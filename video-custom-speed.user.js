// ==UserScript==
// @name         Video Custom Speed
// @namespace    http://tampermonkey.net/
// @version      3.6.0
// @description  Default custom playback speed for videos on YouTube, Bilibili, and X
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://www.bilibili.com/*
// @match        *://m.bilibili.com/*
// @match        *://x.com/*
// @match        *://*.x.com/*
// @match        *://twitter.com/*
// @match        *://*.twitter.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SITE_SPEEDS = [
        { domain: 'youtube.com', speed: 2 },
        { domain: 'bilibili.com', speed: 2 },
        { domain: 'x.com', speed: 2 },
        { domain: 'twitter.com', speed: 2 },
    ];

    const enforceTimers = new WeakMap();

    function getTargetSpeed() {
        const host = location.hostname;
        for (const { domain, speed } of SITE_SPEEDS) {
            if (host === domain || host.endsWith('.' + domain)) return speed;
        }
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

    function stopEnforce(video) {
        const timer = enforceTimers.get(video);
        if (timer) {
            clearInterval(timer);
            enforceTimers.delete(video);
        }
    }

    function startInitialEnforce(video) {
        stopEnforce(video);

        let tries = 0;
        const timer = setInterval(() => {
            if (!document.contains(video) || video.dataset.speedManualOverride === 'true') {
                stopEnforce(video);
                return;
            }

            applySpeed(video);

            tries++;
            if (video.dataset.speedInitialized === 'true' || tries >= 20) {
                stopEnforce(video);
            }
        }, 250);

        enforceTimers.set(video, timer);
    }

    function hookVideo(video) {
        if (!video || video.dataset.speedHooked === 'true') return;
        video.dataset.speedHooked = 'true';

        applySpeed(video);
        startInitialEnforce(video);

        // X data saver: video only loads/plays on tap, so re-apply on play events.
        ['loadedmetadata', 'canplay', 'play', 'playing'].forEach((event) => {
            video.addEventListener(event, () => applySpeed(video));
        });

        video.addEventListener('ratechange', () => {
            const targetSpeed = getTargetSpeed();

            // Only treat it as manual after the initial auto-speed phase is done.
            if (video.dataset.speedInitialized === 'true' && video.playbackRate !== targetSpeed) {
                markManualOverride(video);
            }
        });
    }

    function hookAll() {
        document.querySelectorAll('video').forEach(hookVideo);
    }

    function reapply() {
        // YouTube reuses the same <video> across navigations; reset it to re-force speed.
        document.querySelectorAll('video').forEach((video) => {
            clearVideoFlags(video);
            applySpeed(video);
            startInitialEnforce(video);
        });
        hookAll();
    }

    let lastUrl = location.pathname + location.search;
    function onNavigation() {
        const url = location.pathname + location.search;

        // X spams history updates on the same page; only reset on real URL change
        // so manual speed choices survive.
        if (url === lastUrl) {
            hookAll();
            return;
        }

        lastUrl = url;
        reapply();
    }

    let scanScheduled = false;
    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        setTimeout(() => {
            scanScheduled = false;
            hookAll();
        }, 100);
    }

    const observer = new MutationObserver(scheduleScan);

    function startObserver() {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    window.addEventListener('yt-navigate-finish', onNavigation);
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        setTimeout(onNavigation, 150);
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        setTimeout(onNavigation, 150);
        return result;
    };

    startObserver();
    hookAll();

    let attempts = 0;
    const interval = setInterval(() => {
        hookAll();
        if (++attempts > 40) clearInterval(interval);
    }, 500);
})();
