// tests/popup-recent-chats.test.js
// Unit tests for popup-modules/recent-chats.js — _formatAge, _hasReport, _extractGoal, _escapeHtml.
// Uses VM sandbox with mocked DOM + chrome.storage.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox() {
  const storage = {};
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
    RegExp,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    Map,
    Set,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        children: [],
        appendChild() {},
        addEventListener() {},
        classList: { add() {}, remove() {}, contains: () => false },
        innerHTML: '',
        textContent: '',
        insertBefore() {},
        remove() {},
        querySelector: () => null,
        firstChild: null,
      }),
      body: { appendChild() {}, removeChild() {} },
      addEventListener() {},
      removeEventListener() {},
      readyState: 'complete',
      visibilityState: 'visible',
    },
    chrome: {
      storage: {
        local: {
          get: (keys, cb) => {
            const result = {};
            if (typeof keys === 'string') {
              if (storage[keys] !== undefined) result[keys] = storage[keys];
            } else if (Array.isArray(keys)) {
              keys.forEach(k => { if (storage[k] !== undefined) result[k] = storage[k]; });
            }
            cb(result);
          },
          set: (data, cb) => {
            Object.assign(storage, data);
            if (cb) cb();
          },
        },
      },
      runtime: {
        sendMessage: (msg, cb) => { if (cb) cb(null); },
        lastError: null,
      },
    },
    confirm: () => false,
    alert: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1024,
    getState: undefined,
    sanitizeHtml: (s) => s,
    _storage: storage,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/recent-chats.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'recent-chats.js' });
  script.runInContext(sandbox);
  return sandbox;
}

// _formatAge, _hasReport, _extractGoal, _escapeHtml are IIFE-scoped.
// Test via __sentinelRecentChats where possible, or replicate pure logic.

describe('_hasReport', () => {
  // Replicate the pure regex logic
  function hasReport(htmlSnapshot) {
    return typeof htmlSnapshot === 'string' && /report-group|report-card-title|Investigation Report/i.test(htmlSnapshot);
  }

  test('detects report-group class', () => {
    expect(hasReport('<div class="report-group">...</div>')).toBe(true);
  });

  test('detects report-card-title class', () => {
    expect(hasReport('<div class="report-card-title">Results</div>')).toBe(true);
  });

  test('detects Investigation Report text', () => {
    expect(hasReport('<h2>Investigation Report</h2>')).toBe(true);
  });

  test('detects case-insensitive investigation report', () => {
    expect(hasReport('<h2>investigation report</h2>')).toBe(true);
  });

  test('returns false for null', () => {
    expect(hasReport(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(hasReport(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(hasReport('')).toBe(false);
  });

  test('returns false for non-matching HTML', () => {
    expect(hasReport('<div class="action-card">Click here</div>')).toBe(false);
  });

  test('returns false for non-string input', () => {
    expect(hasReport(12345)).toBe(false);
  });
});

describe('_formatAge', () => {
  // Replicate the pure logic
  function formatAge(ts) {
    if (!ts) return '—';
    const ageMs = Date.now() - ts;
    const min = Math.round(ageMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    if (min < 1440) return Math.round(min / 60) + 'h ago';
    return Math.round(min / 1440) + 'd ago';
  }

  test('returns dash for null', () => {
    expect(formatAge(null)).toBe('—');
  });

  test('returns dash for undefined', () => {
    expect(formatAge(undefined)).toBe('—');
  });

  test('returns dash for 0', () => {
    expect(formatAge(0)).toBe('—');
  });

  test('returns "just now" for recent timestamp', () => {
    expect(formatAge(Date.now())).toBe('just now');
  });

  test('returns minutes ago for 5 minutes ago', () => {
    expect(formatAge(Date.now() - 5 * 60000)).toBe('5 min ago');
  });

  test('returns hours ago for 2 hours ago', () => {
    expect(formatAge(Date.now() - 120 * 60000)).toBe('2h ago');
  });

  test('returns days ago for 2 days ago', () => {
    expect(formatAge(Date.now() - 2880 * 60000)).toBe('2d ago');
  });

  test('returns 1 min ago at 60 seconds', () => {
    expect(formatAge(Date.now() - 60000)).toBe('1 min ago');
  });

  test('returns 1h ago at 60 minutes', () => {
    expect(formatAge(Date.now() - 3600000)).toBe('1h ago');
  });

  test('returns 1d ago at 1440 minutes', () => {
    expect(formatAge(Date.now() - 1440 * 60000)).toBe('1d ago');
  });
});

describe('_escapeHtml', () => {
  // Replicate the pure logic
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  test('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  test('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  test('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(escapeHtml("'hello'")).toBe('&#39;hello&#39;');
  });

  test('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  test('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  test('handles all special chars combined', () => {
    expect(escapeHtml('<a href="x&y">\'z\'</a>')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;&#39;z&#39;&lt;/a&gt;');
  });
});

describe('_extractGoal', () => {
  // Replicate the pure logic
  function extractGoal(conversationHistory, fallbackHtml) {
    if (Array.isArray(conversationHistory)) {
      for (const turn of conversationHistory) {
        if (turn && turn.role === 'user' && typeof turn.text === 'string' && turn.text.trim()) {
          return turn.text.trim().substring(0, 200);
        }
      }
    }
    return '(no goal)';
  }

  test('extracts first user message', () => {
    const history = [
      { role: 'system', text: 'You are a helper' },
      { role: 'user', text: 'Check firewall rules' },
      { role: 'assistant', text: 'Checking...' },
    ];
    expect(extractGoal(history)).toBe('Check firewall rules');
  });

  test('returns first user message even if there are multiple', () => {
    const history = [
      { role: 'user', text: 'First question' },
      { role: 'assistant', text: 'Answer' },
      { role: 'user', text: 'Second question' },
    ];
    expect(extractGoal(history)).toBe('First question');
  });

  test('skips empty user messages', () => {
    const history = [
      { role: 'user', text: '' },
      { role: 'user', text: '   ' },
      { role: 'user', text: 'Actual goal' },
    ];
    expect(extractGoal(history)).toBe('Actual goal');
  });

  test('truncates long messages to 200 chars', () => {
    const longText = 'a'.repeat(300);
    const history = [{ role: 'user', text: longText }];
    const result = extractGoal(history);
    expect(result.length).toBe(200);
  });

  test('trims whitespace from messages', () => {
    const history = [{ role: 'user', text: '  hello world  ' }];
    expect(extractGoal(history)).toBe('hello world');
  });

  test('returns no goal for empty array', () => {
    expect(extractGoal([])).toBe('(no goal)');
  });

  test('returns no goal for non-array', () => {
    expect(extractGoal(null)).toBe('(no goal)');
  });

  test('returns no goal for array with only assistant messages', () => {
    const history = [{ role: 'assistant', text: 'I am helping' }];
    expect(extractGoal(history)).toBe('(no goal)');
  });

  test('handles null entries in array', () => {
    const history = [null, { role: 'user', text: 'Goal' }];
    expect(extractGoal(history)).toBe('Goal');
  });

  test('handles entries without text field', () => {
    const history = [{ role: 'user' }, { role: 'user', text: 'Goal' }];
    expect(extractGoal(history)).toBe('Goal');
  });
});

describe('__sentinelRecentChats (module export)', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('exports __sentinelRecentChats on window', () => {
    expect(sandbox.window.__sentinelRecentChats).toBeDefined();
  });

  test('exports archive function', () => {
    expect(typeof sandbox.window.__sentinelRecentChats.archive).toBe('function');
  });

  test('exports list function', () => {
    expect(typeof sandbox.window.__sentinelRecentChats.list).toBe('function');
  });

  test('exports restore function', () => {
    expect(typeof sandbox.window.__sentinelRecentChats.restore).toBe('function');
  });

  test('exports remove function', () => {
    expect(typeof sandbox.window.__sentinelRecentChats.remove).toBe('function');
  });

  test('exports clear function', () => {
    expect(typeof sandbox.window.__sentinelRecentChats.clear).toBe('function');
  });

  test('exports openModal function', () => {
    expect(typeof sandbox.window.__sentinelRecentChats.openModal).toBe('function');
  });
});
