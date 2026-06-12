// tests/shared-state.test.js
// Unit tests for background/shared-state.js — SPA transition, keepalive, notifyIfEnabled.

import { jest } from '@jest/globals';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (defaults) => {
        const result = {};
        for (const k of Object.keys(defaults)) {
          result[k] = storageData[k] !== undefined ? storageData[k] : defaults[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
    },
    session: {
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
    },
  },
  runtime: {
    getPlatformInfo: jest.fn((cb) => { if (cb) cb({}); }),
  },
  notifications: {
    create: jest.fn(),
  },
};

const {
  setSPATransitionPending,
  isSPATransitionPending,
  clearSPATransition,
  startSwKeepalive,
  stopSwKeepalive,
  notifyIfEnabled,
} = await import('../background/shared-state.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
  // Reset SPA flag
  clearSPATransition();
  // Stop any lingering keepalives by cycling with matching start/stop
});

describe('SPA transition flag', () => {
  test('starts as false', () => {
    expect(isSPATransitionPending()).toBe(false);
  });

  test('setSPATransitionPending sets to true', () => {
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
  });

  test('clearSPATransition resets to false', () => {
    setSPATransitionPending();
    clearSPATransition();
    expect(isSPATransitionPending()).toBe(false);
  });

  test('multiple sets stay true', () => {
    setSPATransitionPending();
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
  });

  test('clear when already false is a no-op', () => {
    clearSPATransition();
    expect(isSPATransitionPending()).toBe(false);
  });
});

describe('SW keepalive', () => {
  afterEach(() => {
    // Clean up any intervals by stopping all started keepalives
    // We'll use a simple approach: stop with the names we started
  });

  test('startSwKeepalive creates an interval and calls session.set', () => {
    jest.useFakeTimers();
    startSwKeepalive('test-keepalive');

    // First tick happens immediately on start
    expect(chrome.storage.session.set).toHaveBeenCalled();

    jest.advanceTimersByTime(20000);
    expect(chrome.storage.session.set).toHaveBeenCalledTimes(2);

    stopSwKeepalive('test-keepalive');
    jest.useRealTimers();
  });

  test('stopSwKeepalive clears the interval', () => {
    jest.useFakeTimers();
    startSwKeepalive('test-stop');
    jest.clearAllMocks();

    stopSwKeepalive('test-stop');
    jest.advanceTimersByTime(20000);

    // Should NOT call set again after stopping
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('multiple starts with same name use ref counting', () => {
    jest.useFakeTimers();
    startSwKeepalive('ref-test');
    startSwKeepalive('ref-test');
    jest.clearAllMocks();

    // Stop once — should NOT clear interval (ref count still 1)
    stopSwKeepalive('ref-test');
    jest.advanceTimersByTime(20000);
    expect(chrome.storage.session.set).toHaveBeenCalledTimes(1);

    // Stop again — should clear interval
    jest.clearAllMocks();
    stopSwKeepalive('ref-test');
    jest.advanceTimersByTime(20000);
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('falls back to getPlatformInfo when session storage unavailable', () => {
    const originalSession = chrome.storage.session;
    chrome.storage.session = null;

    jest.useFakeTimers();
    startSwKeepalive('fallback-test');

    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalled();

    stopSwKeepalive('fallback-test');
    chrome.storage.session = originalSession;
    jest.useRealTimers();
  });

  test('does nothing when both session storage and getPlatformInfo are unavailable', () => {
    // Covers the else-if false branch: session null + getPlatformInfo undefined
    const originalSession = chrome.storage.session;
    const originalGetPlatformInfo = chrome.runtime.getPlatformInfo;
    chrome.storage.session = null;
    chrome.runtime.getPlatformInfo = undefined;

    jest.useFakeTimers();
    expect(() => startSwKeepalive('no-fallback-test')).not.toThrow();

    stopSwKeepalive('no-fallback-test');
    chrome.storage.session = originalSession;
    chrome.runtime.getPlatformInfo = originalGetPlatformInfo;
    jest.useRealTimers();
  });

  test('defaults name to "default" for non-string input', () => {
    jest.useFakeTimers();
    startSwKeepalive(null);
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_default': expect.any(Number) })
    );
    stopSwKeepalive(null);
    jest.useRealTimers();
  });

  test('stopSwKeepalive cleans up session storage key', () => {
    jest.useFakeTimers();
    startSwKeepalive('cleanup-test');
    stopSwKeepalive('cleanup-test');

    expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_cleanup-test');
    jest.useRealTimers();
  });

  test('stopSwKeepalive for never-started name is safe', () => {
    jest.useFakeTimers();
    expect(() => stopSwKeepalive('never-started')).not.toThrow();
    // stopSwKeepalive still attempts session.remove for cleanup
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_never-started');
    jest.useRealTimers();
  });

  test('stopSwKeepalive handles session.remove rejection', () => {
    chrome.storage.session.remove.mockRejectedValueOnce(new Error('session error'));
    jest.useFakeTimers();
    startSwKeepalive('remove-fail');
    expect(() => stopSwKeepalive('remove-fail')).not.toThrow();
    jest.useRealTimers();
  });

  test('different keepalive names are independent', () => {
    jest.useFakeTimers();
    startSwKeepalive('name-a');
    startSwKeepalive('name-b');
    jest.clearAllMocks();

    // Stop name-a — name-b should still be ticking
    stopSwKeepalive('name-a');
    jest.advanceTimersByTime(20000);
    // name-b should still fire (session.set called once for name-b)
    expect(chrome.storage.session.set).toHaveBeenCalled();

    stopSwKeepalive('name-b');
    jest.useRealTimers();
  });

  test('startSwKeepalive with empty string defaults to "default"', () => {
    jest.useFakeTimers();
    startSwKeepalive('');
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_default': expect.any(Number) })
    );
    stopSwKeepalive('');
    jest.useRealTimers();
  });
});

describe('notifyIfEnabled', () => {
  test('skips notification when sound is disabled (default)', async () => {
    storageData.sentinelSoundEnabled = false;
    await notifyIfEnabled({ type: 'basic', title: 'Test', message: 'Hi' });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('creates notification when sound is enabled', async () => {
    storageData.sentinelSoundEnabled = true;
    await notifyIfEnabled({ type: 'basic', title: 'Test', message: 'Hello' });
    expect(chrome.notifications.create).toHaveBeenCalledWith({ type: 'basic', title: 'Test', message: 'Hello' });
  });

  test('accepts (id, opts) call signature', async () => {
    storageData.sentinelSoundEnabled = true;
    await notifyIfEnabled('my-notif-id', { type: 'basic', title: 'Test', message: 'With ID' });
    expect(chrome.notifications.create).toHaveBeenCalledWith('my-notif-id', { type: 'basic', title: 'Test', message: 'With ID' });
  });

  test('does not throw when storage fails', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage error'));
    await expect(notifyIfEnabled({ type: 'basic', title: 'Test', message: 'Hi' })).resolves.toBeUndefined();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('does not throw when notifications.create rejects', async () => {
    storageData.sentinelSoundEnabled = true;
    chrome.notifications.create.mockRejectedValueOnce(new Error('permission denied'));
    await expect(notifyIfEnabled({ type: 'basic', title: 'Test', message: 'Hi' })).resolves.toBeUndefined();
  });

  test('does not throw when called with no arguments', async () => {
    storageData.sentinelSoundEnabled = true;
    await expect(notifyIfEnabled()).resolves.toBeUndefined();
  });

  test('does not throw when called with empty options', async () => {
    storageData.sentinelSoundEnabled = true;
    await expect(notifyIfEnabled({})).resolves.toBeUndefined();
    expect(chrome.notifications.create).toHaveBeenCalledWith({});
  });
});
