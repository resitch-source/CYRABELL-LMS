/**
 * @module modules/documents
 * @description Document management: list, upload registration, AI tagging display.
 * @dependencies core/api, shared/ui
 * @events PUBLISHES: document:registered
 * @trace-id DOC-MOD-01
 */

import { Documents } from '../core/api.js';
import { toast, dataTable, emptyState, openModal, closeModal,
         fieldGroup, textInput, formData, escHtml, fmtDate } from '../shared/ui.js';
import { currentUser } from '../core/auth.js';

export async function renderDocuments(el, caseId) {
  el.innerHTML = '<div class="animate-pulse font-mono text-xs text-ink-muted py-6 text-center">Loading documents…</div>';
  try {
    const docs = await Documents.list({ case_id: caseId });
    const cols = [
      { key:'doc_id',     label:'ID',   render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'name',       label:'Name', render: v => `<span class="font-body text-sm">${escHtml(v)}</span>` },
      { key:'uploaded_by',label:'By',   render: v => `<span class="text-xs text-ink-muted">${escHtml(v)}</span>` },
      { key:'timestamp',  label:'Date', render: v => escHtml(fmtDate(v)) },
      { key:'ai_tags',    label:'AI Tags', render: v => {
        let tags = v; try { tags = JSON.parse(v||'[]'); } catch(_) { tags=[v]; }
        return (Array.isArray(tags)?tags:[tags]).map(t =>
          `<span class="inline-block px-1.5 py-0.5 bg-gold/20 text-ink rounded text-xs font-mono mr-1">${escHtml(t)}</span>`
        ).join('');
      }},
      { key:'drive_url',  label:'Link', render: v => v
          ? `<a href="${escHtml(v)}" target="_blank" class="text-gold text-xs font-mono hover:underline">Open →</a>` : '—' },
    ];
    el.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <p class="font-mono text-xs text-ink-muted">${docs.length} document(s)</p>
          <button id="btn-reg-doc" class="btn-secondary text-xs">+ Register Document</button>
        </div>
        ${docs.length ? dataTable(cols, docs) : emptyState('No documents', '📄')}
      </div>`;
    el.querySelector('#btn-reg-doc')?.addEventListener('click', () => openRegisterDocModal(caseId, el));
  } catch (err) {
    el.innerHTML = `<p class="text-red-700 text-sm font-body">${escHtml(err.message)}</p>`;
  }
}

function openRegisterDocModal(caseId, parentEl) {
  openModal('Register Document', `
    <form id="doc-form" class="space-y-1">
      ${fieldGroup('Document Name', textInput('name','','placeholder="Motion to Dismiss.pdf"'))}
      ${fieldGroup('Google Drive URL', textInput('drive_url','','placeholder="https://drive.google.com/…"'))}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="closeModal()" class="btn-secondary">Cancel</button>
        <button type="submit" class="btn-primary">Register</button>
      </div>
    </form>`);
  document.getElementById('doc-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const data = formData(e.target);
    data.case_id = caseId;
    try {
      const doc = await Documents.register(data);
      closeModal();
      toast(`Document registered — AI tags: ${doc.ai_tags}`, 'success');
      renderDocuments(parentEl, caseId);
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @module modules/billing
 * @description Time entry logging, invoice generation, overdue risk display.
 * @dependencies core/api, shared/ui, shared/utils
 * @trace-id BILL-MOD-01
 */

import { Time, Invoices, AI as AIApi } from '../core/api.js';
import { fmtCurrency, riskBadge } from '../shared/ui.js';

export async function renderTimeEntries(el, caseId) {
  el.innerHTML = '<div class="animate-pulse font-mono text-xs text-ink-muted py-6 text-center">Loading time entries…</div>';
  try {
    const entries = await Time.list({ case_id: caseId });
    const total = entries.reduce((s,e) => s + parseFloat(e.amount||0), 0);
    const cols = [
      { key:'entry_id',   label:'ID',   render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'lawyer_email',label:'Lawyer',render: v => `<span class="text-xs font-body">${escHtml(v)}</span>` },
      { key:'hours',      label:'Hrs',  render: v => `<span class="font-mono">${escHtml(String(v))}</span>` },
      { key:'rate',       label:'Rate', render: v => escHtml(fmtCurrency(v)) },
      { key:'amount',     label:'Amount',render: v => `<strong class="font-mono">${escHtml(fmtCurrency(v))}</strong>` },
      { key:'description',label:'Description', render: v => `<span class="text-sm font-body">${escHtml(v)}</span>` },
    ];
    el.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <p class="font-body text-sm text-ink">Total: <strong class="font-mono">${escHtml(fmtCurrency(total))}</strong></p>
          <button id="btn-add-time" class="btn-secondary text-xs">+ Log Time</button>
        </div>
        ${entries.length ? dataTable(cols, entries) : emptyState('No time entries', '⏱')}
      </div>`;
    el.querySelector('#btn-add-time')?.addEventListener('click', () => openTimeModal(caseId, el));
  } catch (err) {
    el.innerHTML = `<p class="text-red-700 text-sm font-body">${escHtml(err.message)}</p>`;
  }
}

export async function createInvoiceForCase(caseId, clientId) {
  return Invoices.create({ case_id: caseId, client_id: clientId });
}

function openTimeModal(caseId, parentEl) {
  openModal('Log Time Entry', `
    <form id="time-form" class="space-y-1">
      ${fieldGroup('Hours (0.1 increments)', textInput('hours','1.0','type="number" step="0.1" min="0.1"'))}
      ${fieldGroup('Rate (₱/hr)', textInput('rate','3500','type="number" min="0"'))}
      ${fieldGroup('Description', textInput('description','','placeholder="Research and drafting…"'))}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="closeModal()" class="btn-secondary">Cancel</button>
        <button type="submit" class="btn-primary">Log Entry</button>
      </div>
    </form>`);
  document.getElementById('time-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const data = formData(e.target);
    data.case_id = caseId;
    try {
      await Time.add(data);
      closeModal();
      toast('Time entry logged', 'success');
      renderTimeEntries(parentEl, caseId);
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @module modules/analytics
 * @description Dashboard analytics: KPI cards, case distribution,
 *              AI model status, booking calendar heatmap.
 * @dependencies core/api, core/auth, shared/ui, shared/utils
 * @trace-id ANALYTICS-MOD-01
 */

import { Analytics, AI as AI2 } from '../core/api.js';
import { isAdmin, isLawyer } from '../core/auth.js';

export async function renderAnalytics(el) {
  el.innerHTML = `<div class="flex items-center justify-center py-20">
    <div class="animate-spin h-8 w-8 border-2 border-gold border-t-transparent rounded-full"></div>
  </div>`;
  try {
    const data = await Analytics.dashboard({});
    el.innerHTML = buildAnalyticsDashboard(data);
    wireAnalytics(el, data);
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}

function buildAnalyticsDashboard(d) {
  const kpis = [
    { label:'Total Clients',  value: d.clients_total,       icon:'👤', color:'text-blue-700' },
    { label:'Open Cases',     value: d.cases_open,          icon:'⚖',  color:'text-amber-700' },
    { label:'Closed Cases',   value: d.cases_closed,        icon:'✓',  color:'text-emerald-700' },
    { label:'Pending Bookings',value: d.bookings_pending,   icon:'📅', color:'text-violet-700' },
    { label:'Unpaid Invoices',value: d.invoices_unpaid,     icon:'₱',  color:'text-red-700' },
    { label:'Overdue Invoices',value: d.invoices_overdue,   icon:'⚠',  color:'text-red-900' },
  ];
  const byType = d.cases_by_type || {};
  const byStatus = d.bookings_by_status || {};
  const total = Object.values(byType).reduce((s,v)=>s+v,0)||1;

  return `
    <div class="space-y-8">
      <div class="flex justify-between items-center flex-wrap gap-4">
        <h1 class="font-display text-3xl text-ink">Dashboard</h1>
        ${isAdmin() ? `<button id="btn-retrain" class="btn-secondary text-xs">↺ Retrain AI Models</button>` : ''}
      </div>

      <!-- KPI Grid -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        ${kpis.map(k => `
          <div class="bg-white/50 border border-ink/10 rounded-lg p-4 hover:shadow-md transition">
            <div class="text-2xl mb-1">${k.icon}</div>
            <div class="font-display text-3xl ${k.color}">${k.value ?? 0}</div>
            <div class="font-mono text-xs text-ink-muted mt-1">${escHtml(k.label)}</div>
          </div>`).join('')}
      </div>

      <!-- Charts row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Cases by type -->
        <div class="bg-white/50 border border-ink/10 rounded-lg p-5">
          <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-4">Cases by Type</p>
          <div class="space-y-2">
            ${Object.entries(byType).map(([type, count]) => `
              <div>
                <div class="flex justify-between text-xs font-body text-ink mb-0.5">
                  <span>${escHtml(type)}</span><span class="font-mono">${count}</span>
                </div>
                <div class="h-2 bg-ink/5 rounded-full overflow-hidden">
                  <div class="h-full bg-gold rounded-full transition-all" style="width:${Math.round(count/total*100)}%"></div>
                </div>
              </div>`).join('') || '<p class="text-xs text-ink-muted font-body">No data</p>'}
          </div>
        </div>

        <!-- Bookings by status -->
        <div class="bg-white/50 border border-ink/10 rounded-lg p-5">
          <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-4">Bookings by Status</p>
          <div class="space-y-2">
            ${Object.entries(byStatus).map(([status, count]) => `
              <div class="flex items-center gap-3">
                <span class="font-body text-sm text-ink w-24 shrink-0">${badge(status)}</span>
                <div class="flex-1 h-2 bg-ink/5 rounded-full overflow-hidden">
                  <div class="h-full bg-oxblood/60 rounded-full" style="width:${Math.round(count/(d.bookings_pending+1)*100)}%"></div>
                </div>
                <span class="font-mono text-xs text-ink-muted w-6 text-right">${count}</span>
              </div>`).join('') || '<p class="text-xs text-ink-muted font-body">No data</p>'}
          </div>
        </div>
      </div>

      <!-- AI model status (admin) -->
      ${isAdmin() ? `
      <div class="bg-white/50 border border-ink/10 rounded-lg p-5">
        <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-4">AI Model Status</p>
        <div id="ai-model-status">
          <div class="animate-pulse text-xs text-ink-muted font-mono">Loading model status…</div>
        </div>
      </div>` : ''}
    </div>`;
}

function wireAnalytics(el, data) {
  el.querySelector('#btn-retrain')?.addEventListener('click', async () => {
    const btn = el.querySelector('#btn-retrain');
    btn.disabled = true; btn.textContent = '↺ Training…';
    try {
      const res = await AI2.retrain();
      toast(`Models retrained — Duration accuracy: ${Math.round((res.duration?.accuracy||0)*100)}%`, 'success', 6000);
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '↺ Retrain AI Models'; }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @module modules/admin
 * @description Admin power-user tools: client management, global search,
 *              bulk operations, keyboard shortcuts.
 * @dependencies core/api, core/auth, shared/ui, shared/utils
 * @trace-id ADMIN-MOD-01
 */

import { Clients as ClientsApi } from '../core/api.js';
import { currentUser as curUser, isAdmin as checkAdmin } from '../core/auth.js';
import { debounce as deb, exportCsv, onKey } from '../shared/utils.js';

export async function renderAdmin(el) {
  if (!checkAdmin()) { el.innerHTML = emptyState('Admin access required', '🔒'); return; }
  el.innerHTML = buildAdminView();
  wireAdmin(el);
}

function buildAdminView() {
  return `
    <div class="space-y-6">
      <div class="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 class="font-display text-3xl text-ink">Administration</h1>
          <p class="font-body text-sm text-ink-muted">Client registry · System health · Bulk operations</p>
        </div>
        <button id="btn-new-client" class="btn-primary text-sm">+ New Client</button>
      </div>

      <!-- Global search -->
      <div class="relative">
        <input id="global-search" type="text" placeholder="Global search (Ctrl+K)…"
          class="w-full border border-ink/20 bg-white/70 rounded-lg px-4 py-3 pl-10
                 font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
        <span class="absolute left-3 top-3.5 text-ink-muted">🔍</span>
        <div id="search-results" class="absolute left-0 right-0 top-full mt-1 bg-parchment border border-ink/20 rounded-lg shadow-xl z-20 hidden max-h-72 overflow-y-auto"></div>
      </div>

      <!-- Clients table -->
      <div>
        <div class="flex justify-between items-center mb-3">
          <p class="font-mono text-xs text-ink-muted uppercase tracking-widest">Clients</p>
          <button id="btn-export-clients" class="btn-secondary text-xs">↓ Export CSV</button>
        </div>
        <div id="admin-clients-table">
          <div class="animate-pulse text-xs text-ink-muted font-mono py-8 text-center">Loading clients…</div>
        </div>
      </div>

      <!-- Keyboard shortcuts -->
      <div class="bg-ink/5 rounded-lg p-4">
        <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-3">Keyboard Shortcuts</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-body text-ink-muted">
          ${[['Ctrl+K','Global Search'],['Ctrl+N','New Booking'],['Ctrl+Shift+C','New Case'],['Ctrl+D','Dashboard'],
             ['Ctrl+B','Bookings'],['Ctrl+L','Clients'],['Ctrl+A','Analytics'],['Escape','Close Modal']
          ].map(([k,l]) => `<div class="flex items-center gap-1.5">
            <kbd class="font-mono text-xs bg-ink/10 rounded px-1.5 py-0.5 border border-ink/20 whitespace-nowrap">${escHtml(k)}</kbd>
            <span>${escHtml(l)}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>`;
}

async function wireAdmin(el) {
  // Load clients
  try {
    const clients = await ClientsApi.list({});
    const tbl = el.querySelector('#admin-clients-table');
    const cols = [
      { key:'client_id', label:'ID',     render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'full_name', label:'Name',   render: v => `<span class="font-body">${escHtml(v)}</span>` },
      { key:'email',     label:'Email' },
      { key:'phone',     label:'Phone' },
      { key:'risk_level',label:'Risk',   render: v => riskBadge(v === 'high' ? 75 : v === 'medium' ? 45 : 15) },
      { key:'assigned_lawyer_email', label:'Lawyer', render: v => `<span class="text-xs font-body">${escHtml(v||'—')}</span>` },
    ];
    if (tbl) tbl.innerHTML = dataTable(cols, clients, { rowAction: row => openClientDetail(row) });

    el.querySelector('#btn-export-clients')?.addEventListener('click', () => exportCsv(clients, 'clients.csv'));
    el.querySelector('#btn-new-client')?.addEventListener('click', () => openNewClientModal());
  } catch (_) {}

  // Global search
  const gs = el.querySelector('#global-search');
  const sr = el.querySelector('#search-results');
  if (gs && sr) {
    const doSearch = deb(async () => {
      const q = gs.value.trim().toLowerCase();
      if (!q) { sr.classList.add('hidden'); return; }
      sr.classList.remove('hidden');
      sr.innerHTML = '<p class="p-3 text-xs text-ink-muted font-mono animate-pulse">Searching…</p>';
      try {
        const [clients] = await Promise.all([ClientsApi.list({})]);
        const hits = clients.filter(c =>
          String(c.full_name).toLowerCase().includes(q) ||
          String(c.email).toLowerCase().includes(q) ||
          String(c.client_id).toLowerCase().includes(q)
        ).slice(0, 10);
        sr.innerHTML = hits.length
          ? hits.map(c => `<div class="px-4 py-2 hover:bg-gold/10 cursor-pointer transition border-b border-ink/5 last:border-0" onclick="closeSearchResults()">
              <p class="font-body text-sm text-ink">${escHtml(c.full_name)}</p>
              <p class="font-mono text-xs text-ink-muted">${escHtml(c.client_id)} · ${escHtml(c.email)}</p>
            </div>`).join('')
          : '<p class="p-3 text-xs text-ink-muted font-body">No results</p>';
      } catch (_) { sr.classList.add('hidden'); }
    }, 250);
    gs.addEventListener('input', doSearch);
    document.addEventListener('click', e => { if (!gs.contains(e.target)) sr.classList.add('hidden'); });
    window.closeSearchResults = () => { sr.innerHTML=''; sr.classList.add('hidden'); gs.value=''; };
  }
}

function openClientDetail(row) {
  openModal(`Client — ${escHtml(row.full_name)}`, `
    <div class="grid grid-cols-2 gap-4 text-sm font-body">
      ${[['ID',row.client_id],['Email',row.email],['Phone',row.phone],
         ['Risk',row.risk_level],['Lawyer',row.assigned_lawyer_email||'—'],
         ['Created',fmtDate(row.created_at)]
      ].map(([l,v]) => `<div>
        <p class="font-mono text-xs text-ink-muted">${escHtml(l)}</p>
        <p class="text-ink mt-0.5">${escHtml(String(v||'—'))}</p>
      </div>`).join('')}
      <div class="col-span-2">
        <p class="font-mono text-xs text-ink-muted">Notification Preferences</p>
        <p class="text-ink mt-0.5 font-mono text-xs">${escHtml(row.pref_notification_channels||'[]')}</p>
      </div>
    </div>`, { wide: false });
}

function openNewClientModal() {
  openModal('New Client', `
    <form id="client-form" class="space-y-1">
      ${fieldGroup('Full Name', textInput('full_name'))}
      ${fieldGroup('Email',     textInput('email','','type="email"'))}
      ${fieldGroup('Phone',     textInput('phone','','+63…'))}
      ${fieldGroup('Risk Level', selectInput('risk_level',[['low','Low'],['medium','Medium'],['high','High']]))}
      ${fieldGroup('Assigned Lawyer', selectInput('assigned_lawyer_email',[
        ['lawyer1@lexfirm.test','Atty. Reyes'],['lawyer2@lexfirm.test','Atty. Santos']
      ]))}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="closeModal()" class="btn-secondary">Cancel</button>
        <button type="submit" class="btn-primary">Create Client</button>
      </div>
    </form>`);
  document.getElementById('client-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const data = formData(e.target);
      await ClientsApi.create(data);
      closeModal();
      toast('Client created', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @module modules/notifications
 * @description Notification log viewer + manual send panel.
 * @dependencies core/api, shared/ui
 * @trace-id NOTIFY-MOD-01
 */

import { Notify } from '../core/api.js';

export async function renderNotifications(el) {
  el.innerHTML = '<div class="animate-pulse text-xs text-ink-muted font-mono py-8 text-center">Loading…</div>';
  try {
    const logs = await Notify.log({});
    const cols = [
      { key:'log_id',       label:'ID',      render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'recipient_id', label:'To',       render: v => `<span class="text-sm font-body">${escHtml(v)}</span>` },
      { key:'channel',      label:'Channel',  render: v => `<span class="font-mono text-xs uppercase">${escHtml(v)}</span>` },
      { key:'template_used',label:'Template' },
      { key:'status',       label:'Status',   render: v => badge(v) },
      { key:'timestamp',    label:'Sent',     render: v => escHtml(fmtDate(v)) },
      { key:'trace_id',     label:'Trace',    render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(v)}</span>` },
    ];
    el.innerHTML = `
      <div class="space-y-6">
        <h1 class="font-display text-3xl text-ink">Notification Log</h1>
        ${logs.length ? dataTable(cols, logs) : emptyState('No notifications sent yet', '📬')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @module modules/action-log
 * @description Action log viewer with filtering (admin/lawyer only).
 * @dependencies core/api, core/auth, shared/ui
 * @trace-id LOG-MOD-01
 */

import { ActionLog } from '../core/api.js';
import { isLawyer as checkLawyer } from '../core/auth.js';

export async function renderActionLog(el) {
  if (!checkLawyer()) { el.innerHTML = emptyState('Access restricted', '🔒'); return; }
  el.innerHTML = '<div class="animate-pulse text-xs text-ink-muted font-mono py-8 text-center">Loading audit trail…</div>';
  try {
    const logs = await ActionLog.list({});
    const cols = [
      { key:'timestamp',   label:'Time',    render: v => `<span class="font-mono text-xs">${escHtml(String(v).slice(0,19).replace('T',' '))}</span>` },
      { key:'user_email',  label:'User',    render: v => `<span class="text-xs font-body">${escHtml(v)}</span>` },
      { key:'user_role',   label:'Role',    render: v => badge(v) },
      { key:'action_type', label:'Action',  render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'entity_type', label:'Entity' },
      { key:'entity_id',   label:'ID',      render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(v)}</span>` },
      { key:'success',     label:'OK',      render: v => v===true||v==='TRUE'||v==='true'
          ? '<span class="text-emerald-600 font-mono text-sm">✓</span>'
          : '<span class="text-red-600 font-mono text-sm">✕</span>' },
      { key:'trace_id',    label:'Trace',   render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(v)}</span>` },
      { key:'duration_ms', label:'ms',      render: v => `<span class="font-mono text-xs">${escHtml(String(v))}</span>` },
    ];
    el.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h1 class="font-display text-3xl text-ink">Audit Trail</h1>
          <p class="font-body text-sm text-ink-muted">${logs.length} entries (last 200)</p>
        </div>
        ${logs.length ? dataTable(cols, logs) : emptyState('No activity logged yet', '📋')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}
