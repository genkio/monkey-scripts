// ==UserScript==
// @name         Bilibili Mobile Enhancements
// @namespace    local.bilibili.mobile-enhancements
// @version      0.2.2
// @description  Mobile-focused Bilibili layout tweaks.
// @match        https://m.bilibili.com/*
// @match        https://t.bilibili.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-bilibili-mobile-enhancements-style';
  const PAGE_ATTR = 'data-bme-timeline';
  const CARD_ONLY_ATTR = 'data-bme-card-only';
  const CARD_PATH_ATTR = 'data-bme-card-path';
  const FAKE_FS_DOC_CLASS = 'bme-fake-fullscreen-active';
  const FAKE_FS_BACKDROP_ID = 'bme-fake-fullscreen-backdrop';
  const FAKE_FS_WRAPPER_ID = 'bme-fake-fullscreen-wrapper';
  const FAKE_FS_EXIT_BTN_ID = 'bme-fake-fullscreen-exit';
  const CENTER_PLAY_SELECTOR = [
    '.bpx-player-video-btn-start',
    '.bpx-player-video-btn',
    '.bpx-player-state-wrap',
    '.bpx-player-state-play',
    '.bilibili-player-video-btn-start',
    '.bilibili-player-video-state',
    '[class*="player-video-btn-start"]',
    '[class*="video-btn-start"]',
    '[class*="player-state-play"]'
  ].join(',');
  const PLAYER_AREA_SELECTOR = [
    'video',
    '.bpx-player-container',
    '.bilibili-player',
    '.bilibili-player-video',
    '[class*="bpx-player"]',
    '[class*="bilibili-player"]'
  ].join(',');
  const FAKE_FS_ARM_MS = 2500;
  const IS_MOBILE_SAFARI_LIKE = /iP(ad|hone|od)/.test(navigator.platform)
    || /iP(ad|hone|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let fakeFullscreenActive = false;
  let fakeFullscreenOrigin = null;
  let fakeFullscreenSavedScrollY = 0;
  let fakeFullscreenProgressVideo = null;
  let fakeFullscreenArmedUntil = 0;
  let fakeFullscreenAttemptTimer = null;

  function isTimelinePage() {
    return location.hostname === 't.bilibili.com';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[${PAGE_ATTR}],
      html[${PAGE_ATTR}] body {
        min-width: 0 !important;
        width: 100% !important;
        overflow-x: hidden !important;
      }

      html[${PAGE_ATTR}] *,
      html[${PAGE_ATTR}] *::before,
      html[${PAGE_ATTR}] *::after {
        box-sizing: border-box !important;
      }

      html[${PAGE_ATTR}] aside {
        display: none !important;
      }

      html[${PAGE_ATTR}] main .bili-dyn-publishing,
      html[${PAGE_ATTR}] main .bili-dyn-up-list,
      html[${PAGE_ATTR}] main .bili-dyn-list-tabs {
        display: none !important;
      }

      html[${PAGE_ATTR}] #app,
      html[${PAGE_ATTR}] main,
      html[${PAGE_ATTR}] [role="main"],
      html[${PAGE_ATTR}] .bili-dyn-home,
      html[${PAGE_ATTR}] .bili-dyn-home--member,
      html[${PAGE_ATTR}] .bili-dyn-home--main,
      html[${PAGE_ATTR}] .bili-dyn-list,
      html[${PAGE_ATTR}] .bili-dyn-list__items,
      html[${PAGE_ATTR}] .bili-dyn-item {
        min-width: 0 !important;
        max-width: none !important;
        width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-item {
        padding-left: 12px !important;
        padding-right: 12px !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}] > :not([${CARD_PATH_ATTR}]),
      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}] [${CARD_PATH_ATTR}]:not(.bili-dyn-card-video) > :not([${CARD_PATH_ATTR}]) {
        display: none !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}],
      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}] [${CARD_PATH_ATTR}] {
        min-width: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}] .bili-dyn-item__main {
        transform: none !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}] .bili-dyn-card-video {
        width: 100% !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-item[${CARD_ONLY_ATTR}] .bili-dyn-card-video__body {
        display: block !important;
      }

      html[${PAGE_ATTR}] .bili-dyn-home,
      html[${PAGE_ATTR}] .bili-dyn-home--member {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      html[${PAGE_ATTR}] main,
      html[${PAGE_ATTR}] [role="main"],
      html[${PAGE_ATTR}] .bili-dyn-home--main {
        display: block !important;
        flex: 1 1 auto !important;
      }

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
        object-fit: contain !important;
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
          #fb7299 calc(var(--bme-fs-progress, 0) * 360deg),
          rgba(255, 255, 255, 0.3) 0deg
        ) !important;
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)) !important;
        mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)) !important;
        pointer-events: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function syncPageState() {
    ensureStyles();
    document.documentElement.toggleAttribute(PAGE_ATTR, isTimelinePage());
    if (isTimelinePage()) scheduleCardOnlyItems();
  }

  let cardOnlyScheduled = false;

  function scheduleCardOnlyItems() {
    if (cardOnlyScheduled) return;

    cardOnlyScheduled = true;
    requestAnimationFrame(() => {
      cardOnlyScheduled = false;
      markCardOnlyItems();
    });
  }

  function markCardOnlyItems() {
    document.querySelectorAll('.bili-dyn-card-video').forEach((card) => {
      const item = card.closest('.bili-dyn-item');
      if (!item) return;

      item.setAttribute(CARD_ONLY_ATTR, '');

      let node = card;
      while (node && node !== item) {
        node.setAttribute(CARD_PATH_ATTR, '');
        node = node.parentElement;
      }
    });
  }

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.find(video => !video.paused && isVisibleVideo(video))
      || videos.find(isVisibleVideo)
      || videos[0]
      || null;
  }

  function isVisibleVideo(video) {
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function playVideo(video) {
    try {
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
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
    btn.textContent = 'x';
    btn.addEventListener('click', (event) => {
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

  function updateExitButtonProgress() {
    const btn = document.getElementById(FAKE_FS_EXIT_BTN_ID);
    if (!btn || !fakeFullscreenProgressVideo) return;
    const { currentTime, duration } = fakeFullscreenProgressVideo;
    // Live streams report Infinity duration; keep the ring empty.
    const ratio = Number.isFinite(duration) && duration > 0
      ? Math.min(1, Math.max(0, currentTime / duration))
      : 0;
    btn.style.setProperty('--bme-fs-progress', ratio);
  }

  function startExitButtonProgress(video) {
    stopExitButtonProgress();
    if (!video) return;
    fakeFullscreenProgressVideo = video;
    video.addEventListener('timeupdate', updateExitButtonProgress);
    video.addEventListener('durationchange', updateExitButtonProgress);
    updateExitButtonProgress();
  }

  function stopExitButtonProgress() {
    if (!fakeFullscreenProgressVideo) return;
    fakeFullscreenProgressVideo.removeEventListener('timeupdate', updateExitButtonProgress);
    fakeFullscreenProgressVideo.removeEventListener('durationchange', updateExitButtonProgress);
    fakeFullscreenProgressVideo = null;
  }

  function enterFakeFullscreen(video = getActiveVideo()) {
    if (fakeFullscreenActive) return;

    if (!video || !video.parentNode || !document.body) return;

    fakeFullscreenSavedScrollY = window.scrollY || window.pageYOffset || 0;
    ensureStyles();
    fakeFullscreenActive = true;
    document.documentElement.classList.add(FAKE_FS_DOC_CLASS);
    ensureBackdrop();

    const wasPlaying = !video.paused;
    const placeholder = document.createComment('bme-fakefs');
    video.parentNode.insertBefore(placeholder, video);

    const wrapper = document.createElement('div');
    wrapper.id = FAKE_FS_WRAPPER_ID;
    wrapper.appendChild(video);
    document.body.appendChild(wrapper);

    fakeFullscreenOrigin = { video, placeholder, wrapper };
    if (wasPlaying && video.paused) playVideo(video);

    ensureExitButton();
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
    stopExitButtonProgress();

    try {
      window.scrollTo({ top: fakeFullscreenSavedScrollY, left: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, fakeFullscreenSavedScrollY);
    }
  }

  function armFakeFullscreen() {
    fakeFullscreenArmedUntil = Date.now() + FAKE_FS_ARM_MS;
    scheduleFakeFullscreenAttempts();
  }

  function isFakeFullscreenArmed() {
    return Date.now() <= fakeFullscreenArmedUntil;
  }

  function scheduleFakeFullscreenAttempts() {
    if (fakeFullscreenAttemptTimer) return;

    let tries = 0;
    fakeFullscreenAttemptTimer = setInterval(() => {
      tries++;
      if (fakeFullscreenActive || !isFakeFullscreenArmed() || tries > 16) {
        clearInterval(fakeFullscreenAttemptTimer);
        fakeFullscreenAttemptTimer = null;
        return;
      }

      const video = getActiveVideo();
      if (video && !video.paused) {
        enterFakeFullscreen(video);
      }
    }, 125);
  }

  function getEventPoint(event) {
    if (event.touches && event.touches.length > 0) return event.touches[0];
    if (event.changedTouches && event.changedTouches.length > 0) return event.changedTouches[0];
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') return event;
    return null;
  }

  function isCenteredPlayerEvent(event) {
    if (!(event.target instanceof Element)) return false;

    const player = event.target.closest(PLAYER_AREA_SELECTOR);
    if (!player) return false;

    const point = getEventPoint(event);
    if (!point) return false;

    const rect = player.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const x = (point.clientX - rect.left) / rect.width;
    const y = (point.clientY - rect.top) / rect.height;
    return x >= 0.2 && x <= 0.8 && y >= 0.2 && y <= 0.8;
  }

  function handleCenterPlayClick(event) {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(CENTER_PLAY_SELECTOR) && !isCenteredPlayerEvent(event)) return;

    armFakeFullscreen();
    requestAnimationFrame(() => {
      const video = getActiveVideo();
      if (video && !video.paused && !fakeFullscreenActive) enterFakeFullscreen(video);
    });
  }

  function handleVideoStarted(event) {
    if (!isFakeFullscreenArmed()) return;
    if (!(event.target instanceof HTMLVideoElement)) return;

    enterFakeFullscreen(event.target);
  }

  function overrideMethod(target, name, fn) {
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        value: fn
      });
    } catch {}
  }

  function patchFullscreenAPIs() {
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
    if (!IS_MOBILE_SAFARI_LIKE) return;

    ensureStyles();
    patchFullscreenAPIs();
    document.addEventListener('pointerdown', handleCenterPlayClick, true);
    document.addEventListener('touchstart', handleCenterPlayClick, true);
    document.addEventListener('click', handleCenterPlayClick, true);
    document.addEventListener('play', handleVideoStarted, true);
    document.addEventListener('playing', handleVideoStarted, true);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && fakeFullscreenActive) exitFakeFullscreen();
    });
  }

  syncPageState();
  window.addEventListener('DOMContentLoaded', syncPageState, { once: true });
  window.addEventListener('popstate', syncPageState);
  window.addEventListener('hashchange', syncPageState);

  const observer = new MutationObserver(() => {
    if (isTimelinePage()) scheduleCardOnlyItems();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  installFakeFullscreen();
})();
