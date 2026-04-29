/**
 * format.js — Text formatting utilities
 * Telegram MarkdownV2 escaping, text sparklines, display helpers.
 */

/**
 * Escape text for Telegram MarkdownV2.
 * Escapes: . - ( ) ! + = _ * ~ > # | { } [ ] \ &
 * @param {string|number} text
 * @returns {string}
 */
export function escapeMdV2(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  return str.replace(/[`\.\-()!+=_*~>#|{}[\]\\&]/g, c => `\\${c}`);
}

/**
 * Generate a text sparkline from an array of numbers.
 * @param {number[]} values
 * @returns {string} e.g. "▁▃▅▇▆▄▂"
 */
export function sparkline(values) {
  if (!values || values.length === 0) return '';
  const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => '▄').join('');
  return values.map(v => {
    const normalized = (v - min) / range;
    const idx = Math.min(Math.floor(normalized * BLOCKS.length), BLOCKS.length - 1);
    return BLOCKS[idx];
  }).join('');
}

/**
 * Format a number with commas.
 * @param {number} n
 * @returns {string}
 */
export function commaNum(n) {
  if (n === null || n === undefined) return 'N/A';
  return Number(n).toLocaleString('en-US');
}

/**
 * Format a percentage.
 * @param {number} n
 * @returns {string}
 */
export function pct(n) {
  if (n === null || n === undefined) return 'N/A';
  return `${Math.round(n)}%`;
}

/**
 * Format change as ±N% string.
 * @param {number} change - fractional change (0.12 = +12%)
 * @returns {string}
 */
export function formatChange(change) {
  if (change === null || change === undefined || !isFinite(change)) return '';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${Math.round(change * 100)}%`;
}

/**
 * Format a date string to short display (e.g. "Apr 28").
 * @param {string} dateStr - ISO date or datetime string
 * @returns {string}
 */
export function shortDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

/**
 * Format age in ms to human-readable.
 * @param {number} ageMs
 * @returns {string}
 */
export function formatAge(ageMs) {
  if (!isFinite(ageMs)) return 'unknown age';
  const hours = Math.floor(ageMs / 3600000);
  const mins = Math.floor((ageMs % 3600000) / 60000);
  if (hours === 0) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ${mins}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Capitalize first letter of a string.
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Build a Telegram-safe digest line from an object.
 * @param {string} text - already-formatted plain text
 * @returns {string} MarkdownV2-escaped version
 */
export function toTelegramSafe(text) {
  return escapeMdV2(text);
}
