/**
 * Branch coverage for page-monitor.js uncovered paths:
 *   17-20   chrome.storage.onChanged listener body (module-level, needs fresh import)
 *   157     checkMonitor — tab object exists but has no id
 *   161-162 checkMonitor — executeScript func body (document.querySelector)
 *   231     startMonitorLoop — idempotency guard (already-started branch)
 *   240     alarm handler — runMonitorCycle().catch() error path
 */

import { jest } from '@jest/globals';

let capturedOnChangedListener = null;
let capturedAlarmListener = null;
const storageMock = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (key) => ({ [key]: storageMock[key] })),
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
    },
    onChanged: {
      addListener: jest.fn((fn) => { capturedOnChangedListener = fn; }),
    },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
  },
  scripting: {
    executeScript: jest.fn(async () => [{ result: 'content' }]),
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn((fn) => { capturedAlarmListener = fn; }),
      removeListener: jest.fn(),
    },
  },
  notifications: {
    create: jest.fn(),
  },
  runtime: {
    getURL: jest.fn((path) => `chrome-extension://test/${path}`),
  },
};

const {
  loadMonitors,
  createMonitor,
  checkMonitor,
  startMonitorLoop,
  _resetMonitorLoop,
  clearMonitorCache,
} = await import('../background/page-monitor.js');

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  clearMonitorCache();
  _resetMonitorLoop();
  jest.clearAllMocks();
  chrome.storage.local.get.mockImplementation(async (key) => ({ [key]: storageMock[key] }));
  chrome.storage.local.set.mockImplementation(async (obj) => { Object.assign(storageMock, obj); });
  chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
  chrome.scripting.executeScript.mockResolvedValue([{ result: 'content' }]);
  chrome.alarms.onAlarm.addListener.mockImplementation((fn) => { capturedAlarmListener = fn; });
});

// ── Lines 17-20: chrome.storage.onChanged listener body ──────────────────────

describe('page-monitor — chrome.storage.onChanged listener (lines 17-20)', () => {
  test('listener was registered with chrome.storage.onChanged.addListener (line 17)', () => {
    expect(capturedOnChangedListener).not.toBeNull();
  });

  test('invalidates cache when sentinel_monitors changes in local area (lines 18-20)', async () => {
    storageMock['sentinel_monitors'] = [
      { id: 'm1', url: 'https://a.com', selector: '#x', active: true, label: 'T', interval: 30, createdAt: '', lastChangedAt: null, changeCount: 0, lastContent: '' }
    ];
    const first = await loadMonitors();
    expect(first.length).toBe(1);

    // Fire listener — should reset _cachedMonitors and _loadMonitorsPromise (lines 19-20)
    capturedOnChangedListener({ sentinel_monitors: { newValue: [] } }, 'local');

    storageMock['sentinel_monitors'] = [];
    const second = await loadMonitors();
    expect(second.length).toBe(0);
  });

  test('no-ops when areaName is not local (line 18 guard)', async () => {
    storageMock['sentinel_monitors'] = [{ id: 'm2', url: 'https://b.com', selector: '#y', active: true, label: 'U', interval: 30, createdAt: '', lastChangedAt: null, changeCount: 0, lastContent: '' }];
    await loadMonitors();

    capturedOnChangedListener({ sentinel_monitors: { newValue: [] } }, 'sync');

    storageMock['sentinel_monitors'] = [];
    const cached = await loadMonitors();
    expect(cached.length).toBe(1);
  });

  test('no-ops when changes do not include sentinel_monitors (line 18 guard)', async () => {
    storageMock['sentinel_monitors'] = [{ id: 'm3', url: 'https://c.com', selector: '#z', active: true, label: 'V', interval: 30, createdAt: '', lastChangedAt: null, changeCount: 0, lastContent: '' }];
    await loadMonitors();

    capturedOnChangedListener({ other_key: { newValue: {} } }, 'local');

    storageMock['sentinel_monitors'] = [];
    const cached = await loadMonitors();
    expect(cached.length).toBe(1);
  });
});

// ── Line 157: checkMonitor — tab exists but has no id ────────────────────────

describe('checkMonitor — tab without id (line 157)', () => {
  test('returns unchanged when tabs[0] exists but has no id field', async () => {
    chrome.tabs.query.mockResolvedValueOnce([{}]);
    const monitor = {
      id: 'mon-x', url: 'https://example.com', selector: '#x',
      lastContent: '', label: 'T', active: true, interval: 30, changeCount: 0,
    };
    const result = await checkMonitor(monitor);
    expect(result).toEqual({ changed: false, content: '' });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

// ── Lines 161-162: executeScript func body ───────────────────────────────────

describe('checkMonitor — executeScript func body (lines 161-162)', () => {
  test('func returns textContent.trim() when element is found (line 161)', async () => {
    const monitor = { id: 'mon-y', url: 'https://example.com', selector: '#content', lastContent: '', label: 'T', active: true, interval: 30, changeCount: 0 };
    storageMock['sentinel_monitors'] = [monitor];

    chrome.scripting.executeScript.mockResolvedValueOnce([{ result: 'sample text' }]);
    await checkMonitor(monitor);

    const callArgs = chrome.scripting.executeScript.mock.calls.at(-1)[0];
    const func = callArgs.func;

    const origDocument = globalThis.document;
    globalThis.document = { querySelector: jest.fn(() => ({ textContent: '  trimmed  ' })) };
    expect(func('#content')).toBe('trimmed');
    globalThis.document = origDocument;
  });

  test('func returns empty string when element is not found (line 162)', async () => {
    const monitor = { id: 'mon-z', url: 'https://example.com', selector: '#missing', lastContent: '', label: 'T', active: true, interval: 30, changeCount: 0 };
    storageMock['sentinel_monitors'] = [monitor];

    chrome.scripting.executeScript.mockResolvedValueOnce([{ result: '' }]);
    await checkMonitor(monitor);

    const callArgs = chrome.scripting.executeScript.mock.calls.at(-1)[0];
    const func = callArgs.func;

    const origDocument = globalThis.document;
    globalThis.document = { querySelector: jest.fn(() => null) };
    expect(func('#missing')).toBe('');
    globalThis.document = origDocument;
  });
});

// ── Line 231: startMonitorLoop idempotency guard ──────────────────────────────

describe('startMonitorLoop — idempotency guard (line 231)', () => {
  test('returns alarm name without re-creating alarm on second call', () => {
    startMonitorLoop();
    chrome.alarms.create.mockClear();

    const result = startMonitorLoop();

    expect(result).toBe('sentinel-monitor-check');
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});

// ── Line 240: alarm handler — runMonitorCycle().catch() ───────────────────────

describe('alarm handler — runMonitorCycle catch (line 240)', () => {
  test('catches and logs error when runMonitorCycle rejects (line 240)', async () => {
    // loadMonitors has its own try/catch and always resolves — need a throw AFTER it.
    // Set up an active monitor with prior content so changed=true and notifications.create is called.
    const activeMonitor = {
      id: 'mon-active', url: 'https://example.com', selector: '#x',
      active: true, label: 'Active', interval: 30,
      lastContent: 'old content', changeCount: 0,
      createdAt: '', lastChangedAt: null,
    };
    storageMock['sentinel_monitors'] = [activeMonitor];

    startMonitorLoop();
    expect(capturedAlarmListener).not.toBeNull();

    // Return different content so changed=true
    chrome.scripting.executeScript.mockResolvedValue([{ result: 'new content' }]);
    // Throw synchronously from notifications.create → runMonitorCycle rejects
    chrome.notifications.create.mockImplementationOnce(() => {
      throw new Error('notifications disabled');
    });

    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    capturedAlarmListener({ name: 'sentinel-monitor-check' });
    // Allow the full async chain to complete (multiple microtask/macrotask rounds)
    await new Promise((r) => setTimeout(r, 50));

    console.error = origError;
    expect(errors.some((m) => m.includes('Cycle failed'))).toBe(true);
  });

  test('no-ops when alarm name does not match sentinel-monitor-check', () => {
    startMonitorLoop();
    expect(() => capturedAlarmListener({ name: 'other-alarm' })).not.toThrow();
  });
});
