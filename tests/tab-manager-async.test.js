// tests/tab-manager-async.test.js
// Tests for async/mocked functions in background/tab-manager.js

import { jest } from '@jest/globals';

let onMessageListeners = [];
let tabsGetCallback = null;

globalThis.chrome = {
  tabs: {
    get: jest.fn((tabId, cb) => { if (cb) cb(null); }),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  runtime: {
    lastError: null,
    onMessage: {
      addListener: jest.fn((fn) => { onMessageListeners.push(fn); }),
      removeListener: jest.fn((fn) => {
        onMessageListeners = onMessageListeners.filter(l => l !== fn);
      }),
    },
  },
  scripting: {
    executeScript: jest.fn(async () => {}),
  },
  debugger: {
    onDetach: { addListener: jest.fn() },
  },
};

const {
  createContentScriptListener,
  getTabInfo,
  waitForPageLoad,
  injectContentScript,
  isValidUrl,
} = await import('../background/tab-manager.js');

beforeEach(() => {
  onMessageListeners = [];
  chrome.runtime.lastError = null;
  jest.clearAllMocks();
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { onMessageListeners.push(fn); });
  chrome.runtime.onMessage.removeListener.mockImplementation((fn) => {
    onMessageListeners = onMessageListeners.filter(l => l !== fn);
  });
});

describe('createContentScriptListener', () => {
  test('resolves false when timeout fires', async () => {
    jest.useFakeTimers();
    try {
      const { promise } = createContentScriptListener(42, 1000);
      jest.advanceTimersByTime(1001);
      await expect(promise).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('resolves true when content_script_ready message arrives from correct tab', async () => {
    const { promise } = createContentScriptListener(42, 5000);
    // Fire the message from the correct tab
    const listener = onMessageListeners[onMessageListeners.length - 1];
    listener({ action: 'content_script_ready' }, { tab: { id: 42 } });
    await expect(promise).resolves.toBe(true);
  });

  test('ignores message from different tab', async () => {
    jest.useFakeTimers();
    try {
      const { promise } = createContentScriptListener(42, 500);
      const listener = onMessageListeners[onMessageListeners.length - 1];
      // Wrong tab ID — should not resolve
      listener({ action: 'content_script_ready' }, { tab: { id: 99 } });
      jest.advanceTimersByTime(501);
      await expect(promise).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('ignores wrong action type', async () => {
    jest.useFakeTimers();
    try {
      const { promise } = createContentScriptListener(42, 500);
      const listener = onMessageListeners[onMessageListeners.length - 1];
      listener({ action: 'other_action' }, { tab: { id: 42 } });
      jest.advanceTimersByTime(501);
      await expect(promise).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('cancel() clears the timeout and removes listener', () => {
    jest.useFakeTimers();
    try {
      const listenerCountBefore = onMessageListeners.length;
      const { cancel } = createContentScriptListener(42, 5000);
      expect(onMessageListeners.length).toBe(listenerCountBefore + 1);
      cancel();
      expect(onMessageListeners.length).toBe(listenerCountBefore);
      // Timer should be cleared — advancing time should not cause double-resolve
      jest.advanceTimersByTime(10000);
    } finally {
      jest.useRealTimers();
    }
  });

  test('cancel() is idempotent — second call is a no-op', () => {
    const { cancel } = createContentScriptListener(42, 5000);
    expect(() => {
      cancel();
      cancel();
    }).not.toThrow();
  });
});

describe('getTabInfo', () => {
  test('returns tab info on success', async () => {
    const tabInfo = { id: 5, url: 'https://example.com', status: 'complete' };
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = null;
      cb(tabInfo);
    });
    const result = await getTabInfo(5);
    expect(result).toEqual(tabInfo);
  });

  test('returns null when lastError is set', async () => {
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = { message: 'No tab with id' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    const result = await getTabInfo(999);
    expect(result).toBeNull();
  });

  test('returns tab when lastError is null string (not object)', async () => {
    const tabInfo = { id: 3, url: 'https://example.com' };
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = 'string error';
      cb(tabInfo);
      chrome.runtime.lastError = null;
    });
    // lastError is a string, not an object — guard `typeof === 'object'` passes the tab through
    const result = await getTabInfo(3);
    expect(result).toEqual(tabInfo);
  });
});

describe('waitForPageLoad', () => {
  test('returns immediately when tab.status is already complete', async () => {
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = null;
      cb({ id: tabId, status: 'complete' });
    });
    await expect(waitForPageLoad(1)).resolves.toBeUndefined();
    expect(chrome.tabs.onUpdated.addListener).not.toHaveBeenCalled();
  });

  test('returns immediately when tab get returns null (lastError)', async () => {
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = { message: 'Tab not found' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    await expect(waitForPageLoad(999)).resolves.toBeUndefined();
    expect(chrome.tabs.onUpdated.addListener).not.toHaveBeenCalled();
  });

  test('registers onUpdated listener when tab is loading', async () => {
    jest.useFakeTimers();
    try {
      chrome.tabs.get.mockImplementation((tabId, cb) => {
        chrome.runtime.lastError = null;
        cb({ id: tabId, status: 'loading' });
      });
      let capturedListener;
      chrome.tabs.onUpdated.addListener.mockImplementation((fn) => { capturedListener = fn; });

      const loadPromise = waitForPageLoad(10);
      await Promise.resolve(); // allow promise setup

      expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled();

      // Fire the onUpdated event with status complete
      capturedListener(10, { status: 'complete' });
      await loadPromise;
    } finally {
      jest.useRealTimers();
    }
  });

  test('resolves on timeout when page never completes', async () => {
    jest.useFakeTimers();
    try {
      chrome.tabs.get.mockImplementation((tabId, cb) => {
        chrome.runtime.lastError = null;
        cb({ id: tabId, status: 'loading' });
      });
      chrome.tabs.onUpdated.addListener.mockImplementation(() => {});

      const loadPromise = waitForPageLoad(10);
      await Promise.resolve();
      jest.advanceTimersByTime(30000);
      await loadPromise;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('injectContentScript', () => {
  afterEach(() => jest.useRealTimers());

  test('returns false when executeScript always fails', async () => {
    chrome.scripting.executeScript.mockRejectedValue(new Error('Script injection blocked'));
    const result = await injectContentScript(5, 1);
    expect(result).toBe(false);
  });

  test('returns false when executeScript succeeds but content_script_ready never fires', async () => {
    jest.useFakeTimers();
    chrome.scripting.executeScript.mockResolvedValue([]);
    const injectPromise = injectContentScript(5, 1);
    // advanceTimersByTimeAsync advances the clock AND drains microtasks between ticks
    await jest.advanceTimersByTimeAsync(3001); // past the 3s createContentScriptListener timeout
    await jest.advanceTimersByTimeAsync(501);  // past the sleep(500) between attempts
    const result = await injectPromise;
    expect(result).toBe(false);
  });

  test('returns true when content_script_ready fires after injection', async () => {
    // Trigger the message synchronously inside the executeScript mock, before it returns.
    // The listener is already registered in onMessageListeners by createContentScriptListener,
    // so calling it here resolves csListener.promise before injectContentScript awaits it.
    chrome.scripting.executeScript.mockImplementation(() => {
      const listener = onMessageListeners[onMessageListeners.length - 1];
      if (listener) listener({ action: 'content_script_ready' }, { tab: { id: 7 } });
      return Promise.resolve([]);
    });
    const result = await injectContentScript(7, 1);
    expect(result).toBe(true);
  });
});

describe('isValidUrl — additional edge cases', () => {
  test('rejects ftp: URLs', () => {
    expect(isValidUrl('ftp://files.example.com/file.txt')).toBe(false);
  });

  test('rejects file: URLs', () => {
    expect(isValidUrl('file:///etc/passwd')).toBe(false);
  });

  test('rejects data: URLs', () => {
    expect(isValidUrl('data:text/html,<h1>Hello</h1>')).toBe(false);
  });

  test('rejects blob: URLs', () => {
    expect(isValidUrl('blob:https://example.com/abc123')).toBe(false);
  });

  test('rejects non-string types', () => {
    expect(isValidUrl(42)).toBe(false);
    expect(isValidUrl({})).toBe(false);
    expect(isValidUrl([])).toBe(false);
  });

  test('rejects malformed URL', () => {
    expect(isValidUrl('https://')).toBe(false);
  });
});
