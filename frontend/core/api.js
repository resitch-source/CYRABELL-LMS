/**
 * @module core/api
 * @description Centralised HTTP client for all Apps Script backend calls.
 *              Implements stale-while-revalidate caching, automatic retry with
 *              exponential back-off, trace-ID injection, and request queuing
 *              while offline.
 * @dependencies core/state, core/auth
 * @events PUBLISHES: api:error, api:offline, api:online
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
/** @description Replace with your deployed Apps Script /exec URL after deployment. */
export const API_BASE = window.CYRABELL_API_BASE || 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

const CACHE_TTL_MS   = 30_000;   // 30s stale-while-revalidate
const RETRY_DELAYS   = [500, 2000, 5000];
const OFFLINE_QUEUE_KEY = 'cb_offline_queue';

// ─── INTERNAL STATE ──────────────────────────────────────────────────────────
const _cache   = new Map();   // key -> { data, ts }
const _inflight= new Map();   // key -> Promise (dedup concurrent identical GETs)

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * @description Generate short trace ID for every outbound request.
 * @workflow api-client
 * @trace-id API-TRACE-01
 * @returns {string}
 */
function mkTrace() {
  return 'FE-' + Date.now().toString(36).slice(-5) + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

/**
 * @description Read auth token from sessionStorage (set by core/auth.js).
 * @workflow api-client
 * @trace-id API-TOKEN-01
 * @returns {string}
 */
function getToken() {
  return sessionStorage.getItem('cb_token') || '';
}

/** @description Emit global event for cross-module error visibility. */
function emit(name, detail) {
  window.dispatchEvent(new CustomEvent('cyrabell:' + name, { detail }));
}

// ─── CORE FETCH ──────────────────────────────────────────────────────────────

/**
 * @description Low-level fetch with retry + trace injection. Always resolves
 *              (never rejects) — errors are returned as { ok:false, error }.
 * @workflow api-client
 * @trace-id API-FETCH-01
 * @param {string} url
 * @param {RequestInit} opts
 * @param {number} [attempt=0]
 * @returns {Promise<Object>}
 */
async function fetchWithRetry(url, opts, attempt = 0) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) });
    if (!res.ok && res.status >= 500 && attempt < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[attempt]);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    const json = await res.json();
    if (!json.ok && json.error === 'rate_limited') {
      await sleep(RETRY_DELAYS[Math.min(attempt, 2)] * 2);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    return json;
  } catch (err) {
    if (attempt < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[attempt]);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    emit('api:error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * @description Perform a GET-style call (action + params encoded as query string).
 *              Uses stale-while-revalidate: returns cached data immediately while
 *              revalidating in background.
 * @workflow api-client
 * @trace-id API-GET-01
 * @param {string} action   Backend action name (e.g. "booking_list")
 * @param {Object} [params] Extra params
 * @param {Object} [opts]   { cache:false, sessionId:'' }
 * @returns {Promise<any>}  Resolved data (or throws on non-ok)
 */
export async function apiGet(action, params = {}, opts = {}) {
  const traceId = mkTrace();
  const sessionId = opts.sessionId || sessionStorage.getItem('cb_session_id') || '';
  const qs = new URLSearchParams({
    action, token: getToken(), trace_id: traceId, session_id: sessionId,
    ...params
  }).toString();
  const url = `${API_BASE}?${qs}`;
  const cacheKey = url;

  // Stale-while-revalidate
  const cached = _cache.get(cacheKey);
  const fresh = cached && (Date.now() - cached.ts < CACHE_TTL_MS);

  if (fresh && opts.cache !== false) {
    console.log(`[TRACE:${traceId}] apiGet ${action} → cache hit`);
    return cached.data;
  }

  // Dedup concurrent identical requests
  if (_inflight.has(cacheKey)) {
    console.log(`[TRACE:${traceId}] apiGet ${action} → dedup inflight`);
    return _inflight.get(cacheKey);
  }

  const promise = fetchWithRetry(url, { method: 'GET' }).then(json => {
    _inflight.delete(cacheKey);
    if (!json.ok) throw new Error(json.error || 'api_error');
    _cache.set(cacheKey, { data: json.data, ts: Date.now() });
    if (cached && !fresh) {
      // Background revalidation: notify listeners
      emit('api:revalidated', { action, data: json.data });
    }
    return json.data;
  }).catch(err => {
    _inflight.delete(cacheKey);
    if (cached) return cached.data; // serve stale on error
    throw err;
  });

  _inflight.set(cacheKey, promise);
  if (cached) return cached.data; // return stale immediately
  return promise;
}

/**
 * @description Perform a POST-style call (body as JSON). Never cached.
 *              If offline, enqueues to localStorage for later replay.
 * @workflow api-client
 * @trace-id API-POST-01
 * @param {string} action
 * @param {Object} [body]
 * @param {Object} [opts]   { sessionId:'', offlineQueue:false }
 * @returns {Promise<any>}
 */
export async function apiPost(action, body = {}, opts = {}) {
  const traceId = mkTrace();
  const sessionId = opts.sessionId || sessionStorage.getItem('cb_session_id') || '';
  const payload = {
    action, token: getToken(), trace_id: traceId, session_id: sessionId, ...body
  };
  console.log(`[TRACE:${traceId}] apiPost ${action}`);

  if (!navigator.onLine && opts.offlineQueue !== false) {
    enqueueOffline_(action, payload, traceId);
    return { queued: true, trace_id: traceId };
  }

  // Bust related cache entries on mutations
  bustCacheFor_(action);

  // ── IMPORTANT: Apps Script Web Apps do NOT support JSON POST bodies from
  //    cross-origin requests (CORS preflight strips the body).
  //    We must send as application/x-www-form-urlencoded so Apps Script
  //    receives values in e.parameter (same as GET query string).
  //    Nested objects are JSON-stringified per key.
  const formPayload = new URLSearchParams();
  Object.entries(payload).forEach(([k, v]) => {
    formPayload.append(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
  });

  const json = await fetchWithRetry(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formPayload.toString()
  });

  if (!json.ok) throw new Error(json.error || 'api_error');
  return json.data;
}

/**
 * @description Replays queued offline mutations when connection resumes.
 * @workflow api-client
 * @trace-id API-OFFLINE-01
 */
export async function flushOfflineQueue() {
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return;
  let queue;
  try { queue = JSON.parse(raw); } catch (_) { queue = []; }
  const remaining = [];
  for (const item of queue) {
    try {
      const json = await fetchWithRetry(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload)
      });
      if (!json.ok) remaining.push(item);
      else emit('api:offline-flushed', { action: item.action, trace_id: item.trace_id });
    } catch (_) {
      remaining.push(item);
    }
  }
  if (remaining.length) localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  else localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

function enqueueOffline_(action, payload, traceId) {
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({ action, payload, trace_id: traceId, ts: Date.now() });
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  emit('api:queued-offline', { action, trace_id: traceId });
}

/** @description Bust GET cache for entity types related to a mutation action. */
function bustCacheFor_(action) {
  const prefix = action.split('_')[0]; // e.g. "booking" from "booking_create"
  for (const key of _cache.keys()) {
    if (key.includes('action=' + prefix)) _cache.delete(key);
  }
}

/** @description Manual cache invalidation (call after successful mutations). */
export function invalidateCache(actionPrefix) {
  for (const key of _cache.keys()) {
    if (!actionPrefix || key.includes('action=' + actionPrefix)) _cache.delete(key);
  }
}

// ─── CONNECTIVITY ─────────────────────────────────────────────────────────────
window.addEventListener('online',  () => { emit('api:online', {}); flushOfflineQueue(); });
window.addEventListener('offline', () => emit('api:offline', {}));

// ─── CONVENIENCE WRAPPERS ────────────────────────────────────────────────────

/** Bookings */
export const Bookings = {
  availability: (p)     => apiGet('booking_availability', p),
  list:         (p)     => apiGet('booking_list', p),
  create:       (b)     => apiPost('booking_create', b),
  update:       (b)     => apiPost('booking_update', b),
  checkin:      (b)     => apiPost('booking_checkin', b),
};

/** Clients */
export const Clients = {
  list:   (p)  => apiGet('client_list', p),
  get:    (p)  => apiGet('client_get', p),
  create: (b)  => apiPost('client_create', b),
  update: (b)  => apiPost('client_update', b),
};

/** Cases */
export const Cases = {
  list:          (p) => apiGet('case_list', p),
  get:           (p) => apiGet('case_get', p),
  create:        (b) => apiPost('case_create', b),
  update:        (b) => apiPost('case_update', b),
  conflictCheck: (b) => apiPost('case_conflict_check', b),
};

/** Documents */
export const Documents = {
  list:     (p) => apiGet('document_list', p),
  register: (b) => apiPost('document_register', b),
};

/** Time + Invoices */
export const Time = {
  list: (p) => apiGet('time_list', p),
  add:  (b) => apiPost('time_add', b),
};
export const Invoices = {
  list:   (p) => apiGet('invoice_list', p),
  create: (b) => apiPost('invoice_create', b),
};

/** AI */
export const AI = {
  predictDuration: (b) => apiPost('ai_predict_duration', b),
  suggestLawyer:   (b) => apiPost('ai_suggest_lawyer', b),
  overdueRisk:     (p) => apiGet('ai_overdue_risk', p),
  feedback:        (b) => apiPost('ai_feedback', b),
  retrain:         ()  => apiPost('ai_retrain', {}),
};

/** Analytics */
export const Analytics = {
  dashboard: (p) => apiGet('analytics_dashboard', p),
};

/** Notifications */
export const Notify = {
  send: (b) => apiPost('notify_send', b),
  log:  (p) => apiGet('notify_log', p),
};

/** Action log (admin/lawyer only) */
export const ActionLog = {
  list: (p) => apiGet('action_log_list', p),
};
