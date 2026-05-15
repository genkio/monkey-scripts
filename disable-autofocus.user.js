// ==UserScript==
// @name         Disable Autofocus on Page Load
// @namespace    local.disable.autofocus
// @version      1.0.0
// @description  Prevents websites from auto-focusing text inputs, textareas, and contenteditable fields on page load so the page doesn't steal your keyboard.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Stop blocking this long after `load` fires, in case nothing else clears it.
  const GRACE_AFTER_LOAD_MS = 1500;
  // Absolute ceiling, in case `load` never fires (long-polling SPAs, etc.).
  const MAX_BLOCK_MS = 8000;

  const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'url', 'tel', 'password',
    'number', 'date', 'datetime-local', 'month', 'week', 'time'
  ]);

  let blockingActive = true;

  function isTextEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.has(type);
    }
    return el.isContentEditable === true;
  }

  function stripAutofocusAttr(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('autofocus')) {
      root.removeAttribute('autofocus');
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('[autofocus]').forEach((el) => el.removeAttribute('autofocus'));
    }
  }

  // 1) Strip `autofocus` attributes everywhere -- now, and as new nodes arrive.
  stripAutofocusAttr(document.documentElement);

  const observer = new MutationObserver((mutations) => {
    if (!blockingActive) return;
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'autofocus') {
        m.target.removeAttribute('autofocus');
      } else if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) stripAutofocusAttr(node);
        });
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['autofocus']
  });

  // 2) Intercept programmatic .focus() on text-editable elements during page load.
  const realFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (blockingActive && isTextEditable(this)) {
      return;
    }
    return realFocus.apply(this, args);
  };

  // 3) Any real user gesture means we should stop fighting the page.
  const gestureEvents = ['pointerdown', 'mousedown', 'touchstart', 'keydown'];
  function onGesture(event) {
    if (event.isTrusted) stopBlocking();
  }
  gestureEvents.forEach((type) => {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  });

  // 4) Catch the case where the browser already focused something before we ran.
  function blurActiveTextInput() {
    const active = document.activeElement;
    if (isTextEditable(active) && active !== document.body) {
      try { active.blur(); } catch {}
    }
  }

  document.addEventListener('DOMContentLoaded', blurActiveTextInput, { once: true });
  window.addEventListener('load', () => {
    blurActiveTextInput();
    setTimeout(stopBlocking, GRACE_AFTER_LOAD_MS);
  }, { once: true });

  function stopBlocking() {
    if (!blockingActive) return;
    blockingActive = false;
    observer.disconnect();
    HTMLElement.prototype.focus = realFocus;
    gestureEvents.forEach((type) => {
      window.removeEventListener(type, onGesture, { capture: true });
    });
  }

  setTimeout(stopBlocking, MAX_BLOCK_MS);
})();
