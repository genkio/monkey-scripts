// ==UserScript==
// @name         YouTube Enhancements
// @namespace    local.youtube.enhancements
// @version      0.1.0
// @description  Hide YouTube thumbnails and auto-unmute video pages.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-youtube-enhancements-style';
  const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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

  const BACKGROUND_THUMBNAIL_SELECTOR = [
    'ytd-thumbnail [style*="background-image"]',
    'ytd-playlist-thumbnail [style*="background-image"]',
    'ytm-thumbnail [style*="background-image"]',
    '.media-item-thumbnail-container [style*="background-image"]',
    '.compact-media-item-image [style*="background-image"]'
  ].join(',');

  let scheduled = false;
  let unmuteTimer = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ytd-thumbnail,
      ytd-playlist-thumbnail,
      ytm-thumbnail,
      .media-item-thumbnail-container,
      .compact-media-item-image {
        background: #111 !important;
      }

      ${THUMBNAIL_IMAGE_SELECTOR} {
        opacity: 0 !important;
        visibility: hidden !important;
      }

      img[data-youtube-enhancements-thumbnail-disabled="true"] {
        opacity: 0 !important;
        visibility: hidden !important;
      }

      ${BACKGROUND_THUMBNAIL_SELECTOR} {
        background-image: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function isVideoPage() {
    return location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
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
  }

  function disableBackgroundThumbnail(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.style.getPropertyValue('background-image') === 'none') return;
    el.style.setProperty('background-image', 'none', 'important');
  }

  function disableThumbnails() {
    document.querySelectorAll(THUMBNAIL_IMAGE_SELECTOR).forEach(disableThumbnailImage);
    document.querySelectorAll(BACKGROUND_THUMBNAIL_SELECTOR).forEach(disableBackgroundThumbnail);
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

  function runEnhancements() {
    ensureStyles();
    disableThumbnails();
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
    scheduleEnhancements();
    startUnmuteWindow();
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

  ensureStyles();

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
