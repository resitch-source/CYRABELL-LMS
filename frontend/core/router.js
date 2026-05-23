/**
 * @module core/router
 * @description Hash-based SPA router. Maps URL hashes to view renderers
 *              with before-navigation guards (auth, role checks).
 * @dependencies core/auth, core/state
 * @events PUBLISHES: router:navigated, router:blocked
 */

import { isLoggedIn, isAdmin, isLawyer, currentUser } from './auth.js';

const _routes   = new Map();   // hash -> { render:fn, guard?:fn, title:string }
const _history  = [];
let   _current  = null;
let   _outlet   = null;

// ─── ROUTE REGISTRATION ──────────────────────────────────────────────────────

/**
 * @description Register a route.
 * @workflow router
 * @trace-id ROUTE-REG-01
 * @param {string}   hash      e.g. '#dashboard'
 * @param {Function} render    async fn(params) → void (mutates _outlet)
 * @param {Object}   [opts]    { guard, title, roles:[] }
 */
export function addRoute(hash, render, opts = {}) {
  _routes.set(hash, { render, ...opts });
}

/**
 * @description Navigate to a hash route, applying guards.
 * @workflow router
 * @trace-id ROUTE-NAV-01
 * @param {string} hash
 * @param {Object} [params]
 */
export async function navigate(hash, params = {}) {
  const route = _routes.get(hash);
  if (!route) {
    console.warn(`[TRACE:ROUTE-NAV-01] Unknown route: ${hash}`);
    return navigate('#404', {});
  }

  // Auth guard
  if (route.guard === 'auth' && !isLoggedIn()) {
    window.dispatchEvent(new CustomEvent('cyrabell:router:blocked', { detail: { hash, reason: 'not_authenticated' } }));
    return navigate('#login', {});
  }

  // Role guard
  if (route.roles?.length) {
    const user = currentUser();
    if (!user || !route.roles.includes(user.role)) {
      window.dispatchEvent(new CustomEvent('cyrabell:router:blocked', { detail: { hash, reason: 'insufficient_role' } }));
      return navigate('#unauthorized', {});
    }
  }

  // Custom guard fn
  if (typeof route.guard === 'function') {
    const ok = await route.guard(params);
    if (!ok) return;
  }

  _current = hash;
  _history.push({ hash, params, ts: Date.now() });
  if (window.location.hash !== hash) window.location.hash = hash;
  if (route.title) document.title = `Cyrabell | ${route.title}`;

  try {
    await route.render(params);
    window.dispatchEvent(new CustomEvent('cyrabell:router:navigated', { detail: { hash, params } }));
  } catch (err) {
    console.error(`[TRACE:ROUTE-NAV-01] Render error on ${hash}:`, err);
    renderError(_outlet, err);
  }
}

/** @returns {string} current hash */
export function currentRoute() { return _current; }

/** @description Register the DOM element that views render into. */
export function setOutlet(el) { _outlet = el; }
export function getOutlet()   { return _outlet; }

// ─── HASH CHANGE LISTENER ────────────────────────────────────────────────────

/**
 * @description Boot the router — call once from main entry point.
 * @workflow router
 * @trace-id ROUTE-BOOT-01
 */
export function startRouter(outletEl) {
  _outlet = outletEl;
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash || '#dashboard';
    const [base, qs] = hash.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    navigate(base, params);
  });
  // Initial load
  const initial = window.location.hash || (isLoggedIn() ? '#dashboard' : '#login');
  navigate(initial, {});
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function renderError(outlet, err) {
  if (!outlet) return;
  outlet.innerHTML = `<div class="p-8 text-center">
    <p class="font-display text-2xl text-red-800 mb-2">Navigation Error</p>
    <p class="font-mono text-sm text-ink-muted">${err.message}</p>
    <button onclick="window.location.hash='#dashboard'" class="btn-secondary mt-4">Return</button>
  </div>`;
}

/** @description Programmatic link helper — used in templates. */
export function link(hash, params = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return `${hash}${qs}`;
}
