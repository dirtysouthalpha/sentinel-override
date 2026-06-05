// tests/popup-client-knowledge.test.js
// Unit tests for popup-modules/client-knowledge.js — _safeEsc, _send, _on/_set/_get.
// Uses VM sandbox with mocked chrome.runtime and document.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let sendMessageCallback;
const eventListeners = {};

function createSandbox() {
  const elements = {};
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    Promise,
    setTimeout: (fn, ms) => fn(),
    clearTimeout: () => {},
    chrome: {
      runtime: {
        sendMessage: (msg, cb) => {
          if (sendMessageCallback) {
            sendMessageCallback(msg, cb);
          } else {
            cb({ ok: true });
          }
        },
        lastError: null,
      },
    },
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { appendChild() {}, removeChild() {} },
      createElement(tag) {
        return { tagName: tag.toUpperCase(), style: {}, _attrs: {} };
      },
    },
    showToast: () => {},
    sanitizeHtml: (s) => s,
    escapeHtml: (s) => s,
    confirm: () => false,
    alert: () => {},
    getErrorMessage(err) {
      if (typeof err === 'string') return err;
      if (typeof err === 'object' && err !== null && typeof err.message === 'string') return err.message;
      return String(err || '');
    },
    _elements: elements,
  };
  sandbox.window = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/client-knowledge.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'client-knowledge.js' });
  script.runInContext(sandbox);
  return sandbox;
}

beforeEach(() => {
  sendMessageCallback = null;
});

describe('_safeEsc', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('escapes ampersands', () => {
    expect(sandbox._safeEsc('a&b')).toBe('a&amp;b');
  });

  test('escapes angle brackets', () => {
    expect(sandbox._safeEsc('<div>')).toBe('&lt;div&gt;');
  });

  test('escapes double quotes', () => {
    expect(sandbox._safeEsc('"hello"')).toBe('&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(sandbox._safeEsc("'hello'")).toBe('&#39;hello&#39;');
  });

  test('returns empty string for null', () => {
    expect(sandbox._safeEsc(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(sandbox._safeEsc(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(sandbox._safeEsc('')).toBe('');
  });

  test('leaves plain text unchanged', () => {
    expect(sandbox._safeEsc('hello world')).toBe('hello world');
  });

  test('converts numbers to strings', () => {
    expect(sandbox._safeEsc(42)).toBe('42');
  });

  test('handles combined special characters', () => {
    expect(sandbox._safeEsc('<a href="x&y">\'z\'</a>')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;&#39;z&#39;&lt;/a&gt;');
  });
});

describe('_send', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('sends action in message', () => {
    let capturedMsg;
    sendMessageCallback = (msg, cb) => { capturedMsg = msg; cb({ ok: true, data: {} }); };
    return sandbox._send('client_list').then(() => {
      expect(capturedMsg.action).toBe('client_list');
    });
  });

  test('merges body into message', () => {
    let capturedMsg;
    sendMessageCallback = (msg, cb) => { capturedMsg = msg; cb({ ok: true }); };
    return sandbox._send('client_get', { id: 'abc123' }).then(() => {
      expect(capturedMsg.id).toBe('abc123');
    });
  });

  test('resolves with response data', () => {
    sendMessageCallback = (msg, cb) => { cb({ ok: true, data: { displayName: 'Test' } }); };
    return sandbox._send('client_get', { id: 'x' }).then(res => {
      expect(res.ok).toBe(true);
      expect(res.data.displayName).toBe('Test');
    });
  });

  test('handles chrome.runtime.lastError', () => {
    sendMessageCallback = (msg, cb) => {
      sandbox.chrome.runtime.lastError = { message: 'Context invalidated' };
      cb(undefined);
      sandbox.chrome.runtime.lastError = null;
    };
    return sandbox._send('action').then(res => {
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Context invalidated');
    });
  });

  test('returns default error for null response', () => {
    sendMessageCallback = (msg, cb) => { cb(null); };
    return sandbox._send('action').then(res => {
      expect(res.ok).toBe(false);
      expect(res.error).toBe('No response');
    });
  });

  test('returns default error for undefined response', () => {
    sendMessageCallback = (msg, cb) => { cb(undefined); };
    return sandbox._send('action').then(res => {
      expect(res.ok).toBe(false);
      expect(res.error).toBe('No response');
    });
  });
});

describe('DOM helpers (_on, _set, _get)', () => {
  let sandbox;
  beforeAll(() => {
    sandbox = createSandbox();
    const mockEl = {
      addEventListener: (ev, fn) => { eventListeners[ev] = fn; },
      textContent: '',
      value: '',
    };
    sandbox._elements['testEl'] = mockEl;
    loadModule(sandbox);
  });

  test('_get returns element by id', () => {
    const el = sandbox._get('testEl');
    expect(el).toBeTruthy();
  });

  test('_get returns null for missing element', () => {
    expect(sandbox._get('nonexistent')).toBeNull();
  });

  test('_set sets property on element', () => {
    sandbox._set('testEl', 'textContent', 'Hello');
    expect(sandbox._elements['testEl'].textContent).toBe('Hello');
  });

  test('_set does nothing for missing element', () => {
    expect(() => sandbox._set('missing', 'textContent', 'x')).not.toThrow();
  });
});
