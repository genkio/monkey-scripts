// ==UserScript==
// @name         Slack Emoji for GitHub
// @namespace    local.slack.github.emoji
// @version      0.3.0
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

  function isSlackEmojiListUrl(url) {
    return typeof url === 'string' &&
      /edgeapi\.slack\.com\/cache\/[^/]+\/emojis\/list/.test(url);
  }

  function getWorkspaceIdFromUrl(url) {
    const m = String(url).match(/edgeapi\.slack\.com\/cache\/([^/]+)\/emojis\/list/);
    return m ? m[1] : null;
  }

  async function mergeEmojiResults(workspaceId, payload) {
    if (!workspaceId || !payload || !Array.isArray(payload.results)) return;

    const store = await loadStore();
    if (!store[workspaceId]) {
      store[workspaceId] = {
        updatedAt: nowTs(),
        emojis: []
      };
    }

    // Only cache the names
    const names = payload.results
        .map(item => item && item.name)
        .filter(Boolean);

    store[workspaceId].emojis = Array.from(new Set(names));
    store[workspaceId].updatedAt = nowTs();
    store._lastWorkspaceId = workspaceId;
    await saveStore(store);

    console.log(`[SlackEmojiTM] cached ${store[workspaceId].emojis.length} emoji names for workspace ${workspaceId}`);
  }

  function patchSlackFetch() {
    const orig = window.fetch;
    if (!orig || orig.__tmSlackEmojiPatched) return;

    const wrapped = async function (...args) {
      const res = await orig.apply(this, args);

      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input?.url;
        if (isSlackEmojiListUrl(url)) {
          res.clone().json()
            .then(json => mergeEmojiResults(getWorkspaceIdFromUrl(url), json))
            .catch(() => {});
        }
      } catch {}

      return res;
    };

    wrapped.__tmSlackEmojiPatched = true;
    window.fetch = wrapped;
  }

  function patchSlackXHR() {
    if (XMLHttpRequest.prototype.__tmSlackEmojiPatched) return;
    XMLHttpRequest.prototype.__tmSlackEmojiPatched = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__tmSlackEmojiUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const url = this.__tmSlackEmojiUrl;
          if (!isSlackEmojiListUrl(url)) return;
          const json = JSON.parse(this.responseText);
          mergeEmojiResults(getWorkspaceIdFromUrl(url), json).catch(() => {});
        } catch {}
      });
      return origSend.apply(this, args);
    };
  }

  function onSlack() {
    patchSlackFetch();
    patchSlackXHR();
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
