/**
 * @module shared/utils
 * @description Pure utility functions used across all frontend modules.
 *              No DOM dependencies, no side effects.
 * @dependencies none
 */

/**
 * @description Debounce a function call.
 * @trace-id UTIL-DEBOUNCE-01
 */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * @description Throttle a function call.
 * @trace-id UTIL-THROTTLE-01
 */
export function throttle(fn, ms = 300) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

/**
 * @description Generate a client-side UUID v4.
 * @trace-id UTIL-UUID-01
 */
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * @description Deep clone a plain object.
 * @trace-id UTIL-CLONE-01
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @description Flatten nested object to dot-notation keys.
 * @trace-id UTIL-FLATTEN-01
 */
export function flatten(obj, prefix = '') {
  return Object.keys(obj).reduce((acc, key) => {
    const full = prefix ? `${prefix}.${key}` : key;
    if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      Object.assign(acc, flatten(obj[key], full));
    } else {
      acc[full] = obj[key];
    }
    return acc;
  }, {});
}

/**
 * @description Format ISO date string to human-readable.
 * @trace-id UTIL-DATE-01
 */
export function fmtDate(iso, locale = 'en-PH') {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) { return iso; }
}

export function fmtDateTime(iso, locale = 'en-PH') {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) { return iso; }
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * @description Format currency (Philippine Peso).
 * @trace-id UTIL-CURRENCY-01
 */
export function fmtCurrency(n) {
  return '₱' + (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * @description Chunk array into groups of n.
 * @trace-id UTIL-CHUNK-01
 */
export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * @description Group array of objects by a key.
 * @trace-id UTIL-GROUP-01
 */
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] ?? '_';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

/**
 * @description Sort array of objects by a key.
 * @trace-id UTIL-SORT-01
 */
export function sortBy(arr, key, dir = 'asc') {
  return [...arr].sort((a, b) => {
    const av = a[key] ?? '', bv = b[key] ?? '';
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ?  1 : -1;
    return 0;
  });
}

/**
 * @description Validate email address.
 * @trace-id UTIL-VALID-01
 */
export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}

export function isPhone(s) {
  return /^[+]?[\d\s\-().]{7,20}$/.test(String(s || ''));
}

/**
 * @description Parse JSON safely — returns fallback on error.
 * @trace-id UTIL-JSON-01
 */
export function safeJson(s, fallback = null) {
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

/**
 * @description Build a query string from object.
 * @trace-id UTIL-QS-01
 */
export function toQs(obj) {
  return new URLSearchParams(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
}

/**
 * @description Pluralise a word.
 * @trace-id UTIL-PLURAL-01
 */
export function plural(n, word, suffix = 's') {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

/**
 * @description Clamp a number.
 * @trace-id UTIL-CLAMP-01
 */
export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/**
 * @description Get value at dot-path in object.
 * @trace-id UTIL-PATH-01
 */
export function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj) ?? fallback;
}

/**
 * @description Pick selected keys from object.
 * @trace-id UTIL-PICK-01
 */
export function pick(obj, keys) {
  return keys.reduce((acc, k) => { if (k in obj) acc[k] = obj[k]; return acc; }, {});
}

/**
 * @description Omit keys from object.
 * @trace-id UTIL-OMIT-01
 */
export function omit(obj, keys) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

/**
 * @description Keyboard shortcut registry.
 * @trace-id UTIL-SHORTCUT-01
 * @param {string}   combo  e.g. 'ctrl+k', 'shift+n'
 * @param {Function} fn
 * @returns {Function} unregister
 */
export function onKey(combo, fn) {
  const parts = combo.toLowerCase().split('+');
  const key   = parts.pop();
  const ctrl  = parts.includes('ctrl');
  const shift = parts.includes('shift');
  const alt   = parts.includes('alt');
  const handler = e => {
    if (ctrl  && !e.ctrlKey  && !e.metaKey) return;
    if (shift && !e.shiftKey) return;
    if (alt   && !e.altKey)   return;
    if (e.key.toLowerCase() !== key) return;
    fn(e);
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

/**
 * @description Download JSON/CSV/text as a file.
 * @trace-id UTIL-DOWNLOAD-01
 */
export function downloadFile(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

export function exportCsv(rows, filename = 'export.csv') {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const csv  = [cols.join(','), ...rows.map(r => cols.map(c => `"${String(r[c]??'').replace(/"/g,'""')}"`).join(','))].join('\n');
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}

/** Today's date in YYYY-MM-DD */
export function today() { return new Date().toISOString().slice(0,10); }

/** Next n weekdays from today */
export function nextWeekdays(n = 7) {
  const days = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d.toISOString().slice(0,10));
  }
  return days;
}
