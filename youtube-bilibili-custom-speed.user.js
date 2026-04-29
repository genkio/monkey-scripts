// ==UserScript==
// @name         YouTube + Bilibili Custom Speed
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Default YouTube and Bilibili playback speeds
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://www.bilibili.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SPEEDS = {
        youtube: 2.25,
        bilibili: 2.5
    };

    let lastVideo = null;
    let applyTimer = null;

    function getTargetSpeed() {
        const host = location.hostname;
        if (host.includes('youtube.com')) return SPEEDS.youtube;
        if (host.includes('bilibili.com')) return SPEEDS.bilibili;
        return 1;
    }

    function markManualOverride(video) {
        video.dataset.speedManualOverride = 'true';
    }

    function clearVideoFlags(video) {
        delete video.dataset.speedInitialized;
        delete video.dataset.speedManualOverride;
    }

    function applySpeed(video) {
        if (!video) return false;
        if (video.dataset.speedManualOverride === 'true') return false;

        const targetSpeed = getTargetSpeed();
        if (video.playbackRate !== targetSpeed) {
            video.playbackRate = targetSpeed;
        }

        if (video.playbackRate === targetSpeed) {
            video.dataset.speedInitialized = 'true';
            return true;
        }

        return false;
    }

    function startInitialEnforce(video) {
        if (applyTimer) {
            clearInterval(applyTimer);
            applyTimer = null;
        }

        let tries = 0;
        applyTimer = setInterval(() => {
            if (!video || video !== lastVideo || !document.contains(video)) {
                clearInterval(applyTimer);
                applyTimer = null;
                return;
            }

            if (video.dataset.speedManualOverride === 'true') {
                clearInterval(applyTimer);
                applyTimer = null;
                return;
            }

            applySpeed(video);

            tries++;
            if (video.dataset.speedInitialized === 'true' || tries >= 20) {
                clearInterval(applyTimer);
                applyTimer = null;
            }
        }, 250);
    }

    function hookVideo() {
        const video = document.querySelector('video');
        if (!video || video === lastVideo) return;

        lastVideo = video;
        clearVideoFlags(video);

        startInitialEnforce(video);

        video.addEventListener('loadedmetadata', () => applySpeed(video));
        video.addEventListener('canplay', () => applySpeed(video));
        video.addEventListener('playing', () => applySpeed(video));

        video.addEventListener('ratechange', () => {
            const targetSpeed = getTargetSpeed();

            // Only treat it as manual after the initial auto-speed phase is done.
            if (video.dataset.speedInitialized === 'true' && video.playbackRate !== targetSpeed) {
                markManualOverride(video);
            }
        });
    }

    function resetAndHook() {
        lastVideo = null;
        if (applyTimer) {
            clearInterval(applyTimer);
            applyTimer = null;
        }
        hookVideo();
    }

    const observer = new MutationObserver(() => {
        hookVideo();
    });

    function startObserver() {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    window.addEventListener('yt-navigate-finish', resetAndHook);
    window.addEventListener('popstate', resetAndHook);
    window.addEventListener('hashchange', resetAndHook);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        setTimeout(resetAndHook, 150);
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        setTimeout(resetAndHook, 150);
        return result;
    };

    startObserver();
    hookVideo();

    let attempts = 0;
    const interval = setInterval(() => {
        hookVideo();
        if (++attempts > 40) clearInterval(interval);
    }, 500);
})();
