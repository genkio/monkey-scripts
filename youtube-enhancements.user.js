// ==UserScript==
// @name         YouTube Enhancements
// @namespace    local.youtube.enhancements
// @version      0.7.3
// @description  Remove YouTube thumbnails and Shorts, auto-unmute video pages, and keep iOS background playback alive.
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
  const BACKGROUND_PLAY_EVENTS = [
    'visibilitychange',
    'webkitvisibilitychange',
    'pagehide',
    'freeze',
    'blur'
  ];

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
    // Bottom pivot-bar Shorts tab — multiple selectors so we still hit it if YouTube swaps href/aria
    'ytm-pivot-bar-item-renderer[tab-identifier="FEshorts"]',
    'ytm-pivot-bar-item-renderer:has(a[href^="/shorts"])',
    'ytm-pivot-bar-item-renderer:has([aria-label="Shorts" i])',
    'ytm-pivot-bar-item-renderer:has([role="tab"][aria-label="Shorts" i])'
  ].join(',');

  // Stable semantic signals YouTube has to keep for accessibility/routing,
  // regardless of how often they rename the wrapper element.
  const SHORTS_TAB_ANCHOR_SELECTOR = '[aria-label="Shorts" i],[tab-identifier="FEshorts"]';
  const SHORTS_TAB_SLOT_SELECTOR = [
    'ytm-pivot-bar-item-renderer',
    'ytd-guide-entry-renderer',
    'ytd-mini-guide-entry-renderer',
    '[role="tab"]',
    '[class*="pivot-bar-item"]',
    '[class*="pivot-shorts"]',
    '[class*="bottom-bar-item"]'
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

  let scheduled = false;
  let unmuteTimer = null;
  let backgroundResumeUntil = 0;
  let backgroundResumeTimer = null;

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

  function shouldKeepBackgroundPlaybackAlive() {
    return IS_IOS && isVideoPage();
  }

  function isBackgroundResumeWindowActive() {
    return shouldKeepBackgroundPlaybackAlive() && Date.now() < backgroundResumeUntil;
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

    // Pass 2: text-content fallback for renders (e.g. iOS Safari mobile) where
    // the tab is a plain <a>/<button> labeled only by visible text "Shorts".
    document.querySelectorAll('a, button').forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      if (el.dataset.youtubeEnhancementsShortsHidden === 'true') return;
      const text = (el.textContent || '').trim();
      if (text.length === 0 || text.length > 20) return;
      if (text.toLowerCase() !== 'shorts') return;
      // Avoid hiding actual video items that happen to be titled "Shorts".
      if (el.closest(SHORTS_TAB_CONTENT_BLOCKLIST)) return;
      hideShortsTabSlot(el);
    });
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

  function resumeBackgroundVideo(video) {
    if (!isBackgroundResumeWindowActive() || !video) return;
    unmuteVideo(video);
    if (video.paused) playVideo(video);
  }

  function startBackgroundResumeWindow() {
    if (!shouldKeepBackgroundPlaybackAlive()) return;

    backgroundResumeUntil = Date.now() + 6000;
    if (backgroundResumeTimer) return;

    let tries = 0;
    backgroundResumeTimer = setInterval(() => {
      tries++;
      resumeBackgroundVideo(getActiveVideo());

      if (!isBackgroundResumeWindowActive() || tries >= 24) {
        clearInterval(backgroundResumeTimer);
        backgroundResumeTimer = null;
      }
    }, 250);
  }

  function preventBackgroundPauseEvent(event) {
    if (!shouldKeepBackgroundPlaybackAlive()) return;

    startBackgroundResumeWindow();
    event.stopImmediatePropagation();

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
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
    video.addEventListener('pause', () => resumeBackgroundVideo(video), true);
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
    if (redirectShortsToWatch()) return;
    scheduleEnhancements();
    startUnmuteWindow();
  }

  function overrideProperty(target, name, value) {
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        get: () => value
      });
    } catch {
      // Some browser properties are not configurable.
    }
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

  function forceVisiblePageState() {
    overrideProperty(document, 'hidden', false);
    overrideProperty(document, 'visibilityState', 'visible');
    overrideProperty(document, 'webkitHidden', false);
    overrideProperty(document, 'webkitVisibilityState', 'visible');
    overrideMethod(document, 'hasFocus', () => true);

    if (typeof Document !== 'undefined') {
      overrideProperty(Document.prototype, 'hidden', false);
      overrideProperty(Document.prototype, 'visibilityState', 'visible');
      overrideProperty(Document.prototype, 'webkitHidden', false);
      overrideProperty(Document.prototype, 'webkitVisibilityState', 'visible');
      overrideMethod(Document.prototype, 'hasFocus', () => true);
    }
  }

  function patchMediaPause() {
    const originalPause = HTMLMediaElement.prototype.pause;

    HTMLMediaElement.prototype.pause = function (...args) {
      if (this instanceof HTMLVideoElement && isBackgroundResumeWindowActive()) {
        resumeBackgroundVideo(this);
        return undefined;
      }

      return originalPause.apply(this, args);
    };
  }

  function installBackgroundPlaybackGuards() {
    if (!IS_IOS) return;

    forceVisiblePageState();
    patchMediaPause();

    BACKGROUND_PLAY_EVENTS.forEach(eventName => {
      window.addEventListener(eventName, preventBackgroundPauseEvent, true);
      document.addEventListener(eventName, preventBackgroundPauseEvent, true);
    });
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

  installBackgroundPlaybackGuards();
  ensureStyles();

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
