// ==UserScript==
// @name         Hacker News Reader Mode
// @namespace    local.hackernews.reader
// @version      0.4.0
// @description  Reformat Hacker News item pages into a clean article so iOS Safari Reader Mode can render the discussion as audio-friendly prose.
// @match        https://news.ycombinator.com/item*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // HN doesn't expose numeric comment scores in the HTML, but it fades the
  // .commtext color as a comment is downvoted (c00 = black, c5a..cdd = grayer).
  // The hex digits ARE the gray level. Skip any comment whose gray exceeds this
  // threshold. 0x00 = strict (drop anything faded), 0x5a = lenient.
  const FADE_SKIP_THRESHOLD = 0x00;

  const fatitem = document.querySelector('.fatitem');
  if (!fatitem) return;

  const titleAnchor = fatitem.querySelector('.titleline > a');
  const score = fatitem.querySelector('.score')?.textContent.trim() || '';
  const opAuthor = fatitem.querySelector('.hnuser')?.textContent.trim() || '';
  const age = fatitem.querySelector('.age')?.textContent.trim() || '';
  const storyText = fatitem.querySelector('.toptext');
  const leadComment = !titleAnchor ? fatitem.querySelector('.commtext') : null;

  const title = titleAnchor?.textContent.trim()
    || (opAuthor ? `Comment by ${opAuthor}` : 'Hacker News thread');
  const rawHref = titleAnchor?.getAttribute('href') || '';
  const externalUrl = rawHref && !rawHref.startsWith('item?') ? rawHref : '';

  const meta = [score, opAuthor && `by ${opAuthor}`, age]
    .filter(Boolean)
    .join(' · ');

  const topLevelSections = [];
  const allSections = [];

  for (const row of document.querySelectorAll('tr.athing.comtr')) {
    const commentText = row.querySelector('.commtext');
    if (!commentText) continue;
    if (fadeLevel(commentText) > FADE_SKIP_THRESHOLD) continue;

    const indCell = row.querySelector('td.ind');
    const depth = parseInt(indCell?.getAttribute('indent') || '0', 10);
    const user = row.querySelector('.hnuser')?.textContent.trim() || 'unknown';

    const heading = depth === 0 ? `${user} says` : `${user} replies`;
    const html = `<section><h3>${escapeHtml(heading)}</h3>${commentText.innerHTML}</section>`;

    allSections.push(html);
    if (depth === 0) topLevelSections.push(html);
  }

  const hasReplies = allSections.length > topLevelSections.length;
  let commentsBlock;
  if (topLevelSections.length === 0) {
    commentsBlock = '<h2>Comments</h2>\n<p>No comments yet.</p>';
  } else if (!hasReplies) {
    commentsBlock = `<h2>Comments</h2>\n${topLevelSections.join('\n')}`;
  } else {
    commentsBlock = `
      <h2>Top comments</h2>
      ${topLevelSections.join('\n')}
      <h2>Full discussion</h2>
      ${allSections.join('\n')}
    `;
  }

  const moreLink = document.querySelector('a.morelink');
  const moreHref = moreLink?.getAttribute('href');

  const article = document.createElement('article');
  article.innerHTML = `
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${externalUrl ? `<p>Source: <a href="${escapeHtml(externalUrl)}">linked article</a></p>` : ''}
      ${meta ? `<p>${escapeHtml(meta)}</p>` : ''}
    </header>
    ${storyText ? `<section>${storyText.innerHTML}</section>` : ''}
    ${leadComment ? `<section>${leadComment.innerHTML}</section>` : ''}
    ${commentsBlock}
    ${moreHref ? `<p><a href="${escapeHtml(moreHref)}">More comments</a></p>` : ''}
  `;

  simplifyLinks(article);

  document.title = title;
  document.body.innerHTML = '';
  document.body.appendChild(article);

  const style = document.createElement('style');
  style.textContent = `
    body {
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      line-height: 1.6;
      max-width: 720px;
      margin: 2rem auto;
      padding: 0 1rem;
      color: #222;
      background: #fafafa;
    }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    h2 { margin-top: 2.5rem; border-top: 1px solid #ccc; padding-top: 1rem; }
    h3 { font-size: 0.95rem; margin: 1.75rem 0 0.5rem; color: #555; font-weight: 600; }
    section { margin-bottom: 1rem; }
    pre { white-space: pre-wrap; }
    a { color: #0366d6; }
  `;
  document.head.appendChild(style);

  function fadeLevel(commtext) {
    for (const cls of commtext.classList) {
      const match = /^c([0-9a-f]{2})$/.exec(cls);
      if (match) return parseInt(match[1], 16);
    }
    return 0;
  }

  function simplifyLinks(root) {
    for (const a of root.querySelectorAll('a')) {
      const text = (a.textContent || '').trim();
      if (!text) continue;
      const href = a.getAttribute('href') || '';
      const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(text) || text === href;
      if (!looksLikeUrl) continue;
      a.textContent = /news\.ycombinator\.com\/item/i.test(href)
        ? 'this Hacker News thread'
        : 'this link';
    }
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
