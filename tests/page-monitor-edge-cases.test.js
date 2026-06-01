// tests/page-monitor-edge-cases.test.js
// Edge case and race condition tests for background/page-monitor.js
// Tests concurrent operations, storage failures, and malformed inputs.

import { jest } from '@jest/globals';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const key = typeof keys === 'string' ? keys : Array.isArray(keys) ? keys[0] : Object.keys(keys)[0];
        return { [key]: storageData[key] || [] };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
    },
  },
  tabs: {
    query: jest.fn(async () => []),
  },
  scripting: {
    executeScript: jest.fn(async () => []),
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
  },
  notifications: {
    create: jest.fn(async () => ''),
  },
  runtime: {
    getURL: jest.fn((path) => 'chrome-extension://xxx/' + path),
  },
};

const {
  loadMonitors,
  createMonitor,
  removeMonitor,
  toggleMonitor,
  checkMonitor,
  runMonitorCycle,
  _resetMonitorLoop,
} = await import('../background/page-monitor.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
  if (typeof _resetMonitorLoop === 'function') {
    _resetMonitorLoop();
  }
  // Restore storage mock implementations
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const key = typeof keys === 'string' ? keys : Array.isArray(keys) ? keys[0] : Object.keys(keys)[0];
    return { [key]: storageData[key] || [] };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.tabs.query.mockResolvedValue([]);
  chrome.scripting.executeScript.mockResolvedValue([{ result: '' }]);
});

describe('page-monitor — edge cases and race conditions', () => {
  describe('malformed inputs', () => {
    test('handles null URL', async () => {
      await expect(createMonitor(null, '#content', 'Test')).rejects.toThrow();
    });

    test('handles undefined URL', async () => {
      await expect(createMonitor(undefined, '#content', 'Test')).rejects.toThrow();
    });

    test('handles URL with spaces only', async () => {
      const monitor = await createMonitor('   ', '#content', 'Test');
      expect(monitor.url).toBe('');
    });

    test('handles selector with special characters', async () => {
      const monitor = await createMonitor('https://example.com', 'div[data-test="foo:bar"]', 'Test');
      expect(monitor.selector).toBe('div[data-test="foo:bar"]');
    });

    test('handles very long URLs', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2000);
      const monitor = await createMonitor(longUrl, '#content', 'Test');
      expect(monitor.url).toBe(longUrl);
    });

    test('handles very long selectors', async () => {
      const longSelector = '#' + 'a'.repeat(2000);
      const monitor = await createMonitor('https://example.com', longSelector, 'Test');
      expect(monitor.selector).toBe(longSelector);
    });

    test('handles empty label', async () => {
      const monitor = await createMonitor('https://example.com', '#content', '');
      expect(monitor.label).toBe('Monitor: #content');
    });

    test('handles label with only whitespace', async () => {
      const monitor = await createMonitor('https://example.com', '#content', '   ');
      expect(monitor.label).toBe('Monitor: #content');
    });

    test('handles negative interval', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test', -10);
      expect(monitor.interval).toBe(-10);
    });

    test('handles zero interval', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test', 0);
      expect(monitor.interval).toBe(0);
    });

    test('handles fractional interval', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test', 1.5);
      expect(monitor.interval).toBe(1.5);
    });
  });

  describe('storage failures', () => {
    test('handles storage.get failure during loadMonitors', async () => {
      chrome.storage.local.get.mockImplementation(async () => {
        throw new Error('Storage read failed');
      });

      // loadMonitors doesn't handle errors, so it should reject
      await expect(loadMonitors()).rejects.toThrow('Storage read failed');
    });

    test('handles storage.set failure during createMonitor', async () => {
      chrome.storage.local.set.mockImplementation(async () => {
        throw new Error('Storage write failed');
      });

      await expect(createMonitor('https://example.com', '#content', 'Test')).rejects.toThrow();
    });

    test('handles storage.set failure during removeMonitor', async () => {
      await createMonitor('https://example.com', '#content', 'Test');

      chrome.storage.local.set.mockImplementation(async () => {
        throw new Error('Storage write failed');
      });

      await expect(removeMonitor('mon-123')).rejects.toThrow();
    });

    test('handles storage.set failure during toggleMonitor', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      chrome.storage.local.set.mockImplementation(async () => {
        throw new Error('Storage write failed');
      });

      await expect(toggleMonitor(monitor.id, false)).rejects.toThrow();
    });
  });

  describe('concurrent operations', () => {
    test('handles concurrent createMonitor operations', async () => {
      const promises = [
        createMonitor('https://example1.com', '#content1', 'Test1'),
        createMonitor('https://example2.com', '#content2', 'Test2'),
        createMonitor('https://example3.com', '#content3', 'Test3'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results[0].id).not.toBe(results[1].id);
      expect(results[1].id).not.toBe(results[2].id);
    });

    test('handles concurrent removeMonitor operations', async () => {
      const m1 = await createMonitor('https://example1.com', '#content1', 'Test1');
      const m2 = await createMonitor('https://example2.com', '#content2', 'Test2');
      const m3 = await createMonitor('https://example3.com', '#content3', 'Test3');

      const promises = [
        removeMonitor(m1.id),
        removeMonitor(m2.id),
        removeMonitor(m3.id),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    test('handles concurrent toggleMonitor operations', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      const promises = [
        toggleMonitor(monitor.id, true),
        toggleMonitor(monitor.id, false),
        toggleMonitor(monitor.id, true),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    test('handles createMonitor and removeMonitor concurrently', async () => {
      const m1 = await createMonitor('https://example1.com', '#content1', 'Test1');
      const m2 = await createMonitor('https://example2.com', '#content2', 'Test2');

      const promises = [
        createMonitor('https://example3.com', '#content3', 'Test3'),
        removeMonitor(m1.id),
        toggleMonitor(m2.id, false),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });

  describe('content script failures', () => {
    test('handles tab.query returning no tabs', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      chrome.tabs.query.mockResolvedValue([]);

      const result = await checkMonitor(monitor);

      expect(result.changed).toBe(false);
      expect(result.content).toBe('');
    });

    test('handles executeScript throwing error', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockImplementation(async () => {
        throw new Error('Script injection failed');
      });

      const result = await checkMonitor(monitor);

      expect(result.changed).toBe(false);
    });

    test('handles executeScript returning null result', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([{ result: null }]);

      const result = await checkMonitor(monitor);

      expect(result.changed).toBe(false);
    });

    test('handles executeScript returning undefined result', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([{}]);

      const result = await checkMonitor(monitor);

      expect(result.changed).toBe(false);
    });

    test('handles executeScript throwing during selector query', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: undefined },
      ]);

      const result = await checkMonitor(monitor);

      expect(result.changed).toBe(false);
    });
  });

  describe('runMonitorCycle edge cases', () => {
    test('handles empty monitor list', async () => {
      chrome.notifications.create.mockResolvedValue('');

      await runMonitorCycle();

      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('handles monitors with active=false', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');
      await toggleMonitor(monitor.id, false);

      chrome.notifications.create.mockResolvedValue('');

      await runMonitorCycle();

      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('handles monitors with URL pattern matching no tabs', async () => {
      await createMonitor('https://nonexistent.com', '#content', 'Test');

      chrome.notifications.create.mockResolvedValue('');

      await runMonitorCycle();

      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('handles mix of active and inactive monitors', async () => {
      const m1 = await createMonitor('https://example1.com', '#content1', 'Test1');
      const m2 = await createMonitor('https://example2.com', '#content2', 'Test2');
      await toggleMonitor(m2.id, false);
      const m3 = await createMonitor('https://example3.com', '#content3', 'Test3');

      chrome.notifications.create.mockResolvedValue('');

      await runMonitorCycle();

      // Should check monitors 1 and 3 (active), skip monitor 2 (inactive)
      expect(chrome.tabs.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('data consistency', () => {
    test('handles toggle on non-existent monitor', async () => {
      await toggleMonitor('non-existent-id', true);

      const monitors = await loadMonitors();
      expect(monitors).toHaveLength(0);
    });

    test('handles remove on non-existent monitor', async () => {
      await removeMonitor('non-existent-id');

      const monitors = await loadMonitors();
      expect(monitors).toHaveLength(0);
    });

    test('handles multiple operations on same monitor', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      await toggleMonitor(monitor.id, false);
      await toggleMonitor(monitor.id, true);
      await toggleMonitor(monitor.id, false);

      const monitors = await loadMonitors();
      const m = monitors.find(x => x.id === monitor.id);
      expect(m.active).toBe(false);
    });
  });
});
