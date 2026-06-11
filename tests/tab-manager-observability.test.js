/**
 * Tests for tab-manager.js observability buffer functions.
 *
 * Strategy: chrome.debugger.onEvent.addListener is mocked to capture the
 * event listener callback. Calling cdpExecuteJs() triggers ensureDebuggerAttached()
 * → installObservabilityEventHook() → the listener is captured. Subsequent tests
 * fire it directly with CDP events to populate per-tab buffers, then exercise
 * all filter/limit branches in readConsoleMessages and readNetworkRequests.
 */

import { jest } from '@jest/globals';

let capturedOnEventListener = null;

globalThis.chrome = {
  tabs: {
    get: jest.fn((tabId, cb) => { if (cb) cb({ id: tabId, status: 'complete' }); }),
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    sendMessage: jest.fn(async () => null),
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    sendMessage: jest.fn(async () => {}),
  },
  scripting: { executeScript: jest.fn(async () => []) },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: jest.fn(async () => {}),
    sendCommand: jest.fn(async () => ({})),
    onEvent: {
      addListener: jest.fn((listener) => { capturedOnEventListener = listener; }),
    },
    onDetach: {
      addListener: jest.fn(),
    },
  },
};

import {
  cdpExecuteJs,
  readConsoleMessages,
  readNetworkRequests,
  clearObservabilityBuffers,
} from '../background/tab-manager.js';

const TEST_TAB = 54321;

// Trigger installObservabilityEventHook by attaching the debugger once.
beforeAll(async () => {
  await cdpExecuteJs(TEST_TAB, 'return 1');
  // capturedOnEventListener is now set
});

beforeEach(() => {
  clearObservabilityBuffers(TEST_TAB);
  // Don't clearAllMocks — that would lose the onEvent.addListener implementation
  // that stores capturedOnEventListener. Reset only the call counts.
  chrome.debugger.sendCommand.mockClear();
  chrome.debugger.attach.mockClear();
});

function fireEvent(source, method, params) {
  if (capturedOnEventListener) {
    capturedOnEventListener(source, method, params);
  }
}

// ── readConsoleMessages ───────────────────────────────────────────────────────

describe('readConsoleMessages — no filter', () => {
  test('returns empty array when buffer is empty', () => {
    expect(readConsoleMessages(TEST_TAB)).toEqual([]);
  });

  test('returns all entries when no filter given', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'info msg', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'error', text: 'error msg', url: '' } });
    expect(readConsoleMessages(TEST_TAB).length).toBe(2);
  });

  test('returns empty array for unknown tab', () => {
    expect(readConsoleMessages(99999)).toEqual([]);
  });
});

describe('readConsoleMessages — filter=error branch', () => {
  test('filter=error keeps error/severe/critical, drops others', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'info', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'warning', text: 'warn', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'error', text: 'err', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'severe', text: 'severe', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'critical', text: 'crit', url: '' } });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'error' });
    expect(msgs.length).toBe(3);
    expect(msgs.map(m => m.level).sort()).toEqual(['critical', 'error', 'severe']);
  });

  test('filter=errors (plural) behaves identically to error', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'error', text: 'err', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'info', url: '' } });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'errors' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].level).toBe('error');
  });
});

describe('readConsoleMessages — filter=warn branch', () => {
  test('filter=warn keeps warnings only', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'warning', text: 'w1', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'error', text: 'e1', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'i1', url: '' } });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'warn' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('w1');
  });

  test('filter=warning (long form) keeps warnings only', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'warning', text: 'w2', url: '' } });
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'i2', url: '' } });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'warning' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('w2');
  });
});

describe('readConsoleMessages — limit branches', () => {
  test('limit caps the returned entries', () => {
    for (let i = 0; i < 5; i++) {
      fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: `m${i}`, url: '' } });
    }
    expect(readConsoleMessages(TEST_TAB, { limit: 3 }).length).toBe(3);
  });

  test('negative limit returns empty array', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'x', url: '' } });
    expect(readConsoleMessages(TEST_TAB, { limit: -1 })).toEqual([]);
  });

  test('non-finite limit (Infinity) returns empty array', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'x', url: '' } });
    expect(readConsoleMessages(TEST_TAB, { limit: Infinity })).toEqual([]);
  });
});

// ── Runtime CDP events → consoleBuffers ──────────────────────────────────────

describe('Runtime.consoleAPICalled → console buffer', () => {
  test('stores warn-type Runtime.consoleAPICalled entry', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.consoleAPICalled', {
      type: 'warn',
      args: [{ value: 'console warn text' }]
    });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'warn' });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[msgs.length - 1].text).toContain('console warn text');
  });

  test('stores log-type Runtime.consoleAPICalled with multiple args', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ value: 'hello' }, { value: 'world' }]
    });
    const msgs = readConsoleMessages(TEST_TAB);
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toContain('hello');
    expect(msgs[0].text).toContain('world');
  });

  test('Runtime.consoleAPICalled with description-only arg', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ description: 'TypeError: x is null' }]
    });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'error' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toContain('TypeError');
  });

  test('Runtime.consoleAPICalled without args array falls back to empty string', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.consoleAPICalled', { type: 'log' });
    const msgs = readConsoleMessages(TEST_TAB);
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('');
  });
});

describe('Runtime.exceptionThrown → console buffer', () => {
  test('stores exception as error-level entry using exception.description', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.exceptionThrown', {
      exceptionDetails: {
        exception: { description: 'ReferenceError: foo is not defined' },
        url: 'https://example.com/app.js',
        lineNumber: 42,
        text: 'Uncaught'
      }
    });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'error' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].level).toBe('error');
    expect(msgs[0].text).toContain('ReferenceError');
  });

  test('falls back to ex.text when no exception object', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'Script error.',
        lineNumber: 0
      }
    });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'error' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('Script error.');
  });

  test('falls back to "exception" literal when both empty', () => {
    fireEvent({ tabId: TEST_TAB }, 'Runtime.exceptionThrown', {
      exceptionDetails: {}
    });
    const msgs = readConsoleMessages(TEST_TAB, { filter: 'error' });
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('exception');
  });
});

describe('installObservabilityEventHook — guard branches', () => {
  test('ignores CDP events with no source', () => {
    expect(() => {
      fireEvent(null, 'Log.entryAdded', { entry: { level: 'info', text: 'ignored', url: '' } });
    }).not.toThrow();
    expect(readConsoleMessages(TEST_TAB).length).toBe(0);
  });

  test('ignores CDP events when source.tabId is not a number', () => {
    expect(() => {
      fireEvent({ tabId: 'string-id' }, 'Log.entryAdded', { entry: { level: 'info', text: 'ignored', url: '' } });
    }).not.toThrow();
    expect(readConsoleMessages(TEST_TAB).length).toBe(0);
  });

  test('ignores unknown CDP method without throwing', () => {
    expect(() => {
      fireEvent({ tabId: TEST_TAB }, 'Unknown.methodName', { data: 'xyz' });
    }).not.toThrow();
    expect(readConsoleMessages(TEST_TAB).length).toBe(0);
  });
});

// ── readNetworkRequests ───────────────────────────────────────────────────────

function addRequest(requestId, url, status, failed, errorText) {
  fireEvent({ tabId: TEST_TAB }, 'Network.requestWillBeSent', {
    requestId,
    request: { method: 'GET', url },
    type: 'XHR'
  });
  if (status !== undefined) {
    fireEvent({ tabId: TEST_TAB }, 'Network.responseReceived', {
      requestId,
      response: { status }
    });
  }
  if (failed) {
    fireEvent({ tabId: TEST_TAB }, 'Network.loadingFailed', {
      requestId,
      errorText: errorText || 'net::ERR_FAILED'
    });
  }
}

describe('readNetworkRequests — no filter', () => {
  test('returns empty array when no requests in buffer', () => {
    expect(readNetworkRequests(TEST_TAB)).toEqual([]);
  });

  test('returns all requests when no filter given', () => {
    addRequest('r1', 'https://example.com/api', 200);
    addRequest('r2', 'https://example.com/page', 404);
    expect(readNetworkRequests(TEST_TAB).length).toBe(2);
  });

  test('returns empty array for unknown tab', () => {
    expect(readNetworkRequests(99999)).toEqual([]);
  });
});

describe('readNetworkRequests — filter=failed branch', () => {
  test('filter=failed keeps requests with failed flag or status >= 400', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    addRequest('r2', 'https://example.com/net-err', 0, true);
    addRequest('r3', 'https://example.com/not-found', 404);
    const reqs = readNetworkRequests(TEST_TAB, { filter: 'failed' });
    expect(reqs.length).toBe(2);
    const urls = reqs.map(r => r.url);
    expect(urls).toContain('https://example.com/net-err');
    expect(urls).toContain('https://example.com/not-found');
  });

  test('filter=failed: 200 request is excluded', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    expect(readNetworkRequests(TEST_TAB, { filter: 'failed' }).length).toBe(0);
  });
});

describe('readNetworkRequests — filter=4xx branch', () => {
  test('filter=4xx keeps only 400-499 status codes', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    addRequest('r2', 'https://example.com/notfound', 404);
    addRequest('r3', 'https://example.com/server-err', 500);
    const reqs = readNetworkRequests(TEST_TAB, { filter: '4xx' });
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://example.com/notfound');
    expect(reqs[0].status).toBe(404);
  });

  test('filter=4xx excludes 5xx and 2xx', () => {
    addRequest('r1', 'https://example.com/bad-gateway', 502);
    addRequest('r2', 'https://example.com/ok', 200);
    expect(readNetworkRequests(TEST_TAB, { filter: '4xx' }).length).toBe(0);
  });
});

describe('readNetworkRequests — filter=5xx branch', () => {
  test('filter=5xx keeps only 500+ status codes', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    addRequest('r2', 'https://example.com/notfound', 404);
    addRequest('r3', 'https://example.com/server-err', 500);
    addRequest('r4', 'https://example.com/bad-gateway', 502);
    const reqs = readNetworkRequests(TEST_TAB, { filter: '5xx' });
    expect(reqs.length).toBe(2);
    expect(reqs.map(r => r.status).sort()).toEqual([500, 502]);
  });

  test('filter=5xx excludes 4xx', () => {
    addRequest('r1', 'https://example.com/forbidden', 403);
    expect(readNetworkRequests(TEST_TAB, { filter: '5xx' }).length).toBe(0);
  });
});

describe('readNetworkRequests — url_includes branch', () => {
  test('url_includes filters by URL substring (case-insensitive)', () => {
    addRequest('r1', 'https://example.com/api/users', 200);
    addRequest('r2', 'https://example.com/static/image.png', 200);
    addRequest('r3', 'https://example.com/API/health', 200);
    const reqs = readNetworkRequests(TEST_TAB, { url_includes: '/api/' });
    expect(reqs.length).toBe(2);
    expect(reqs.every(r => r.url.toLowerCase().includes('/api/'))).toBe(true);
  });

  test('url_includes with no matches returns empty array', () => {
    addRequest('r1', 'https://example.com/home', 200);
    expect(readNetworkRequests(TEST_TAB, { url_includes: '/no-such-path/' }).length).toBe(0);
  });

  test('url_includes combined with filter=5xx', () => {
    addRequest('r1', 'https://example.com/api/data', 500);
    addRequest('r2', 'https://example.com/api/other', 200);
    addRequest('r3', 'https://example.com/home', 500);
    const reqs = readNetworkRequests(TEST_TAB, { filter: '5xx', url_includes: '/api/' });
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://example.com/api/data');
  });
});

describe('readNetworkRequests — limit branches', () => {
  test('limit caps the returned entries', () => {
    for (let i = 0; i < 5; i++) {
      addRequest(`req${i}`, `https://example.com/req${i}`, 200);
    }
    expect(readNetworkRequests(TEST_TAB, { limit: 2 }).length).toBe(2);
  });

  test('negative limit returns empty array', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    expect(readNetworkRequests(TEST_TAB, { limit: -1 })).toEqual([]);
  });

  test('non-finite limit (Infinity) returns empty array', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    expect(readNetworkRequests(TEST_TAB, { limit: Infinity })).toEqual([]);
  });
});

describe('readNetworkRequests — result shape', () => {
  test('returned objects have expected fields', () => {
    addRequest('r1', 'https://example.com/api', 200);
    const reqs = readNetworkRequests(TEST_TAB);
    expect(reqs.length).toBe(1);
    const req = reqs[0];
    expect(req).toHaveProperty('method');
    expect(req).toHaveProperty('url');
    expect(req).toHaveProperty('status');
    expect(req).toHaveProperty('type');
    expect(req).toHaveProperty('duration_ms');
    expect(req).toHaveProperty('failed');
    expect(req).toHaveProperty('error');
    expect(req.url).toBe('https://example.com/api');
    expect(req.status).toBe(200);
    expect(req.failed).toBe(false);
    expect(req.error).toBe('');
  });

  test('failed request has error field populated', () => {
    addRequest('r1', 'https://example.com/err', 0, true, 'net::ERR_CONNECTION_REFUSED');
    const reqs = readNetworkRequests(TEST_TAB);
    expect(reqs[0].failed).toBe(true);
    expect(reqs[0].error).toBe('net::ERR_CONNECTION_REFUSED');
  });
});

// ── clearObservabilityBuffers ─────────────────────────────────────────────────

describe('clearObservabilityBuffers — with populated data', () => {
  test('clears console buffer', () => {
    fireEvent({ tabId: TEST_TAB }, 'Log.entryAdded', { entry: { level: 'info', text: 'x', url: '' } });
    expect(readConsoleMessages(TEST_TAB).length).toBeGreaterThan(0);
    clearObservabilityBuffers(TEST_TAB);
    expect(readConsoleMessages(TEST_TAB).length).toBe(0);
  });

  test('clears network buffer', () => {
    addRequest('r1', 'https://example.com/ok', 200);
    expect(readNetworkRequests(TEST_TAB).length).toBeGreaterThan(0);
    clearObservabilityBuffers(TEST_TAB);
    expect(readNetworkRequests(TEST_TAB).length).toBe(0);
  });

  test('is idempotent — clearing empty buffers does not throw', () => {
    expect(() => clearObservabilityBuffers(TEST_TAB)).not.toThrow();
  });
});

describe('Network.requestWillBeSent — guard branches', () => {
  test('missing requestId is silently ignored', () => {
    expect(() => {
      fireEvent({ tabId: TEST_TAB }, 'Network.requestWillBeSent', {
        request: { method: 'GET', url: 'https://example.com' },
        type: 'XHR'
        // no requestId
      });
    }).not.toThrow();
    expect(readNetworkRequests(TEST_TAB).length).toBe(0);
  });

  test('responseReceived for unknown requestId is silently ignored', () => {
    expect(() => {
      fireEvent({ tabId: TEST_TAB }, 'Network.responseReceived', {
        requestId: 'non-existent',
        response: { status: 200 }
      });
    }).not.toThrow();
  });

  test('loadingFailed for unknown requestId is silently ignored', () => {
    expect(() => {
      fireEvent({ tabId: TEST_TAB }, 'Network.loadingFailed', {
        requestId: 'non-existent',
        errorText: 'net::ERR_FAILED'
      });
    }).not.toThrow();
  });
});
