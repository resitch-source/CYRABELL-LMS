/**
 * @module shared/ui
 * @description Reusable UI primitives: toast notifications, modals, data tables,
 *              loading spinners, empty states, confirm dialogs.
 *              All functions return DOM strings or manipulate the DOM directly.
 * @dependencies none
 * @events PUBLISHES: ui:modal:open, ui:modal:close
 */

// ─── TOAST ───────────────────────────────────────────────────────────────────

let _toastContainer = null;

function getToastContainer() {
  if (_toastContainer) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.id = 'lf-toasts';
  _toastContainer.className = 'fixed top-6 right-6 z-50 flex flex-col gap-2 pointer-events-none';
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

/**
 * @description Show a toast notification. Auto-dismisses after `ms`.
 * @workflow ui
 * @trace-id UI-TOAST-01
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} [type='info']
 * @param {number} [ms=4000]
 */
export function toast(message, type = 'info', ms = 4000) {
  const c = getToastContainer();
  const colors = {
    success: 'bg-emerald-900 border-emerald-600 text-emerald-50',
    error:   'bg-red-950   border-red-700      text-red-50',
    warning: 'bg-amber-900 border-amber-600    text-amber-50',
    info:    'bg-ink       border-gold/40       text-parchment'
  };
  const icons = { success: '✓', error: '✕', warning: '⚠', info: '✦' };

  const el = document.createElement('div');
  el.className = `pointer-events-auto flex items-start gap-3 px-4 py-3 rounded border
    ${colors[type] || colors.info} shadow-2xl
    font-body text-sm max-w-sm translate-x-8 opacity-0
    transition-all duration-300`;
  el.innerHTML = `
    <span class="text-base leading-none mt-0.5 shrink-0">${icons[type] || icons.info}</span>
    <span class="leading-snug">${escHtml(message)}</span>
    <button class="ml-auto shrink-0 opacity-60 hover:opacity-100 text-base leading-none" onclick="this.closest('div').remove()">×</button>
  `;
  c.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(2rem)';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ─── MODAL ───────────────────────────────────────────────────────────────────

let _modalEl = null;

/**
 * @description Open a modal dialog with arbitrary HTML content.
 * @workflow ui
 * @trace-id UI-MODAL-01
 * @param {string} titleHtml
 * @param {string} bodyHtml
 * @param {Object} [opts]   { wide:false, onClose:fn }
 */
export function openModal(titleHtml, bodyHtml, opts = {}) {
  closeModal();
  _modalEl = document.createElement('div');
  _modalEl.className = 'fixed inset-0 z-40 flex items-center justify-center p-4';
  _modalEl.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" id="modal-backdrop"></div>
    <div class="relative bg-parchment border border-ink/20 rounded-lg shadow-2xl
         ${opts.wide ? 'w-full max-w-4xl' : 'w-full max-w-xl'}
         max-h-[90vh] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-ink/10 shrink-0">
        <h2 class="font-display text-xl text-ink">${titleHtml}</h2>
        <button id="modal-close" class="text-ink-muted hover:text-ink text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-ink/5 transition">&times;</button>
      </div>
      <div class="overflow-y-auto flex-1 px-6 py-5 modal-body">${bodyHtml}</div>
    </div>`;

  document.body.appendChild(_modalEl);
  document.body.classList.add('overflow-hidden');
  _modalEl.querySelector('#modal-backdrop').addEventListener('click', closeModal);
  _modalEl.querySelector('#modal-close').addEventListener('click', closeModal);
  window.dispatchEvent(new CustomEvent('cyrabell:ui:modal:open'));
}

export function closeModal() {
  if (_modalEl) { _modalEl.remove(); _modalEl = null; }
  document.body.classList.remove('overflow-hidden');
  window.dispatchEvent(new CustomEvent('cyrabell:ui:modal:close'));
}

export function modalBody() {
  return _modalEl?.querySelector('.modal-body');
}

// ─── CONFIRM DIALOG ──────────────────────────────────────────────────────────

/**
 * @description Promise-based confirm dialog.
 * @workflow ui
 * @trace-id UI-CONFIRM-01
 * @param {string} message
 * @param {string} [confirmLabel='Confirm']
 * @returns {Promise<boolean>}
 */
export function confirm(message, confirmLabel = 'Confirm') {
  return new Promise(resolve => {
    openModal('Confirm', `
      <p class="font-body text-ink mb-6">${escHtml(message)}</p>
      <div class="flex gap-3 justify-end">
        <button id="confirm-no"  class="btn-secondary">Cancel</button>
        <button id="confirm-yes" class="btn-danger">${escHtml(confirmLabel)}</button>
      </div>`, { wide: false });
    _modalEl.querySelector('#confirm-yes').addEventListener('click', () => { closeModal(); resolve(true); });
    _modalEl.querySelector('#confirm-no').addEventListener('click',  () => { closeModal(); resolve(false); });
  });
}

// ─── SPINNER ─────────────────────────────────────────────────────────────────

/**
 * @description Replace element content with a centered spinner.
 * @workflow ui
 * @trace-id UI-SPIN-01
 */
export function showSpinner(el, label = 'Loading…') {
  if (!el) return;
  el.innerHTML = `
    <div class="flex flex-col items-center justify-center py-16 gap-4 text-ink-muted">
      <svg class="animate-spin h-8 w-8 text-gold" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      <span class="font-mono text-sm">${escHtml(label)}</span>
    </div>`;
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

export function emptyState(label, icon = '◈', actionHtml = '') {
  return `<div class="flex flex-col items-center justify-center py-16 gap-3 text-ink-muted">
    <span class="text-4xl opacity-40">${icon}</span>
    <p class="font-body text-sm">${escHtml(label)}</p>
    ${actionHtml}
  </div>`;
}

// ─── DATA TABLE ──────────────────────────────────────────────────────────────

/**
 * @description Render a responsive data table from column definitions + rows.
 * @workflow ui
 * @trace-id UI-TABLE-01
 * @param {Array<{key:string, label:string, render?:fn}>} cols
 * @param {Array<Object>} rows
 * @param {Object} [opts]   { rowAction:fn(row), selectable:bool, id:string }
 * @returns {string} HTML string
 */
export function dataTable(cols, rows, opts = {}) {
  if (!rows.length) return emptyState('No records found');
  const id = opts.id || 'tbl-' + Math.random().toString(36).slice(2,6);
  const thead = cols.map(c => `<th class="text-left py-3 px-4 font-mono text-xs uppercase tracking-widest text-ink-muted border-b border-ink/10 whitespace-nowrap">${escHtml(c.label)}</th>`).join('');
  const tbody = rows.map((row, ri) => {
    const cells = cols.map(c => {
      const raw = row[c.key] ?? '';
      const val = c.render ? c.render(raw, row) : escHtml(String(raw));
      return `<td class="py-3 px-4 text-sm font-body text-ink border-b border-ink/5 align-top">${val}</td>`;
    }).join('');
    const clickAttr = opts.rowAction ? `data-row-index="${ri}" class="hover:bg-gold/5 cursor-pointer transition-colors"` : '';
    return `<tr ${clickAttr}>${cells}</tr>`;
  }).join('');

  const html = `<div class="overflow-x-auto rounded border border-ink/10">
    <table id="${id}" class="w-full border-collapse">
      <thead class="bg-ink/5"><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>`;

  if (opts.rowAction) {
    // Wire up after insertion via delegation
    setTimeout(() => {
      document.getElementById(id)?.querySelectorAll('tr[data-row-index]').forEach(tr => {
        tr.addEventListener('click', () => opts.rowAction(rows[+tr.dataset.rowIndex]));
      });
    }, 0);
  }
  return html;
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  open:       'bg-blue-100 text-blue-800',
  pending:    'bg-amber-100 text-amber-800',
  confirmed:  'bg-emerald-100 text-emerald-800',
  'checked-in':'bg-teal-100 text-teal-800',
  completed:  'bg-gray-200 text-gray-700',
  closed:     'bg-gray-200 text-gray-700',
  cancelled:  'bg-red-100 text-red-800',
  overdue:    'bg-red-100 text-red-800',
  unpaid:     'bg-amber-100 text-amber-800',
  paid:       'bg-emerald-100 text-emerald-800',
  discovery:  'bg-violet-100 text-violet-800',
  trial:      'bg-orange-100 text-orange-800',
};

export function badge(status) {
  const cls = STATUS_COLORS[String(status).toLowerCase()] || 'bg-gray-100 text-gray-700';
  return `<span class="inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${cls}">${escHtml(status)}</span>`;
}

// ─── FORM HELPERS ─────────────────────────────────────────────────────────────

export function fieldGroup(label, inputHtml, hint = '') {
  return `<div class="mb-5">
    <label class="block font-mono text-xs uppercase tracking-widest text-ink-muted mb-1.5">${escHtml(label)}</label>
    ${inputHtml}
    ${hint ? `<p class="text-xs text-ink-muted mt-1 font-body">${escHtml(hint)}</p>` : ''}
  </div>`;
}

export function textInput(name, value = '', attrs = '') {
  return `<input name="${name}" value="${escHtml(value)}" ${attrs}
    class="w-full border border-ink/20 bg-white/60 rounded px-3 py-2
           font-body text-sm text-ink placeholder-ink-muted/50
           focus:outline-none focus:ring-2 focus:ring-gold/40 transition">`;
}

export function selectInput(name, options, selected = '') {
  const opts = options.map(([v, l]) =>
    `<option value="${escHtml(v)}" ${v===selected?'selected':''}>${escHtml(l)}</option>`
  ).join('');
  return `<select name="${name}" class="w-full border border-ink/20 bg-white/60 rounded px-3 py-2
    font-body text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold/40 transition">${opts}</select>`;
}

export function formData(el) {
  const fd = new FormData(el);
  const obj = {};
  fd.forEach((v, k) => obj[k] = v);
  return obj;
}

// ─── MISC ─────────────────────────────────────────────────────────────────────

export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }); } catch (_) { return iso; }
}

export function fmtCurrency(n) {
  return '₱' + (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

export function fmtPct(n) {
  return (parseFloat(n) || 0).toFixed(0) + '%';
}

/** Confidence meter 0-1 → coloured bar HTML */
export function confidenceBar(conf) {
  const pct = Math.round((conf || 0) * 100);
  const color = pct > 70 ? 'bg-emerald-500' : pct > 40 ? 'bg-amber-500' : 'bg-red-400';
  return `<div class="flex items-center gap-2">
    <div class="flex-1 h-1.5 bg-ink/10 rounded-full overflow-hidden">
      <div class="${color} h-full rounded-full transition-all" style="width:${pct}%"></div>
    </div>
    <span class="font-mono text-xs text-ink-muted">${pct}%</span>
  </div>`;
}

/** Risk level color */
export function riskBadge(pct) {
  const n = parseInt(pct, 10) || 0;
  const cls = n > 65 ? 'bg-red-100 text-red-800' : n > 35 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  const label = n > 65 ? 'High' : n > 35 ? 'Medium' : 'Low';
  return `<span class="inline-block px-2 py-0.5 rounded text-xs font-mono ${cls}">${label} (${n}%)</span>`;
}
