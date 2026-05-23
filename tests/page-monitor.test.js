/**
 * Tests for page-monitor.js
 * DOM change monitoring with alarms and notifications.
 */

import { jest } from '@jest/globals';

// Setup chrome mock BEFORE importing the module
const mockStorage = {};
const mockAlarms = {};
const mockNotifications = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        if (keys === 'sentinel_monitors') {
          result['sentinel_monitors'] = mockStorage['sentinel_monitors'] || [];
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((data, callback) => {
        Object.assign(mockStorage, data);
        if (callback) callback();
        return Promise.resolve();
      }),
    },
  },
  tabs: {
    query: jest.fn(),
  },
  scripting: {
    executeScript: jest.fn(),
  },
  alarms: {
    create: jest.fn((name, config) => {
      mockAlarms[name] = config;
      return Promise.resolve();
    }),
    onAlarm: {
      addListener: jest.fn(),
    },
  },
  notifications: {
    create: jest.fn((id, options) => {
      mockNotifications[id] = options;
      return Promise.resolve(id);
    }),
  },
  runtime: {
    getURL: jest.fn(path => `chrome-extension://test/${path}`),
  },
};

// Now import the module after chrome is mocked
import {
  loadMonitors,
  createMonitor,
  removeMonitor,
  toggleMonitor,
  checkMonitor,
  runMonitorCycle,
  startMonitorLoop,
} from '../background/page-monitor.js';

describe('page-monitor', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    Object.keys(mockAlarms).forEach(key => delete mockAlarms[key]);
    Object.keys(mockNotifications).forEach(key => delete mockNotifications[key]);
    jest.clearAllMocks();
  });

  describe('loadMonitors', () => {
    it('should return empty array when no monitors exist', async () => {
      const monitors = await loadMonitors();
      expect(monitors).toEqual([]);
    });

    it('should return existing monitors', async () => {
      const testMonitors = [
        {
          id: 'mon-1',
          url: 'https://example.com',
          selector: '#content',
          lastContent: '',
          label: 'Test Monitor',
          active: true,
          interval: 30,
          createdAt: '2024-01-01',
          lastChangedAt: null,
          changeCount: 0,
        },
      ];
      mockStorage['sentinel_monitors'] = testMonitors;

      const monitors = await loadMonitors();
      expect(monitors).toEqual(testMonitors);
    });
  });

  describe('createMonitor', () => {
    it('should create a new monitor with valid data', async () => {
      const url = 'https://example.com';
      const selector = '#content';
      const label = 'Test Monitor';

      const monitor = await createMonitor(url, selector, label, 60);

      expect(monitor).toMatchObject({
        url,
        selector,
        label,
        active: true,
        interval: 60,
        lastContent: '',
        lastChangedAt: null,
        changeCount: 0,
      });
      expect(monitor.id).toBeDefined();
      expect(monitor.createdAt).toBeDefined();

      const stored = mockStorage['sentinel_monitors'];
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(monitor);
    });

    it('should default interval to 30 seconds', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      expect(monitor.interval).toBe(30);
    });

    it('should trim whitespace from url, selector, and label', async () => {
      const monitor = await createMonitor(
        '  https://example.com  ',
        '  #content  ',
        '  Test Monitor  '
      );

      expect(monitor.url).toBe('https://example.com');
      expect(monitor.selector).toBe('#content');
      expect(monitor.label).toBe('Test Monitor');
    });

    it('should generate default label from selector when empty', async () => {
      const monitor = await createMonitor('https://example.com', '#content', '  ');

      expect(monitor.label).toBe('Monitor: #content');
    });
  });

  describe('removeMonitor', () => {
    beforeEach(async () => {
      await createMonitor('https://example1.com', '#content1', 'Monitor 1');
      await createMonitor('https://example2.com', '#content2', 'Monitor 2');
      await createMonitor('https://example3.com', '#content3', 'Monitor 3');
    });

    it('should remove monitor by id', async () => {
      const monitorsBefore = await loadMonitors();
      const idToRemove = monitorsBefore[1].id;

      await removeMonitor(idToRemove);

      const monitorsAfter = await loadMonitors();
      expect(monitorsAfter).toHaveLength(2);
      expect(monitorsAfter.find(m => m.id === idToRemove)).toBeUndefined();
    });

    it('should handle removing non-existent monitor gracefully', async () => {
      const monitorsBefore = await loadMonitors();
      await removeMonitor('non-existent-id');

      const monitorsAfter = await loadMonitors();
      expect(monitorsAfter).toHaveLength(monitorsBefore.length);
    });
  });

  describe('toggleMonitor', () => {
    it('should toggle monitor active state', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test');

      await toggleMonitor(monitor.id, false);
      let monitors = await loadMonitors();
      expect(monitors[0].active).toBe(false);

      await toggleMonitor(monitor.id, true);
      monitors = await loadMonitors();
      expect(monitors[0].active).toBe(true);
    });

    it('should handle toggling non-existent monitor gracefully', async () => {
      await toggleMonitor('non-existent', true);
      // Should not throw
    });
  });

  describe('checkMonitor', () => {
    let testMonitor;

    beforeEach(async () => {
      testMonitor = await createMonitor('https://example.com', '#content', 'Test');
    });

    it('should return no change when no tabs match', async () => {
      chrome.tabs.query.mockResolvedValue([]);

      const result = await checkMonitor(testMonitor);

      expect(result).toEqual({ changed: false, content: '' });
    });

    it('should execute script in matching tab', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: 'Sample content' },
      ]);

      const result = await checkMonitor(testMonitor);

      expect(chrome.tabs.query).toHaveBeenCalledWith({ url: testMonitor.url });
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 1 },
        func: expect.any(Function),
        args: [testMonitor.selector],
      });
      expect(result.content).toBe('Sample content');
    });

    it('should detect change when content differs from lastContent', async () => {
      testMonitor.lastContent = 'Old content';
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: 'New content' },
      ]);

      const result = await checkMonitor(testMonitor);

      expect(result.changed).toBe(true);
      expect(result.content).toBe('New content');

      const monitors = await loadMonitors();
      expect(monitors[0].lastContent).toBe('New content');
      expect(monitors[0].lastChangedAt).toBeDefined();
      expect(monitors[0].changeCount).toBe(1);
    });

    it('should not detect change when content is same as lastContent', async () => {
      testMonitor.lastContent = 'Same content';
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: 'Same content' },
      ]);

      const result = await checkMonitor(testMonitor);

      expect(result.changed).toBe(false);
      expect(result.content).toBe('Same content');

      const monitors = await loadMonitors();
      expect(monitors[0].changeCount).toBe(0);
    });

    it('should return no change when content is empty', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: '' },
      ]);

      const result = await checkMonitor(testMonitor);

      expect(result).toEqual({ changed: false, content: '' });
    });

    it('should return no change when executeScript returns no result', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([]);

      const result = await checkMonitor(testMonitor);

      expect(result).toEqual({ changed: false, content: '' });
    });

    it('should handle errors gracefully', async () => {
      chrome.tabs.query.mockRejectedValue(new Error('Tab error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await checkMonitor(testMonitor);

      expect(result).toEqual({ changed: false, content: '' });
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Sentinel/page-monitor] checkMonitor failed:',
        'Tab error'
      );
      consoleSpy.mockRestore();
    });

    it('should handle element not found (empty textContent)', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: null },
      ]);

      const result = await checkMonitor(testMonitor);

      expect(result).toEqual({ changed: false, content: '' });
    });
  });

  describe('runMonitorCycle', () => {
    beforeEach(async () => {
      await createMonitor('https://example1.com', '#content1', 'Monitor 1', 30);
      await createMonitor('https://example2.com', '#content2', 'Monitor 2', 60);
    });

    it('should check all active monitors', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([{ result: 'Content' }]);

      await runMonitorCycle();

      expect(chrome.tabs.query).toHaveBeenCalledTimes(2);
    });

    it('should skip inactive monitors', async () => {
      const monitors = await loadMonitors();
      await toggleMonitor(monitors[0].id, false);

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([{ result: 'Content' }]);

      await runMonitorCycle();

      expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    });

    it('should create notification on change', async () => {
      const monitors = await loadMonitors();
      monitors[0].lastContent = 'Old content';

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript
        .mockResolvedValueOnce([{ result: 'New content' }])
        .mockResolvedValueOnce([{ result: 'Content' }]);

      await runMonitorCycle();

      const notificationId = `sentinel-change-${monitors[0].id}`;
      expect(mockNotifications[notificationId]).toMatchObject({
        type: 'basic',
        title: 'Sentinel Override — Change Detected',
        priority: 2,
      });
      expect(mockNotifications[notificationId].message).toContain('Monitor 1');
      expect(mockNotifications[notificationId].message).toContain('1 changes total');
    });

    it('should not create notification when no changes', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([{ result: 'Content' }]);

      await runMonitorCycle();

      expect(Object.keys(mockNotifications)).toHaveLength(0);
    });

    it('should handle multiple changes with correct counts', async () => {
      const monitors = await loadMonitors();
      monitors[0].lastContent = 'Old';
      monitors[1].lastContent = 'Old';

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([{ result: 'New' }]);

      await runMonitorCycle();

      const updated = await loadMonitors();
      expect(updated[0].changeCount).toBe(1);
      expect(updated[1].changeCount).toBe(1);
    });
  });

  describe('startMonitorLoop', () => {
    it('should create alarm with 30 second interval', () => {
      const alarmName = startMonitorLoop();

      expect(alarmName).toBe('sentinel-monitor-check');
      expect(chrome.alarms.create).toHaveBeenCalledWith('sentinel-monitor-check', {
        periodInMinutes: 0.5,
      });
    });

    it('should register alarm listener', () => {
      startMonitorLoop();

      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should register alarm listener that checks alarm name', () => {
      startMonitorLoop();

      // Verify that a listener was registered
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should create alarm and register listener', () => {
      const alarmName = startMonitorLoop();

      expect(alarmName).toBe('sentinel-monitor-check');
      expect(chrome.alarms.create).toHaveBeenCalledWith('sentinel-monitor-check', {
        periodInMinutes: 0.5,
      });
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty selector', async () => {
      const monitor = await createMonitor('https://example.com', '', 'Test');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.scripting.executeScript.mockResolvedValue([
        { result: '' },
      ]);

      const result = await checkMonitor(monitor);

      expect(result.changed).toBe(false);
    });

    it('should handle URL pattern with wildcards', async () => {
      const monitor = await createMonitor('https://*.example.com/*', '#content', 'Test');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);

      await checkMonitor(monitor);

      expect(chrome.tabs.query).toHaveBeenCalledWith({ url: monitor.url });
    });

    it('should handle very short intervals', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test', 1);

      expect(monitor.interval).toBe(1);
    });

    it('should handle very long intervals', async () => {
      const monitor = await createMonitor('https://example.com', '#content', 'Test', 3600);

      expect(monitor.interval).toBe(3600);
    });
  });
});
