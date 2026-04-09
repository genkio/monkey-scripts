// ==UserScript==
// @name         Slack Emoji for GitHub
// @namespace    local.slack.github.emoji
// @version      0.5.0
// @description  Cache Slack custom emojis from Slack web and autocomplete them in GitHub PR comment textareas using ::
// @match        https://app.slack.com/*
// @match        https://github.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'slackEmojiCacheV3'; // Bumped key to avoid conflicts with old cached objects
  const POPUP_ID = 'tm-slack-emoji-popup';
  const STYLE_ID = 'tm-slack-emoji-style';
  const MAX_RESULTS = 10;

  function nowTs() {
    return Math.floor(Date.now() / 1000);
  }

  async function loadStore() {
    const raw = await GM_getValue(STORE_KEY, '{}');
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async function saveStore(store) {
    await GM_setValue(STORE_KEY, JSON.stringify(store));
  }

  function getWorkspaceIdFromPage() {
    // Extract workspace ID from the Slack URL, e.g. https://app.slack.com/client/T3V2WPU0K/...
    const m = location.pathname.match(/\/client\/([A-Z0-9]+)/);
    return m ? m[1] : 'default';
  }

  function scrapeEmojiNamesFromPicker() {
    const names = new Set();
    // Scrape all rendered emoji list items in the picker
    const items = document.querySelectorAll('[data-qa="emoji_list_item"] img[data-stringify-emoji]');
    for (const img of items) {
      const name = img.getAttribute('data-stringify-emoji');
      if (name) names.add(name.replace(/^:|:$/g, ''));
    }
    // Also try data-name on the button itself
    const buttons = document.querySelectorAll('[data-qa="emoji_list_item"][data-name]');
    for (const btn of buttons) {
      const name = btn.getAttribute('data-name');
      if (name) names.add(name);
    }
    return names;
  }

  async function copyEmojisFromPicker() {
    const names = scrapeEmojiNamesFromPicker();
    if (!names.size) return 0;

    const workspaceId = getWorkspaceIdFromPage();
    const store = await loadStore();
    store[workspaceId] = {
      updatedAt: nowTs(),
      emojis: Array.from(names)
    };
    store._lastWorkspaceId = workspaceId;
    await saveStore(store);

    console.log(`[SlackEmojiTM] copied ${names.size} emoji names from picker for workspace ${workspaceId}`);
    return names.size;
  }

  function injectCopyButton(footer) {
    if (footer.querySelector('.tm-slack-emoji-copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'c-button c-button--outline c-button--small tm-slack-emoji-copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.style.marginLeft = '8px';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const count = await copyEmojisFromPicker();
      btn.textContent = count ? `Copied ${count}!` : 'No emojis found';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });

    // Insert after the Add Emoji button
    const addBtn = footer.querySelector('[data-qa="customize_emoji_add_button"]');
    if (addBtn) {
      addBtn.after(btn);
    } else {
      // Fallback: append to the inner div
      const inner = footer.firstElementChild || footer;
      inner.appendChild(btn);
    }
  }

  function observeEmojiPicker() {
    const observer = new MutationObserver(() => {
      const footer = document.querySelector('.p-emoji_picker__footer');
      if (footer) injectCopyButton(footer);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function onSlack() {
    if (document.body) {
      observeEmojiPicker();
    } else {
      document.addEventListener('DOMContentLoaded', observeEmojiPicker);
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${POPUP_ID} {
        position: fixed;
        z-index: 2147483647;
        width: 260px;
        max-height: 280px;
        overflow-y: auto;
        background: var(--color-canvas-overlay, #fff);
        color: var(--color-fg-default, #24292f);
        border: 1px solid var(--color-border-default, rgba(31,35,40,0.15));
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(140,149,159,0.2);
        padding: 6px;
      }
      #${POPUP_ID} .tm-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
        font-size: 13px;
      }
      #${POPUP_ID} .tm-item.tm-active,
      #${POPUP_ID} .tm-item:hover {
        background: var(--color-neutral-muted, rgba(175,184,193,0.2));
      }
      #${POPUP_ID} .tm-item .tm-label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${POPUP_ID} .tm-empty {
        padding: 8px 10px;
        opacity: 0.7;
        font-size: 13px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function getTextareaTarget(el) {
    if (!(el instanceof HTMLElement)) return null;
    if (el instanceof HTMLTextAreaElement) return el;
    return el.closest('textarea');
  }

  function isGitHubPRTextarea(el) {
    if (!(el instanceof HTMLTextAreaElement)) return false;
    if (location.pathname.includes('/pull/') || location.pathname.includes('/issues/')) return true;
    return false;
  }

  function getCaretInfo(el) {
    return {
      text: el.value,
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0
    };
  }

  function findEmojiQuery(text, caret) {
    const left = text.slice(0, caret);
    // Look for :: to trigger
    const match = left.match(/(^|[\s(])::([a-zA-Z0-9_+\-]*)$/);
    if (!match) return null;

    return {
      query: match[2] || '',
      tokenStart: caret - match[2].length - 2, // -2 to account for the '::'
      tokenEnd: caret
    };
  }

  async function getAllEmojiMap() {
    const store = await loadStore();
    const workspaceId = store._lastWorkspaceId;
    if (!workspaceId || !store[workspaceId]?.emojis) {
      return { workspaceId: null, emojis: [] };
    }
    return { workspaceId, emojis: store[workspaceId].emojis };
  }

  async function getEmojiCandidates(query) {
    const { emojis } = await getAllEmojiMap();
    const q = query.toLowerCase();

    return emojis
      // Filter by ANY part of the name
      .filter(name => name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Prioritize results that start with the query, then fall back to alphabetical
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      })
      .slice(0, MAX_RESULTS);
  }

  const state = {
    textarea: null,
    tokenInfo: null,
    items: [],
    activeIndex: 0
  };

  function getPopup() {
    let popup = document.getElementById(POPUP_ID);
    if (!popup) {
      popup = document.createElement('div');
      popup.id = POPUP_ID;
      document.documentElement.appendChild(popup);
    }
    return popup;
  }

  function removePopup() {
    document.getElementById(POPUP_ID)?.remove();
    state.textarea = null;
    state.tokenInfo = null;
    state.items = [];
    state.activeIndex = 0;
  }

  function positionPopup(textarea) {
    const popup = getPopup();
    const rect = textarea.getBoundingClientRect();
    const width = 260;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;

    if (top + 280 > window.innerHeight - 8) {
      top = Math.max(8, rect.top - 286);
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function renderPopup() {
    const popup = getPopup();
    popup.innerHTML = '';

    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'tm-empty';
      empty.textContent = 'No cached Slack emoji matches';
      popup.appendChild(empty);
      positionPopup(state.textarea);
      return;
    }

    state.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'tm-item' + (index === state.activeIndex ? ' tm-active' : '');

      const label = document.createElement('div');
      label.className = 'tm-label';
      label.textContent = `:${item}:`;

      row.appendChild(label);

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applySelection(index);
      });

      popup.appendChild(row);
    });

    positionPopup(state.textarea);
  }

  function applySelection(index) {
    const textarea = state.textarea;
    const tokenInfo = state.tokenInfo;
    const item = state.items[index];
    if (!textarea || !tokenInfo || !item) return;

    // Convert the `::name` trigger into a standard `:name:` format
    const replacement = `:${item}:`;
    const value = textarea.value;
    textarea.value =
      value.slice(0, tokenInfo.tokenStart) +
      replacement +
      value.slice(tokenInfo.tokenEnd);

    const caret = tokenInfo.tokenStart + replacement.length;
    textarea.selectionStart = caret;
    textarea.selectionEnd = caret;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    removePopup();
    textarea.focus();
  }

  async function handleInputEvent(e) {
    const textarea = getTextareaTarget(e.target);
    if (!textarea || !isGitHubPRTextarea(textarea)) return;

    const caretInfo = getCaretInfo(textarea);
    const tokenInfo = findEmojiQuery(caretInfo.text, caretInfo.start);

    if (!tokenInfo) {
      removePopup();
      return;
    }

    const items = await getEmojiCandidates(tokenInfo.query);

    state.textarea = textarea;
    state.tokenInfo = tokenInfo;
    state.items = items;
    state.activeIndex = 0;

    renderPopup();
  }

  function handleKeydown(e) {
    const textarea = getTextareaTarget(e.target);
    const popup = document.getElementById(POPUP_ID);
    if (!textarea || !popup || textarea !== state.textarea) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.items.length) {
        state.activeIndex = (state.activeIndex + 1) % state.items.length;
        renderPopup();
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.items.length) {
        state.activeIndex = (state.activeIndex - 1 + state.items.length) % state.items.length;
        renderPopup();
      }
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (state.items.length) {
        e.preventDefault();
        applySelection(state.activeIndex);
      }
      return;
    }

    if (e.key === 'Escape') {
      removePopup();
    }
  }

  function onGitHub() {
    ensureStyles();
    document.addEventListener('input', handleInputEvent, true);
    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('click', (e) => {
      const popup = document.getElementById(POPUP_ID);
      if (!popup) return;
      if (popup.contains(e.target)) return;
      removePopup();
    }, true);
    window.addEventListener('scroll', () => {
      if (state.textarea && document.getElementById(POPUP_ID)) {
        positionPopup(state.textarea);
      }
    }, true);
    window.addEventListener('resize', () => {
      if (state.textarea && document.getElementById(POPUP_ID)) {
        positionPopup(state.textarea);
      }
    });
  }

  if (location.hostname === 'app.slack.com') {
    onSlack();
  } else if (location.hostname === 'github.com') {
    onGitHub();
  }
})();
