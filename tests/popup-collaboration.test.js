// tests/popup-collaboration.test.js
// Unit tests for popup-modules/collaboration.js — sanitizeFilename, sendMessage,
// downloadJson, downloadText. Uses VM sandbox with mocked chrome/DOM APIs.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mocks shared across tests
let sendMessageCallback;
const clickLog = [];
const revokeLog = [];

function createSandbox() {
  const bodyChildren = [];
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    setTimeout: (fn, ms) => fn(),
    clearTimeout: () => {},
    Blob: class Blob {
      constructor(parts, opts) { this.parts = parts; this.opts = opts; }
    },
    URL: {
      createObjectURL: () => 'blob:mock://test',
      revokeObjectURL: (u) => { revokeLog.push(u); },
    },
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
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          _attrs: {},
          style: { display: '' },
          get type() { return this._attrs.type || ''; },
          set type(v) { this._attrs.type = v; },
          get accept() { return this._attrs.accept || ''; },
          set accept(v) { this._attrs.accept = v; },
          get href() { return this._attrs.href || ''; },
          set href(v) { this._attrs.href = v; },
          get download() { return this._attrs.download || ''; },
          set download(v) { this._attrs.download = v; },
          setAttribute(n, v) { this._attrs[n] = v; },
          getAttribute(n) { return this._attrs[n]; },
          addEventListener() {},
          click() { clickLog.push(this); },
        };
      },
      body: {
        appendChild(c) { bodyChildren.push(c); },
        removeChild(c) { const i = bodyChildren.indexOf(c); if (i >= 0) bodyChildren.splice(i, 1); },
        _children: bodyChildren,
      },
      getElementById: () => null,
      querySelector: () => null,
    },
    showToast: () => {},
    sanitizeHtml: (s) => s,
    escapeHtml: (s) => s,
  };
  sandbox.window = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/collaboration.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'collaboration.js' });
  script.runInContext(sandbox);
  return sandbox;
}

beforeEach(() => {
  sendMessageCallback = null;
  clickLog.length = 0;
  revokeLog.length = 0;
});

describe('sanitizeFilename', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('lowercases input', () => {
    expect(sandbox.sanitizeFilename('MyTemplate')).toBe('mytemplate');
  });

  test('replaces spaces with hyphens', () => {
    expect(sandbox.sanitizeFilename('my cool template')).toBe('my-cool-template');
  });

  test('strips special characters', () => {
    expect(sandbox.sanitizeFilename('test@#$%^&()')).toBe('test');
  });

  test('allows alphanumerics, hyphens, underscores', () => {
    expect(sandbox.sanitizeFilename('hello_world-test 123')).toBe('hello_world-test-123');
  });

  test('defaults to "template" for null input', () => {
    expect(sandbox.sanitizeFilename(null)).toBe('template');
  });

  test('defaults to "template" for undefined input', () => {
    expect(sandbox.sanitizeFilename(undefined)).toBe('template');
  });

  test('defaults to "template" for empty string', () => {
    expect(sandbox.sanitizeFilename('')).toBe('template');
  });

  test('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(sandbox.sanitizeFilename(long).length).toBe(80);
  });

  test('handles string with only special chars', () => {
    expect(sandbox.sanitizeFilename('@#$%')).toBe('');
  });
});

describe('sendMessage', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('sends action in message', () => {
    let capturedMsg;
    sendMessageCallback = (msg, cb) => { capturedMsg = msg; cb({ ok: true, data: 'test' }); };
    return sandbox.sendMessage('test_action', { id: 123 }).then(res => {
      expect(capturedMsg.action).toBe('test_action');
      expect(capturedMsg.id).toBe(123);
      expect(res.ok).toBe(true);
    });
  });

  test('resolves with response data', () => {
    sendMessageCallback = (msg, cb) => { cb({ ok: true, data: { name: 'result' } }); };
    return sandbox.sendMessage('action', {}).then(res => {
      expect(res.data.name).toBe('result');
    });
  });

  test('handles chrome.runtime.lastError', () => {
    sendMessageCallback = (msg, cb) => {
      sandbox.chrome.runtime.lastError = { message: 'Extension context invalidated' };
      cb(undefined);
      sandbox.chrome.runtime.lastError = null;
    };
    return sandbox.sendMessage('action', {}).then(res => {
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Extension context invalidated');
    });
  });

  test('returns default error for null response', () => {
    sendMessageCallback = (msg, cb) => { cb(null); };
    return sandbox.sendMessage('action', {}).then(res => {
      expect(res.ok).toBe(false);
      expect(res.error).toBe('No response');
    });
  });
});

describe('downloadJson', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('creates blob and triggers download', () => {
    sandbox.downloadJson({ test: true }, 'file.json');
    expect(clickLog.length).toBe(1);
    expect(clickLog[0].download).toBe('file.json');
    expect(clickLog[0].href).toBe('blob:mock://test');
  });

  test('revokes object URL after download', () => {
    sandbox.downloadJson({ a: 1 }, 'test.json');
    expect(revokeLog).toContain('blob:mock://test');
  });
});

describe('downloadText', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('downloads text content with mime type', () => {
    sandbox.downloadText('# Report', 'report.md', 'text/markdown');
    expect(clickLog.length).toBe(1);
    expect(clickLog[0].download).toBe('report.md');
  });

  test('revokes object URL', () => {
    sandbox.downloadText('content', 'f.txt', 'text/plain');
    expect(revokeLog).toContain('blob:mock://test');
  });
});
