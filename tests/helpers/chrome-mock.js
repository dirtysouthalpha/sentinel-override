// Sentinel Override v3 -- Chrome API Mock
// Stateful mock for ~9 Chrome namespaces used by background and content scripts.
// Provides createChromeMock() and setupChromeMock() for test setup.

/**
 * Event listener pool that mimics chrome event listeners.
 * Supports addListener, removeListener, and fire.
 */
export class EventListenerPool {
  constructor() {
    this._listeners = new Set();
  }

  addListener(fn) {
    this._listeners.add(fn);
  }

  removeListener(fn) {
    this._listeners.delete(fn);
  }

  fire(...args) {
    this._listeners.forEach(fn => {
      try { fn(...args); } catch (e) { /* listener error */ }
    });
  }

  hasListeners() {
    return this._listeners.size > 0;
  }

  clear() {
    this._listeners.clear();
  }
}

/**
 * Creates a stateful mock of chrome.storage.local and chrome.storage.session.
 * Supports both callback and Promise patterns.
 */
export function createStorageMock() {
  const _store = {};

  function get(keys) {
    const result = {};
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) {
      keys.forEach(k => { if (k in _store) result[k] = _store[k]; });
    } else if (keys && typeof keys === 'object') {
      Object.keys(keys).forEach(k => { if (k in _store) result[k] = _store[k]; });
    } else {
      Object.assign(result, _store);
    }
    return result;
  }

  const storage = {
    _store,
    get(keys, callback) {
      const result = get(keys);
      if (callback) {
        // Use setTimeout to mimic async behavior
        setTimeout(() => callback(result), 0);
      }
      return Promise.resolve(result);
    },
    set(items, callback) {
      Object.assign(_store, items);
      if (callback) setTimeout(() => callback(), 0);
      return Promise.resolve();
    },
    remove(keys, callback) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => { delete _store[k]; });
      if (callback) setTimeout(() => callback(), 0);
      return Promise.resolve();
    },
    clear(callback) {
      Object.keys(_store).forEach(k => { delete _store[k]; });
      if (callback) setTimeout(() => callback(), 0);
      return Promise.resolve();
    },
  };

  return storage;
}

/**
 * Creates a stateful mock of chrome.tabs.
 * Tracks tabs in an internal Map. Supports create, get, query, update, remove, sendMessage.
 */
export function createTabsMock() {
  const _tabs = new Map();
  let _nextId = 1;

  const tabs = {
    _tabs,
    _nextId,

    create(properties, callback) {
      const tab = {
        id: _nextId++,
        url: properties?.url || 'about:blank',
        title: '',
        status: 'complete',
        active: properties?.active !== undefined ? properties.active : false,
        windowId: 1,
        openerTabId: properties?.openerTabId || null,
        pinned: false,
        highlighted: false,
        incognito: false,
      };
      _tabs.set(tab.id, tab);
      if (callback) setTimeout(() => callback(tab), 0);
      return Promise.resolve(tab);
    },

    get(tabId, callback) {
      const tab = _tabs.get(tabId) || null;
      if (callback) setTimeout(() => callback(tab), 0);
      return Promise.resolve(tab);
    },

    query(queryInfo, callback) {
      let results = Array.from(_tabs.values());
      if (queryInfo) {
        if (queryInfo.active !== undefined) results = results.filter(t => t.active === queryInfo.active);
        if (queryInfo.currentWindow !== undefined) results = results.filter(t => t.windowId === 1);
        if (queryInfo.url) results = results.filter(t => t.url && t.url.includes(queryInfo.url));
      }
      if (callback) setTimeout(() => callback(results), 0);
      return Promise.resolve(results);
    },

    update(tabId, properties, callback) {
      const tab = _tabs.get(tabId);
      if (tab) {
        Object.assign(tab, properties);
        // Fire onUpdated if status changed
        if (properties.status) {
          chrome.tabs.onUpdated.fire(tabId, { status: properties.status });
        }
      }
      if (callback) setTimeout(() => callback(tab), 0);
      return Promise.resolve(tab);
    },

    remove(tabIds, callback) {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      ids.forEach(id => {
        _tabs.delete(id);
        chrome.tabs.onRemoved.fire(id, { windowId: 1, isWindowClosing: false });
      });
      if (callback) setTimeout(() => callback(), 0);
      return Promise.resolve();
    },

    sendMessage(tabId, message, callback) {
      const response = { ok: true, data: null };
      if (callback) setTimeout(() => callback(response), 0);
      return Promise.resolve(response);
    },

    captureVisibleTab(windowId, options, callback) {
      const dataUrl = 'data:image/jpeg;base64,MOCK_SCREENSHOT';
      if (callback) setTimeout(() => callback(dataUrl), 0);
      return Promise.resolve(dataUrl);
    },
  };

  return tabs;
}

/**
 * Creates a mock of chrome.runtime.
 */
export function createRuntimeMock() {
  const runtime = {
    lastError: null,
    onMessage: new EventListenerPool(),
    onInstalled: new EventListenerPool(),

    sendMessage(message, callback) {
      const response = { ok: true, data: null };
      if (callback) setTimeout(() => callback(response), 0);
      return Promise.resolve(response);
    },

    getURL(path) {
      return `chrome-extension://mock-id/${path || ''}`;
    },
  };

  return runtime;
}

/**
 * Creates a stateful mock of chrome.alarms.
 */
export function createAlarmsMock() {
  const _alarms = new Map();

  const alarms = {
    _alarms,

    create(name, alarmInfo) {
      _alarms.set(name, {
        name,
        scheduledTime: alarmInfo?.when || Date.now(),
        periodInMinutes: alarmInfo?.periodInMinutes || 0,
      });
    },

    get(name, callback) {
      const alarm = _alarms.get(name) || undefined;
      if (callback) setTimeout(() => callback(alarm), 0);
      return Promise.resolve(alarm);
    },

    getAll(callback) {
      const all = Array.from(_alarms.values());
      if (callback) setTimeout(() => callback(all), 0);
      return Promise.resolve(all);
    },

    clear(name, callback) {
      _alarms.delete(name);
      if (callback) setTimeout(() => callback(true), 0);
      return Promise.resolve(true);
    },

    clearAll(callback) {
      _alarms.clear();
      if (callback) setTimeout(() => callback(true), 0);
      return Promise.resolve(true);
    },

    onAlarm: new EventListenerPool(),
  };

  return alarms;
}

/**
 * Creates a mock of chrome.scripting.
 */
export function createScriptingMock() {
  return {
    executeScript(injection, callback) {
      const result = [];
      if (callback) setTimeout(() => callback(result), 0);
      return Promise.resolve(result);
    },
  };
}

/**
 * Creates a mock of chrome.debugger.
 */
export function createDebuggerMock() {
  return {
    attach(target, version, callback) {
      if (callback) setTimeout(() => callback(), 0);
      return Promise.resolve();
    },
    detach(target, callback) {
      if (callback) setTimeout(() => callback(), 0);
      return Promise.resolve();
    },
    sendCommand(target, method, params, callback) {
      const result = { data: 'MOCK_SCREENSHOT_BASE64' };
      if (callback) setTimeout(() => callback(result), 0);
      return Promise.resolve(result);
    },
  };
}

/**
 * Creates a mock of chrome.action.
 */
export function createActionMock() {
  return {
    setIcon(details, callback) {
      if (callback) setTimeout(() => callback(), 0);
    },
    setBadgeText(details, callback) {
      if (callback) setTimeout(() => callback(), 0);
    },
    setBadgeBackgroundColor(details, callback) {
      if (callback) setTimeout(() => callback(), 0);
    },
  };
}

/**
 * Creates a mock of chrome.sidePanel.
 */
export function createSidePanelMock() {
  return {
    open(options, callback) {
      if (callback) setTimeout(() => callback(), 0);
    },
    setOptions(options, callback) {
      if (callback) setTimeout(() => callback(), 0);
    },
  };
}

/**
 * Creates a mock of chrome.webNavigation.
 */
export function createWebNavigationMock() {
  return {
    onBeforeNavigate: new EventListenerPool(),
    getAllFrames(details, callback) {
      const frames = [{ frameId: 0, url: 'about:blank' }];
      if (callback) setTimeout(() => callback(frames), 0);
      return Promise.resolve(frames);
    },
  };
}

/**
 * Assembles all Chrome namespace mocks into a single object.
 * @returns {object} Complete chrome mock with all namespaces
 */
export function createChromeMock() {
  const storage = createStorageMock();
  const local = storage;

  return {
    storage: {
      local,
      session: createStorageMock(),
    },
    tabs: createTabsMock(),
    runtime: createRuntimeMock(),
    alarms: createAlarmsMock(),
    scripting: createScriptingMock(),
    debugger: createDebuggerMock(),
    action: createActionMock(),
    sidePanel: createSidePanelMock(),
    webNavigation: createWebNavigationMock(),
  };
}

/**
 * Sets global.chrome to a fresh mock and returns it for per-test access.
 * Call this in beforeEach() to get a clean Chrome API mock for each test.
 * @returns {object} The chrome mock object
 */
export function setupChromeMock() {
  const mock = createChromeMock();
  global.chrome = mock;
  return mock;
}
