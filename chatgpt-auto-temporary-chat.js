// ==UserScript==
// @name         ChatGPT Auto Temporary Chat
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically clicks the "Turn on temporary chat" button on ChatGPT.
// @author       You
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Cooldown timer to prevent the script from spam-clicking
    // the button while the UI takes a millisecond to update its state.
    let lastClickTime = 0;
    const cooldownMs = 1000;

    // Create an observer to monitor the page for dynamic element loading
    const observer = new MutationObserver(() => {
        const now = Date.now();
        if (now - lastClickTime < cooldownMs) return;

        // Target the button specifically by its exact aria-label
        const tempChatBtn = document.querySelector('button[aria-label="Turn on temporary chat"]');

        if (tempChatBtn) {
            tempChatBtn.click();
            lastClickTime = Date.now();
            console.log("Auto Temporary Chat: Feature enabled.");
        }
    });

    // Start observing the entire body for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
