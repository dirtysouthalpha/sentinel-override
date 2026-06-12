// tests/boot-catcher.test.js
// Unit tests for popup-modules/boot-catcher.js.
// The module has no exports — it runs as a side-effect script that attaches
// global error/rejection listeners and a boot-time diagnostic setTimeout.
// We load it via vm.Script so we can fully control the DOM and chrome APIs.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    id: '',
    _textContent: '',
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = v == null ? '' : String(v); },
    _placeholder: '',
    get placeholder() { return this._placeholder; },
    set placeholder(v) { this._placeholder = v == null ? '' : String(v); },
    style: { cssText: '' },
    _prependedBy: null,
  };
}

/**
 * Build a fresh sandbox for each test. `opts` can override specific pieces.
 *
 * @param {object} opts
 * @param {boolean} opts.hasGoalInput  - whether document contains #goalInput (default true)
 * @param {boolean} opts.hasSendBtn    - whether document contains #sendBtn (default true)
 * @param {boolean} opts.hasBannerDiv  - whether #__sentinel-boot-err already exists (default false)
 * @param {object}  opts.pingResponse  - value returned by chrome.runtime.sendMessage callback
 * @param {boolean} opts.pingThrows    - if true, sendMessage throws instead of calling cb
 * @param {object}  opts.pingLastError - value of chrome.runtime.lastError inside ping callback
 * @param {object}  opts.storageResult - value returned by chrome.storage.local.get
 * @param {boolean} opts.storageLastError - if true, set chrome.runtime.lastError in storage cb
 */
function makeSandbox(opts = {}) {
  const {
    hasGoalInput = true,
    hasSendBtn   = true,
    hasBannerDiv = false,
    pingResponse  = { pong: true },
    pingThrows    = false,
    pingLastError = null,
    storageResult = {},
    storageLastError = false,
  } = opts;

  const goalInput  = hasGoalInput ? makeEl('input')  : null;
  const sendBtn    = hasSendBtn   ? makeEl('button') : null;
  let   bannerEl   = hasBannerDiv ? makeEl('div')    : null;
  let   capturedTimeoutCb = null;
  const eventHandlers = {};
  const bannerPrepended = [];

  const sandbox = {
    // ── globals the script touches ───────────────────────────────────────────
    console: { log() {}, warn() {}, error() {} },

    addEventListener(type, fn) { eventHandlers[type] = fn; },

    setTimeout(fn, _delay) {
      capturedTimeoutCb = fn;
      return 1;
    },
    clearTimeout() {},

    document: {
      getElementById(id) {
        if (id === '__sentinel-boot-err') return bannerEl;
        if (id === 'goalInput') return goalInput;
        if (id === 'sendBtn')   return sendBtn;
        return null;
      },
      createElement(tag) {
        const el = makeEl(tag);
        if (!bannerEl && tag === 'div') bannerEl = el; // capture first div created
        return el;
      },
      body: {
        prepend(el) { bannerPrepended.push(el); },
      },
    },

    chrome: {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          if (pingThrows) throw new Error('sendMessage exploded');
          if (pingLastError) {
            this.lastError = pingLastError;
            if (cb) cb(pingResponse);
            this.lastError = null;
          } else {
            if (cb) cb(pingResponse);
          }
        },
      },
      storage: {
        local: {
          get(_keys, cb) {
            if (storageLastError) {
              sandbox.chrome.runtime.lastError = { message: 'storage error' };
              if (cb) cb(storageResult);
              sandbox.chrome.runtime.lastError = null;
            } else {
              if (cb) cb(storageResult);
            }
          },
        },
      },
    },

    // ── test helpers (not touched by the script itself) ──────────────────────
    _eventHandlers: eventHandlers,
    _bannerPrepended: bannerPrepended,
    _runTimeout() { if (capturedTimeoutCb) capturedTimeoutCb(); },
    _getBanner() { return bannerEl; },
    _goalInput: goalInput,
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadBootCatcher(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/boot-catcher.js'), 'utf8');
  new vm.Script(source, { filename: 'boot-catcher.js' }).runInContext(sandbox);
  return sandbox;
}

// ── window.error handler ────────────────────────────────────────────────────

describe('boot-catcher — window.error handler', () => {
  test('pushes entry to __sentinelErrors when error event fires', () => {
    const sb = loadBootCatcher(makeSandbox());
    sb._eventHandlers['error']({
      message: 'ReferenceError: x is not defined',
      filename: 'popup-full.js',
      lineno: 42,
      colno: 0,
    });
    expect(sb.__sentinelErrors).toHaveLength(1);
    expect(sb.__sentinelErrors[0].type).toBe('error');
    expect(sb.__sentinelErrors[0].message).toContain('ReferenceError');
    expect(sb.__sentinelErrors[0].lineno).toBe(42);
  });

  test('creates banner element and appends text on first error', () => {
    const sb = loadBootCatcher(makeSandbox({ hasBannerDiv: false }));
    sb._eventHandlers['error']({ message: 'oops', filename: 'f.js', lineno: 1, colno: 0 });
    const banner = sb._getBanner();
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('[ERROR]');
    expect(banner.textContent).toContain('oops');
  });

  test('appends to existing banner on second error', () => {
    const sb = loadBootCatcher(makeSandbox({ hasBannerDiv: true }));
    const banner = sb._getBanner();
    sb._eventHandlers['error']({ message: 'err1', filename: 'a.js', lineno: 1, colno: 0 });
    sb._eventHandlers['error']({ message: 'err2', filename: 'b.js', lineno: 2, colno: 0 });
    expect(banner.textContent).toContain('err1');
    expect(banner.textContent).toContain('err2');
  });
});

// ── window.unhandledrejection handler ───────────────────────────────────────

describe('boot-catcher — window.unhandledrejection handler', () => {
  test('uses reason.message when reason has a message property', () => {
    const sb = loadBootCatcher(makeSandbox());
    sb._eventHandlers['unhandledrejection']({ reason: { message: 'Promise boom' } });
    expect(sb.__sentinelErrors[0].type).toBe('unhandledrejection');
    expect(sb.__sentinelErrors[0].message).toBe('Promise boom');
    expect(sb._getBanner().textContent).toContain('Promise boom');
  });

  test('falls back to String(reason) when reason has no message', () => {
    const sb = loadBootCatcher(makeSandbox());
    sb._eventHandlers['unhandledrejection']({ reason: 'plain string reason' });
    expect(sb.__sentinelErrors[0].message).toBe('plain string reason');
  });

  test('handles null reason gracefully', () => {
    const sb = loadBootCatcher(makeSandbox());
    expect(() => {
      sb._eventHandlers['unhandledrejection']({ reason: null });
    }).not.toThrow();
    expect(sb.__sentinelErrors[0].message).toBe('null');
  });
});

// ── setTimeout diagnostic callback ──────────────────────────────────────────

describe('boot-catcher — setTimeout diagnostic: boot-error count banner', () => {
  test('shows boot-error count banner when errors exist', () => {
    const sb = loadBootCatcher(makeSandbox());
    // Manually populate sentinelErrors as the handler would
    sb.__sentinelErrors.push({ type: 'error', message: 'pre-existing error' });
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('Boot errors: 1');
  });

  test('does not add boot-error banner when no errors exist', () => {
    const sb = loadBootCatcher(makeSandbox());
    sb._runTimeout();
    const text = sb._getBanner()?.textContent || '';
    expect(text).not.toContain('Boot errors:');
  });
});

describe('boot-catcher — setTimeout diagnostic: missing DOM elements', () => {
  test('shows goalInput NOT FOUND banner when #goalInput is absent', () => {
    const sb = loadBootCatcher(makeSandbox({ hasGoalInput: false }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[DIAG] goalInput NOT FOUND');
  });

  test('shows sendBtn NOT FOUND banner when #sendBtn is absent', () => {
    const sb = loadBootCatcher(makeSandbox({ hasSendBtn: false }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[DIAG] sendBtn NOT FOUND');
  });

  test('does not show DOM-missing banners when both elements exist', () => {
    const sb = loadBootCatcher(makeSandbox());
    sb._runTimeout();
    const text = sb._getBanner()?.textContent || '';
    expect(text).not.toContain('NOT FOUND');
  });
});

describe('boot-catcher — setTimeout diagnostic: service-worker ping', () => {
  test('shows NOT REACHABLE when chrome.runtime.lastError is set in ping callback', () => {
    const sb = loadBootCatcher(makeSandbox({
      pingLastError: { message: 'Extension context invalidated' },
      pingResponse: undefined,
    }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[SW] NOT REACHABLE');
    expect(sb._getBanner().textContent).toContain('Extension context invalidated');
  });

  test('shows unexpected-response banner when response has no pong', () => {
    const sb = loadBootCatcher(makeSandbox({ pingResponse: { ok: false } }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[SW] Unexpected response');
  });

  test('shows no SW banner when ping succeeds with pong:true', () => {
    const sb = loadBootCatcher(makeSandbox({ pingResponse: { pong: true } }));
    sb._runTimeout();
    const text = sb._getBanner()?.textContent || '';
    expect(text).not.toContain('[SW]');
  });

  test('shows Ping-threw banner when sendMessage throws', () => {
    const sb = loadBootCatcher(makeSandbox({ pingThrows: true }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[SW] Ping threw');
    expect(sb._getBanner().textContent).toContain('sendMessage exploded');
  });
});

describe('boot-catcher — setTimeout diagnostic: API key check (hasKey logic)', () => {
  test('shows OK banner when providers[activeId].api_key exists', () => {
    const sb = loadBootCatcher(makeSandbox({
      storageResult: {
        active_provider: 'anthropic',
        providers: { anthropic: { api_key: 'sk-ant-test' } },
      },
    }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[OK] Provider: anthropic');
  });

  test('shows OK banner when legacy api_key present (no providers object)', () => {
    const sb = loadBootCatcher(makeSandbox({
      storageResult: { api_key: 'legacy-key-abc' },
    }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[OK] Provider: legacy');
  });

  test('shows CONFIG banner and sets placeholder when no key found', () => {
    const sb = loadBootCatcher(makeSandbox({ storageResult: {} }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[CONFIG] No API key found');
    expect(sb._goalInput.placeholder).toContain('API key');
  });

  test('shows CONFIG banner when active_provider set but providers object missing', () => {
    const sb = loadBootCatcher(makeSandbox({
      storageResult: { active_provider: 'openai' },
    }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[CONFIG] No API key found');
  });

  test('shows CONFIG banner when providers exist but active provider has no api_key', () => {
    const sb = loadBootCatcher(makeSandbox({
      storageResult: {
        active_provider: 'openai',
        providers: { openai: { model: 'gpt-4o' } }, // no api_key
      },
    }));
    sb._runTimeout();
    expect(sb._getBanner().textContent).toContain('[CONFIG] No API key found');
  });
});

describe('boot-catcher — __showBootBanner: no body branch', () => {
  test('does not throw when document.body is null and banner does not exist', () => {
    const sb = makeSandbox();
    sb.document.body = null;   // no body
    loadBootCatcher(sb);
    // Firing an error event calls __showBootBanner — should not crash
    expect(() => {
      sb._eventHandlers['error']({ message: 'no body test', filename: 'x.js', lineno: 1, colno: 0 });
    }).not.toThrow();
    // Banner could not be created, so no banner
    expect(sb._getBanner()).toBeNull();
  });
});
