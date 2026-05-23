/**
 * @module modules/booking
 * @description Booking & Consultation workflow module.
 *              Handles slot selection, online/f2f mode, QR check-in,
 *              24h reminders, and status progression UI.
 * @dependencies core/api, core/auth, shared/ui, shared/utils
 * @events PUBLISHES: booking:created, booking:confirmed, booking:checkedin
 *         SUBSCRIBES: router:navigated (to #bookings)
 */

import { Bookings } from '../core/api.js';
import { currentUser, isLawyer, isAdmin } from '../core/auth.js';
import { toast, openModal, closeModal, dataTable, badge, showSpinner,
         emptyState, fieldGroup, textInput, selectInput, formData, fmtDate, escHtml } from '../shared/ui.js';
import { today, nextWeekdays, fmtCurrency, debounce } from '../shared/utils.js';

// ─── PUBLIC ENTRY POINTS ─────────────────────────────────────────────────────

/**
 * @description Workflow: Booking → renders the main booking view into `el`.
 * @workflow online-consultation
 * @trace-id WF-BOOK-VIEW-01
 * @param {HTMLElement} el
 */
export async function renderBookings(el) {
  showSpinner(el, 'Loading bookings…');
  try {
    const bookings = await Bookings.list({});
    const user = currentUser();
    el.innerHTML = buildBookingsView(bookings, user);
    wireBookingsView(el, bookings);
  } catch (err) {
    el.innerHTML = `<div class="p-8 text-center text-red-700 font-body">${escHtml(err.message)}</div>`;
  }
}

/**
 * @description Workflow: Booking → Step 1 – open new-booking modal.
 * @workflow online-consultation
 * @trace-id WF-BOOK-NEW-01
 */
export function openBookingModal(prefill = {}) {
  const days = nextWeekdays(14);
  openModal('New Booking', buildBookingForm(days, prefill));
  document.getElementById('booking-date-sel')?.addEventListener('change', loadSlots);
  document.getElementById('booking-lawyer-sel')?.addEventListener('change', loadSlots);
  document.getElementById('booking-form')?.addEventListener('submit', handleBookingSubmit);
}

// ─── VIEW BUILDERS ────────────────────────────────────────────────────────────

function buildBookingsView(bookings, user) {
  const isStaff = isLawyer() || isAdmin();
  const cols = [
    { key: 'booking_id', label: 'ID', render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
    { key: 'date',       label: 'Date', render: v => escHtml(fmtDate(v)) },
    { key: 'time_slot',  label: 'Time' },
    { key: 'mode',       label: 'Mode', render: v => v === 'online'
        ? '<span class="text-blue-600 font-mono text-xs">▶ Online</span>'
        : '<span class="text-amber-700 font-mono text-xs">⌂ Face-to-Face</span>' },
    isStaff ? { key: 'client_id',    label: 'Client' } : null,
    isStaff ? { key: 'lawyer_email', label: 'Lawyer', render: v => `<span class="text-xs font-body">${escHtml(v)}</span>` } : null,
    { key: 'status', label: 'Status', render: v => badge(v) },
    { key: 'meeting_link', label: 'Link', render: v => v
        ? `<a href="${escHtml(v)}" target="_blank" class="text-gold hover:underline text-xs font-mono">Join →</a>` : '—' },
  ].filter(Boolean);

  const pendingCount   = bookings.filter(b => b.status === 'pending').length;
  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length;

  return `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-3xl text-ink">Bookings</h1>
          <p class="font-body text-sm text-ink-muted mt-0.5">
            ${pendingCount} pending · ${confirmedCount} confirmed
          </p>
        </div>
        <div class="flex gap-2">
          ${isStaff ? `<button id="btn-checkin" class="btn-secondary text-sm">⬛ QR Check-in</button>` : ''}
          <button id="btn-new-booking" class="btn-primary text-sm">+ New Booking</button>
        </div>
      </div>

      <!-- Filters (staff only) -->
      ${isStaff ? `
      <div class="flex flex-wrap gap-3" id="booking-filters">
        ${['all','pending','confirmed','checked-in','completed','cancelled'].map(s =>
          `<button data-filter="${s}" class="filter-chip ${s==='all'?'active':''}">${s}</button>`
        ).join('')}
      </div>` : ''}

      <!-- Table -->
      <div id="bookings-table">
        ${bookings.length ? dataTable(cols, bookings, {
          rowAction: row => openBookingDetail(row),
          id: 'bookings-tbl'
        }) : emptyState('No bookings yet', '📅', `<button onclick="window.dispatchEvent(new Event('cyrabell:open-booking-modal'))" class="btn-primary text-sm mt-3">Book a consultation</button>`)}
      </div>
    </div>`;
}

function buildBookingForm(days, prefill = {}) {
  const lawyerOptions = [
    ['lawyer1@cyrabell.test', 'Atty. Benigno Reyes'],
    ['lawyer2@cyrabell.test', 'Atty. Carmelita Santos'],
  ];
  return `
    <form id="booking-form" class="space-y-1">
      ${fieldGroup('Service Type',
        selectInput('service_type', [
          ['consultation','Initial Consultation'],
          ['followup','Follow-up Meeting'],
          ['case_review','Case Review'],
          ['document_signing','Document Signing'],
        ], prefill.service_type)
      )}
      ${fieldGroup('Mode',
        selectInput('mode', [['online','Online (Video Call)'],['f2f','Face-to-Face']], prefill.mode||'online')
      )}
      ${fieldGroup('Assigned Lawyer',
        selectInput('lawyer_email', lawyerOptions, prefill.lawyer_email || lawyerOptions[0][0], 'id="booking-lawyer-sel"')
      )}
      ${fieldGroup('Preferred Date',
        selectInput('date', days.map(d => [d, d]), prefill.date||days[0], 'id="booking-date-sel"')
      )}
      <div id="slots-container">
        ${fieldGroup('Time Slot',
          `<div id="slot-grid" class="grid grid-cols-4 gap-2">
            <span class="font-mono text-xs text-ink-muted col-span-4">Select date + lawyer to load slots</span>
          </div>`
        )}
      </div>
      ${fieldGroup('Notes (optional)',
        `<textarea name="notes" rows="3" class="w-full border border-ink/20 bg-white/60 rounded px-3 py-2 font-body text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold/40 transition" placeholder="Any specific topics or requirements…"></textarea>`
      )}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="window.__cbCloseModal()" class="btn-secondary">Cancel</button>
        <button type="submit" class="btn-primary">Request Booking</button>
      </div>
    </form>`;
}

// ─── SLOT LOADER ──────────────────────────────────────────────────────────────

/**
 * @description Workflow: Booking → Step 2 – load available time slots.
 * @workflow online-consultation
 * @trace-id WF-BOOK-02
 */
async function loadSlots() {
  const date   = document.getElementById('booking-date-sel')?.value;
  const lawyer = document.getElementById('booking-lawyer-sel')?.value;
  if (!date || !lawyer) return;
  const grid = document.getElementById('slot-grid');
  if (!grid) return;
  grid.innerHTML = '<span class="font-mono text-xs text-ink-muted col-span-4 animate-pulse">Checking availability…</span>';
  try {
    const { available } = await Bookings.availability({ date, lawyer_email: lawyer });
    if (!available.length) {
      grid.innerHTML = '<span class="text-xs text-red-600 font-body col-span-4">No slots available for this date.</span>';
      return;
    }
    grid.innerHTML = available.map(slot =>
      `<label class="slot-chip">
        <input type="radio" name="time_slot" value="${escHtml(slot)}" class="sr-only" required>
        <span class="slot-label">${escHtml(slot)}</span>
      </label>`
    ).join('');
    // Wire slot selection visual
    grid.querySelectorAll('.slot-chip input').forEach(inp => {
      inp.addEventListener('change', () => {
        grid.querySelectorAll('.slot-label').forEach(l => l.classList.remove('selected'));
        inp.nextElementSibling.classList.add('selected');
      });
    });
  } catch (err) {
    grid.innerHTML = `<span class="text-xs text-red-600 font-body col-span-4">${escHtml(err.message)}</span>`;
  }
}

// ─── FORM SUBMISSION ──────────────────────────────────────────────────────────

/**
 * @description Workflow: Booking → Step 3 – submit booking request.
 * @workflow online-consultation
 * @trace-id WF-BOOK-03
 */
async function handleBookingSubmit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Requesting…';
  try {
    const data = formData(e.target);
    if (!data.time_slot) { toast('Please select a time slot', 'error'); return; }
    data.client_id = currentUser().email;
    const booking = await Bookings.create(data);
    closeModal();
    toast(`Booking ${booking.booking_id} submitted — awaiting confirmation`, 'success');
    window.dispatchEvent(new CustomEvent('cyrabell:booking:created', { detail: booking }));
    // Refresh the view
    const outlet = document.getElementById('main-outlet');
    if (outlet) renderBookings(outlet);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Request Booking';
  }
}

// ─── BOOKING DETAIL ───────────────────────────────────────────────────────────

/**
 * @description Workflow: Booking → Step 5 – view/manage booking detail.
 * @workflow online-consultation
 * @trace-id WF-BOOK-DETAIL-01
 */
function openBookingDetail(row) {
  const isStaff = isLawyer() || isAdmin();
  const qrSvg = buildQrSvg(row.qr_code_data);
  openModal(`Booking <span class="font-mono text-sm">${escHtml(row.booking_id)}</span>`, `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3 text-sm font-body">
        <div><span class="text-ink-muted font-mono text-xs">Date</span><p class="text-ink mt-0.5">${escHtml(fmtDate(row.date))}</p></div>
        <div><span class="text-ink-muted font-mono text-xs">Time</span><p class="text-ink mt-0.5">${escHtml(row.time_slot)}</p></div>
        <div><span class="text-ink-muted font-mono text-xs">Mode</span><p class="text-ink mt-0.5">${escHtml(row.mode)}</p></div>
        <div><span class="text-ink-muted font-mono text-xs">Status</span><p class="mt-0.5">${badge(row.status)}</p></div>
        ${row.meeting_link ? `<div class="col-span-2"><span class="text-ink-muted font-mono text-xs">Meeting Link</span>
          <a href="${escHtml(row.meeting_link)}" target="_blank" class="block text-gold font-mono text-xs mt-0.5 hover:underline">${escHtml(row.meeting_link)}</a></div>` : ''}
      </div>

      ${row.mode === 'f2f' ? `
      <div class="border border-ink/10 rounded p-4 text-center">
        <p class="font-mono text-xs text-ink-muted mb-3">Check-in QR Code</p>
        <div class="flex justify-center">${qrSvg}</div>
        <p class="font-mono text-xs text-ink-muted mt-2">${escHtml(row.qr_code_data)}</p>
      </div>` : ''}

      ${isStaff ? `
      <div class="flex gap-2 flex-wrap pt-2 border-t border-ink/10">
        ${row.status === 'pending' ? `
          <button class="btn-primary text-sm" onclick="confirmBooking('${escHtml(row.booking_id)}')">✓ Confirm</button>
          <button class="btn-danger text-sm"  onclick="cancelBooking('${escHtml(row.booking_id)}')">✕ Cancel</button>` : ''}
        ${row.status === 'confirmed' && row.mode === 'f2f' ? `
          <button class="btn-secondary text-sm" onclick="checkInBooking('${escHtml(row.qr_code_data)}')">⬛ Check-in</button>` : ''}
        ${row.status === 'checked-in' || row.status === 'confirmed' ? `
          <button class="btn-secondary text-sm" onclick="completeBooking('${escHtml(row.booking_id)}')">✔ Complete</button>` : ''}
      </div>` : ''}
    </div>
  `, { wide: false });

  // Wire the action buttons
  window.confirmBooking = (id) => updateStatus(id, 'confirmed');
  window.cancelBooking  = (id) => updateStatus(id, 'cancelled');
  window.completeBooking= (id) => updateStatus(id, 'completed');
  window.checkInBooking = (qr) => handleQrCheckin(qr);
}

async function updateStatus(id, status) {
  try {
    await Bookings.update({ booking_id: id, status });
    closeModal();
    toast(`Booking ${id} → ${status}`, 'success');
    window.dispatchEvent(new CustomEvent('cyrabell:booking:updated', { detail: { booking_id: id, status } }));
    const outlet = document.getElementById('main-outlet');
    if (outlet) renderBookings(outlet);
  } catch (err) { toast(err.message, 'error'); }
}

/**
 * @description Workflow: Booking → Step 6 – QR scanner check-in.
 * @workflow online-consultation
 * @trace-id WF-BOOK-06
 */
async function handleQrCheckin(qrData) {
  try {
    const res = await Bookings.checkin({ qr: qrData });
    closeModal();
    toast(`Checked in: ${res.booking_id}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

export function openQrCheckinModal() {
  openModal('QR Check-in', `
    <div class="space-y-4">
      <p class="font-body text-sm text-ink-muted">Enter the QR code value from the client's booking confirmation.</p>
      <input id="qr-manual-input" type="text" placeholder="CHECKIN:BK-XXXXXXXX"
        class="w-full border border-ink/20 bg-white/60 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
      <div class="flex justify-end gap-2">
        <button class="btn-secondary" onclick="window.__cbCloseModal()">Cancel</button>
        <button class="btn-primary" id="qr-submit-btn">Check In</button>
      </div>
    </div>`);
  document.getElementById('qr-submit-btn')?.addEventListener('click', () => {
    const val = document.getElementById('qr-manual-input')?.value?.trim();
    if (val) handleQrCheckin(val);
  });
}

// ─── WIRING ───────────────────────────────────────────────────────────────────

function wireBookingsView(el, bookings) {
  el.querySelector('#btn-new-booking')?.addEventListener('click', () => openBookingModal());
  el.querySelector('#btn-checkin')?.addEventListener('click', openQrCheckinModal);

  // Filter chips
  el.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const f = chip.dataset.filter;
      const filtered = f === 'all' ? bookings : bookings.filter(b => b.status === f);
      const tblDiv = el.querySelector('#bookings-table');
      if (tblDiv) {
        const cols = [
          { key: 'booking_id', label: 'ID', render: v => `<span class="font-mono text-xs">${escHtml(v)}</span>` },
          { key: 'date',    label: 'Date', render: v => escHtml(fmtDate(v)) },
          { key: 'time_slot',label: 'Time' },
          { key: 'mode',    label: 'Mode' },
          { key: 'status',  label: 'Status', render: v => badge(v) },
        ];
        tblDiv.innerHTML = dataTable(cols, filtered, { rowAction: row => openBookingDetail(row) });
      }
    });
  });

  // Listen for global open-modal event
  window.addEventListener('cyrabell:open-booking-modal', () => openBookingModal(), { once: true });
}

// ─── MINIMAL QR SVG RENDERER ──────────────────────────────────────────────────

/**
 * @description Render a minimal visual QR-style grid from a string (decorative,
 *              not scannable — real implementation should use qrcodejs2 CDN).
 * @workflow online-consultation
 * @trace-id WF-BOOK-QR-01
 */
function buildQrSvg(data) {
  // Simple checkered pattern seeded from data hash (decorative placeholder)
  const n = 11;
  const cell = 8;
  const size = n * cell + 2;
  let cells = '';
  let h = 5381;
  for (let i = 0; i < (data||'').length; i++) h = ((h << 5) + h) ^ (data||'').charCodeAt(i);
  // Finder patterns (corners)
  const finders = [[0,0],[0,n-7],[n-7,0]];
  const finder = new Set();
  finders.forEach(([r,c]) => {
    for (let i=r; i<r+7; i++) for (let j=c; j<c+7; j++) {
      const inner = i>r && i<r+6 && j>c && j<c+6;
      const ring  = i===r||i===r+6||j===c||j===c+6;
      const core  = i>r+1&&i<r+5&&j>c+1&&j<c+5;
      if (ring || core) finder.add(i+','+j);
    }
  });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const isFinder = finder.has(r+','+c);
      const isData   = !isFinder && (((h ^ (r*31+c*17)) & 1) === 1);
      if (isFinder || isData) {
        cells += `<rect x="${1+c*cell}" y="${1+r*cell}" width="${cell-1}" height="${cell-1}" fill="#0F1419" rx="1"/>`;
      }
    }
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="border border-ink/10 rounded">${cells}</svg>`;
}
