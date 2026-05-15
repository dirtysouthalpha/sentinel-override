// popup-modules/popup-state.js
// Reactive state management for the Sentinel Override popup.
// Loaded first so window.__popupState is available to all other modules.
//
// Usage:
//   const state = getState();            // returns the reactive proxy
//   subscribe('activeProviderId', cb);   // cb(newValue, key) on change

// ========== Subscriber Registry ==========
const _subscribers = {}; // key -> Set<callback>

// ========== Default State Shape ==========
const _initialState = {
  conversationHistory: [],
  selectedAttachments: [],
  currentSearchQuery: '',
  currentSearchIndex: 0,
  activeProviderId: 'anthropic',
  providerConfigs: { anthropic: {}, openai: {} },
  currentReportMarkdown: null,
  currentReport: null,
  pendingStepLogs: {},
};

// ========== Proxy Factory ==========
function _createReactiveProxy(target) {
  return new Proxy(target, {
    set(obj, prop, value) {
      const oldValue = obj[prop];
      obj[prop] = value;

      // Notify subscribers only when the value actually changed
      if (oldValue !== value && _subscribers[prop]) {
        for (const cb of _subscribers[prop]) {
          try {
            cb(value, prop, oldValue);
          } catch (err) {
            console.error(`[popup-state] subscriber error on "${String(prop)}":`, err);
          }
        }
      }
      return true;
    },
  });
}

// ========== Public API ==========

/**
 * Initialize (or re-initialize) the shared popup state.
 * Sets window.__popupState to a new reactive proxy.
 * Safe to call once at startup.
 */
// eslint-disable-next-line no-unused-vars
function initPopupState() {
  // Deep-clone defaults so each init is independent
  const fresh = JSON.parse(JSON.stringify(_initialState));
  window.__popupState = _createReactiveProxy(fresh);
}

/**
 * Returns the reactive state proxy (window.__popupState).
 */
// eslint-disable-next-line no-unused-vars
function getState() {
  return window.__popupState;
}

/**
 * Subscribe to changes on a specific state key.
 * @param {string} key       - State property name to watch.
 * @param {Function} callback - Called with (newValue, key, oldValue).
 * @returns {Function} Unsubscribe function.
 */
// eslint-disable-next-line no-unused-vars
function subscribe(key, callback) {
  if (!_subscribers[key]) {
    _subscribers[key] = new Set();
  }
  _subscribers[key].add(callback);

  // Return an unsubscribe thunk for easy cleanup
  return () => {
    _subscribers[key]?.delete(callback);
  };
}
