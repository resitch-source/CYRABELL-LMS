/**
 * @module core/state
 * @description Lightweight reactive global store with pub/sub.
 *              Modules read state with getState() and subscribe to changes
 *              with subscribe(). Mutations go through setState() which
 *              broadcasts to all listeners.
 * @dependencies none
 * @events PUBLISHES: state:changed:{key}
 */

const _store = {};
const _listeners = {};   // key -> Set<Function>
const _wildcards  = new Set();

/**
 * @description Read a value from the global store.
 * @workflow state-management
 * @trace-id STATE-GET-01
 * @param {string} key
 * @param {*} [defaultVal]
 * @returns {*}
 */
export function getState(key, defaultVal = null) {
  return _store.hasOwnProperty(key) ? _store[key] : defaultVal;
}

/**
 * @description Write a value and notify subscribers.
 * @workflow state-management
 * @trace-id STATE-SET-01
 * @param {string} key
 * @param {*} value
 */
export function setState(key, value) {
  const prev = _store[key];
  _store[key] = value;
  // Notify key-specific listeners
  (_listeners[key] || new Set()).forEach(fn => {
    try { fn(value, prev, key); } catch (e) { console.error('[state] listener error', e); }
  });
  // Notify wildcard listeners
  _wildcards.forEach(fn => {
    try { fn(key, value, prev); } catch (e) { console.error('[state] wildcard error', e); }
  });
  window.dispatchEvent(new CustomEvent('lexfirm:state:' + key, { detail: { value, prev } }));
}

/**
 * @description Subscribe to changes on a specific key.
 * @workflow state-management
 * @trace-id STATE-SUB-01
 * @param {string|'*'} key  Pass '*' to subscribe to all changes
 * @param {Function}   fn   Called with (value, prev, key)
 * @returns {Function}      Unsubscribe function
 */
export function subscribe(key, fn) {
  if (key === '*') {
    _wildcards.add(fn);
    return () => _wildcards.delete(fn);
  }
  if (!_listeners[key]) _listeners[key] = new Set();
  _listeners[key].add(fn);
  return () => _listeners[key].delete(fn);
}

/**
 * @description Merge a partial object into an existing store key (must be Object).
 * @workflow state-management
 * @trace-id STATE-MERGE-01
 */
export function mergeState(key, partial) {
  const current = _store[key] || {};
  setState(key, { ...current, ...partial });
}

/** @description Reset the entire store — used in tests / logout. */
export function resetState() {
  Object.keys(_store).forEach(k => delete _store[k]);
}

// Expose on window for debugging in DevTools
if (typeof window !== 'undefined') window.__lfState = { getState, setState, _store };
