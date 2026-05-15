// Sentinel Override v3 — Tab Manager
// Tab locking, page load waiting, content script injection, screenshot capture.
// Imports from message-protocol.js only (no circular dependency risk).

// ========== Page Load Waiting ==========
let pageLoadConfig = {
  pageLoadTimeout: 25000
};

export function setPageLoadConfig(config) {
  pageLoadConfig = { ...pageLoadConfig, ...config };
}

export async function waitForPageLoad(tabId) {
  const tab = await new Promise(resolve => { chrome.tabs.get(tabId, (i) => { resolve(chrome.runtime.lastError ? null : i); }); });
  if (!tab || tab.status === 'complete') return;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, pageLoadConfig.pageLoadTimeout);
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timeout); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ========== Content Script Injection ==========
export function createContentScriptListener(tabId, timeout = 3000) {
  let timer, listener, resolved = false;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => { if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); resolve(false); }, timeout);
    listener = (msg, sender) => {
      if (msg.action === 'content_script_ready' && sender.tab && sender.tab.id === tabId) {
        if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); clearTimeout(timer); resolve(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
  return { promise, cancel() { if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); clearTimeout(timer); } };
}

/**
 * Inject the content script into the target tab, with retry logic.
 * Returns true if the content script signaled ready, false otherwise.
 *
 * @param {number} tabId
 * @param {number} [maxAttempts=3]
 * @returns {Promise<boolean>}
 */
const CONTENT_SCRIPT_FILES = [
  'content/dom-utils.js',
  'content/shadow-dom.js',
  'content/highlight.js',
  'content/cursor.js',
  'content/wait-utils.js',
  'content/dropdown-utils.js',
  'content/special-inputs.js',
  'content/overlay-detector.js',
  'content/frame-manager.js',
  'content/index.js'
];

export async function injectContentScript(tabId, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const csListener = createContentScriptListener(tabId);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
      const scriptReady = await csListener.promise;
      if (scriptReady) return true;
    } catch (err) { csListener.cancel(); }
    await sleep(500);
  }
  return false;
}

// ========== Message Sending with Retry ==========
export async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      // Unwrap the content-script envelope: { ok: true, data: <actual> }
      if (response && response.ok === false) {
        throw new Error(response.error || 'Content script error');
      }
      // Unwrap outer envelope
      let data = response && response.data !== undefined ? response.data : response;
      // Unwrap inner execute_command wrapper: { result: <string> }
      // Content script returns { result } for execute_command actions
      if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 1 && 'result' in data) {
        data = data.result;
      }
      return data;
    } catch (err) {
      if (i < maxRetries - 1) {
        const csListener = createContentScriptListener(tabId, 2000);
        try { await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES }); await csListener.promise; } catch (e) { csListener.cancel(); }
        await sleep(500 * (i + 1));
      } else { throw err; }
    }
  }
}

// ========== Screenshot Capture ==========
// CDP debugger attachment tracking — keep one attachment per tab for the duration
// of an agent run, instead of attach/detach on every screenshot. This avoids the
// CDP banner shifting viewport pixels by ~30px between captures.
const attachedDebuggees = new Set();
const userDetachedTabs = new Set(); // tabs where the user dismissed the CDP banner
let onDetachListenerInstalled = false;

// (3.7.0) Per-tab observability buffers for read_console_messages and
// read_network_requests. Keys are tabIds; values are bounded ring-buffers
// of recent entries. Listener installation is tracked per-tab so we don't
// double-subscribe across re-attaches.
const consoleBuffers = new Map();   // tabId -> Array<{level,text,url,line,ts}>
const networkBuffers = new Map();   // tabId -> Map<requestId, {method,url,status,duration,startTs,endTs,type}>
const observabilityListenersInstalled = new Set(); // tabIds
const CONSOLE_BUFFER_MAX = 200;
const NETWORK_BUFFER_MAX = 200;

function pushConsoleEntry(tabId, entry) {
  let buf = consoleBuffers.get(tabId);
  if (!buf) { buf = []; consoleBuffers.set(tabId, buf); }
  buf.push(entry);
  while (buf.length > CONSOLE_BUFFER_MAX) buf.shift();
}

function recordNetworkStart(tabId, params) {
  let buf = networkBuffers.get(tabId);
  if (!buf) { buf = new Map(); networkBuffers.set(tabId, buf); }
  if (!params || !params.requestId) return;
  buf.set(params.requestId, {
    method: (params.request && params.request.method) || '',
    url: (params.request && params.request.url) || '',
    type: params.type || '',
    status: 0,
    startTs: Date.now(),
    endTs: 0,
    duration: 0,
    failed: false,
    errorText: ''
  });
  // Bound the map size by trimming oldest entries.
  if (buf.size > NETWORK_BUFFER_MAX) {
    const it = buf.keys();
    let toRemove = buf.size - NETWORK_BUFFER_MAX;
    while (toRemove-- > 0) {
      const k = it.next().value;
      if (k !== undefined) buf.delete(k);
    }
  }
}
function recordNetworkResponse(tabId, params) {
  const buf = networkBuffers.get(tabId);
  if (!buf || !params || !params.requestId) return;
  const e = buf.get(params.requestId);
  if (!e) return;
  e.status = (params.response && params.response.status) || 0;
  e.endTs = Date.now();
  e.duration = e.endTs - e.startTs;
}
function recordNetworkFailure(tabId, params) {
  const buf = networkBuffers.get(tabId);
  if (!buf || !params || !params.requestId) return;
  const e = buf.get(params.requestId);
  if (!e) return;
  e.failed = true;
  e.errorText = params.errorText || 'failed';
  e.endTs = Date.now();
  e.duration = e.endTs - e.startTs;
}

// Install Log + Network listeners on a tab once. Caller must already have
// chrome.debugger attached (we just enable the domains and wire the events).
async function ensureObservabilityListeners(tabId) {
  if (observabilityListenersInstalled.has(tabId)) return;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
  } catch (e) { /* may not be supported on this target */ }
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  } catch (e) {}
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  } catch (e) {}
  observabilityListenersInstalled.add(tabId);
}

// Single global event hook: chrome.debugger fires onEvent for every attached
// target. We dispatch into per-tab buffers based on source.tabId.
let __obsEventHookInstalled = false;
function installObservabilityEventHook() {
  if (__obsEventHookInstalled) return;
  __obsEventHookInstalled = true;
  try {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (!source || typeof source.tabId !== 'number') return;
      const tabId = source.tabId;
      try {
        if (method === 'Log.entryAdded' && params && params.entry) {
          const e = params.entry;
          pushConsoleEntry(tabId, {
            level: e.level || 'info',
            text: String(e.text || '').substring(0, 1000),
            url: e.url || '',
            line: e.lineNumber || 0,
            ts: Date.now()
          });
        } else if (method === 'Runtime.consoleAPICalled' && params) {
          // console.log/error/warn/info — most app-level logs come through here
          const args = (params.args || []).map(a => {
            if (a && a.value !== undefined) return String(a.value);
            if (a && a.description) return String(a.description);
            return '';
          }).join(' ').substring(0, 1000);
          pushConsoleEntry(tabId, {
            level: params.type || 'log',
            text: args,
            url: '',
            line: 0,
            ts: Date.now()
          });
        } else if (method === 'Runtime.exceptionThrown' && params && params.exceptionDetails) {
          const ex = params.exceptionDetails;
          const txt = (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || 'exception';
          pushConsoleEntry(tabId, {
            level: 'error',
            text: String(txt).substring(0, 1000),
            url: ex.url || '',
            line: ex.lineNumber || 0,
            ts: Date.now()
          });
        } else if (method === 'Network.requestWillBeSent') {
          recordNetworkStart(tabId, params);
        } else if (method === 'Network.responseReceived') {
          recordNetworkResponse(tabId, params);
        } else if (method === 'Network.loadingFailed') {
          recordNetworkFailure(tabId, params);
        }
      } catch (e) { /* swallow per-event errors so one bad event can't disable the hook */ }
    });
  } catch (e) { /* chrome.debugger unavailable in some test contexts */ }
}

// Public reads.
export function readConsoleMessages(tabId, options) {
  const buf = consoleBuffers.get(tabId) || [];
  const limit = (options && Number(options.limit)) || 50;
  const filter = options && options.filter;
  let out = buf.slice();
  if (filter === 'error' || filter === 'errors') {
    out = out.filter(e => /error|severe|critical/i.test(e.level));
  } else if (filter === 'warning' || filter === 'warn') {
    out = out.filter(e => /warn/i.test(e.level));
  }
  return out.slice(-limit);
}

export function readNetworkRequests(tabId, options) {
  const buf = networkBuffers.get(tabId);
  if (!buf) return [];
  const limit = (options && Number(options.limit)) || 30;
  const filter = options && options.filter;
  const urlIncludes = options && options.url_includes;
  let arr = Array.from(buf.values());
  if (filter === 'failed') {
    arr = arr.filter(e => e.failed || (e.status >= 400));
  } else if (filter === '4xx') {
    arr = arr.filter(e => e.status >= 400 && e.status < 500);
  } else if (filter === '5xx') {
    arr = arr.filter(e => e.status >= 500);
  }
  if (urlIncludes && typeof urlIncludes === 'string') {
    const needle = urlIncludes.toLowerCase();
    arr = arr.filter(e => (e.url || '').toLowerCase().includes(needle));
  }
  // Most-recent first
  arr.sort((a, b) => b.startTs - a.startTs);
  return arr.slice(0, limit).map(e => ({
    method: e.method,
    url: e.url.substring(0, 300),
    status: e.status,
    type: e.type,
    duration_ms: e.duration,
    failed: e.failed,
    error: e.errorText || ''
  }));
}

export function clearObservabilityBuffers(tabId) {
  consoleBuffers.delete(tabId);
  networkBuffers.delete(tabId);
  observabilityListenersInstalled.delete(tabId);
}


function installDetachListenerOnce() {
  if (onDetachListenerInstalled) return;
  onDetachListenerInstalled = true;
  try {
    chrome.debugger.onDetach.addListener((source /*, reason */) => {
      // If the user manually detaches via the debugger banner, drop our tracking
      // and remember this tab so we can warn the user on next re-attach.
      if (source && typeof source.tabId === 'number') {
        attachedDebuggees.delete(source.tabId);
        clearObservabilityBuffers(source.tabId);
        userDetachedTabs.add(source.tabId);
      }
    });
  } catch (e) { /* in non-extension contexts (tests) chrome.debugger may be absent */ }
}

/**
 * Detach chrome.debugger from all tabs we've attached to.
 * Call from agent-engine cleanup paths (loop end, stop, error).
 */
export async function detachAllDebuggees() {
  const ids = Array.from(attachedDebuggees);
  attachedDebuggees.clear();
  for (const tabId of ids) {
    try { await chrome.debugger.detach({ tabId }); } catch (e) { /* may already be gone */ }
  }
}

// ========== CDP Trusted Input Dispatch (#9) ==========
// Opt-in trusted-input path. When the user enables `useTrustedInput`, the
// agent engine routes click/type/press_key through chrome.debugger so events
// are dispatched with `isTrusted: true`. Sites with strict event verification
// (reCAPTCHA, paywalls, OAuth, banks) accept these where synthetic content
// script events get rejected.
//
// Reuses the `attachedDebuggees` set above so we don't double-attach. We
// never detach here -- detachAllDebuggees() handles cleanup at agent end.

async function ensureDebuggerAttached(tabId) {
  installDetachListenerOnce();
  installObservabilityEventHook();
  if (attachedDebuggees.has(tabId)) {
    await ensureObservabilityListeners(tabId);
    return;
  }
  const wasUserDetached = userDetachedTabs.has(tabId);
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedDebuggees.add(tabId);
  await ensureObservabilityListeners(tabId);
  // Warn the user that the debugger re-attached after they dismissed the banner,
  // so they're aware trusted input is active again.
  if (wasUserDetached) {
    userDetachedTabs.delete(tabId);
    try {
      chrome.runtime.sendMessage({
        action: 'cdp_reattach_warning',
        tabId,
        message: 'Debugger re-attached after banner was dismissed. Trusted input is active. Dismiss this banner again to fall back to synthetic events.'
      }).catch(() => {});
    } catch (e) { console.warn('[tab-manager] CDP reattach warning broadcast failed:', e.message); }
  }
}

/**
 * Dispatch a trusted mouse click at (x, y) in CSS pixels via CDP.
 * Sends Input.dispatchMouseEvent type='mousePressed' then 'mouseReleased'
 * with a small delay between to mimic a real click.
 *
 * @param {number} tabId
 * @param {number} x - CSS pixels (NOT image pixels). Caller must already
 *                     have divided screenshot coordinates by dpr.
 * @param {number} y - CSS pixels.
 * @param {object} [options]
 * @param {string} [options.button='left']  - 'left' | 'right' | 'middle'
 * @param {number} [options.clickCount=1]
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function cdpDispatchClick(tabId, x, y, options = {}) {
  const button = options.button || 'left';
  const clickCount = options.clickCount || 1;
  try {
    await ensureDebuggerAttached(tabId);

    // (G1) Pre-click visual feedback. Notify the content script so it can
    // animate the virtual cursor to (x, y), highlight the element under the
    // pointer, and show the click pulse — visuals the synthetic-events path
    // gets for free, but the CDP path used to skip entirely.
    if (options.skipVisual !== true) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'cdp_pre_click_visual',
          x: Number(x) || 0,
          y: Number(y) || 0,
          description: options.description || ('Clicking at (' + Math.round(x) + ', ' + Math.round(y) + ')')
        });
      } catch (e) { /* content script may not be ready on first frame */ }
      // Brief pause so the user sees the cursor arrive + element light up
      // before the click actually fires.
      await sleep(220);
    }

    const base = { x: Number(x) || 0, y: Number(y) || 0, button, clickCount };
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await sleep(50);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// Map a key name to CDP key params. Returns null when unknown so caller
// can fall through to insertText / synthetic dispatch.
function cdpKeyParamsFor(key) {
  if (!key) return null;
  const k = String(key);
  const SPECIAL = {
    'Enter':      { key: 'Enter',      code: 'Enter',      windowsVirtualKeyCode: 13, text: '\r' },
    'Return':     { key: 'Enter',      code: 'Enter',      windowsVirtualKeyCode: 13, text: '\r' },
    'Tab':        { key: 'Tab',        code: 'Tab',        windowsVirtualKeyCode:  9 },
    'Escape':     { key: 'Escape',     code: 'Escape',     windowsVirtualKeyCode: 27 },
    'Esc':        { key: 'Escape',     code: 'Escape',     windowsVirtualKeyCode: 27 },
    'Backspace':  { key: 'Backspace',  code: 'Backspace',  windowsVirtualKeyCode:  8 },
    'Delete':     { key: 'Delete',     code: 'Delete',     windowsVirtualKeyCode: 46 },
    'Del':        { key: 'Delete',     code: 'Delete',     windowsVirtualKeyCode: 46 },
    'ArrowDown':  { key: 'ArrowDown',  code: 'ArrowDown',  windowsVirtualKeyCode: 40 },
    'ArrowUp':    { key: 'ArrowUp',    code: 'ArrowUp',    windowsVirtualKeyCode: 38 },
    'ArrowLeft':  { key: 'ArrowLeft',  code: 'ArrowLeft',  windowsVirtualKeyCode: 37 },
    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    'Down':       { key: 'ArrowDown',  code: 'ArrowDown',  windowsVirtualKeyCode: 40 },
    'Up':         { key: 'ArrowUp',    code: 'ArrowUp',    windowsVirtualKeyCode: 38 },
    'Left':       { key: 'ArrowLeft',  code: 'ArrowLeft',  windowsVirtualKeyCode: 37 },
    'Right':      { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    'Home':       { key: 'Home',       code: 'Home',       windowsVirtualKeyCode: 36 },
    'End':        { key: 'End',        code: 'End',        windowsVirtualKeyCode: 35 },
    'PageUp':     { key: 'PageUp',     code: 'PageUp',     windowsVirtualKeyCode: 33 },
    'PageDown':   { key: 'PageDown',   code: 'PageDown',   windowsVirtualKeyCode: 34 },
    ' ':          { key: ' ',          code: 'Space',      windowsVirtualKeyCode: 32, text: ' ' },
    'Space':      { key: ' ',          code: 'Space',      windowsVirtualKeyCode: 32, text: ' ' },
  };
  if (SPECIAL[k]) return SPECIAL[k];
  // Single printable char fallback
  if (k.length === 1) {
    const code = k.charCodeAt(0);
    return { key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: code, text: k };
  }
  return null;
}

/**
 * Dispatch a trusted key press via CDP. Sends keyDown then keyUp.
 *
 * @param {number} tabId
 * @param {string} key - 'Enter' | 'Tab' | 'Escape' | 'ArrowDown' | etc.
 * @param {object} [options] - reserved for future modifiers support.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function cdpDispatchKey(tabId, key, options = {}) {
  const params = cdpKeyParamsFor(key);
  if (!params) return { ok: false, error: 'Unknown key: ' + key };
  try {
    await ensureDebuggerAttached(tabId);
    // For keys with `text` (Enter, Space, printable chars) use 'keyDown' so the
    // event has both keyboard and text dispatch. For pure control keys (Tab,
    // Escape, arrows, etc.) use 'rawKeyDown' to avoid generating a text event.
    const downType = params.text ? 'keyDown' : 'rawKeyDown';
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: downType });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * Dispatch trusted text entry via CDP. Uses Input.insertText for the bulk
 * of the text (which dispatches proper trusted input events) and falls back
 * to per-character dispatchKeyEvent for any character insertText rejects.
 *
 * Caller is responsible for focusing the target element first (either via
 * the content script or via a preceding cdpDispatchClick).
 *
 * @param {number} tabId
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.perCharKeyEvents=false] - if true, also dispatch
 *        keyDown/keyUp per character (slower, but triggers more handlers).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function cdpDispatchType(tabId, text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: true };
  }
  try {
    await ensureDebuggerAttached(tabId);

    // (G2) Default per-char dispatch for short strings so the user can SEE
    // the agent typing — same UX as the synthetic-events path. Long strings
    // (URLs, pasted blocks > 40 chars) use the fast Input.insertText path
    // because watching 200 chars get typed one-at-a-time wastes time.
    const explicitOff = options.perCharKeyEvents === false;
    const usePerChar = !explicitOff && (options.perCharKeyEvents === true || text.length <= 40);

    if (usePerChar) {
      // Pace banner updates: every char for very short strings, every Nth
      // char for medium strings so the popup stream isn't spammy.
      const updateInterval = Math.max(1, Math.floor(text.length / 12));

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        // Stream typing-progress to the content script so showTypingBanner
        // can update with the current position.
        if (i % updateInterval === 0 || i === text.length - 1) {
          try {
            await chrome.tabs.sendMessage(tabId, {
              action: 'cdp_typing_progress',
              text,
              position: i + 1
            });
          } catch (e) { /* non-fatal */ }
        }

        if (ch === '\n' || ch === '\r') {
          await cdpDispatchKey(tabId, 'Enter');
        } else {
          const params = cdpKeyParamsFor(ch) || {
            key: ch,
            code: 'Key' + ch.toUpperCase(),
            windowsVirtualKeyCode: ch.charCodeAt(0),
            text: ch
          };
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: 'keyDown' });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
        }

        // Human-ish typing pace: fast for medium strings, slightly slower
        // with thinking pauses for short strings so it reads naturally.
        let delay;
        if (text.length > 25) {
          delay = 22 + Math.floor(Math.random() * 22);
        } else if (i > 0 && i % 6 === 0) {
          delay = 80 + Math.floor(Math.random() * 80); // thinking pause
        } else {
          delay = 40 + Math.floor(Math.random() * 50);
        }
        await sleep(delay);
      }
      return { ok: true };
    }

    // Fast path: single Input.insertText call. CDP dispatches trusted
    // input/beforeinput events for the inserted text in one shot.
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * Execute arbitrary JS in the page's MAIN world via CDP Runtime.evaluate.
 *
 * This is the canonical bypass for sites with strict Content Security Policies
 * (script-src without 'unsafe-inline' / 'unsafe-eval'). The <script>-tag
 * injection used by content/index.js execute_js gets blocked by such CSPs,
 * silently failing and producing a timeout. CDP Runtime.evaluate has elevated
 * privileges and bypasses page CSP entirely, so the code actually runs.
 *
 * Used by agent-engine.js as the preferred path for execute_js. Falls back
 * to the content-script script-tag injection only if CDP fails (e.g.,
 * chrome:// pages where debugger.attach is denied).
 *
 * @param {number} tabId
 * @param {string} code - JS source. Wrapped in `(async () => { ... })()`
 *                        so `return` and top-level await both work.
 * @param {object} [options]
 * @param {number} [options.timeout=8000] - Hard wall-clock timeout in ms.
 *                                          Clamped to [500, 60000].
 * @returns {Promise<{ok: boolean, value?: any, error?: string, cspBlocked?: boolean}>}
 */
export async function cdpExecuteJs(tabId, code, options = {}) {
  if (typeof code !== 'string' || code.length === 0) {
    return { ok: false, error: 'No code provided' };
  }
  const timeout = Math.max(500, Math.min(60000, Number(options.timeout) || 8000));
  try {
    await ensureDebuggerAttached(tabId);
    const expression = '(async () => { ' + code + ' \n })()';
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout
    });
    if (result && result.exceptionDetails) {
      const ex = result.exceptionDetails;
      const msg = (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || 'Runtime exception';
      return { ok: false, error: String(msg).slice(0, 500) };
    }
    const value = result && result.result ? result.result.value : undefined;
    return { ok: true, value };
  } catch (err) {
    const msg = (err && err.message) || String(err);
    // Detect chrome:// / extension page where debugger.attach is denied.
    return { ok: false, error: msg, cspBlocked: false, attachDenied: /Cannot access|chrome:\/\/|extension/i.test(msg) };
  }
}

/**
 * Take a screenshot of the given tab using CDP, with captureVisibleTab as fallback.
 * On the FIRST screenshot for a tab, attaches the debugger and keeps it attached
 * for the rest of the agent run. Subsequent screenshots reuse the attachment.
 *
 * (#11) DPR-aware: queries the content script for live viewport CSS-pixel
 * dimensions, devicePixelRatio, and scroll offsets, and bundles them with the
 * captured base64 image so downstream consumers can correlate screenshot pixels
 * to CSS coordinates correctly on HiDPI displays.
 *
 * Returns { base64Image, width, height, dpr, scrollX, scrollY, capturedAt, url }
 * or null if screenshot fails. Width/height are in CSS pixels (NOT image pixels).
 *
 * @param {number} tabId
 * @param {number} windowId
 * @param {string} currentUrl - The current URL (for caching)
 * @param {object} screenshotCache - { cachedSnapshot, lastScreenshotUrl } mutable ref;
 *                                   legacy { cachedBase64Image } is also accepted on read
 * @param {object} CONFIG - { screenshotQuality, screenshotCache }
 * @param {number} stepNumber - For status messages
 * @param {function} sendSilentUpdateFn - Reference to sendSilentUpdate
 * @returns {Promise<{ base64Image: string, width: number, height: number, dpr: number, scrollX: number, scrollY: number, capturedAt: number, url: string }|null>}
 */
export async function takeScreenshot(tabId, windowId, currentUrl, screenshotCache, CONFIG, stepNumber, sendSilentUpdateFn) {
  // (#11) Cache hit: prefer the new cachedSnapshot object; fall back to the
  // legacy cachedBase64Image string for backward compatibility on first run
  // after upgrade.
  if (CONFIG.screenshotCache && screenshotCache.lastScreenshotUrl === currentUrl) {
    if (screenshotCache.cachedSnapshot && screenshotCache.cachedSnapshot.base64Image) {
      return { ...screenshotCache.cachedSnapshot, url: currentUrl };
    }
    if (screenshotCache.cachedBase64Image) {
      // Legacy cache shape — wrap in the new object form.
      return {
        base64Image: screenshotCache.cachedBase64Image,
        width: 0, height: 0, dpr: 1, scrollX: 0, scrollY: 0,
        capturedAt: Date.now(),
        url: currentUrl
      };
    }
  }

  installDetachListenerOnce();
  installObservabilityEventHook();

  // (#11) Fetch viewport metadata from the content script before capture.
  // We do this BEFORE the screenshot so width/height/dpr describe the same
  // viewport that's about to be photographed. If the content script isn't
  // available (very early load, error pages), fall back to safe defaults.
  let viewport = { width: 0, height: 0, dpr: 1, scrollX: 0, scrollY: 0 };
  try {
    const vp = await sendMessageWithRetry(tabId, { action: 'get_viewport_info' }, 1);
    if (vp && typeof vp === 'object') {
      viewport = {
        width: Number(vp.width) || 0,
        height: Number(vp.height) || 0,
        dpr: Number(vp.dpr) || 1,
        scrollX: Number(vp.scrollX) || 0,
        scrollY: Number(vp.scrollY) || 0
      };
    }
  } catch (e) { /* non-fatal: keep defaults */ }

  let base64Image = null;
  try {
    if (!attachedDebuggees.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedDebuggees.add(tabId);
    }
    try { await ensureObservabilityListeners(tabId); } catch (e) {}
    const screenshotResult = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'jpeg', quality: CONFIG.screenshotQuality });
    base64Image = screenshotResult.data;
  } catch (debuggerErr) {
    // Attachment or capture failed — drop our tracking, attempt a clean detach,
    // then fall back to captureVisibleTab.
    attachedDebuggees.delete(tabId);
    try { await chrome.debugger.detach({ tabId }); } catch(e) { console.warn('[tab-manager] Debugger detach failed in error path:', e.message); }
    try {
      const screenshot_data_url = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: CONFIG.screenshotQuality }, (dataUrl) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(dataUrl);
        });
      });
      base64Image = screenshot_data_url.split(',')[1];
    } catch (err) {
      if (sendSilentUpdateFn) sendSilentUpdateFn('Screenshot skipped (text-only mode)', stepNumber);
      return null;
    }
  }

  if (base64Image) {
    const snapshot = {
      base64Image,
      width: viewport.width,
      height: viewport.height,
      dpr: viewport.dpr,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      capturedAt: Date.now()
    };
    screenshotCache.cachedSnapshot = snapshot;
    screenshotCache.cachedBase64Image = null;
    screenshotCache.lastScreenshotUrl = currentUrl;
    return { ...snapshot, url: currentUrl };
  }
  return null;
}

// ========== Validation ==========
export function isValidUrl(url) {
  try { const p = new URL(url); return ['http:', 'https:'].includes(p.protocol); } catch { return false; }
}

// ========== Tab Info ==========
/**
 * Get tab info with lastError handling.
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getTabInfo(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, (info) => { resolve(chrome.runtime.lastError ? null : info); });
  });
}

// ========== Utilities ==========
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
