/**
 * @module modules/casework
 * @description Full legal case management lifecycle module.
 *              Covers: intake, conflict check, status progression,
 *              linked documents, time entries, and AI predictions.
 * @dependencies core/api, core/auth, shared/ui, shared/utils, modules/documents, modules/billing
 * @events PUBLISHES: case:created, case:updated, case:closed
 *         SUBSCRIBES: router:navigated (#cases)
 */

import { Cases, Clients, AI } from '../core/api.js';
import { currentUser, isLawyer, isAdmin } from '../core/auth.js';
import { toast, openModal, closeModal, dataTable, badge, showSpinner,
         emptyState, fieldGroup, selectInput, textInput, formData,
         fmtDate, confidenceBar, escHtml } from '../shared/ui.js';
import { debounce, today, fmtCurrency } from '../shared/utils.js';
import { renderDocuments } from './documents.js';
import { renderTimeEntries } from './billing.js';

const CASE_TYPES = [
  ['civil','Civil Litigation'],['criminal','Criminal'],['family','Family Law'],
  ['corporate','Corporate / Commercial'],['labor','Labor & Employment'],
  ['real_estate','Real Estate'],['immigration','Immigration'],['ip','Intellectual Property'],
];

const CASE_STATUSES = [
  ['open','Open'],['discovery','Discovery'],['trial','Trial'],['closed','Closed'],
];

// ─── PUBLIC ENTRY POINTS ──────────────────────────────────────────────────────

/**
 * @description Workflow: Case Management → render cases list view.
 * @workflow case-intake
 * @trace-id WF-CASE-VIEW-01
 * @param {HTMLElement} el
 */
export async function renderCases(el) {
  showSpinner(el, 'Loading cases…');
  try {
    const [cases, clients] = await Promise.all([Cases.list({}), Clients.list({})]);
    const clientMap = Object.fromEntries(clients.map(c => [c.client_id, c]));
    el.innerHTML = buildCasesView(cases, clientMap);
    wireCasesView(el, cases, clientMap);
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}

/**
 * @description Workflow: Case Intake → Step 1 – open new-case modal w/ conflict check.
 * @workflow case-intake
 * @trace-id WF-CASE-INTAKE-01
 * @param {Array} clients   Pre-loaded client list
 */
export async function openCaseModal(clients = []) {
  openModal('New Case — Intake', buildCaseForm(clients), { wide: true });
  const form = document.getElementById('case-form');
  const oppField = form?.querySelector('[name=opposing_party]');
  if (oppField) oppField.addEventListener('input', debounce(() => runConflictCheck(oppField.value), 500));
  form?.addEventListener('submit', handleCaseSubmit);
  // Trigger AI suggestions
  document.getElementById('case-type-sel')?.addEventListener('change', loadAiSuggestions);
}

// ─── VIEW BUILDERS ────────────────────────────────────────────────────────────

function buildCasesView(cases, clientMap) {
  const byStatus = { open:0, discovery:0, trial:0, closed:0 };
  cases.forEach(c => { if (byStatus.hasOwnProperty(c.status)) byStatus[c.status]++; });

  const cols = [
    { key:'case_id',    label:'Case ID',  render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
    { key:'client_id',  label:'Client',   render: (v) => {
      const cl = clientMap[v];
      return cl ? `<div class="text-sm font-body text-ink">${escHtml(cl.full_name)}</div>
        <div class="text-xs text-ink-muted font-body">${escHtml(v)}</div>` : escHtml(v);
    }},
    { key:'case_type',  label:'Type',     render: v => escHtml(CASE_TYPES.find(t=>t[0]===v)?.[1] || v) },
    { key:'status',     label:'Status',   render: v => badge(v) },
    { key:'filing_date',label:'Filed',    render: v => escHtml(fmtDate(v)) },
    { key:'opposing_party', label:'Opposing Party', render: v => v
        ? `<span class="text-sm font-body">${escHtml(v)}</span>` : '<span class="text-ink-muted text-xs">—</span>' },
    { key:'predicted_duration_months', label:'Est. Duration',
      render: v => v ? `<span class="font-mono text-xs">${escHtml(v)}mo</span>` : '—' },
  ];

  return `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-display text-3xl text-ink">Case Management</h1>
          <p class="font-body text-sm text-ink-muted mt-0.5">
            ${cases.length} total &nbsp;·&nbsp;
            <span class="text-blue-700">${byStatus.open} open</span> &nbsp;·&nbsp;
            <span class="text-violet-700">${byStatus.discovery} discovery</span> &nbsp;·&nbsp;
            <span class="text-orange-700">${byStatus.trial} trial</span> &nbsp;·&nbsp;
            ${byStatus.closed} closed
          </p>
        </div>
        <button id="btn-new-case" class="btn-primary text-sm">+ New Case</button>
      </div>

      <!-- Search + filter bar -->
      <div class="flex flex-wrap gap-3 items-center">
        <input id="case-search" type="text" placeholder="Search cases…"
          class="border border-ink/20 bg-white/60 rounded px-3 py-2 font-body text-sm w-64
                 focus:outline-none focus:ring-2 focus:ring-gold/40">
        <div class="flex gap-2">
          ${['all',...CASE_STATUSES.map(s=>s[0])].map(s =>
            `<button data-filter="${s}" class="filter-chip ${s==='all'?'active':''}">${s}</button>`
          ).join('')}
        </div>
        <button id="btn-export-cases" class="btn-secondary text-xs ml-auto">↓ Export CSV</button>
      </div>

      <!-- Table -->
      <div id="cases-table">
        ${cases.length
          ? dataTable(cols, cases, { rowAction: row => openCaseDetail(row, clientMap), id:'cases-tbl' })
          : emptyState('No cases yet', '⚖', `<button id="btn-new-case-empty" class="btn-primary text-sm mt-3">Create first case</button>`)}
      </div>
    </div>`;
}

function buildCaseForm(clients = []) {
  const clientOptions = clients.map(c => [c.client_id, `${c.full_name} (${c.client_id})`]);
  const lawyerOptions = [
    ['lawyer1@cyrabell.test','Atty. Benigno Reyes'],
    ['lawyer2@cyrabell.test','Atty. Carmelita Santos'],
  ];
  return `
    <form id="case-form">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <div>
          ${fieldGroup('Client', selectInput('client_id', clientOptions))}
          ${fieldGroup('Case Type', selectInput('case_type', CASE_TYPES, '', 'id="case-type-sel"'))}
          ${fieldGroup('Assigned Lawyer', selectInput('assigned_lawyer_email', lawyerOptions))}
          ${fieldGroup('Filing Date', textInput('filing_date', today(), 'type="date"'))}
        </div>
        <div>
          ${fieldGroup('Opposing Party', textInput('opposing_party','','placeholder="Opposing party name"'))}
          <div id="conflict-result" class="mb-4 hidden"></div>
          ${fieldGroup('Court / Venue', textInput('court_details','','placeholder="RTC Iligan, Branch 4"'))}
          ${fieldGroup('Case Summary / Notes',
            `<textarea name="notes" rows="4" class="w-full border border-ink/20 bg-white/60 rounded px-3 py-2 font-body text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold/40 transition" placeholder="Brief description of the matter…"></textarea>`
          )}
        </div>
      </div>

      <!-- AI Suggestion Panel -->
      <div id="ai-suggestion-panel" class="bg-ink/5 rounded-lg p-4 mb-5 hidden">
        <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-3">AI Recommendations</p>
        <div id="ai-content" class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm font-body text-ink"></div>
      </div>

      <div class="flex gap-3 justify-end border-t border-ink/10 pt-4">
        <button type="button" onclick="window.__cbCloseModal()" class="btn-secondary">Cancel</button>
        <button type="submit" id="case-submit-btn" class="btn-primary">Create Case</button>
      </div>
    </form>`;
}

// ─── CONFLICT CHECK ───────────────────────────────────────────────────────────

/**
 * @description Workflow: Case Intake → Step 1a – live fuzzy conflict check.
 * @workflow case-intake
 * @trace-id WF-CASE-CONFLICT-01
 * @param {string} opposing
 */
async function runConflictCheck(opposing) {
  const el = document.getElementById('conflict-result');
  if (!el || !opposing.trim()) { el?.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="text-xs font-mono text-ink-muted animate-pulse">Checking conflicts…</div>`;
  try {
    const { conflicts } = await Cases.conflictCheck({ opposing_party: opposing });
    if (!conflicts.length) {
      el.innerHTML = `<div class="flex items-center gap-2 text-emerald-700 text-sm font-body">
        <span class="text-base">✓</span> No conflicts found for "${escHtml(opposing)}"</div>`;
    } else {
      el.innerHTML = `<div class="border border-red-300 bg-red-50 rounded p-3">
        <p class="text-red-800 font-mono text-xs mb-2">⚠ ${conflicts.length} potential conflict(s)</p>
        ${conflicts.map(c => `
          <div class="text-sm font-body text-red-700">
            ${escHtml(c.type)}: <strong>${escHtml(c.match)}</strong>
            ${c.case_id ? `(${escHtml(c.case_id)})` : ''}
            — similarity ${Math.round(c.score*100)}%
          </div>`).join('')}
      </div>`;
    }
  } catch (_) { el.classList.add('hidden'); }
}

// ─── AI SUGGESTIONS ───────────────────────────────────────────────────────────

/**
 * @description Workflow: Case Intake → Step 2a – load AI duration + lawyer suggestions.
 * @workflow ai-prediction
 * @trace-id AI-INTAKE-01
 */
async function loadAiSuggestions() {
  const panel = document.getElementById('ai-suggestion-panel');
  const content = document.getElementById('ai-content');
  if (!panel || !content) return;
  panel.classList.remove('hidden');
  content.innerHTML = '<p class="col-span-2 font-mono text-xs animate-pulse text-ink-muted">Loading AI recommendations…</p>';
  const form = document.getElementById('case-form');
  const caseType   = form?.querySelector('[name=case_type]')?.value;
  const lawyer     = form?.querySelector('[name=assigned_lawyer_email]')?.value;
  const opposing   = form?.querySelector('[name=opposing_party]')?.value;
  try {
    const [dur, sug] = await Promise.all([
      AI.predictDuration({ case_type: caseType, lawyer, opposing_party: opposing }),
      AI.suggestLawyer({ case_type: caseType })
    ]);
    content.innerHTML = `
      <div>
        <p class="font-mono text-xs text-ink-muted mb-1">Predicted Duration</p>
        <p class="text-2xl font-display text-ink">${escHtml(String(dur.predicted_months))} <span class="text-base">months</span></p>
        <div class="mt-1">${confidenceBar(dur.confidence)}</div>
        <p class="text-xs text-ink-muted mt-1 font-body">${escHtml(dur.reason||'')}</p>
        <button class="text-xs text-gold font-mono mt-2 hover:underline" onclick="aiFeedbackThumb('dur','${escHtml(String(dur.predicted_months))}')">
          👍 Helpful &nbsp; 👎 Incorrect
        </button>
      </div>
      <div>
        <p class="font-mono text-xs text-ink-muted mb-1">Suggested Lawyer</p>
        <p class="text-sm font-body text-ink mt-1">${escHtml(sug.recommended_lawyer_email)}</p>
        <p class="text-xs text-ink-muted font-body mt-1">${escHtml(sug.reason||'')}</p>
      </div>`;
  } catch (_) { content.innerHTML = '<p class="col-span-2 text-xs text-ink-muted font-body">AI unavailable</p>'; }
}

// ─── FORM SUBMISSION ──────────────────────────────────────────────────────────

/**
 * @description Workflow: Case Intake → Step 3 – submit case creation.
 * @workflow case-intake
 * @trace-id WF-CASE-03
 */
async function handleCaseSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('case-submit-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const data = formData(e.target);
    const c = await Cases.create(data);
    closeModal();
    toast(`Case ${c.case_id} created. AI predicts ${c.ai_prediction?.predicted_months} months.`, 'success', 6000);
    window.dispatchEvent(new CustomEvent('cyrabell:case:created', { detail: c }));
    const outlet = document.getElementById('main-outlet');
    if (outlet) renderCases(outlet);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Case';
  }
}

// ─── CASE DETAIL ──────────────────────────────────────────────────────────────

/**
 * @description Workflow: Case Management → full case detail with tabs.
 * @workflow case-intake
 * @trace-id WF-CASE-DETAIL-01
 */
async function openCaseDetail(row, clientMap) {
  const client = clientMap[row.client_id];
  const isStaff = isLawyer() || isAdmin();

  openModal(`
    <span class="font-mono text-sm mr-2 text-ink-muted">${escHtml(row.case_id)}</span>
    ${escHtml(CASE_TYPES.find(t=>t[0]===row.case_type)?.[1] || row.case_type)}`,
    buildCaseDetail(row, client, isStaff), { wide: true });

  wireCaseTabs(row);
}

function buildCaseDetail(row, client, isStaff) {
  return `
    <div class="space-y-4">
      <!-- Case meta -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-body">
        <div><p class="font-mono text-xs text-ink-muted">Client</p>
          <p class="text-ink mt-0.5">${escHtml(client?.full_name || row.client_id)}</p></div>
        <div><p class="font-mono text-xs text-ink-muted">Status</p>
          <p class="mt-0.5">${badge(row.status)}</p></div>
        <div><p class="font-mono text-xs text-ink-muted">Filed</p>
          <p class="text-ink mt-0.5">${escHtml(fmtDate(row.filing_date))}</p></div>
        <div><p class="font-mono text-xs text-ink-muted">Est. Duration</p>
          <p class="text-ink mt-0.5 font-mono">${escHtml(String(row.predicted_duration_months||'?'))} mo</p></div>
        <div class="col-span-2"><p class="font-mono text-xs text-ink-muted">Opposing Party</p>
          <p class="text-ink mt-0.5">${escHtml(row.opposing_party||'—')}</p></div>
        <div class="col-span-2"><p class="font-mono text-xs text-ink-muted">Court / Venue</p>
          <p class="text-ink mt-0.5">${escHtml(row.court_details||'—')}</p></div>
      </div>

      <!-- Status progress -->
      <div class="flex items-center gap-1 flex-wrap">
        ${['open','discovery','trial','closed'].map((s, i) => {
          const statuses = ['open','discovery','trial','closed'];
          const cur = statuses.indexOf(row.status);
          const idx = statuses.indexOf(s);
          const done = idx < cur, active = idx === cur;
          return `<div class="flex items-center gap-1">
            ${i > 0 ? '<div class="h-px w-6 bg-ink/10"></div>' : ''}
            <div class="flex flex-col items-center">
              <div class="w-6 h-6 rounded-full text-xs flex items-center justify-center font-mono
                ${done?'bg-emerald-600 text-white':active?'bg-ink text-parchment':'bg-ink/10 text-ink-muted'}">
                ${done?'✓':i+1}
              </div>
              <p class="text-xs font-mono text-ink-muted mt-0.5">${s}</p>
            </div>
          </div>`;
        }).join('')}
      </div>

      <!-- Tabs -->
      <div class="border-b border-ink/10">
        <div class="flex gap-6" id="case-tabs">
          ${['Documents','Time & Billing','Notes'].map((t,i) =>
            `<button data-tab="${t.toLowerCase().replace(/\s+/g,'-')}" class="tab-btn ${i===0?'active':''} pb-3 font-mono text-xs uppercase tracking-widest">${t}</button>`
          ).join('')}
        </div>
      </div>
      <div id="case-tab-content" class="min-h-40">
        <div class="flex justify-center py-10"><div class="animate-spin h-5 w-5 border-2 border-gold border-t-transparent rounded-full"></div></div>
      </div>

      <!-- Staff actions -->
      ${isStaff ? `
      <div class="flex gap-2 flex-wrap border-t border-ink/10 pt-3">
        <select id="case-status-sel" class="border border-ink/20 rounded px-2 py-1.5 text-sm font-body bg-white/60 focus:outline-none">
          ${CASE_STATUSES.map(([v,l]) => `<option value="${v}" ${v===row.status?'selected':''}>${l}</option>`).join('')}
        </select>
        <button id="btn-update-case-status" class="btn-primary text-sm">Update Status</button>
        <button id="btn-gen-invoice" class="btn-secondary text-sm">Generate Invoice</button>
      </div>` : ''}
    </div>`;
}

function wireCaseTabs(row) {
  const content = document.getElementById('case-tab-content');
  const tabs = document.querySelectorAll('#case-tabs .tab-btn');

  async function loadTab(tabId) {
    if (!content) return;
    content.innerHTML = '<div class="flex justify-center py-10"><div class="animate-spin h-5 w-5 border-2 border-gold border-t-transparent rounded-full"></div></div>';
    if (tabId === 'documents')      await renderDocuments(content, row.case_id);
    else if (tabId === 'time-&-billing') await renderTimeEntries(content, row.case_id);
    else if (tabId === 'notes')     content.innerHTML = buildNotesTab(row);
  }

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      loadTab(btn.dataset.tab);
    });
  });

  // Load first tab
  loadTab('documents');

  // Update status
  document.getElementById('btn-update-case-status')?.addEventListener('click', async () => {
    const status = document.getElementById('case-status-sel')?.value;
    try {
      await Cases.update({ case_id: row.case_id, status });
      toast(`Case ${row.case_id} → ${status}`, 'success');
      closeModal();
      window.dispatchEvent(new CustomEvent('cyrabell:case:updated', { detail: { case_id: row.case_id, status } }));
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('btn-gen-invoice')?.addEventListener('click', async () => {
    try {
      const inv = await (await import('./billing.js')).createInvoiceForCase(row.case_id, row.client_id);
      toast(`Invoice ${inv.invoice_id} — ${fmtCurrency(inv.total_amount)} — risk ${inv.predicted_overdue_risk}%`, 'info', 7000);
    } catch (err) { toast(err.message, 'error'); }
  });
}

function buildNotesTab(row) {
  return `<div class="space-y-3">
    <textarea rows="6" class="w-full border border-ink/20 bg-white/60 rounded px-3 py-2
      font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
      placeholder="Add notes for this case…">${escHtml(row.notes||'')}</textarea>
    <button class="btn-primary text-sm">Save Notes</button>
  </div>`;
}

// ─── WIRING ───────────────────────────────────────────────────────────────────

function wireCasesView(el, cases, clientMap) {
  let filtered = [...cases];

  const redraw = () => {
    const tbl = el.querySelector('#cases-table');
    if (!tbl) return;
    const cols = [
      { key:'case_id',   label:'Case ID', render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'client_id', label:'Client',  render: v => escHtml(clientMap[v]?.full_name || v) },
      { key:'case_type', label:'Type',    render: v => escHtml(CASE_TYPES.find(t=>t[0]===v)?.[1]||v) },
      { key:'status',    label:'Status',  render: v => badge(v) },
      { key:'filing_date',label:'Filed',  render: v => escHtml(fmtDate(v)) },
      { key:'predicted_duration_months', label:'Est.', render: v => v ? `<span class="font-mono text-xs">${v}mo</span>` : '—' },
    ];
    tbl.innerHTML = filtered.length
      ? dataTable(cols, filtered, { rowAction: row => openCaseDetail(row, clientMap) })
      : emptyState('No matching cases');
  };

  const loadClients = async () => {
    try { return await Clients.list({}); } catch(_) { return []; }
  };

  el.querySelector('#btn-new-case')?.addEventListener('click', async () => {
    const cls = await loadClients();
    openCaseModal(cls);
  });
  el.querySelector('#btn-new-case-empty')?.addEventListener('click', async () => {
    const cls = await loadClients();
    openCaseModal(cls);
  });

  // Search
  const search = el.querySelector('#case-search');
  if (search) {
    search.addEventListener('input', debounce(() => {
      const q = search.value.toLowerCase();
      filtered = cases.filter(c =>
        String(c.case_id).toLowerCase().includes(q) ||
        String(c.case_type).toLowerCase().includes(q) ||
        String(c.opposing_party).toLowerCase().includes(q) ||
        String(clientMap[c.client_id]?.full_name||'').toLowerCase().includes(q)
      );
      redraw();
    }, 250));
  }

  // Filter chips
  el.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const f = chip.dataset.filter;
      filtered = f === 'all' ? cases : cases.filter(c => c.status === f);
      redraw();
    });
  });

  // Export CSV
  el.querySelector('#btn-export-cases')?.addEventListener('click', () => {
    const { exportCsv } = import('../shared/utils.js').then(({ exportCsv }) => {
      exportCsv(filtered.map(c => ({...c, client_name: clientMap[c.client_id]?.full_name||''})), 'cases.csv');
    });
  });

  // Re-render on case updates
  window.addEventListener('cyrabell:case:created', () => renderCases(el.closest('[id]') || el));
  window.addEventListener('cyrabell:case:updated', () => renderCases(el.closest('[id]') || el));
}

// Exposed for inline onclick
window.aiFeedbackThumb = async (type, val) => {
  try {
    await AI.feedback({ prediction_id: type + '-' + Date.now(), feedback: 'user_reviewed', corrected_value: val });
    toast('Thanks for the feedback — model will improve', 'success');
  } catch (_) {}
};
