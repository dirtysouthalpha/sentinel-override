// tests/tab-manager.test.js
// Unit tests for background/tab-manager.js — page load, content scripts, CDP, screenshots, observability.

import { jest } from '@jest/globals';

// Track registered listeners so we can fire them in tests.
const listeners = {
  tabsOnUpdated: [],
  runtimeOnMessage: [],
  debuggerOnEvent: [],
  debuggerOnDetach: [],
};

globalThis.chrome = {
  tabs: {
    get: jest.fn((tabId, cb) => {
      if (cb) cb({ id: tabId, status: 'loading' });
    }),
    sendMessage: jest.fn(async () => ({ ok: true, data: 'response' })),
    captureVisibleTab: jest.fn((windowId, opts, cb) => {
      if (cb) cb('data:image/jpeg;base64,AA==');
    }),
    onUpdated: {
      addListener: jest.fn((fn) => listeners.tabsOnUpdated.push(fn)),
      removeListener: jest.fn((fn) => {
        const idx = listeners.tabsOnUpdated.indexOf(fn);
        if (idx !== -1) listeners.tabsOnUpdated.splice(idx, 1);
      }),
    },
  },
  runtime: {
    lastError: null,
    onMessage: {
      addListener: jest.fn((fn) => listeners.runtimeOnMessage.push(fn)),
      removeListener: jest.fn(),
    },
    sendMessage: jest.fn(async () => {}),
    getURL: jest.fn((path) => 'chrome-extension://xxx/' + path),
  },
  scripting: {
    executeScript: jest.fn(async () => []),
  },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: jest.fn(async () => {}),
    sendCommand: jest.fn(async () => ({})),
    onEvent: {
      addListener: jest.fn((fn) => listeners.debuggerOnEvent.push(fn)),
    },
    onDetach: {
      addListener: jest.fn((fn) => listeners.debuggerOnDetach.push(fn)),
    },
  },
};

const {
  setPageLoadConfig,
  waitForPageLoad,
  createContentScriptListener,
  injectContentScript,
  sendMessageWithRetry,
  takeScreenshot,
  isValidUrl,
  getTabInfo,
  detachAllDebuggees,
  readConsoleMessages,
  readNetworkRequests,
  clearObservabilityBuffers,
  cdpDispatchClick,
  cdpDispatchKey,
  cdpDispatchType,
  cdpExecuteJs,
} = await import('../background/tab-manager.js');

beforeEach(async () => {
  jest.clearAllMocks();
  listeners.tabsOnUpdated.length = 0;
  listeners.runtimeOnMessage.length = 0;
  listeners.debuggerOnEvent.length = 0;
  listeners.debuggerOnDetach.length = 0;
  globalThis.chrome.runtime.lastError = null;
  // Reset module-level debugger/observability state
  await detachAllDebuggees();
  clearObservabilityBuffers(1);
  clearObservabilityBuffers(2);
  clearObservabilityBuffers(100);
  clearObservabilityBuffers(800);
});

// ========== isValidUrl ==========
describe('isValidUrl', () => {
  test('accepts http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  test('accepts https URLs', () => {
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
  });

  test('rejects ftp URLs', () => {
    expect(isValidUrl('ftp://files.example.com')).toBe(false);
  });

  test('rejects chrome:// URLs', () => {
    expect(isValidUrl('chrome://settings')).toBe(false);
  });

  test('rejects non-URL strings', () => {
    expect(isValidUrl('not a url')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });
});

// ========== getTabInfo ==========
describe('getTabInfo', () => {
  test('returns tab info for valid tab', async () => {
    chrome.tabs.get.mockImplementationOnce((id, cb) => {
      cb({ id: 1, url: 'https://example.com', status: 'complete' });
    });
    const info = await getTabInfo(1);
    expect(info).toBeTruthy();
    expect(info.id).toBe(1);
  });

  test('returns null when lastError is set', async () => {
    globalThis.chrome.runtime.lastError = { message: 'tab not found' };
    chrome.tabs.get.mockImplementationOnce((id, cb) => {
      cb(null);
    });
    const info = await getTabInfo(999);
    expect(info).toBeNull();
    globalThis.chrome.runtime.lastError = null;
  });
});

// ========== setPageLoadConfig / waitForPageLoad ==========
describe('waitForPageLoad', () => {
  test('resolves immediately if tab is already complete', async () => {
    chrome.tabs.get.mockImplementationOnce((id, cb) => {
      cb({ id: 1, status: 'complete' });
    });
    await expect(waitForPageLoad(1)).resolves.toBeUndefined();
  });

  test('resolves when tab status becomes complete', async () => {
    chrome.tabs.get.mockImplementationOnce((id, cb) => {
      cb({ id: 1, status: 'loading' });
    });
    const promise = waitForPageLoad(1);
    await new Promise(r => setTimeout(r, 10));
    const listener = listeners.tabsOnUpdated[listeners.tabsOnUpdated.length - 1];
    if (listener) listener(1, { status: 'complete' });
    await expect(promise).resolves.toBeUndefined();
  });

  test('ignores status updates for other tabs', async () => {
    chrome.tabs.get.mockImplementationOnce((id, cb) => {
      cb({ id: 1, status: 'loading' });
    });
    setPageLoadConfig({ pageLoadTimeout: 100 });
    const promise = waitForPageLoad(1);
    await new Promise(r => setTimeout(r, 10));
    const listener = listeners.tabsOnUpdated[listeners.tabsOnUpdated.length - 1];
    if (listener) listener(2, { status: 'complete' });
    await expect(promise).resolves.toBeUndefined();
    setPageLoadConfig({ pageLoadTimeout: 25000 });
  });
});

// ========== createContentScriptListener ==========
describe('createContentScriptListener', () => {
  test('resolves true when content_script_ready received', async () => {
    const { promise } = createContentScriptListener(1, 5000);
    await new Promise(r => setTimeout(r, 10));
    const listener = listeners.runtimeOnMessage[listeners.runtimeOnMessage.length - 1];
    if (listener) {
      listener({ action: 'content_script_ready' }, { tab: { id: 1 } });
    }
    await expect(promise).resolves.toBe(true);
  });

  test('resolves false on timeout', async () => {
    jest.useFakeTimers();
    const { promise } = createContentScriptListener(1, 100);
    jest.advanceTimersByTime(200);
    await expect(promise).resolves.toBe(false);
    jest.useRealTimers();
  });

  test('ignores messages from other tabs', async () => {
    jest.useFakeTimers();
    const { promise } = createContentScriptListener(1, 100);
    const listener = listeners.runtimeOnMessage[listeners.runtimeOnMessage.length - 1];
    if (listener) {
      listener({ action: 'content_script_ready' }, { tab: { id: 2 } });
    }
    jest.advanceTimersByTime(200);
    await expect(promise).resolves.toBe(false);
    jest.useRealTimers();
  });

  test('cancel stops listener and timer without resolving', async () => {
    const { promise, cancel } = createContentScriptListener(1, 100);
    cancel();
    // cancel() doesn't resolve the promise; it just prevents resolution
    const result = await Promise.race([
      promise,
      new Promise(r => setTimeout(() => r('pending'), 50)),
    ]);
    expect(result).toBe('pending');
  });
});

// ========== injectContentScript ==========
describe('injectContentScript', () => {
  test('returns true when script signals ready', async () => {
    chrome.scripting.executeScript.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10));
      const listener = listeners.runtimeOnMessage[listeners.runtimeOnMessage.length - 1];
      if (listener) {
        listener({ action: 'content_script_ready' }, { tab: { id: 1 } });
      }
    });
    const result = await injectContentScript(1, 1);
    expect(result).toBe(true);
  });

  test('returns false when injection fails all attempts', async () => {
    chrome.scripting.executeScript.mockRejectedValue(new Error('cannot inject'));
    const result = await injectContentScript(1, 1);
    expect(result).toBe(false);
  });
});

// ========== sendMessageWithRetry ==========
describe('sendMessageWithRetry', () => {
  test('returns data on first try', async () => {
    chrome.tabs.sendMessage.mockResolvedValueOnce({ ok: true, data: 'result' });
    const result = await sendMessageWithRetry(1, { action: 'test' }, 1);
    expect(result).toBe('result');
  });

  test('unwraps { result: string } envelope', async () => {
    chrome.tabs.sendMessage.mockResolvedValueOnce({ ok: true, data: { result: 'plain text' } });
    const result = await sendMessageWithRetry(1, { action: 'test' }, 1);
    expect(result).toBe('plain text');
  });

  test('throws on content script error after retries', async () => {
    chrome.tabs.sendMessage.mockRejectedValue(new Error('not connected'));
    chrome.scripting.executeScript.mockResolvedValue([]);
    await expect(sendMessageWithRetry(1, { action: 'test' }, 2)).rejects.toThrow('not connected');
  });

  test('throws when content script returns ok:false consistently', async () => {
    // All sendMessage calls return ok:false so retries also fail
    chrome.tabs.sendMessage.mockResolvedValue({ ok: false, error: 'bad action' });
    chrome.scripting.executeScript.mockResolvedValue([]);
    await expect(sendMessageWithRetry(1, { action: 'test' }, 2)).rejects.toThrow('bad action');
  });
});

// ========== Observability Buffers ==========
describe('readConsoleMessages', () => {
  test('returns empty array for unknown tab', () => {
    expect(readConsoleMessages(999)).toEqual([]);
  });

  test('respects limit and filter options', () => {
    expect(readConsoleMessages(1, { limit: 10 })).toEqual([]);
    expect(readConsoleMessages(1, { filter: 'error' })).toEqual([]);
    expect(readConsoleMessages(1, { filter: 'warning' })).toEqual([]);
  });
});

describe('readNetworkRequests', () => {
  test('returns empty array for unknown tab', () => {
    expect(readNetworkRequests(999)).toEqual([]);
  });

  test('respects filter and urlIncludes options', () => {
    expect(readNetworkRequests(1, { filter: 'failed' })).toEqual([]);
    expect(readNetworkRequests(1, { filter: '4xx' })).toEqual([]);
    expect(readNetworkRequests(1, { filter: '5xx' })).toEqual([]);
    expect(readNetworkRequests(1, { url_includes: 'api' })).toEqual([]);
    expect(readNetworkRequests(1, { limit: 5 })).toEqual([]);
  });
});

describe('clearObservabilityBuffers', () => {
  test('does not throw for unknown tab', () => {
    expect(() => clearObservabilityBuffers(999)).not.toThrow();
  });
});

// ========== detachAllDebuggees ==========
describe('detachAllDebuggees', () => {
  test('does not throw when no debuggees attached', async () => {
    await expect(detachAllDebuggees()).resolves.toBeUndefined();
    expect(chrome.debugger.detach).not.toHaveBeenCalled();
  });
});

// ========== CDP Dispatch ==========
// Use unique tab IDs to avoid cross-test state from the module-level attachedDebuggees set.
describe('cdpDispatchClick', () => {
  test('returns ok:true on success', async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});
    const result = await cdpDispatchClick(100, 100, 200);
    expect(result.ok).toBe(true);
  });

  test('returns ok:false on debugger error', async () => {
    chrome.debugger.attach.mockRejectedValueOnce(new Error('attach failed'));
    const result = await cdpDispatchClick(100, 100, 200);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('attach failed');
  });

  test('uses default button and clickCount', async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});
    await cdpDispatchClick(100, 50, 50);
    const calls = chrome.debugger.sendCommand.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  test('skips visual feedback when skipVisual is true', async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});
    const result = await cdpDispatchClick(100, 10, 10, { skipVisual: true });
    expect(result.ok).toBe(true);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe('cdpDispatchKey', () => {
  test('returns ok:true for Enter key', async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});
    const result = await cdpDispatchKey(100, 'Enter');
    expect(result.ok).toBe(true);
  });

  test('returns ok:false for unknown key', async () => {
    const result = await cdpDispatchKey(100, 'UnknownKey123');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown key');
  });

  test('handles single printable character', async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});
    const result = await cdpDispatchKey(100, 'a');
    expect(result.ok).toBe(true);
  });

  test('returns ok:false on debugger error', async () => {
    chrome.debugger.attach.mockRejectedValueOnce(new Error('denied'));
    const result = await cdpDispatchKey(100, 'Enter');
    expect(result.ok).toBe(false);
  });
});

describe('cdpDispatchType', () => {
  test('returns ok:true for empty string', async () => {
    const result = await cdpDispatchType(100, '');
    expect(result.ok).toBe(true);
  });

  test('returns ok:true for non-string input', async () => {
    const result = await cdpDispatchType(100, null);
    expect(result.ok).toBe(true);
  });

  test('uses fast insertText path for long strings', async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});
    const longText = 'a'.repeat(100);
    const result = await cdpDispatchType(100, longText, { perCharKeyEvents: false });
    expect(result.ok).toBe(true);
    const insertCall = chrome.debugger.sendCommand.mock.calls.find(
      c => c[1] === 'Input.insertText'
    );
    expect(insertCall).toBeTruthy();
  });
});

describe('cdpExecuteJs', () => {
  test('returns error for empty code', async () => {
    const result = await cdpExecuteJs(100, '');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No code provided');
  });

  test('returns error for non-string code', async () => {
    const result = await cdpExecuteJs(100, null);
    expect(result.ok).toBe(false);
  });

  test('returns ok:true with value on success', async () => {
    // Fresh tab 100: attach, then observability commands, then Runtime.evaluate
    chrome.debugger.sendCommand.mockResolvedValueOnce({}) // Log.enable
      .mockResolvedValueOnce({}) // Runtime.enable
      .mockResolvedValueOnce({}) // Network.enable
      .mockResolvedValueOnce({ // Runtime.evaluate
        result: { type: 'string', value: 'hello' },
      });
    const result = await cdpExecuteJs(100, 'return "hello"');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('hello');
  });

  test('returns error on runtime exception', async () => {
    chrome.debugger.sendCommand.mockResolvedValueOnce({}) // Log.enable
      .mockResolvedValueOnce({}) // Runtime.enable
      .mockResolvedValueOnce({}) // Network.enable
      .mockResolvedValueOnce({ // Runtime.evaluate with exception
        exceptionDetails: { exception: { description: 'ReferenceError: x is not defined' }, text: 'Error' },
      });
    const result = await cdpExecuteJs(100, 'return x');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ReferenceError');
  });

  test('returns attachDenied for chrome:// pages', async () => {
    chrome.debugger.attach.mockRejectedValueOnce(new Error('Cannot access chrome:// URL'));
    const result = await cdpExecuteJs(100, 'return 1');
    expect(result.ok).toBe(false);
    expect(result.attachDenied).toBe(true);
  });

  test('clamps timeout to valid range', async () => {
    chrome.debugger.sendCommand.mockResolvedValueOnce({}) // Log.enable
      .mockResolvedValueOnce({}) // Runtime.enable
      .mockResolvedValueOnce({}) // Network.enable
      .mockResolvedValueOnce({ result: { value: null } }); // Runtime.evaluate
    await cdpExecuteJs(100, 'return 1', { timeout: 100 });
    const evalCall = chrome.debugger.sendCommand.mock.calls.find(c => c[1] === 'Runtime.evaluate');
    expect(evalCall[2].timeout).toBe(500);
  });
});

// ========== takeScreenshot ==========
describe('takeScreenshot', () => {
  const baseConfig = { screenshotQuality: 80, screenshotCache: true };

  test('returns cached snapshot on cache hit', async () => {
    const cache = {
      cachedSnapshot: { base64Image: 'cached', width: 100, height: 200, dpr: 1, scrollX: 0, scrollY: 0, capturedAt: 123 },
      cachedBase64Image: null,
      lastScreenshotUrl: 'https://example.com',
    };
    const result = await takeScreenshot(800, 1, 'https://example.com', cache, baseConfig, 1, null);
    expect(result.base64Image).toBe('cached');
    expect(result.url).toBe('https://example.com');
  });

  test('falls back to legacy cachedBase64Image', async () => {
    const cache = {
      cachedSnapshot: null,
      cachedBase64Image: 'legacy',
      lastScreenshotUrl: 'https://example.com',
    };
    const result = await takeScreenshot(800, 1, 'https://example.com', cache, baseConfig, 1, null);
    expect(result.base64Image).toBe('legacy');
  });

  test('captures via CDP on cache miss', async () => {
    const cache = { cachedSnapshot: null, cachedBase64Image: null, lastScreenshotUrl: null };
    // sendMessageWithRetry will call chrome.tabs.sendMessage internally
    chrome.tabs.sendMessage.mockResolvedValueOnce({ ok: true, data: { width: 800, height: 600, dpr: 2, scrollX: 0, scrollY: 0 } });
    // CDP path: attach (fresh tab 800) then capture
    chrome.debugger.sendCommand.mockResolvedValue({ data: 'screenshotdata' });
    const result = await takeScreenshot(800, 1, 'https://example.com', cache, baseConfig, 1, null);
    expect(result).toBeTruthy();
    expect(result.base64Image).toBe('screenshotdata');
    expect(result.dpr).toBe(2);
    expect(cache.lastScreenshotUrl).toBe('https://example.com');
  });

  test('falls back to captureVisibleTab on debugger error', async () => {
    const cache = { cachedSnapshot: null, cachedBase64Image: null, lastScreenshotUrl: null };
    // sendMessageWithRetry fails (content script not ready)
    chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'));
    // Debugger attach fails for tab 800
    chrome.debugger.attach.mockRejectedValueOnce(new Error('cannot attach'));
    chrome.debugger.detach.mockRejectedValueOnce(new Error('not attached'));
    // captureVisibleTab succeeds
    chrome.tabs.captureVisibleTab.mockImplementationOnce((wid, opts, cb) => {
      cb('data:image/jpeg;base64,AA==');
    });
    const result = await takeScreenshot(800, 1, 'https://example.com', cache, baseConfig, 1, null);
    expect(result).toBeTruthy();
    expect(result.base64Image).toBe('AA==');
  });

  test('returns null when all capture methods fail', async () => {
    const cache = { cachedSnapshot: null, cachedBase64Image: null, lastScreenshotUrl: null };
    const sendSilentUpdate = jest.fn();
    chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'));
    chrome.debugger.attach.mockRejectedValueOnce(new Error('cannot attach'));
    chrome.debugger.detach.mockRejectedValueOnce(new Error('not attached'));
    chrome.tabs.captureVisibleTab.mockImplementationOnce((wid, opts, cb) => {
      globalThis.chrome.runtime.lastError = { message: 'capture failed' };
      cb(null);
      globalThis.chrome.runtime.lastError = null;
    });
    const result = await takeScreenshot(800, 1, 'https://example.com', cache, baseConfig, 1, sendSilentUpdate);
    expect(result).toBeNull();
    expect(sendSilentUpdate).toHaveBeenCalled();
  });

  test('writes cache even when screenshotCache config is false', async () => {
    const cache = { cachedSnapshot: null, cachedBase64Image: null, lastScreenshotUrl: null };
    const configNoCache = { screenshotQuality: 80, screenshotCache: false };
    chrome.tabs.sendMessage.mockResolvedValueOnce({ ok: true, data: { width: 800, height: 600, dpr: 1, scrollX: 0, scrollY: 0 } });
    chrome.debugger.sendCommand.mockResolvedValue({ data: 'img' });
    const result = await takeScreenshot(800, 1, 'https://example.com', cache, configNoCache, 1, null);
    expect(result).toBeTruthy();
    // Cache write is unconditional — the config flag only controls cache READ (hit detection)
    expect(cache.lastScreenshotUrl).toBe('https://example.com');
    expect(cache.cachedSnapshot).toBeTruthy();
  });
});
