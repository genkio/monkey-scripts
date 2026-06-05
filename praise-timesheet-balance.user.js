// ==UserScript==
// @name         Praise Timesheet Balance
// @namespace    local.praise.timesheet.balance
// @version      1.0.0
// @description  Add an Extra / Short card to Praise timesheets based on worked days * 8h versus total worked hours.
// @match        https://praise.pafin.com/time/my-timesheet*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CARD_ID = 'tm-praise-timesheet-balance-card';
  const VALUE_ID = 'tm-praise-timesheet-balance-value';
  const LABEL_TEXT = 'Extra / Short';
  const TOTAL_HOURS_LABEL = 'Total Hours Worked';
  const WORKED_DAYS_LABEL = 'Worked Days';
  const EXPECTED_MINUTES_PER_WORKED_DAY = 8 * 60;
  const UPDATE_DELAY_MS = 100;

  let updateTimer = 0;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findElementByExactText(root, text) {
    const matches = Array.from(root.querySelectorAll('*')).filter((element) => normalizeText(element.textContent) === text);
    return matches.find((element) => Array.from(element.children).every((child) => normalizeText(child.textContent) !== text)) || matches[0] || null;
  }

  function findStatCard(label) {
    const labelElement = findElementByExactText(document.body, label);
    return labelElement ? labelElement.closest('.rt-Card') : null;
  }

  function findStatValue(label) {
    const card = findStatCard(label);
    if (!card) return '';

    const labelElement = findElementByExactText(card, label);
    const textColumn = labelElement ? labelElement.closest('.rt-r-fd-column') : null;
    const valueElement = textColumn ? textColumn.querySelector('.rt-r-weight-bold') : card.querySelector('.rt-r-weight-bold');

    return normalizeText(valueElement ? valueElement.textContent : '');
  }

  function parseDurationMinutes(text) {
    const normalized = normalizeText(text);
    const hourMatch = normalized.match(/([+-]?\d+(?:\.\d+)?)\s*h/i);
    const minuteMatch = normalized.match(/([+-]?\d+)\s*m/i);

    if (!hourMatch && !minuteMatch) return null;

    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    return Math.round(hours * 60) + minutes;
  }

  function parseWorkedDays(text) {
    const match = normalizeText(text).match(/^(\d+(?:\.\d+)?)/);
    if (!match) return null;

    const days = Number(match[1]);
    return Number.isFinite(days) ? days : null;
  }

  function formatSignedDuration(totalMinutes) {
    const roundedMinutes = Math.round(totalMinutes);
    if (roundedMinutes === 0) return '0h';

    const sign = roundedMinutes > 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(roundedMinutes);
    const hours = Math.floor(absoluteMinutes / 60);
    const minutes = absoluteMinutes % 60;
    const parts = [];

    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return `${sign}${parts.join(' ')}`;
  }

  function setBalanceColor(valueElement, balanceMinutes) {
    if (!valueElement) return;

    let color = 'var(--gray-11)';

    if (balanceMinutes > 0) {
      color = 'var(--green-11)';
    } else if (balanceMinutes < 0) {
      color = 'var(--red-11)';
    }

    if (valueElement.style.color !== color) valueElement.style.color = color;
  }

  function createBalanceCard(sampleCard) {
    const card = sampleCard.cloneNode(true);
    card.id = CARD_ID;
    card.title = 'Total Hours Worked minus Worked Days x 8h';

    for (const button of card.querySelectorAll('button')) {
      button.remove();
    }

    for (const chart of card.querySelectorAll('.recharts-wrapper')) {
      const chartBox = chart.closest('.rt-Box');
      if (chartBox) chartBox.remove();
    }

    const oldLabel = findElementByExactText(card, TOTAL_HOURS_LABEL);
    if (oldLabel) oldLabel.textContent = LABEL_TEXT;

    const valueElement = card.querySelector('.rt-r-weight-bold');
    if (valueElement) {
      valueElement.id = VALUE_ID;
      valueElement.textContent = '...';
    }

    return card;
  }

  function ensureBalanceCard(sampleCard) {
    const grid = sampleCard.parentElement;
    if (!grid) return null;

    const existingCard = document.getElementById(CARD_ID);
    if (existingCard && existingCard.parentElement === grid) return existingCard;
    if (existingCard) existingCard.remove();

    const card = createBalanceCard(sampleCard);
    grid.append(card);
    return card;
  }

  function updateBalanceCard() {
    const totalCard = findStatCard(TOTAL_HOURS_LABEL);
    if (!totalCard) return;

    const totalMinutes = parseDurationMinutes(findStatValue(TOTAL_HOURS_LABEL));
    const workedDays = parseWorkedDays(findStatValue(WORKED_DAYS_LABEL));
    if (totalMinutes === null || workedDays === null) return;

    const balanceMinutes = totalMinutes - (workedDays * EXPECTED_MINUTES_PER_WORKED_DAY);
    const card = ensureBalanceCard(totalCard);
    if (!card) return;

    const valueElement = card.querySelector(`#${VALUE_ID}`);
    if (!valueElement) return;

    const nextValue = formatSignedDuration(balanceMinutes);
    if (normalizeText(valueElement.textContent) !== nextValue) {
      valueElement.textContent = nextValue;
    }

    setBalanceColor(valueElement, balanceMinutes);
  }

  function scheduleUpdate() {
    if (updateTimer) return;

    updateTimer = window.setTimeout(() => {
      updateTimer = 0;
      updateBalanceCard();
    }, UPDATE_DELAY_MS);
  }

  function start() {
    scheduleUpdate();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.setInterval(scheduleUpdate, 5000);
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
