// ==UserScript==
// @name         Reddit Enhancements
// @namespace    local.reddit.enhancements
// @version      0.1.0
// @description  Drop the old.reddit sidebar so the middle column gets the full viewport width on mobile.
// @match        https://old.reddit.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-reddit-enhancements-style';

  // .side is the floated 300px sidebar; aside.read-next is the "discussions in
  // r/x" panel nested inside it on comment pages.
  const SIDEBAR_SELECTOR = '.side, aside, .read-next-container';

  // Reddit reserves right margin for the sidebar on these; reclaim it.
  const RESERVED_MARGIN_SELECTOR = 'body > .content, .aboutpage, .sheets, #noresults';

  injectStyle();
  onReady(removeSidebars);

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${SIDEBAR_SELECTOR} { display: none !important; }
      ${RESERVED_MARGIN_SELECTOR} { margin-right: 0 !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // CSS alone still lets the sidebar's images and embeds load.
  function removeSidebars() {
    for (const el of document.querySelectorAll(SIDEBAR_SELECTOR)) el.remove();
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }
})();
