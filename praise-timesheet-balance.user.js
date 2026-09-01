// ==UserScript==
// @name         Praise Timesheet Balance
// @namespace    local.praise.timesheet.balance
// @version      1.5.0
// @description  Show the current catch-up gap or the clock-out time that closes it.
// @match        https://praise.pafin.com/time/my-timesheet*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CARD_ID = 'tm-praise-timesheet-balance-card';
  const LABEL_ID = 'tm-praise-timesheet-balance-label';
  const VALUE_ID = 'tm-praise-timesheet-balance-value';
  const ACTIVE_LABEL_TEXT = 'Clock Out At';
  const INACTIVE_LABEL_TEXT = 'Catch Up';
  const TOTAL_HOURS_LABEL = 'Total Hours Worked';
  const TIME_CLOCK_LABEL = 'Time Clock';
  const CLOCKED_IN_LABEL = 'Clocked In';
  const ON_BREAK_LABEL = 'On Break';
  const WORKING_DAY_LABEL = 'Working Day';
  const HALF_DAY_LEAVE_LABELS = ['AM Leave', 'PM Leave'];
  const EXPECTED_MINUTES_PER_WORKING_DAY = 8 * 60;
  const UPDATE_DELAY_MS = 100;
  const LIVE_UPDATE_INTERVAL_MS = 1000;

  let updateTimer = 0;
  let liveAnchor = null;

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

  function parseDurationSeconds(text) {
    const normalized = normalizeText(text);
    const hourMatch = normalized.match(/(\d+)\s*h/i);
    const minuteMatch = normalized.match(/(\d+)\s*m/i);
    const secondMatch = normalized.match(/(\d+)\s*s/i);

    if (!secondMatch) return null;

    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    const seconds = Number(secondMatch[1]);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;

    return (hours * 60 * 60) + (minutes * 60) + seconds;
  }

  function findClockState() {
    const card = findStatCard(TIME_CLOCK_LABEL);
    if (!card) return { isActive: false, timerSeconds: null };

    const isWorking = Boolean(findElementByExactText(card, CLOCKED_IN_LABEL));
    const isOnBreak = Boolean(findElementByExactText(card, ON_BREAK_LABEL));
    if (!isWorking && !isOnBreak) return { isActive: false, timerSeconds: null };

    if (isOnBreak) return { isActive: true, timerSeconds: null };

    for (const element of card.querySelectorAll('.rt-r-weight-bold')) {
      const seconds = parseDurationSeconds(element.textContent);
      if (seconds !== null) return { isActive: true, timerSeconds: seconds };
    }

    return { isActive: true, timerSeconds: null };
  }

  function parseRowDate(text) {
    const normalized = normalizeText(text).replace(/\s*\([^)]*\)\s*$/, '');
    const timestamp = Date.parse(`${normalized} 00:00:00`);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  function findRequiredMinutesToDate() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let foundDate = false;
    let requiredMinutes = 0;

    for (const row of document.querySelectorAll('table tbody tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;

      const date = parseRowDate(cells[0].textContent);
      if (!date) continue;

      foundDate = true;
      if (date > today) continue;

      const dayType = normalizeText(cells[1].textContent);
      if (!dayType.includes(WORKING_DAY_LABEL)) continue;

      const isHalfDayLeave = HALF_DAY_LEAVE_LABELS.some((label) => dayType.includes(label));
      requiredMinutes += isHalfDayLeave
        ? EXPECTED_MINUTES_PER_WORKING_DAY / 2
        : EXPECTED_MINUTES_PER_WORKING_DAY;
    }

    return foundDate ? requiredMinutes : null;
  }

  function isViewingCurrentMonth() {
    const now = new Date();
    const params = new URLSearchParams(window.location.search);
    const year = Number(params.get('year') || now.getFullYear());
    const month = Number(params.get('month') || now.getMonth() + 1);
    return year === now.getFullYear() && month === now.getMonth() + 1;
  }

  function formatClockTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function formatRemainingDuration(totalSeconds) {
    const roundedMinutes = Math.ceil(totalSeconds / 60);
    if (roundedMinutes === 0) return 'Caught Up';

    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;
    const parts = [];

    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ');
  }

  function setValueColor(valueElement, isActive, remainingSeconds) {
    if (!valueElement) return;

    const color = isActive || remainingSeconds === 0 ? 'var(--green-11)' : 'var(--red-11)';

    if (valueElement.style.color !== color) valueElement.style.color = color;
  }

  function createBalanceCard(sampleCard) {
    const card = sampleCard.cloneNode(true);
    card.id = CARD_ID;
    card.title = 'Clock-out time that meets required working hours elapsed to date';

    for (const button of card.querySelectorAll('button')) {
      button.remove();
    }

    for (const chart of card.querySelectorAll('.recharts-wrapper')) {
      const chartBox = chart.closest('.rt-Box');
      if (chartBox) chartBox.remove();
    }

    const oldLabel = findElementByExactText(card, TOTAL_HOURS_LABEL);
    if (oldLabel) {
      oldLabel.id = LABEL_ID;
      oldLabel.textContent = INACTIVE_LABEL_TEXT;
    }

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
    const requiredMinutes = findRequiredMinutesToDate();
    if (totalMinutes === null || requiredMinutes === null) return;

    const clockState = isViewingCurrentMonth()
      ? findClockState()
      : { isActive: false, timerSeconds: null };
    const liveTimerSeconds = clockState.timerSeconds;
    if (liveTimerSeconds === null) {
      liveAnchor = null;
    } else if (
      !liveAnchor ||
      liveAnchor.totalMinutes !== totalMinutes ||
      liveTimerSeconds < liveAnchor.timerSeconds
    ) {
      liveAnchor = { totalMinutes, timerSeconds: liveTimerSeconds };
    }

    const liveDeltaSeconds = liveAnchor ? liveTimerSeconds - liveAnchor.timerSeconds : 0;
    const workedSeconds = (totalMinutes * 60) + liveDeltaSeconds;
    const remainingSeconds = Math.max(0, (requiredMinutes * 60) - workedSeconds);
    const card = ensureBalanceCard(totalCard);
    if (!card) return;

    const valueElement = card.querySelector(`#${VALUE_ID}`);
    const labelElement = card.querySelector(`#${LABEL_ID}`);
    if (!valueElement || !labelElement) return;

    const nextLabel = clockState.isActive ? ACTIVE_LABEL_TEXT : INACTIVE_LABEL_TEXT;
    const nextValue = clockState.isActive
      ? remainingSeconds === 0
        ? 'Now'
        : formatClockTime(Date.now() + (remainingSeconds * 1000))
      : formatRemainingDuration(remainingSeconds);
    if (normalizeText(labelElement.textContent) !== nextLabel) {
      labelElement.textContent = nextLabel;
    }
    if (normalizeText(valueElement.textContent) !== nextValue) {
      valueElement.textContent = nextValue;
    }

    setValueColor(valueElement, clockState.isActive, remainingSeconds);
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

    window.setInterval(scheduleUpdate, LIVE_UPDATE_INTERVAL_MS);
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
