// ==UserScript==
// @name         Slack Web Custom Experience
// @namespace    local.slack.custom
// @version      1.0.0
// @description  Personal tweaks for Slack web. Currently: frees Cmd+Shift+A (Slack's "All unreads") so Brave's tab-search keybinding wins.
// @match        https://app.slack.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Shortcuts Slack grabs that we want handed back to the browser. We swallow
  // them before Slack's keydown handler runs, but never preventDefault, so the
  // browser keybinding (e.g. Brave tab search) still fires.
  const RELEASED_SHORTCUTS = [
    // Cmd+Shift+A: Slack jumps to "All unreads"; Brave uses it for tab search.
    { meta: true, shift: true, ctrl: false, alt: false, code: 'KeyA' },
  ];

  function matchesCombo(e, combo) {
    return e.code === combo.code &&
      e.metaKey === combo.meta &&
      e.shiftKey === combo.shift &&
      e.ctrlKey === combo.ctrl &&
      e.altKey === combo.alt;
  }

  function releaseBrowserShortcuts() {
    // Capture phase on window + @run-at document-start means we see the event
    // before Slack does, so stopImmediatePropagation keeps Slack's handler off.
    window.addEventListener('keydown', (e) => {
      for (const combo of RELEASED_SHORTCUTS) {
        if (matchesCombo(e, combo)) {
          e.stopImmediatePropagation();
          return;
        }
      }
    }, true);
  }

  releaseBrowserShortcuts();
})();
