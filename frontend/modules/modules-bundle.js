/**
 * @module modules/modules-bundle
 * @description Consolidated bundle: documents, billing, analytics, admin,
 *              notifications, action-log modules.
 *              All imports are at the top (ES module spec requirement).
 * @dependencies core/api, core/auth, shared/ui, shared/utils
 */

// ── All imports consolidated at top ─────────────────────────────────────────
import { Documents, Time, Invoices, Analytics, AI as AIApi,
         Clients as ClientsApi, Notify, ActionLog } from '../core/api.js';
import { currentUser, isAdmin, isLawyer } from '../core/auth.js';
import { toast, openModal, closeModal, dataTable, badge, showSpinner,
         emptyState, fieldGroup, textInput, selectInput, formData,
         fmtDate, fmtCurrency, riskBadge, confidenceBar, escHtml } from '../shared/ui.js';
import { debounce, exportCsv, onKey, today } from '../shared/utils.js';

// ════════════════════════════════════════════════════════════════════════════
// MODULE: documents
// ════════════════════════════════════════════════════════════════════════════
/**
 * @description Render document list for a case with AI tags + upload registration.
 * @workflow documents
 * @trace-id DOC-VIEW-01
 * @param {HTMLElement} el
 * @param {string} caseId
 */
export async function renderDocuments(el, caseId) {
  el.innerHTML = '<div class="animate-pulse font-mono text-xs text-ink-muted py-6 text-center">Loading documents…</div>';
  try {
    const docs = await Documents.list({ case_id: caseId });
    const cols = [
      { key:'doc_id',      label:'ID',       render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'name',        label:'Name',     render: v => `<span class="font-body text-sm">${escHtml(v)}</span>` },
      { key:'uploaded_by', label:'By',       render: v => `<span class="text-xs text-ink-muted">${escHtml(v)}</span>` },
      { key:'timestamp',   label:'Date',     render: v => escHtml(fmtDate(v)) },
      { key:'ai_tags',     label:'AI Tags',  render: v => {
        let tags; try { tags = JSON.parse(v || '[]'); } catch(_) { tags = [v]; }
        return (Array.isArray(tags) ? tags : [tags]).map(t =>
          `<span class="inline-block px-1.5 py-0.5 bg-gold/20 text-ink rounded text-xs font-mono mr-1">${escHtml(String(t))}</span>`
        ).join('');
      }},
      { key:'drive_url',   label:'Link',     render: v => v
          ? `<a href="${escHtml(v)}" target="_blank" class="text-gold text-xs font-mono hover:underline">Open →</a>` : '—' },
    ];
    el.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <p class="font-mono text-xs text-ink-muted">${docs.length} document(s)</p>
          <button id="btn-reg-doc" class="btn-secondary text-xs">+ Register Document</button>
        </div>
        ${docs.length ? dataTable(cols, docs) : emptyState('No documents yet', '📄')}
      </div>`;
    el.querySelector('#btn-reg-doc')?.addEventListener('click', () => _openRegisterDocModal(caseId, el));
  } catch (err) {
    el.innerHTML = `<p class="text-red-700 text-sm font-body p-4">${escHtml(err.message)}</p>`;
  }
}

function _openRegisterDocModal(caseId, parentEl) {
  openModal('Register Document', `
    <form id="doc-form" class="space-y-1">
      ${fieldGroup('Document Name', textInput('name', '', 'placeholder="Motion to Dismiss.pdf"'))}
      ${fieldGroup('Google Drive URL', textInput('drive_url', '', 'placeholder="https://drive.google.com/…"'))}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="window.__cbCloseModal()" class="btn-secondary">Cancel</button>
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

// ════════════════════════════════════════════════════════════════════════════
// MODULE: billing
// ════════════════════════════════════════════════════════════════════════════
/**
 * @description Render time entries for a case with running total + log-time form.
 * @workflow billing
 * @trace-id BILL-VIEW-01
 * @param {HTMLElement} el
 * @param {string} caseId
 */
export async function renderTimeEntries(el, caseId) {
  el.innerHTML = '<div class="animate-pulse font-mono text-xs text-ink-muted py-6 text-center">Loading time entries…</div>';
  try {
    const entries = await Time.list({ case_id: caseId });
    const total = entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const cols = [
      { key:'entry_id',    label:'ID',         render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'lawyer_email',label:'Lawyer',      render: v => `<span class="text-xs font-body">${escHtml(v)}</span>` },
      { key:'hours',       label:'Hrs',         render: v => `<span class="font-mono">${escHtml(String(v))}</span>` },
      { key:'rate',        label:'Rate/hr',     render: v => escHtml(fmtCurrency(v)) },
      { key:'amount',      label:'Amount',      render: v => `<strong class="font-mono">${escHtml(fmtCurrency(v))}</strong>` },
      { key:'description', label:'Description', render: v => `<span class="text-sm font-body">${escHtml(v)}</span>` },
    ];
    el.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <p class="font-body text-sm text-ink">
            Total: <strong class="font-mono">${escHtml(fmtCurrency(total))}</strong>
            <span class="text-xs text-ink-muted ml-2">(${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})</span>
          </p>
          <button id="btn-add-time" class="btn-secondary text-xs">+ Log Time</button>
        </div>
        ${entries.length ? dataTable(cols, entries) : emptyState('No time entries yet', '⏱')}
      </div>`;
    el.querySelector('#btn-add-time')?.addEventListener('click', () => _openTimeModal(caseId, el));
  } catch (err) {
    el.innerHTML = `<p class="text-red-700 text-sm font-body p-4">${escHtml(err.message)}</p>`;
  }
}

/**
 * @description Create an invoice from all unbilled time entries for a case.
 * @workflow billing
 * @trace-id BILL-INV-01
 */
export async function createInvoiceForCase(caseId, clientId) {
  return Invoices.create({ case_id: caseId, client_id: clientId });
}

function _openTimeModal(caseId, parentEl) {
  openModal('Log Time Entry', `
    <form id="time-form" class="space-y-1">
      ${fieldGroup('Hours (0.1 increments)', textInput('hours', '1.0', 'type="number" step="0.1" min="0.1"'))}
      ${fieldGroup('Rate (₱/hr)', textInput('rate', '3500', 'type="number" min="0"'))}
      ${fieldGroup('Description', textInput('description', '', 'placeholder="Research and drafting…"'))}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="window.__cbCloseModal()" class="btn-secondary">Cancel</button>
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

// ════════════════════════════════════════════════════════════════════════════
// MODULE: analytics
// ════════════════════════════════════════════════════════════════════════════
/**
 * @description Render analytics dashboard: KPI cards, case distribution,
 *              booking breakdown, AI retrain button.
 * @workflow analytics
 * @trace-id ANALYTICS-VIEW-01
 * @param {HTMLElement} el
 */
export async function renderAnalytics(el) {
  el.innerHTML = `<div class="flex items-center justify-center py-20">
    <div class="animate-spin h-8 w-8 border-2 border-gold border-t-transparent rounded-full"></div>
  </div>`;
  try {
    const data = await Analytics.dashboard({});
    el.innerHTML = _buildAnalyticsDashboard(data);
    _wireAnalytics(el);
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}

function _buildAnalyticsDashboard(d) {
  const kpis = [
    { label:'Total Clients',   value: d.clients_total    ?? 0, icon:'👤', color:'text-blue-700' },
    { label:'Open Cases',      value: d.cases_open       ?? 0, icon:'⚖',  color:'text-amber-700' },
    { label:'Closed Cases',    value: d.cases_closed     ?? 0, icon:'✓',  color:'text-emerald-700' },
    { label:'Pending Bookings',value: d.bookings_pending ?? 0, icon:'📅', color:'text-violet-700' },
    { label:'Unpaid Invoices', value: d.invoices_unpaid  ?? 0, icon:'₱',  color:'text-red-700' },
    { label:'Overdue Invoices',value: d.invoices_overdue ?? 0, icon:'⚠',  color:'text-red-900' },
  ];
  const byType   = d.cases_by_type      || {};
  const byStatus = d.bookings_by_status || {};
  const total    = Object.values(byType).reduce((s, v) => s + v, 0) || 1;

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
            <div class="font-display text-3xl ${k.color}">${k.value}</div>
            <div class="font-mono text-xs text-ink-muted mt-1">${escHtml(k.label)}</div>
          </div>`).join('')}
      </div>

      <!-- Charts row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Cases by type -->
        <div class="bg-white/50 border border-ink/10 rounded-lg p-5">
          <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-4">Cases by Type</p>
          <div class="space-y-2">
            ${Object.keys(byType).length ? Object.entries(byType).map(([type, count]) => `
              <div>
                <div class="flex justify-between text-xs font-body text-ink mb-0.5">
                  <span>${escHtml(type)}</span><span class="font-mono">${count}</span>
                </div>
                <div class="h-2 bg-ink/5 rounded-full overflow-hidden">
                  <div class="h-full bg-gold rounded-full" style="width:${Math.round(count/total*100)}%"></div>
                </div>
              </div>`).join('')
            : '<p class="text-xs text-ink-muted font-body">No case data yet</p>'}
          </div>
        </div>

        <!-- Bookings by status -->
        <div class="bg-white/50 border border-ink/10 rounded-lg p-5">
          <p class="font-mono text-xs text-ink-muted uppercase tracking-widest mb-4">Bookings by Status</p>
          <div class="space-y-2">
            ${Object.keys(byStatus).length ? Object.entries(byStatus).map(([status, count]) => `
              <div class="flex items-center gap-3">
                <div class="w-28 shrink-0">${badge(status)}</div>
                <div class="flex-1 h-2 bg-ink/5 rounded-full overflow-hidden">
                  <div class="h-full bg-oxblood/60 rounded-full" style="width:${Math.min(100, count * 20)}%"></div>
                </div>
                <span class="font-mono text-xs text-ink-muted w-6 text-right">${count}</span>
              </div>`).join('')
            : '<p class="text-xs text-ink-muted font-body">No booking data yet</p>'}
          </div>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a data-route="#bookings" class="bg-ink text-parchment rounded-lg p-5 cursor-pointer hover:bg-ink/90 transition block">
          <p class="font-display text-lg mb-1">Bookings</p>
          <p class="font-body text-xs text-parchment/60">Manage consultations</p>
        </a>
        <a data-route="#cases" class="bg-oxblood/90 text-parchment rounded-lg p-5 cursor-pointer hover:bg-oxblood transition block">
          <p class="font-display text-lg mb-1">Cases</p>
          <p class="font-body text-xs text-parchment/60">Active legal matters</p>
        </a>
        ${isAdmin() ? `<a data-route="#admin" class="bg-gold/80 text-ink rounded-lg p-5 cursor-pointer hover:bg-gold transition block">
          <p class="font-display text-lg mb-1">Admin</p>
          <p class="font-body text-xs text-ink/60">Clients &amp; system</p>
        </a>` : '<div></div>'}
      </div>
    </div>`;
}

function _wireAnalytics(el) {
  el.querySelector('#btn-retrain')?.addEventListener('click', async () => {
    const btn = el.querySelector('#btn-retrain');
    btn.disabled = true; btn.textContent = '↺ Training…';
    try {
      const res = await AIApi.retrain();
      const acc = res?.duration?.accuracy;
      toast(`Models retrained${acc != null ? ` — Duration accuracy: ${Math.round(acc * 100)}%` : ''}`, 'success', 6000);
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '↺ Retrain AI Models'; }
  });

  // Wire quick-action cards to router
  el.querySelectorAll('[data-route]').forEach(card => {
    card.addEventListener('click', () => {
      window.location.hash = card.dataset.route;
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// MODULE: admin
// ════════════════════════════════════════════════════════════════════════════
/**
 * @description Admin panel: client registry, global search, bulk CSV export,
 *              keyboard shortcut reference.
 * @workflow admin
 * @trace-id ADMIN-VIEW-01
 * @param {HTMLElement} el
 */
export async function renderAdmin(el) {
  if (!isAdmin()) {
    el.innerHTML = emptyState('Admin access required', '🔒');
    return;
  }
  el.innerHTML = _buildAdminView();
  await _wireAdmin(el);
}

function _buildAdminView() {
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
        <input id="global-search" type="text" placeholder="Global search — clients, cases, IDs… (Ctrl+K)"
          class="w-full border border-ink/20 bg-white/70 rounded-lg px-4 py-3 pl-10
                 font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
        <span class="absolute left-3 top-3.5 text-ink-muted text-sm">🔍</span>
        <div id="search-results"
          class="absolute left-0 right-0 top-full mt-1 bg-parchment border border-ink/20
                 rounded-lg shadow-xl z-20 hidden max-h-72 overflow-y-auto"></div>
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
          ${[['Ctrl+K','Global Search'],['Ctrl+N','New Booking'],['Ctrl+Shift+C','New Case'],
             ['Ctrl+D','Dashboard'],['Ctrl+B','Bookings'],['Ctrl+L','Admin / Clients'],
             ['Ctrl+A','Analytics'],['Escape','Close Modal']
          ].map(([k, l]) => `
            <div class="flex items-center gap-1.5">
              <kbd class="font-mono text-xs bg-ink/10 rounded px-1.5 py-0.5 border border-ink/20 whitespace-nowrap">${escHtml(k)}</kbd>
              <span>${escHtml(l)}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

async function _wireAdmin(el) {
  let allClients = [];
  try {
    allClients = await ClientsApi.list({});
    const tbl  = el.querySelector('#admin-clients-table');
    const cols = [
      { key:'client_id',  label:'ID',     render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'full_name',  label:'Name',   render: v => `<span class="font-body">${escHtml(v)}</span>` },
      { key:'email',      label:'Email',  render: v => `<span class="font-body text-sm">${escHtml(v)}</span>` },
      { key:'phone',      label:'Phone',  render: v => `<span class="font-body text-sm">${escHtml(v || '—')}</span>` },
      { key:'risk_level', label:'Risk',   render: v => riskBadge(v === 'high' ? 75 : v === 'medium' ? 45 : 15) },
      { key:'assigned_lawyer_email', label:'Lawyer',
        render: v => `<span class="text-xs font-body">${escHtml(v || '—')}</span>` },
    ];
    if (tbl) {
      tbl.innerHTML = allClients.length
        ? dataTable(cols, allClients, { rowAction: row => _openClientDetail(row) })
        : emptyState('No clients yet', '👤', `<button id="btn-new-client-empty" class="btn-primary text-sm mt-3">Add first client</button>`);
    }
    el.querySelector('#btn-export-clients')?.addEventListener('click', () => exportCsv(allClients, 'clients.csv'));
  } catch (err) {
    const tbl = el.querySelector('#admin-clients-table');
    if (tbl) tbl.innerHTML = `<p class="text-red-700 text-sm font-body p-4">${escHtml(err.message)}</p>`;
  }

  el.querySelector('#btn-new-client')?.addEventListener('click', _openNewClientModal);
  el.querySelector('#btn-new-client-empty')?.addEventListener('click', _openNewClientModal);

  // Global search with debounce
  const gs = el.querySelector('#global-search');
  const sr = el.querySelector('#search-results');
  if (gs && sr) {
    const doSearch = debounce(async () => {
      const q = gs.value.trim().toLowerCase();
      if (q.length < 2) { sr.classList.add('hidden'); return; }
      sr.classList.remove('hidden');
      sr.innerHTML = '<p class="p-3 text-xs text-ink-muted font-mono animate-pulse">Searching…</p>';
      const hits = allClients.filter(c =>
        String(c.full_name || '').toLowerCase().includes(q) ||
        String(c.email     || '').toLowerCase().includes(q) ||
        String(c.client_id || '').toLowerCase().includes(q) ||
        String(c.phone     || '').toLowerCase().includes(q)
      ).slice(0, 8);
      sr.innerHTML = hits.length
        ? hits.map(c => `
            <div class="px-4 py-2.5 hover:bg-gold/10 cursor-pointer transition border-b border-ink/5 last:border-0"
                 data-client-id="${escHtml(c.client_id)}">
              <p class="font-body text-sm text-ink">${escHtml(c.full_name)}</p>
              <p class="font-mono text-xs text-ink-muted">${escHtml(c.client_id)} · ${escHtml(c.email)}</p>
            </div>`).join('')
        : '<p class="p-3 text-xs text-ink-muted font-body">No results found</p>';
      sr.querySelectorAll('[data-client-id]').forEach(item => {
        item.addEventListener('click', () => {
          const client = allClients.find(c => c.client_id === item.dataset.clientId);
          if (client) _openClientDetail(client);
          sr.classList.add('hidden');
          gs.value = '';
        });
      });
    }, 250);
    gs.addEventListener('input', doSearch);
    document.addEventListener('click', e => { if (!gs.contains(e.target) && !sr.contains(e.target)) sr.classList.add('hidden'); });
  }
}

function _openClientDetail(row) {
  openModal(`Client — ${escHtml(row.full_name)}`, `
    <div class="grid grid-cols-2 gap-4 text-sm font-body">
      ${[['Client ID', row.client_id], ['Email', row.email], ['Phone', row.phone || '—'],
         ['Risk Level', row.risk_level], ['Assigned Lawyer', row.assigned_lawyer_email || '—'],
         ['Created', fmtDate(row.created_at)]
      ].map(([l, v]) => `
        <div>
          <p class="font-mono text-xs text-ink-muted">${escHtml(l)}</p>
          <p class="text-ink mt-0.5">${escHtml(String(v || '—'))}</p>
        </div>`).join('')}
      <div class="col-span-2">
        <p class="font-mono text-xs text-ink-muted">Preferred Notification Channels</p>
        <p class="text-ink mt-0.5 font-mono text-xs">${escHtml(row.pref_notification_channels || '["email"]')}</p>
      </div>
      <div class="col-span-2">
        <p class="font-mono text-xs text-ink-muted">AI Training Consent</p>
        <p class="mt-0.5">${row.consent_ai_training === true || row.consent_ai_training === 'true' || row.consent_ai_training === 'TRUE'
          ? '<span class="text-emerald-600 font-mono text-xs">✓ Consented</span>'
          : '<span class="text-red-600 font-mono text-xs">✕ Not consented</span>'}</p>
      </div>
    </div>`, { wide: false });
}

function _openNewClientModal() {
  openModal('New Client', `
    <form id="client-form" class="space-y-1">
      ${fieldGroup('Full Name',    textInput('full_name', '', 'placeholder="Maria dela Cruz"'))}
      ${fieldGroup('Email',        textInput('email',     '', 'type="email" placeholder="client@email.com"'))}
      ${fieldGroup('Phone',        textInput('phone',     '', 'placeholder="+63 917 123 4567"'))}
      ${fieldGroup('Risk Level',   selectInput('risk_level', [['low','Low'],['medium','Medium'],['high','High']]))}
      ${fieldGroup('Assigned Lawyer', selectInput('assigned_lawyer_email', [
        ['lawyer1@cyrabell.test', 'Atty. Benigno Reyes'],
        ['lawyer2@cyrabell.test', 'Atty. Carmelita Santos'],
      ]))}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="window.__cbCloseModal()" class="btn-secondary">Cancel</button>
        <button type="submit" class="btn-primary">Create Client</button>
      </div>
    </form>`);
  document.getElementById('client-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const data = formData(e.target);
      await ClientsApi.create(data);
      closeModal();
      toast('Client created successfully', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Create Client'; }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// MODULE: notifications
// ════════════════════════════════════════════════════════════════════════════
/**
 * @description Render notification log (last 100, most recent first).
 * @workflow notification
 * @trace-id NOTIFY-VIEW-01
 * @param {HTMLElement} el
 */
export async function renderNotifications(el) {
  el.innerHTML = '<div class="animate-pulse text-xs text-ink-muted font-mono py-8 text-center">Loading notification log…</div>';
  try {
    const logs = await Notify.log({});
    const cols = [
      { key:'log_id',        label:'ID',       render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'timestamp',     label:'Time',     render: v => `<span class="font-mono text-xs">${escHtml(String(v).slice(0,19).replace('T',' '))}</span>` },
      { key:'recipient_id',  label:'To',       render: v => `<span class="text-sm font-body">${escHtml(v)}</span>` },
      { key:'channel',       label:'Channel',  render: v => `<span class="font-mono text-xs uppercase font-medium">${escHtml(v)}</span>` },
      { key:'template_used', label:'Template', render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(v)}</span>` },
      { key:'status',        label:'Status',   render: v => badge(v) },
      { key:'trace_id',      label:'Trace',    render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(String(v).slice(0,16))}</span>` },
    ];
    el.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h1 class="font-display text-3xl text-ink">Notification Log</h1>
          <p class="font-body text-xs text-ink-muted">${logs.length} entries shown (most recent first)</p>
        </div>
        ${logs.length
          ? dataTable(cols, logs)
          : emptyState('No notifications sent yet', '📬', '<p class="text-xs text-ink-muted font-body mt-1">Notifications appear here after any booking or case action.</p>')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODULE: action-log
// ════════════════════════════════════════════════════════════════════════════
/**
 * @description Render full action audit log (admin/lawyer only, last 200 entries).
 * @workflow logging
 * @trace-id LOG-VIEW-01
 * @param {HTMLElement} el
 */
export async function renderActionLog(el) {
  if (!isLawyer()) {
    el.innerHTML = emptyState('Access restricted — lawyer or admin required', '🔒');
    return;
  }
  el.innerHTML = '<div class="animate-pulse text-xs text-ink-muted font-mono py-8 text-center">Loading audit trail…</div>';
  try {
    const logs = await ActionLog.list({});
    const cols = [
      { key:'timestamp',    label:'Time',    render: v => `<span class="font-mono text-xs">${escHtml(String(v).slice(0,19).replace('T',' '))}</span>` },
      { key:'user_email',   label:'User',    render: v => `<span class="text-xs font-body">${escHtml(v)}</span>` },
      { key:'user_role',    label:'Role',    render: v => badge(v) },
      { key:'action_type',  label:'Action',  render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
      { key:'entity_type',  label:'Entity',  render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(v || '—')}</span>` },
      { key:'entity_id',    label:'ID',      render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(String(v || '—').slice(0,12))}</span>` },
      { key:'success',      label:'OK',      render: v =>
          (v === true || v === 'TRUE' || v === 'true')
            ? '<span class="text-emerald-600 font-mono text-sm">✓</span>'
            : '<span class="text-red-600 font-mono text-sm">✕</span>' },
      { key:'duration_ms',  label:'ms',      render: v => `<span class="font-mono text-xs">${escHtml(String(v || 0))}</span>` },
      { key:'trace_id',     label:'Trace',   render: v => `<span class="font-mono text-xs text-ink-muted">${escHtml(String(v || '').slice(0,16))}</span>` },
    ];
    el.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h1 class="font-display text-3xl text-ink">Audit Trail</h1>
          <div class="flex gap-3">
            <p class="font-body text-xs text-ink-muted self-center">${logs.length} entries (last 200)</p>
            <button id="btn-export-log" class="btn-secondary text-xs">↓ Export CSV</button>
          </div>
        </div>
        ${logs.length
          ? dataTable(cols, logs)
          : emptyState('No actions logged yet', '📋', '<p class="text-xs text-ink-muted font-body mt-1">All user actions are logged here with trace IDs.</p>')}
      </div>`;
    el.querySelector('#btn-export-log')?.addEventListener('click', () => exportCsv(logs, 'audit-log.csv'));
  } catch (err) {
    el.innerHTML = `<p class="p-8 text-red-700 font-body">${escHtml(err.message)}</p>`;
  }
}

// ── Global helper wired in index.html ────────────────────────────────────────
// closeModal is exposed as window.__cbCloseModal so inline onclick in modals works
import { closeModal as _closeModal } from '../shared/ui.js';
window.__cbCloseModal = _closeModal;
