/**
 * @module core/auth
 * @description Session-less authentication. Handles OTP request/verify flow,
 *              token storage in sessionStorage, role-based UI gating, and
 *              automatic token expiry detection.
 * @dependencies core/api, core/state
 * @events PUBLISHES: auth:login, auth:logout, auth:unauthorized
 *         SUBSCRIBES: api:offline
 */

import { apiPost, apiGet } from './api.js';
import { setState, getState } from './state.js';

const TOKEN_KEY   = 'cb_token';
const USER_KEY    = 'cb_user';
const SESSION_KEY = 'cb_session_id';

// ─── BOOTSTRAP ──────────────────────────────────────────────────────────────

/**
 * @description Initialise auth on page load. Restores session if token still
 *              valid; otherwise routes to login screen.
 * @workflow auth
 * @trace-id AUTH-INIT-01
 * @returns {Object|null} user payload or null
 */
export async function initAuth() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  // Check expiry from payload (no server round-trip)
  try {
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp < Date.now()) {
      clearSession();
      return null;
    }
    setState('user', payload);
    console.log(`[TRACE:AUTH-INIT-01] Restored session for ${payload.email} (${payload.role})`);
    return payload;
  } catch (_) {
    clearSession();
    return null;
  }
}

// ─── OTP FLOW ────────────────────────────────────────────────────────────────

/**
 * @description Workflow: Auth → Step 1 – request OTP for email.
 * @workflow auth
 * @trace-id AUTH-OTP-FE-01
 * @param {string} email
 * @returns {Promise<{sent:boolean, demo_otp?:string}>}
 */
export async function requestOtp(email) {
  console.log(`[TRACE:AUTH-OTP-FE-01] Requesting OTP for ${email}`);
  return apiPost('requestOtp', { email });
}

/**
 * @description Workflow: Auth → Step 2 – submit OTP, store token on success.
 * @workflow auth
 * @trace-id AUTH-OTP-FE-02
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<Object>} user object
 * @throws {Error} 'invalid_otp'
 */
export async function verifyOtp(email, otp) {
  console.log(`[TRACE:AUTH-OTP-FE-02] Verifying OTP for ${email}`);
  const data = await apiPost('verifyOtp', { email, otp });
  _storeSession(data);
  return data.user;
}

/**
 * @description Demo/dev quick-login (no OTP, fires auth:login event).
 * @workflow auth
 * @trace-id AUTH-LOGIN-FE-01
 * @param {string} email
 */
export async function quickLogin(email) {
  console.log(`[TRACE:AUTH-LOGIN-FE-01] Quick login for ${email}`);
  const data = await apiPost('login', { email });
  _storeSession(data);
  window.dispatchEvent(new CustomEvent('cyrabell:auth:login', { detail: data.user }));
  return data.user;
}

/**
 * @description Register new client account then auto-login.
 * @workflow auth
 * @trace-id AUTH-REG-FE-01
 */
export async function register(fields) {
  const data = await apiPost('register', fields);
  _storeSession(data);
  window.dispatchEvent(new CustomEvent('cyrabell:auth:login', { detail: data.user }));
  return data.user;
}

// ─── SESSION MANAGEMENT ──────────────────────────────────────────────────────

function _storeSession(data) {
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
  // Generate stable session ID for action log correlation
  if (!sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_KEY, 'SID-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6));
  }
  setState('user', data.user);
}

/**
 * @description Clear all session data and emit logout event.
 * @workflow auth
 * @trace-id AUTH-LOGOUT-01
 */
export function logout() {
  clearSession();
  window.dispatchEvent(new CustomEvent('cyrabell:auth:logout', {}));
  window.location.hash = '#login';
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  setState('user', null);
}

// ─── ACCESSORS ───────────────────────────────────────────────────────────────

/** @returns {Object|null} current user payload */
export function currentUser() {
  const cached = getState('user');
  if (cached) return cached;
  const raw = sessionStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn()  { return !!currentUser(); }
export function isAdmin()     { return currentUser()?.role === 'admin'; }
export function isLawyer()    { return ['admin','lawyer'].includes(currentUser()?.role); }
export function isClient()    { return currentUser()?.role === 'client'; }

/**
 * @description Guards a function — throws auth:unauthorized if role check fails.
 * @workflow auth
 * @trace-id AUTH-GUARD-01
 * @param {Function} fn
 * @param {'admin'|'lawyer'|'client'|'any'} minRole
 */
export function requireRole(fn, minRole = 'any') {
  return (...args) => {
    const u = currentUser();
    if (!u) {
      window.dispatchEvent(new CustomEvent('cyrabell:auth:unauthorized', {}));
      throw new Error('not_authenticated');
    }
    const hierarchy = { admin: 3, lawyer: 2, client: 1, any: 0 };
    if ((hierarchy[u.role] || 0) < (hierarchy[minRole] || 0)) {
      window.dispatchEvent(new CustomEvent('cyrabell:auth:unauthorized', { detail: { required: minRole } }));
      throw new Error('insufficient_role');
    }
    return fn(...args);
  };
}
