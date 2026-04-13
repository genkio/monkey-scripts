// ==UserScript==
// @name         GitHub PR Patch Cleaner
// @namespace    local.github.pr.patch.cleaner
// @version      1.1.0
// @description  Clean noisy file diffs from GitHub PR .patch pages for easier LLM copy/paste.
// @match        https://github.com/*/pull/*.patch*
// @match        https://patch-diff.githubusercontent.com/raw/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-github-patch-cleaner-style';
  const ROOT_ID = 'tm-github-patch-cleaner-root';
  const STORAGE_KEY = 'tm-github-patch-cleaner-view';
  const VIEW_MODE = {
    cleaned: 'cleaned',
    original: 'original'
  };

  const LOCKFILE_NAMES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'Cargo.lock',
    'Gemfile.lock',
    'composer.lock',
    'Podfile.lock'
  ]);

  const BINARY_EXTENSIONS = new Set([
    '7z',
    'avif',
    'bmp',
    'class',
    'cur',
    'dll',
    'doc',
    'docx',
    'eot',
    'exe',
    'gif',
    'gz',
    'ico',
    'jpeg',
    'jpg',
    'mov',
    'mp3',
    'mp4',
    'npy',
    'otf',
    'pdf',
    'png',
    'ppt',
    'pptx',
    'pyc',
    'rar',
    'so',
    'tar',
    'ttf',
    'wasm',
    'webm',
    'webp',
    'woff',
    'woff2',
    'xlsx',
    'xls',
    'zip'
  ]);

  function getTextBody() {
    if (!document.body) return '';
    return document.body.textContent || '';
  }

  function normalizeLines(text) {
    return text.replace(/\r\n/g, '\n').split('\n');
  }

  function countLines(text) {
    if (!text) return 0;

    const normalized = text.replace(/\r\n/g, '\n');
    const withoutTerminalNewline = normalized.endsWith('\n')
      ? normalized.slice(0, -1)
      : normalized;

    return withoutTerminalNewline ? withoutTerminalNewline.split('\n').length : 0;
  }

  function getStoredViewMode() {
    try {
      return localStorage.getItem(STORAGE_KEY) || VIEW_MODE.cleaned;
    } catch {
      return VIEW_MODE.cleaned;
    }
  }

  function setStoredViewMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures on restricted pages.
    }
  }

  function getFilePathFromDiffHeader(line) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) return null;

    const [, fromPath, toPath] = match;
    if (toPath === '/dev/null') return fromPath;
    if (fromPath === '/dev/null') return toPath;
    return toPath;
  }

  function getFilename(path) {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }

  function getExtension(path) {
    const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function isLikelyBinaryDiff(sectionText, path) {
    if (/^GIT binary patch$/m.test(sectionText)) return true;
    if (/^Binary files .* differ$/m.test(sectionText)) return true;

    const extension = getExtension(path);
    return BINARY_EXTENSIONS.has(extension);
  }

  function classifyNoise(path, sectionText) {
    const filename = getFilename(path);

    if (LOCKFILE_NAMES.has(filename)) {
      return {
        kind: 'lockfile',
        label: 'lockfile diff omitted'
      };
    }

    if (isLikelyBinaryDiff(sectionText, path)) {
      return {
        kind: 'binary',
        label: 'binary or non-text diff omitted'
      };
    }

    return null;
  }

  function formatPlaceholder(headerLine, path, classification, removedLineCount) {
    return [
      headerLine,
      `@@ PATCH-CLEANER @@ ${classification.label} (${removedLineCount} lines removed)`,
      `@@ PATCH-CLEANER @@ path=${path}`,
      ''
    ].join('\n');
  }

  function cleanPatch(text) {
    const lines = normalizeLines(text);
    const output = [];
    const omitted = [];
    let index = 0;

    while (index < lines.length) {
      if (!lines[index].startsWith('diff --git ')) {
        output.push(lines[index]);
        index += 1;
        continue;
      }

      const headerLine = lines[index];
      const filePath = getFilePathFromDiffHeader(headerLine);
      const start = index;
      index += 1;

      while (index < lines.length && !lines[index].startsWith('diff --git ')) {
        index += 1;
      }

      const sectionLines = lines.slice(start, index);
      const sectionText = sectionLines.join('\n');

      if (!filePath) {
        output.push(sectionText);
        continue;
      }

      const classification = classifyNoise(filePath, sectionText);
      if (!classification) {
        output.push(sectionText);
        continue;
      }

      omitted.push({
        path: filePath,
        kind: classification.kind,
        linesRemoved: sectionLines.length
      });
      output.push(formatPlaceholder(headerLine, filePath, classification, sectionLines.length).trimEnd());
    }

    return {
      cleanedText: output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
      omitted
    };
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 32px));
        border: 1px solid #d0d7de;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        color: #1f2328;
        box-shadow: 0 12px 28px rgba(31, 35, 40, 0.18);
        backdrop-filter: blur(10px);
        font: 12px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        user-select: none;
      }
      #${ROOT_ID} * {
        box-sizing: border-box;
      }
      #${ROOT_ID} .tm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px 8px;
      }
      #${ROOT_ID} .tm-title {
        font-size: 13px;
        font-weight: 700;
      }
      #${ROOT_ID} .tm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 14px 12px;
      }
      #${ROOT_ID} .tm-stats {
        border-top: 1px solid #d8dee4;
        padding: 10px 14px;
        color: #57606a;
      }
      #${ROOT_ID} button {
        appearance: none;
        border: 1px solid #d0d7de;
        border-radius: 999px;
        background: #f6f8fa;
        color: #1f2328;
        padding: 6px 10px;
        cursor: pointer;
        font: inherit;
      }
      #${ROOT_ID} button.tm-active {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }
      #${ROOT_ID} .tm-summary {
        border-top: 1px solid #d8dee4;
        padding: 10px 14px 12px;
        white-space: pre-wrap;
        word-break: break-word;
        color: #57606a;
      }
      body.tm-github-patch-cleaner-active {
        margin: 0;
        padding: 72px 20px 24px;
        background: #f6f8fa;
      }
      body.tm-github-patch-cleaner-active pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font: 13px/1.5 ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function buildSummary(omitted) {
    if (!omitted.length) {
      return 'No noisy file sections matched the default rules.';
    }

    const byKind = omitted.reduce((acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] || 0) + 1;
      return acc;
    }, {});

    const summaryParts = [];
    if (byKind.lockfile) summaryParts.push(`${byKind.lockfile} lockfile`);
    if (byKind.binary) summaryParts.push(`${byKind.binary} binary/non-text`);

    const preview = omitted
      .slice(0, 6)
      .map((entry) => `- ${entry.path}`)
      .join('\n');

    return [
      `Omitted ${omitted.length} noisy file section(s): ${summaryParts.join(', ')}.`,
      preview,
      omitted.length > 6 ? `- +${omitted.length - 6} more` : ''
    ].filter(Boolean).join('\n');
  }

  function replaceBodyWithPre(text) {
    document.body.classList.add('tm-github-patch-cleaner-active');
    document.body.innerHTML = '';

    const pre = document.createElement('pre');
    pre.textContent = text;
    document.body.appendChild(pre);
    return pre;
  }

  function copyToClipboard(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return true;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }

    return false;
  }

  function renderToolbar(pre, originalText, cleanedText, omitted) {
    const root = document.createElement('section');
    root.id = ROOT_ID;

    const header = document.createElement('div');
    header.className = 'tm-header';

    const title = document.createElement('div');
    title.className = 'tm-title';
    title.textContent = 'GitHub PR Patch Cleaner';
    header.appendChild(title);

    const hideButton = document.createElement('button');
    hideButton.type = 'button';
    hideButton.textContent = 'Hide';
    header.appendChild(hideButton);

    const actions = document.createElement('div');
    actions.className = 'tm-actions';

    const cleanedButton = document.createElement('button');
    cleanedButton.type = 'button';
    cleanedButton.textContent = 'Cleaned view';

    const originalButton = document.createElement('button');
    originalButton.type = 'button';
    originalButton.textContent = 'Original view';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy cleaned';

    const stats = document.createElement('div');
    stats.className = 'tm-stats';

    const summary = document.createElement('div');
    summary.className = 'tm-summary';
    summary.textContent = `${buildSummary(omitted)}\n\nPress Shift+Escape to hide or reopen the toolbar.`;

    const originalLineCount = countLines(originalText);
    const cleanedLineCount = countLines(cleanedText);
    const savedLineCount = Math.max(0, originalLineCount - cleanedLineCount);
    stats.textContent = `LOC: ${originalLineCount.toLocaleString()} original / ${cleanedLineCount.toLocaleString()} cleaned / -${savedLineCount.toLocaleString()}`;

    function setToolbarVisibility(isVisible) {
      root.hidden = !isVisible;
    }

    function setMode(mode) {
      const showCleaned = mode === VIEW_MODE.cleaned;
      pre.textContent = showCleaned ? cleanedText : originalText;
      cleanedButton.classList.toggle('tm-active', showCleaned);
      originalButton.classList.toggle('tm-active', !showCleaned);
      setStoredViewMode(mode);
    }

    cleanedButton.addEventListener('click', () => setMode(VIEW_MODE.cleaned));
    originalButton.addEventListener('click', () => setMode(VIEW_MODE.original));
    hideButton.addEventListener('click', () => setToolbarVisibility(false));
    copyButton.addEventListener('click', () => {
      const copied = copyToClipboard(cleanedText);
      copyButton.textContent = copied ? 'Copied' : 'Copy failed';
      window.setTimeout(() => {
        copyButton.textContent = 'Copy cleaned';
      }, 1200);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.shiftKey) {
        setToolbarVisibility(root.hidden);
      }
    });

    actions.appendChild(cleanedButton);
    actions.appendChild(originalButton);
    actions.appendChild(copyButton);

    root.appendChild(header);
    root.appendChild(actions);
    root.appendChild(stats);
    root.appendChild(summary);

    document.body.appendChild(root);
    setMode(getStoredViewMode());
  }

  function main() {
    const originalText = getTextBody();
    if (!originalText.trim().includes('diff --git ')) return;

    const { cleanedText, omitted } = cleanPatch(originalText);
    ensureStyles();
    const pre = replaceBodyWithPre(cleanedText);
    renderToolbar(pre, originalText, cleanedText, omitted);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
  } else {
    main();
  }
})();
