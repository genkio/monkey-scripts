// ==UserScript==
// @name         YouTube Enhancements
// @namespace    local.youtube.enhancements
// @version      0.2.0
// @description  Remove YouTube thumbnails and auto-unmute video pages.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-youtube-enhancements-style';
  const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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

  let scheduled = false;
  let unmuteTimer = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${THUMBNAIL_CONTAINER_SELECTOR},
      img[data-youtube-enhancements-thumbnail-disabled="true"] {
        display: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function isVideoPage() {
    return location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
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
