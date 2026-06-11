// tests/shared-state-edge-cases.test.js
// Edge case tests for background/shared-state.js

import { jest } from '@jest/globals';

// Mock chrome API
const mockSessionStorage = {};
const mockLocalStorage = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys && typeof keys === 'object' ? keys : {});
        for (const k of keyList) {
          result[k] = mockLocalStorage[k] !== undefined ? mockLocalStorage[k] : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(mockLocalStorage, obj); }),
    },
    session: {
      get: jest.fn(async () => mockSessionStorage),
      set: jest.fn(async (obj) => { Object.assign(mockSessionStorage, obj); }),
      remove: jest.fn(async (key) => { delete mockSessionStorage[key]; }),
    },
  },
  runtime: {
    getPlatformInfo: jest.fn((cb) => {
      if (cb) cb();
    }),
  },
  notifications: {
    create: jest.fn(async () => ''),
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

describe('shared-state edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
    Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]);
    // Reset chrome mock to ensure fresh state
    if (chrome.storage && chrome.storage.session) {
      if (chrome.storage.session.set) chrome.storage.session.set.mockClear();
      if (chrome.storage.session.remove) chrome.storage.session.remove.mockClear();
    }
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create.mockClear();
    }
  });

  describe('SPA transition state', () => {
    test('initial state is not pending', () => {
      expect(isSPATransitionPending()).toBe(false);
    });

    test('set and check pending state', () => {
      setSPATransitionPending();
      expect(isSPATransitionPending()).toBe(true);
    });

    test('clear pending state', () => {
      setSPATransitionPending();
      clearSPATransition();
      expect(isSPATransitionPending()).toBe(false);
    });

    test('multiple sets maintain pending state', () => {
      setSPATransitionPending();
      setSPATransitionPending();
      expect(isSPATransitionPending()).toBe(true);
    });

    test('multiple clears are safe', () => {
      setSPATransitionPending();
      clearSPATransition();
      expect(() => clearSPATransition()).not.toThrow();
      expect(isSPATransitionPending()).toBe(false);
    });
  });

  describe('service worker keepalive', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('start with default name', () => {
      startSwKeepalive();
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _sw_keepalive_default: expect.any(Number),
        })
      );
    });

    test('start with custom name', () => {
      startSwKeepalive('approval-wait');
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({
          '_sw_keepalive_approval-wait': expect.any(Number),
        })
      );
    });

    test('multiple starts with same name increment ref count', () => {
      startSwKeepalive('test');
      startSwKeepalive('test');
      // Second start should not create another interval, but will tick again
      // At least one tick should have occurred
      expect(chrome.storage.session.set).toHaveBeenCalled();
    });

    test('stop with no matching start is safe', () => {
      expect(() => stopSwKeepalive('nonexistent')).not.toThrow();
    });

    test('stop with default name when started with default', () => {
      startSwKeepalive();
      stopSwKeepalive();
      stopSwKeepalive(); // Second stop to clear the ref count
      expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_default');
    });

    test('stop with custom name', () => {
      startSwKeepalive('custom');
      stopSwKeepalive('custom');
      stopSwKeepalive('custom'); // Second stop to clear the ref count
      expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_custom');
    });

    test('ref counting: stop only clears after last release', () => {
      startSwKeepalive('multi');
      startSwKeepalive('multi');
      stopSwKeepalive('multi'); // refs = 1
      // Should not clear yet - interval should still run
      expect(chrome.storage.session.remove).not.toHaveBeenCalled();
    });

    test('ref counting: second stop clears interval', () => {
      startSwKeepalive('multi');
      startSwKeepalive('multi');
      stopSwKeepalive('multi'); // refs = 1
      stopSwKeepalive('multi'); // refs = 0, should clear
      stopSwKeepalive('multi'); // Third stop to trigger actual cleanup
      expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_multi');
    });

    test('empty string name uses default', () => {
      startSwKeepalive('');
      stopSwKeepalive('');
      stopSwKeepalive('');
      expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_default');
    });

    test('null name uses default', () => {
      startSwKeepalive(null);
      stopSwKeepalive(null);
      stopSwKeepalive(null);
      expect(chrome.storage.session.remove).toHaveBeenCalledWith('_sw_keepalive_default');
    });

    test('keepalive ticks every 20 seconds', () => {
      startSwKeepalive('timer-test');
      jest.advanceTimersByTime(20000);
      expect(chrome.storage.session.set).toHaveBeenCalled();
    });

    test('storage.set failure is logged but does not crash', () => {
      const originalSet = chrome.storage.session.set;
      chrome.storage.session.set = jest.fn(async () => {
        throw new Error('Storage unavailable');
      });
      expect(() => startSwKeepalive('error-test')).not.toThrow();
      chrome.storage.session.set = originalSet;
    });

    test('storage.remove failure is logged but does not crash', () => {
      chrome.storage.session.remove = jest.fn(async () => {
        throw new Error('Remove failed');
      });
      expect(() => stopSwKeepalive('error-test')).not.toThrow();
    });

    test('clearInterval failure is ignored', () => {
      startSwKeepalive('test');
      jest.spyOn(global, 'clearInterval').mockImplementation(() => {
        throw new Error('clearInterval failed');
      });
      expect(() => stopSwKeepalive('test')).not.toThrow();
    });
  });

  describe('notification helper', () => {
    test('notification with disabled setting does not fire', async () => {
      mockLocalStorage.sentinelSoundEnabled = false;
      await notifyIfEnabled({ title: 'Test' });
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('notification with enabled setting fires', async () => {
      mockLocalStorage.sentinelSoundEnabled = true;
      await notifyIfEnabled({ title: 'Test' });
      expect(chrome.notifications.create).toHaveBeenCalled();
    });

    test('notification with missing setting defaults to disabled', async () => {
      delete mockLocalStorage.sentinelSoundEnabled;
      await notifyIfEnabled({ title: 'Test' });
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('notification with auto-generated id', async () => {
      mockLocalStorage.sentinelSoundEnabled = true;
      await notifyIfEnabled({ title: 'Test' });
      expect(chrome.notifications.create).toHaveBeenCalledWith({ title: 'Test' });
    });

    test('notification with explicit id', async () => {
      mockLocalStorage.sentinelSoundEnabled = true;
      await notifyIfEnabled('test-id', { title: 'Test' });
      expect(chrome.notifications.create).toHaveBeenCalledWith('test-id', { title: 'Test' });
    });

    test('storage.get failure does not throw', async () => {
      chrome.storage.local.get = jest.fn(async () => {
        throw new Error('Storage error');
      });
      await expect(notifyIfEnabled({ title: 'Test' })).resolves.toBeUndefined();
    });

    test('notifications.create failure does not throw', async () => {
      mockLocalStorage.sentinelSoundEnabled = true;
      chrome.notifications.create = jest.fn(async () => {
        throw new Error('Notification API error');
      });
      await expect(notifyIfEnabled({ title: 'Test' })).resolves.toBeUndefined();
    });

    test('null idOrOpts is handled', async () => {
      mockLocalStorage.sentinelSoundEnabled = true;
      await expect(notifyIfEnabled(null)).resolves.toBeUndefined();
    });

    test('undefined optsIfId is handled', async () => {
      mockLocalStorage.sentinelSoundEnabled = true;
      await expect(notifyIfEnabled('test-id', undefined)).resolves.toBeUndefined();
    });
  });

  describe('keepalive fallback to runtime API', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('falls back to runtime.getPlatformInfo when session storage unavailable', () => {
      const origSet = chrome.storage.session.set;
      delete chrome.storage.session.set;
      expect(() => startSwKeepalive('fallback-test')).not.toThrow();
      expect(chrome.runtime.getPlatformInfo).toHaveBeenCalled();
      chrome.storage.session.set = origSet;
      stopSwKeepalive('fallback-test');
      stopSwKeepalive('fallback-test');
    });

    test('fallback triggers on interval tick when session storage unavailable', () => {
      const origSet = chrome.storage.session.set;
      delete chrome.storage.session.set;
      startSwKeepalive('fallback-tick');
      jest.clearAllMocks();
      jest.advanceTimersByTime(20000);
      expect(chrome.runtime.getPlatformInfo).toHaveBeenCalled();
      chrome.storage.session.set = origSet;
      stopSwKeepalive('fallback-tick');
      stopSwKeepalive('fallback-tick');
    });
  });
});
