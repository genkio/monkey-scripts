// ==UserScript==
// @name         Hacker News Reader Mode
// @namespace    local.hackernews.reader
// @version      0.1.0
// @description  Reformat Hacker News item pages into a clean article so iOS Safari Reader Mode can render the discussion as audio-friendly prose.
// @match        https://news.ycombinator.com/item*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

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

  const parents = [];
  const sections = [];
  let topIndex = 0;

  for (const row of document.querySelectorAll('tr.athing.comtr')) {
    const indCell = row.querySelector('td.ind');
    const depth = parseInt(indCell?.getAttribute('indent') || '0', 10);
    const userEl = row.querySelector('.hnuser');
    const commentText = row.querySelector('.commtext');

    const user = userEl?.textContent.trim() || '[deleted]';
    const parent = depth > 0 ? parents[depth - 1] : null;
    parents[depth] = user;
    parents.length = depth + 1;

    if (!commentText) continue;

    let heading;
    if (depth === 0) {
      topIndex += 1;
      heading = `Comment ${topIndex} by ${user}`;
    } else if (parent && parent !== '[deleted]') {
      heading = `${user} replying to ${parent}`;
    } else {
      heading = `Reply by ${user}`;
    }

    sections.push(
      `<section><h3>${escapeHtml(heading)}</h3>${commentText.innerHTML}</section>`
    );
  }

  const moreLink = document.querySelector('a.morelink');
  const moreHref = moreLink?.getAttribute('href');

  const article = document.createElement('article');
  article.innerHTML = `
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${externalUrl ? `<p>Source: <a href="${escapeHtml(externalUrl)}">${escapeHtml(externalUrl)}</a></p>` : ''}
      ${meta ? `<p>${escapeHtml(meta)}</p>` : ''}
    </header>
    ${storyText ? `<section>${storyText.innerHTML}</section>` : ''}
    ${leadComment ? `<section>${leadComment.innerHTML}</section>` : ''}
    <h2>Comments</h2>
    ${sections.length ? sections.join('\n') : '<p>No comments yet.</p>'}
    ${moreHref ? `<p><a href="${escapeHtml(moreHref)}">More comments</a></p>` : ''}
  `;

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

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
