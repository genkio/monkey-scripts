// ==UserScript==
// @name         X Video Downloader
// @namespace    local.x.video-downloader
// @version      0.1.0
// @description  Adds a download button to videos in X/Twitter posts. Picks the highest-bitrate MP4 variant exposed by X's GraphQL responses.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://*.twitter.com/*
// @grant        GM_download
// @grant        GM.download
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

// Adapted from cxa/xvdl (https://github.com/cxa/xvdl) — Safari extension, MIT-spirit.

/* global GM_download, GM, unsafeWindow */

(function () {
  'use strict';

  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const STYLE_ID = 'tm-xvdl-style';
  const BUTTON_CLASS = 'tm-xvdl-button';
  const HOST_CLASS = 'tm-xvdl-host';
  const TOAST_CLASS = 'tm-xvdl-toast';
  const MAX_RESPONSE_CHARS = 10_000_000;

  const mediaByTweetId = new Map();
  const xhrUrls = new WeakMap();
  const toastTimers = new WeakMap();
  let scanScheduled = false;

  installProbe();
  injectStyles();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  function start() {
    scan();

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'aria-label', 'data-testid']
    });

    patchHistory();
    window.addEventListener('locationchange', scheduleScan);
  }

  // ---------------------------------------------------------------------------
  // Network probe — wraps fetch + XHR on the page window and watches resource
  // entries for direct mp4/m3u8 hits we may not have intercepted.
  // ---------------------------------------------------------------------------

  function installProbe() {
    if (win.__tmXvdlProbeInstalled) return;
    win.__tmXvdlProbeInstalled = true;

    const originalFetch = win.fetch;
    if (typeof originalFetch === 'function') {
      win.fetch = function tmXvdlFetch(...args) {
        const result = originalFetch.apply(this, args);
        Promise.resolve(result)
          .then(response => inspectResponse(response.url || getRequestUrl(args[0]), response.clone()))
          .catch(noop);
        return result;
      };
    }

    const xhrProto = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (xhrProto) {
      const originalOpen = xhrProto.open;
      const originalSend = xhrProto.send;

      xhrProto.open = function tmXvdlOpen() {
        try { xhrUrls.set(this, String(arguments[1] || '')); } catch { noop(); }
        return originalOpen.apply(this, arguments);
      };

      xhrProto.send = function tmXvdlSend() {
        try {
          this.addEventListener('loadend', () => inspectXhr(this), { once: true });
        } catch { noop(); }
        return originalSend.apply(this, arguments);
      };
    }

    observeResources();
    inspectExistingScripts();
  }

  function observeResources() {
    if (!('PerformanceObserver' in win)) return;

    try {
      const observer = new win.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const url = entry.name || '';
          if (/https:\/\/video\.twimg\.com\/.+\.(?:mp4|m3u8)(?:\?|$)/i.test(url)) {
            handleItems([{ tweetId: '', source: 'performance', variants: [variantFromUrl(url)] }]);
          }
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      noop();
    }
  }

  function inspectExistingScripts() {
    for (const script of document.scripts || []) {
      const text = script.textContent || '';
      if (text.includes('video_info') || text.includes('video.twimg.com')) {
        inspectText('inline-script', text);
      }
    }
  }

  function getRequestUrl(request) {
    if (typeof request === 'string') return request;
    return request?.url || '';
  }

  async function inspectResponse(url, response) {
    if (!isInterestingUrl(url)) return;

    const contentType = response.headers?.get?.('content-type') || '';
    if (!/json|javascript|text/i.test(contentType) && !/graphql|\/i\/api\//i.test(url)) return;

    let text = '';
    try {
      text = await response.text();
    } catch {
      return;
    }
    inspectText(url, text);
  }

  function inspectXhr(xhr) {
    const url = xhr.responseURL || xhrUrls.get(xhr) || '';
    if (!isInterestingUrl(url) || xhr.status < 200 || xhr.status >= 400) return;

    const contentType = xhr.getResponseHeader?.('content-type') || '';
    if (!/json|javascript|text/i.test(contentType) && !/graphql|\/i\/api\//i.test(url)) return;
    if (xhr.responseType && xhr.responseType !== 'text') return;

    inspectText(url, xhr.responseText || '');
  }

  function inspectText(url, text) {
    if (!text || text.length > MAX_RESPONSE_CHARS) return;
    const items = extractItemsFromText(text, url);
    if (items.length > 0) handleItems(items);
  }

  function isInterestingUrl(url) {
    return /(?:x|twitter)\.com\/i\/api|graphql|video\.twimg\.com|syndication\.twitter\.com/i.test(String(url || ''));
  }

  // ---------------------------------------------------------------------------
  // JSON walking — find tweet objects and their video_info.variants regardless
  // of where they're nested in X's GraphQL response shapes.
  // ---------------------------------------------------------------------------

  function extractItemsFromText(text, source) {
    const items = [];
    for (const json of findJsonObjects(text)) {
      items.push(...extractMediaItems(json, source));
    }
    return dedupeItems(items);
  }

  function findJsonObjects(text) {
    const trimmed = text.trim();
    const objects = [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        objects.push(JSON.parse(trimmed));
        return objects;
      } catch { /* fall through */ }
    }

    const markers = ['__INITIAL_STATE__', '__NEXT_DATA__', 'video_info', 'extended_entities'];
    if (!markers.some(marker => text.includes(marker))) return objects;

    for (const candidate of extractBalancedJsonCandidates(text)) {
      try { objects.push(JSON.parse(candidate)); } catch { noop(); }
    }
    return objects;
  }

  function extractBalancedJsonCandidates(text) {
    const candidates = [];
    const starts = [];

    for (const marker of ['{"', '[{"', '{\\"', '[{\\"']) {
      let index = text.indexOf(marker);
      while (index !== -1 && starts.length < 30) {
        starts.push(index);
        index = text.indexOf(marker, index + marker.length);
      }
    }
    starts.sort((a, b) => a - b);

    for (const start of starts) {
      const candidate = readBalancedJson(text, start);
      if (candidate && /video_info|video\.twimg\.com|extended_entities/.test(candidate)) {
        candidates.push(candidate.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      }
    }
    return candidates;
  }

  function readBalancedJson(text, start) {
    const opener = text[start];
    const closer = opener === '[' ? ']' : '}';
    const stack = [closer];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < text.length; i++) {
      const c = text[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (c === '{' || c === '[') {
        stack.push(c === '{' ? '}' : ']');
      } else if (c === '}' || c === ']') {
        if (stack.pop() !== c) return '';
        if (stack.length === 0) return text.slice(start, i + 1);
      }
    }
    return '';
  }

  function extractMediaItems(root, source) {
    const items = [];
    const seen = new WeakSet();

    walk(root, '', null);
    return items;

    function walk(value, tweetId, parentMedia) {
      if (!value || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      const nextTweetId = getTweetId(value) || tweetId;
      const media = getMediaObject(value) || parentMedia;
      const variants = getVariants(value);

      if (variants.length > 0) {
        const inferredTweetId =
          nextTweetId || getTweetIdFromMedia(media) || getTweetIdFromMedia(value);
        if (inferredTweetId) {
          items.push({
            tweetId: inferredTweetId,
            source,
            poster: getPoster(media || value),
            variants
          });
        }
      }

      if (Array.isArray(value)) {
        for (const child of value) walk(child, nextTweetId, media);
        return;
      }
      for (const child of Object.values(value)) walk(child, nextTweetId, media);
    }
  }

  function getTweetId(value) {
    if (!value || typeof value !== 'object') return '';
    if (isTweetObject(value)) return toTweetId(value.rest_id || value.id_str || value.id);
    if (value.legacy && typeof value.legacy === 'object' && isTweetObject(value.legacy)) {
      return toTweetId(value.rest_id || value.legacy.id_str || value.legacy.id);
    }
    return '';
  }

  function isTweetObject(value) {
    if (!value || typeof value !== 'object') return false;
    return Boolean(
      value.full_text ||
        value.entities ||
        value.extended_entities ||
        value.conversation_id_str ||
        (value.created_at && (value.id_str || value.rest_id || value.id))
    );
  }

  function getMediaObject(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.video_info || value.media_url_https || value.expanded_url) return value;
    return null;
  }

  function getVariants(value) {
    const variants = value?.video_info?.variants || value?.variants || [];
    if (!Array.isArray(variants)) return [];
    return variants
      .filter(v => v?.url)
      .map(v => ({
        url: normalizeMediaUrl(v.url),
        bitrate: Number(v.bitrate || 0),
        contentType: v.content_type || v.contentType || contentTypeFromUrl(v.url)
      }))
      .filter(v => /^https:\/\/video\.twimg\.com\//i.test(v.url));
  }

  function variantFromUrl(url) {
    return {
      url: normalizeMediaUrl(url),
      bitrate: bitrateFromUrl(url),
      contentType: contentTypeFromUrl(url)
    };
  }

  function getPoster(media) {
    return media?.media_url_https || media?.media_url || media?.preview_image_url || '';
  }

  function getTweetIdFromMedia(media) {
    const values = [media?.expanded_url, media?.url, media?.display_url];
    for (const value of values) {
      const id = toTweetId(String(value || '').match(/\/status(?:es)?\/(\d+)/)?.[1]);
      if (id) return id;
    }
    return '';
  }

  function toTweetId(value) {
    const text = String(value || '');
    return /^\d{5,}$/.test(text) ? text : '';
  }

  function normalizeMediaUrl(url) {
    return String(url || '').replace(/\\u0026/g, '&');
  }

  function contentTypeFromUrl(url) {
    if (/\.m3u8(?:\?|$)/i.test(url)) return 'application/x-mpegURL';
    if (/\.mp4(?:\?|$)/i.test(url)) return 'video/mp4';
    return '';
  }

  function bitrateFromUrl(url) {
    const match = String(url || '').match(/\/(\d{3,5})k\//i);
    return match ? Number(match[1]) * 1000 : 0;
  }

  function dedupeItems(items) {
    const byTweetId = new Map();
    for (const item of items) {
      if (!item.tweetId) continue;
      const previous = byTweetId.get(item.tweetId);
      if (!previous) { byTweetId.set(item.tweetId, item); continue; }

      const variants = new Map(previous.variants.map(v => [v.url, v]));
      for (const v of item.variants) variants.set(v.url, v);

      byTweetId.set(item.tweetId, {
        ...previous,
        poster: previous.poster || item.poster,
        variants: [...variants.values()]
      });
    }
    return [...byTweetId.values()];
  }

  function handleItems(items) {
    let changed = false;
    for (const item of items) {
      if (!item.tweetId || !Array.isArray(item.variants) || item.variants.length === 0) continue;
      const previous = mediaByTweetId.get(item.tweetId);
      mediaByTweetId.set(item.tweetId, mergeMediaItem(previous, item));
      changed = true;
    }
    if (changed) scheduleScan();
  }

  function mergeMediaItem(previous, item) {
    const variants = new Map();
    for (const v of previous?.variants || []) if (v.url) variants.set(v.url, v);
    for (const v of item.variants || []) if (v.url) variants.set(v.url, v);

    return {
      tweetId: item.tweetId || previous?.tweetId,
      poster: item.poster || previous?.poster || '',
      source: item.source || previous?.source || '',
      variants: [...variants.values()].sort(compareVariants)
    };
  }

  // ---------------------------------------------------------------------------
  // DOM scanner — find video tweets and inject a download button overlay.
  // ---------------------------------------------------------------------------

  function patchHistory() {
    if (win.__tmXvdlHistoryPatched) return;
    win.__tmXvdlHistoryPatched = true;

    const notify = () => window.dispatchEvent(new Event('locationchange'));
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function patched() {
        const result = original.apply(this, arguments);
        notify();
        return result;
      };
    }
    window.addEventListener('popstate', notify);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => { scanScheduled = false; scan(); });
  }

  function scan() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"], article')) {
      enhanceArticle(article);
    }
  }

  function enhanceArticle(article) {
    if (!(article instanceof HTMLElement)) return;

    const hasVideo = Boolean(
      article.querySelector('video') ||
        article.querySelector('[data-testid="videoPlayer"]') ||
        article.querySelector('[aria-label*="Play video" i]')
    );

    const existing = article.querySelector(':scope .' + BUTTON_CLASS);
    if (!hasVideo) { existing?.remove(); return; }

    const tweetId = findTweetId(article);
    const media = tweetId ? mediaByTweetId.get(tweetId) : null;
    const target = findVideoOverlayHost(article);
    if (!target) return;

    target.classList.add(HOST_CLASS);

    const button = existing || createButton();
    button.dataset.tweetId = tweetId || '';
    updateButton(button, media, tweetId);

    if (button.parentElement !== target) target.append(button);
  }

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute('aria-label', 'Download video');
    button.title = 'Download video';
    button.innerHTML = [
      '<svg class="tm-xvdl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">',
      '<path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
      '</svg>',
      '<span>Save</span>'
    ].join('');
    button.addEventListener('click', onDownloadClick, true);
    return button;
  }

  function updateButton(button, media, tweetId) {
    const ready = Boolean(media && chooseBestVariant(media));
    button.disabled = false;
    button.setAttribute('aria-disabled', String(!ready));
    button.classList.toggle(BUTTON_CLASS + '--ready', ready);
    button.classList.toggle(BUTTON_CLASS + '--pending', !ready);
    button.title = ready
      ? describeBestVariant(media)
      : tweetId ? 'Video URL is still loading' : 'Waiting for post video data';
  }

  async function onDownloadClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const tweetId = button.dataset.tweetId;
    const media = mediaByTweetId.get(tweetId);
    const variant = media ? chooseBestVariant(media) : null;
    const toastHost = button.parentElement instanceof HTMLElement ? button.parentElement : document.body;

    if (!tweetId || !variant) {
      flashButton(button, 'pending');
      showToast(toastHost, 'Video URL not available yet — try again in a moment.', 'error');
      return;
    }

    button.classList.add(BUTTON_CLASS + '--busy');
    try {
      const filename = buildFilename(tweetId, variant);
      await downloadFile(variant.url, filename);
      flashButton(button, 'done');
      showToast(toastHost, 'Saved: ' + filename, 'done');
    } catch (error) {
      console.warn('[X Video Downloader] Download failed.', error);
      flashButton(button, 'error');
      showToast(toastHost, 'Download failed: ' + (error?.message || error), 'error');
    } finally {
      button.classList.remove(BUTTON_CLASS + '--busy');
    }
  }

  function downloadFile(url, name) {
    return new Promise((resolve, reject) => {
      const gmDownload =
        (typeof GM_download === 'function' && GM_download) ||
        (typeof GM !== 'undefined' && typeof GM.download === 'function' && GM.download.bind(GM));

      if (!gmDownload) {
        // Fallback: open the mp4 in a new tab so the user can save manually.
        window.open(url, '_blank', 'noopener');
        resolve();
        return;
      }

      try {
        gmDownload({
          url,
          name,
          saveAs: false,
          onload: () => resolve(),
          onerror: err => reject(new Error(err?.error || err?.details || 'GM_download failed')),
          ontimeout: () => reject(new Error('Download timed out'))
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function findVideoOverlayHost(article) {
    const candidates = article.querySelectorAll(
      '[data-testid="videoPlayer"], video, [aria-label*="Play video" i]'
    );
    for (const c of candidates) {
      const host = normalizeVideoHost(c, article);
      if (host) return host;
    }
    return null;
  }

  function normalizeVideoHost(candidate, article) {
    let host = candidate;
    if (host instanceof HTMLVideoElement) host = host.parentElement;
    if (!(host instanceof HTMLElement)) return null;

    const player = host.closest('[data-testid="videoPlayer"]');
    if (player instanceof HTMLElement && article.contains(player)) return player;

    if (/^(a|button)$/i.test(host.tagName)) host = host.parentElement;

    while (host instanceof HTMLElement && host !== article) {
      if (host.querySelector('video') || host.matches('[aria-label*="Play video" i]')) return host;
      host = host.parentElement;
    }
    return null;
  }

  function findTweetId(article) {
    const currentUrlId = getTweetIdFromUrl(location.href);
    const candidates = [];

    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const id = getTweetIdFromUrl(a.href);
      if (id) candidates.push(id);
    }

    if (currentUrlId && candidates.includes(currentUrlId)) return currentUrlId;

    const timeLink = article.querySelector('time')?.closest('a[href*="/status/"]');
    const timeLinkId = timeLink ? getTweetIdFromUrl(timeLink.href) : '';
    if (timeLinkId) return timeLinkId;

    return candidates[0] || currentUrlId || '';
  }

  function getTweetIdFromUrl(value) {
    try {
      const match = new URL(value, location.origin).pathname.match(/\/status(?:es)?\/(\d+)/);
      return match?.[1] || '';
    } catch {
      return '';
    }
  }

  function chooseBestVariant(media) {
    return [...(media.variants || [])].filter(isMp4Variant).sort(compareVariants)[0] || null;
  }

  function compareVariants(a, b) {
    const aMp4 = isMp4Variant(a);
    const bMp4 = isMp4Variant(b);
    if (aMp4 !== bMp4) return aMp4 ? -1 : 1;
    return Number(b.bitrate || 0) - Number(a.bitrate || 0);
  }

  function isMp4Variant(variant) {
    return /video\/mp4/i.test(variant?.contentType || '') || isMp4Url(variant?.url);
  }

  function isMp4Url(url) {
    return /\.mp4(?:\?|$)/i.test(String(url || ''));
  }

  function describeBestVariant(media) {
    const variant = chooseBestVariant(media);
    const bitrate = Number(variant?.bitrate || 0);
    return bitrate > 0 ? `Download video (${Math.round(bitrate / 1000)} kbps)` : 'Download video';
  }

  function buildFilename(tweetId, variant) {
    const extension = isMp4Url(variant.url) ? 'mp4' : 'm3u8';
    const bitrate = Number(variant.bitrate || 0);
    const quality = bitrate > 0 ? `-${Math.round(bitrate / 1000)}kbps` : '';
    return `x-${tweetId}${quality}.${extension}`;
  }

  function flashButton(button, state) {
    button.dataset.xvdlFlash = state;
    setTimeout(() => {
      if (button.dataset.xvdlFlash === state) delete button.dataset.xvdlFlash;
    }, 900);
  }

  function showToast(host, message, state) {
    const toast = getToast(host);
    toast.textContent = message;
    toast.title = message;
    toast.dataset.xvdlState = state;
    toast.classList.add(TOAST_CLASS + '--visible');

    clearTimeout(toastTimers.get(toast));
    toastTimers.set(toast, setTimeout(() => {
      toast.classList.remove(TOAST_CLASS + '--visible');
    }, state === 'error' ? 6000 : 3600));
  }

  function getToast(host) {
    const existing = [...host.children].find(c => c.classList?.contains(TOAST_CLASS));
    if (existing instanceof HTMLElement) return existing;

    const toast = document.createElement('div');
    toast.className = TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    host.append(toast);
    return toast;
  }

  // ---------------------------------------------------------------------------
  // Styles — lifted (with the prefix renamed) from xvdl/extension/styles.css.
  // ---------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HOST_CLASS} { position: relative !important; }

      .${BUTTON_CLASS} {
        all: unset;
        align-items: center;
        backdrop-filter: blur(10px);
        background: rgba(0, 0, 0, 0.66);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
        box-sizing: border-box;
        color: #ffffff;
        cursor: pointer;
        display: inline-flex;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        gap: 5px;
        height: 28px;
        justify-content: center;
        padding: 0 10px;
        position: absolute;
        right: 10px;
        top: 10px;
        transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease;
        user-select: none;
        white-space: nowrap;
        z-index: 2147483647;
      }
      .${BUTTON_CLASS} svg {
        display: block;
        flex: 0 0 auto;
        height: 15px;
        pointer-events: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 3;
        width: 15px;
      }
      .${BUTTON_CLASS} span { pointer-events: none; }
      .${BUTTON_CLASS}:hover {
        background: rgba(29, 155, 240, 0.9);
        border-color: rgba(255, 255, 255, 0.45);
      }
      .${BUTTON_CLASS}[aria-disabled="true"],
      .${BUTTON_CLASS}--pending {
        cursor: default;
        opacity: 0.62;
      }
      .${BUTTON_CLASS}[aria-disabled="true"]:hover,
      .${BUTTON_CLASS}--pending:hover {
        background: rgba(0, 0, 0, 0.66);
        border-color: rgba(255, 255, 255, 0.24);
      }
      .${BUTTON_CLASS}--busy {
        opacity: 0.72;
        transform: scale(0.94);
      }
      .${BUTTON_CLASS}[data-xvdl-flash="done"] {
        background: rgba(0, 186, 124, 0.92);
        border-color: rgba(255, 255, 255, 0.5);
      }
      .${BUTTON_CLASS}[data-xvdl-flash="error"] {
        background: rgba(244, 33, 46, 0.92);
        border-color: rgba(255, 255, 255, 0.5);
      }

      .${TOAST_CLASS} {
        backdrop-filter: blur(14px);
        background: rgba(15, 20, 25, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        bottom: 10px;
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
        box-sizing: border-box;
        color: #ffffff;
        display: block;
        font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 10px;
        max-height: min(42%, 112px);
        opacity: 0;
        overflow: auto;
        padding: 10px 14px;
        pointer-events: none;
        position: absolute;
        right: 10px;
        text-align: center;
        transform: translateY(8px);
        transition: opacity 160ms ease, transform 160ms ease;
        white-space: normal;
        word-break: break-word;
        z-index: 2147483647;
      }
      .${TOAST_CLASS}--visible { opacity: 1; transform: translateY(0); }
      .${TOAST_CLASS}[data-xvdl-state="done"]  { border-color: rgba(0, 186, 124, 0.5); }
      .${TOAST_CLASS}[data-xvdl-state="error"] { border-color: rgba(244, 33, 46, 0.58); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function noop() {}
})();
