// ==UserScript==
// @name         YouTube Enhancements
// @namespace    local.youtube.enhancements
// @version      0.9.3
// @description  Remove YouTube thumbnails and Shorts, auto-unmute video pages, and rotate-to-landscape fake fullscreen on iOS (manual trigger, with playback-speed and seek controls).
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-youtube-enhancements-style';
  const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const IS_IOS = /iP(ad|hone|od)/.test(navigator.platform)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const THUMBNAIL_CONTAINER_SELECTOR = [
    'ytd-thumbnail',
    'ytd-playlist-thumbnail',
    'ytd-video-preview',
    'ytd-moving-thumbnail-renderer',
    'yt-thumbnail-view-model',
    'ytm-thumbnail',
    '.media-item-thumbnail-container',
    '.compact-media-item-image'
  ].join(',');

  const THUMBNAIL_IMAGE_SELECTOR = [
    'ytd-thumbnail img',
    'ytd-playlist-thumbnail img',
    'ytd-video-preview img',
    'ytd-moving-thumbnail-renderer img',
    'ytm-thumbnail img',
    '.media-item-thumbnail-container img',
    '.compact-media-item-image img',
    'a[href^="/watch"] img[src*="ytimg.com/vi"]',
    'a[href^="/shorts"] img[src*="ytimg.com/vi"]'
  ].join(',');

  const SHORTS_HIDE_SELECTOR = [
    // Dedicated Shorts shelves and the sections wrapping them
    'ytd-reel-shelf-renderer',
    'ytd-rich-shelf-renderer[is-shorts]',
    'ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)',
    'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
    'ytd-reel-item-renderer',
    // Sidebar / mini-sidebar nav entries
    'ytd-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
    // Feed items (home grid, search, channel grid, watch-page sidebar) that point to a Short
    'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
    'ytd-video-renderer:has(a[href*="/shorts/"])',
    'ytd-grid-video-renderer:has(a[href*="/shorts/"])',
    'ytd-compact-video-renderer:has(a[href*="/shorts/"])',
    // Mobile (m.youtube.com)
    'ytm-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model',
    // Bottom pivot-bar Shorts tab — these *do* fire in the iOS Safari render
    // (verified: removing them in v0.7.5 left the tab tappable). Don't remove
    // them again without confirming via DevTools that they match nothing.
    'ytm-pivot-bar-item-renderer[tab-identifier="FEshorts"]',
    'ytm-pivot-bar-item-renderer:has(a[href^="/shorts"])',
    'ytm-pivot-bar-item-renderer:has([aria-label="Shorts" i])',
    'ytm-pivot-bar-item-renderer:has([role="tab"][aria-label="Shorts" i])'
  ].join(',');

  // Stable semantic signals YouTube has to keep for accessibility/routing,
  // regardless of how often they rename the wrapper element.
  const SHORTS_TAB_ANCHOR_SELECTOR = '[aria-label="Shorts" i],[tab-identifier="FEshorts"]';
  // Walk up to one of these when hiding the Shorts tab — keep all variants:
  // the v0.7.5 attempt at consolidation regressed clicks on iOS Safari, where
  // a narrower pattern is the one actually reaching the tappable slot.
  const SHORTS_TAB_SLOT_SELECTOR = [
    'ytm-pivot-bar-item-renderer',
    'ytd-guide-entry-renderer',
    'ytd-mini-guide-entry-renderer',
    '[role="tab"]',
    '[class*="pivot-bar-item"]',
    '[class*="pivot-shorts"]',
    '[class*="bottom-bar-item"]',
    '[class*="pivot"]',
    '[class*="bottom-nav"]'
  ].join(',');
  // Renderers that wrap actual video content — never hide one of these even if
  // a descendant happens to have the text "Shorts" (e.g. a video titled "Shorts").
  const SHORTS_TAB_CONTENT_BLOCKLIST = [
    'ytd-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer'
  ].join(',');

  // Fake-fullscreen: bypass iOS native fullscreen (which strips our enhancements
  // and forces the system video player UI). Move the <video> into our own
  // wrapper appended to <body>, then rotate the wrapper. Two iOS pitfalls
  // motivate the reparent: (1) `position: fixed` is scoped to the nearest
  // transformed ancestor, and YouTube has plenty of those — leaving the video
  // in-place puts the rotated element off-screen even though audio plays;
  // (2) iOS Safari's compositor occasionally drops CSS transforms applied
  // directly to <video>, so we transform a div wrapper instead.
  const FAKE_FS_STYLE_ID = 'tm-youtube-fake-fullscreen-style';
  const FAKE_FS_WRAPPER_ID = 'tm-youtube-fake-fullscreen-wrapper';
  const FAKE_FS_DOC_CLASS = 'tm-youtube-fake-fullscreen-active';
  const FAKE_FS_BACKDROP_ID = 'tm-youtube-fake-fullscreen-backdrop';
  const FAKE_FS_EXIT_BTN_ID = 'tm-youtube-fake-fullscreen-exit';
  const FAKE_FS_SPEED_INC_BTN_ID = 'tm-youtube-fake-fullscreen-speed-inc';
  const FAKE_FS_SPEED_DEC_BTN_ID = 'tm-youtube-fake-fullscreen-speed-dec';
  const FAKE_FS_SPEED_BTN_CLASS = 'tm-youtube-fake-fullscreen-speed';
  const FAKE_FS_SPEED_LABEL_ID = 'tm-youtube-fake-fullscreen-speed-label';
  const FAKE_FS_SPEED_STEP = 0.5;
  const FAKE_FS_SPEED_MIN = 0.25;
  const FAKE_FS_SPEED_MAX = 5;
  const FAKE_FS_SEEK_SECONDS = 30;

  const FULLSCREEN_BUTTON_SELECTOR = [
    '.fullscreen-icon',
    '.ytp-fullscreen-button',
    '.player-controls-fullscreen-button',
    'button[aria-label*="Fullscreen" i]',
    'button[aria-label*="Full screen" i]',
    '[role="button"][aria-label*="Fullscreen" i]',
    '[role="button"][aria-label*="Full screen" i]'
  ].join(',');

  let scheduled = false;
  let unmuteTimer = null;
  let fakeFullscreenActive = false;
  // { video, placeholder, wrapper } — captured on enter so exit can put the
  // video back exactly where YouTube had it. Placeholder is a comment node.
  let fakeFullscreenOrigin = null;
  let fakeFullscreenSavedScrollY = 0;
  let fakeFullscreenProgressVideo = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${THUMBNAIL_CONTAINER_SELECTOR},
      img[data-youtube-enhancements-thumbnail-disabled="true"] {
        display: none !important;
      }

      ${SHORTS_HIDE_SELECTOR} {
        display: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function isVideoPage() {
    return location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
  }

  function redirectShortsToWatch() {
    const { pathname, search, hash } = location;

    if (pathname === '/shorts' || pathname === '/shorts/') {
      location.replace('/' + hash);
      return true;
    }

    const match = pathname.match(/^\/shorts\/([^/?#]+)/);
    if (!match) return false;

    const params = new URLSearchParams(search);
    params.set('v', match[1]);
    location.replace(`/watch?${params.toString()}${hash}`);
    return true;
  }

  function findShortsClickTarget(eventTarget) {
    if (!(eventTarget instanceof Element)) return null;
    // Anything pointing at /shorts via href — most reliable signal.
    const link = eventTarget.closest('a[href^="/shorts"], a[href*="youtube.com/shorts"]');
    if (link) return link;
    // Tab-shaped ancestor whose visible label is exactly "Shorts" — covers the
    // iOS Safari pivot-bar case where the tap target is a non-anchor element.
    const tab = eventTarget.closest('[role="tab"], [role="link"], [role="button"], button, ytm-pivot-bar-item-renderer');
    if (!tab) return null;
    const text = (tab.textContent || '').trim().toLowerCase();
    return text === 'shorts' ? tab : null;
  }

  function blockShortsClicks(event) {
    const target = findShortsClickTarget(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const href = target.getAttribute('href') || '';
    const idMatch = href.match(/\/shorts\/([^/?#]+)/);
    if (idMatch) {
      location.assign(`/watch?v=${encodeURIComponent(idMatch[1])}`);
    } else if (location.pathname !== '/') {
      location.assign('/');
    }
  }

  function removeThumbnailElement(el) {
    if (!(el instanceof HTMLElement)) return;
    el.dataset.youtubeEnhancementsThumbnailRemoved = 'true';
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('display', 'none', 'important');
  }

  function getThumbnailContainer(img) {
    if (!(img instanceof HTMLElement)) return null;
    return img.closest(THUMBNAIL_CONTAINER_SELECTOR) || img;
  }

  function disableThumbnailImage(img) {
    if (!(img instanceof HTMLImageElement)) return;

    img.dataset.youtubeEnhancementsThumbnailDisabled = 'true';
    img.removeAttribute('srcset');
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
    img.removeAttribute('data-thumb');

    if (img.src !== BLANK_IMAGE) {
      img.src = BLANK_IMAGE;
    }

    removeThumbnailElement(getThumbnailContainer(img));
  }

  function disableThumbnails() {
    document.querySelectorAll(THUMBNAIL_CONTAINER_SELECTOR).forEach(removeThumbnailElement);
    document.querySelectorAll(THUMBNAIL_IMAGE_SELECTOR).forEach(disableThumbnailImage);
  }

  function hideShortsTabSlot(el) {
    if (!(el instanceof HTMLElement)) return;
    const slot = el.closest(SHORTS_TAB_SLOT_SELECTOR) || el;
    if (slot instanceof HTMLElement) {
      slot.dataset.youtubeEnhancementsShortsHidden = 'true';
      slot.style.setProperty('display', 'none', 'important');
    }
  }

  function hideShortsTabs() {
    // Pass 1: stable anchors (aria-label / tab-identifier).
    document.querySelectorAll(SHORTS_TAB_ANCHOR_SELECTOR).forEach(hideShortsTabSlot);

    // Pass 2: text-node sweep. Catches the iOS Safari mobile case where the
    // pivot-bar tab is a plain element (div / span / custom element) labeled
    // only by its visible text "Shorts" — element tag-agnostic by design.
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = (node.nodeValue || '').trim().toLowerCase();
        return text === 'shorts' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest(SHORTS_TAB_CONTENT_BLOCKLIST)) continue;
      hideShortsTabSlot(parent);
    }
  }

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.find(video => !video.paused || video.readyState > 0) || videos[0] || null;
  }

  function unmuteVideo(video) {
    if (!isVideoPage() || !video) return false;

    video.defaultMuted = false;
    video.muted = false;
    video.removeAttribute('muted');

    return !video.muted;
  }

  function playVideo(video) {
    if (!video) return;

    try {
      const result = video.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Ignore browser-level play blocks.
    }
  }

  function hookVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.dataset.youtubeEnhancementsUnmuteHooked === 'true') return;

    video.dataset.youtubeEnhancementsUnmuteHooked = 'true';
    const maybeUnmute = () => unmuteVideo(video);

    video.addEventListener('loadedmetadata', maybeUnmute);
    video.addEventListener('canplay', maybeUnmute);
    video.addEventListener('playing', maybeUnmute);
  }

  function hookVideos() {
    document.querySelectorAll('video').forEach(hookVideo);
  }

  function unmuteCurrentVideo() {
    return unmuteVideo(getActiveVideo());
  }

  function stopUnmuteTimer() {
    if (!unmuteTimer) return;
    clearInterval(unmuteTimer);
    unmuteTimer = null;
  }

  function startUnmuteWindow() {
    stopUnmuteTimer();
    if (!isVideoPage()) return;

    let tries = 0;
    unmuteTimer = setInterval(() => {
      hookVideos();

      tries++;
      if (unmuteCurrentVideo() || tries >= 24) {
        stopUnmuteTimer();
      }
    }, 250);
  }

  function ensureFakeFullscreenStyles() {
    if (document.getElementById(FAKE_FS_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = FAKE_FS_STYLE_ID;
    // The wrapper carries the rotation. Wrapper is appended to <body>, so
    // it has no transformed ancestor — `position: fixed` resolves to the
    // viewport. Video inside is a plain block sized to fill the wrapper;
    // the inline `width`/`height`/`top`/`left` YouTube sets on the <video>
    // are explicitly cleared so they don't fight our flex/fill rules.
    style.textContent = `
      /* Keep the document vertically scrollable while fake-fullscreen is
         active so a real touch-drag on the wrapper bubbles into a document
         scroll — that's the only thing iOS Safari accepts as a signal to
         collapse the URL bar. Lock horizontal so the rotated overlay can't
         introduce sideways scroll. */
      html.${FAKE_FS_DOC_CLASS},
      html.${FAKE_FS_DOC_CLASS} body {
        overflow-x: hidden !important;
      }

      #${FAKE_FS_BACKDROP_ID} {
        position: fixed !important;
        inset: 0 !important;
        background: #000 !important;
        z-index: 2147483645 !important;
      }

      #${FAKE_FS_WRAPPER_ID} {
        position: fixed !important;
        top: 50vh !important;
        left: 50vw !important;
        top: 50lvh !important;
        left: 50lvw !important;
        width: 100vh !important;
        height: 100vw !important;
        width: 100lvh !important;
        height: 100lvw !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: translate(-50%, -50%) rotate(-90deg) !important;
        transform-origin: center center !important;
        background: #000 !important;
        z-index: 2147483646 !important;
        overflow: hidden !important;
        /* Allow vertical pan gestures to bubble to the document so iOS
           Safari can collapse the URL bar from a real touch scroll. Taps
           remain absorbed by the wrapper (no leak to YouTube UI underneath). */
        touch-action: pan-y !important;
      }

      #${FAKE_FS_WRAPPER_ID} video {
        display: block !important;
        position: static !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
        bottom: auto !important;
        transform: none !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        object-fit: cover !important;
        background: #000 !important;
      }

      #${FAKE_FS_EXIT_BTN_ID} {
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        width: 44px !important;
        height: 44px !important;
        border-radius: 50% !important;
        border: 0 !important;
        background: rgba(0, 0, 0, 0.65) !important;
        color: #fff !important;
        font: 22px/44px -apple-system, system-ui, sans-serif !important;
        text-align: center !important;
        padding: 0 !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        transform: rotate(-90deg) !important;
        transform-origin: center !important;
        -webkit-tap-highlight-color: transparent !important;
      }

      /* Border can't render a partial arc, so the ring is a masked conic-gradient. */
      #${FAKE_FS_EXIT_BTN_ID}::after {
        content: '' !important;
        position: absolute !important;
        inset: -2px !important;
        border-radius: 50% !important;
        background: conic-gradient(
          #f00 calc(var(--tm-fs-progress, 0) * 360deg),
          rgba(255, 255, 255, 0.3) 0deg
        ) !important;
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)) !important;
        mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)) !important;
        pointer-events: none !important;
      }

      .${FAKE_FS_SPEED_BTN_CLASS} {
        position: fixed !important;
        left: 16px !important;
        width: 40px !important;
        height: 40px !important;
        border: 0 !important;
        background: transparent !important;
        color: rgba(255, 255, 255, 0.85) !important;
        font: 30px/40px -apple-system, system-ui, sans-serif !important;
        text-align: center !important;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.8) !important;
        padding: 0 !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        transform: rotate(-90deg) !important;
        transform-origin: center !important;
        -webkit-tap-highlight-color: transparent !important;
      }

      /* Overlay is rotated -90deg, so these physical top-left buttons render at
         the user's upper-right; a larger top offset shifts a button left there. */
      #${FAKE_FS_SPEED_DEC_BTN_ID} {
        top: 64px !important;
      }

      #${FAKE_FS_SPEED_INC_BTN_ID} {
        top: 16px !important;
      }

      /* Physical bottom-left renders at the user's upper-left, opposite the pair. */
      #${FAKE_FS_SPEED_LABEL_ID} {
        position: fixed !important;
        bottom: 16px !important;
        left: 16px !important;
        min-width: 56px !important;
        height: 40px !important;
        color: rgba(255, 255, 255, 0.9) !important;
        font: 600 20px/40px -apple-system, system-ui, sans-serif !important;
        text-align: center !important;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.8) !important;
        z-index: 2147483647 !important;
        transform: rotate(-90deg) !important;
        transform-origin: center !important;
        pointer-events: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBackdrop() {
    let backdrop = document.getElementById(FAKE_FS_BACKDROP_ID);
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = FAKE_FS_BACKDROP_ID;
    (document.body || document.documentElement).appendChild(backdrop);
    return backdrop;
  }

  function removeBackdrop() {
    const backdrop = document.getElementById(FAKE_FS_BACKDROP_ID);
    if (backdrop) backdrop.remove();
  }

  function ensureExitButton() {
    let btn = document.getElementById(FAKE_FS_EXIT_BTN_ID);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = FAKE_FS_EXIT_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Exit fake fullscreen');
    btn.textContent = '✕';
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitFakeFullscreen();
    }, true);

    (document.body || document.documentElement).appendChild(btn);
    return btn;
  }

  function removeExitButton() {
    const btn = document.getElementById(FAKE_FS_EXIT_BTN_ID);
    if (btn) btn.remove();
  }

  function getFakeFullscreenVideo() {
    return (fakeFullscreenOrigin && fakeFullscreenOrigin.video)
      || fakeFullscreenProgressVideo
      || getActiveVideo();
  }

  function adjustPlaybackRate(delta) {
    const video = getFakeFullscreenVideo();
    if (!video) return;
    const next = Math.min(
      FAKE_FS_SPEED_MAX,
      Math.max(FAKE_FS_SPEED_MIN, Math.round((video.playbackRate + delta) * 100) / 100)
    );
    video.playbackRate = next;
  }

  function ensureSpeedButton(id, label, delta) {
    let btn = document.getElementById(id);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = FAKE_FS_SPEED_BTN_CLASS;
    btn.setAttribute('aria-label', delta > 0 ? 'Increase playback speed' : 'Decrease playback speed');
    btn.textContent = label;
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      adjustPlaybackRate(delta);
    }, true);

    (document.body || document.documentElement).appendChild(btn);
    return btn;
  }

  function ensureSpeedButtons() {
    ensureSpeedButton(FAKE_FS_SPEED_INC_BTN_ID, '+', FAKE_FS_SPEED_STEP);
    ensureSpeedButton(FAKE_FS_SPEED_DEC_BTN_ID, '−', -FAKE_FS_SPEED_STEP);
  }

  function removeSpeedButtons() {
    [FAKE_FS_SPEED_INC_BTN_ID, FAKE_FS_SPEED_DEC_BTN_ID].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.remove();
    });
  }

  function formatSpeedLabel(rate) {
    return `${Number(rate.toFixed(2))}×`;
  }

  function ensureSpeedLabel() {
    let label = document.getElementById(FAKE_FS_SPEED_LABEL_ID);
    if (label) return label;

    label = document.createElement('div');
    label.id = FAKE_FS_SPEED_LABEL_ID;
    (document.body || document.documentElement).appendChild(label);
    return label;
  }

  function removeSpeedLabel() {
    const label = document.getElementById(FAKE_FS_SPEED_LABEL_ID);
    if (label) label.remove();
  }

  function updateSpeedLabel() {
    const label = document.getElementById(FAKE_FS_SPEED_LABEL_ID);
    if (!label || !fakeFullscreenProgressVideo) return;
    label.textContent = formatSpeedLabel(fakeFullscreenProgressVideo.playbackRate);
  }

  function handleFakeFullscreenTap(event) {
    // Reparenting only the <video> orphans YouTube's own tap-to-pause handler
    // (it lives on the player container), so restore the gesture here. The
    // rotated overlay's physical top is the viewer's right (forward) side.
    const video = getFakeFullscreenVideo();
    if (!video) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientY - rect.top) / rect.height;
    if (position < 1 / 3) {
      video.currentTime = Math.min(
        Number.isFinite(video.duration) ? video.duration : Infinity,
        video.currentTime + FAKE_FS_SEEK_SECONDS
      );
      return;
    }
    if (position > 2 / 3) {
      video.currentTime = Math.max(0, video.currentTime - FAKE_FS_SEEK_SECONDS);
      return;
    }

    if (video.paused) playVideo(video);
    else video.pause();
  }

  function updateExitButtonProgress() {
    const btn = document.getElementById(FAKE_FS_EXIT_BTN_ID);
    if (!btn || !fakeFullscreenProgressVideo) return;
    const { currentTime, duration } = fakeFullscreenProgressVideo;
    // Live streams report Infinity duration; keep the ring empty.
    const ratio = Number.isFinite(duration) && duration > 0
      ? Math.min(1, Math.max(0, currentTime / duration))
      : 0;
    btn.style.setProperty('--tm-fs-progress', ratio);
  }

  function startExitButtonProgress(video) {
    stopExitButtonProgress();
    if (!video) return;
    fakeFullscreenProgressVideo = video;
    video.addEventListener('timeupdate', updateExitButtonProgress);
    video.addEventListener('durationchange', updateExitButtonProgress);
    video.addEventListener('ratechange', updateSpeedLabel);
    updateExitButtonProgress();
    updateSpeedLabel();
  }

  function stopExitButtonProgress() {
    if (!fakeFullscreenProgressVideo) return;
    fakeFullscreenProgressVideo.removeEventListener('timeupdate', updateExitButtonProgress);
    fakeFullscreenProgressVideo.removeEventListener('durationchange', updateExitButtonProgress);
    fakeFullscreenProgressVideo.removeEventListener('ratechange', updateSpeedLabel);
    fakeFullscreenProgressVideo = null;
  }

  function enterFakeFullscreen() {
    if (fakeFullscreenActive) return;
    const video = getActiveVideo();
    if (!video || !video.parentNode || !document.body) return;

    fakeFullscreenSavedScrollY = window.scrollY || window.pageYOffset || 0;
    ensureFakeFullscreenStyles();
    fakeFullscreenActive = true;
    document.documentElement.classList.add(FAKE_FS_DOC_CLASS);
    ensureBackdrop();

    const wasPlaying = !video.paused;
    const placeholder = document.createComment('tm-yt-fakefs');
    video.parentNode.insertBefore(placeholder, video);

    const wrapper = document.createElement('div');
    wrapper.id = FAKE_FS_WRAPPER_ID;
    wrapper.appendChild(video);
    wrapper.addEventListener('click', handleFakeFullscreenTap, true);
    document.body.appendChild(wrapper);

    fakeFullscreenOrigin = { video, placeholder, wrapper };

    // Reparenting briefly detaches the <video>; some iOS Safari builds pause
    // it. Resume immediately to keep playback continuous.
    if (wasPlaying && video.paused) playVideo(video);

    ensureExitButton();
    ensureSpeedButtons();
    ensureSpeedLabel();
    startExitButtonProgress(video);
  }

  function exitFakeFullscreen() {
    if (!fakeFullscreenActive) return;
    fakeFullscreenActive = false;
    document.documentElement.classList.remove(FAKE_FS_DOC_CLASS);

    if (fakeFullscreenOrigin) {
      const { video, placeholder, wrapper } = fakeFullscreenOrigin;
      const wasPlaying = !video.paused;
      if (placeholder.parentNode) {
        placeholder.parentNode.insertBefore(video, placeholder);
        placeholder.remove();
      }
      if (wrapper.parentNode) wrapper.remove();
      fakeFullscreenOrigin = null;
      if (wasPlaying && video.paused) playVideo(video);
    }

    removeBackdrop();
    removeExitButton();
    removeSpeedButtons();
    removeSpeedLabel();
    stopExitButtonProgress();

    try {
      window.scrollTo({ top: fakeFullscreenSavedScrollY, left: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, fakeFullscreenSavedScrollY);
    }
  }

  function handleFullscreenButtonClick(event) {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest(FULLSCREEN_BUTTON_SELECTOR);
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (fakeFullscreenActive) {
      exitFakeFullscreen();
    } else {
      enterFakeFullscreen();
    }
  }

  function patchFullscreenAPIs() {
    // YouTube's mobile player sometimes calls webkitEnterFullscreen() directly
    // on the <video>, bypassing the fullscreen button entirely. Redirect it.
    if (typeof HTMLVideoElement === 'undefined') return;
    const proto = HTMLVideoElement.prototype;

    if (typeof proto.webkitEnterFullscreen === 'function') {
      overrideMethod(proto, 'webkitEnterFullscreen', function () {
        enterFakeFullscreen();
      });
    }
    if (typeof proto.requestFullscreen === 'function') {
      overrideMethod(proto, 'requestFullscreen', function () {
        enterFakeFullscreen();
        return Promise.resolve();
      });
    }
  }

  function installFakeFullscreen() {
    if (!IS_IOS) return;
    ensureFakeFullscreenStyles();
    patchFullscreenAPIs();
    document.addEventListener('click', handleFullscreenButtonClick, true);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && fakeFullscreenActive) exitFakeFullscreen();
    });
  }

  function runEnhancements() {
    ensureStyles();
    disableThumbnails();
    hideShortsTabs();
    hookVideos();
    unmuteCurrentVideo();
  }

  function scheduleEnhancements() {
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      runEnhancements();
    });
  }

  function handleNavigation() {
    if (fakeFullscreenActive) exitFakeFullscreen();
    if (redirectShortsToWatch()) return;
    scheduleEnhancements();
    startUnmuteWindow();
  }

  function overrideMethod(target, name, fn) {
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        value: fn
      });
    } catch {
      // Some browser methods are not configurable.
    }
  }

  function patchHistory() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(handleNavigation, 150);
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(handleNavigation, 150);
      return result;
    };
  }

  function startObserver() {
    if (!document.body) return;

    const observer = new MutationObserver(scheduleEnhancements);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'style']
    });
  }

  function start() {
    ensureStyles();
    patchHistory();
    startObserver();
    handleNavigation();
  }

  window.addEventListener('yt-navigate-finish', handleNavigation);
  window.addEventListener('popstate', handleNavigation);
  window.addEventListener('hashchange', handleNavigation);

  // Capture-phase click guard: even if every hide pass missed the Shorts tab,
  // intercept the click before YouTube's bubble-phase handlers see it.
  document.addEventListener('click', blockShortsClicks, true);

  installFakeFullscreen();
  ensureStyles();

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
