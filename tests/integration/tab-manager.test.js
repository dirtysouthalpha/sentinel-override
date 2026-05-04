// Sentinel Override v3 -- Integration test for tab-manager.js
// Tests tab-manager functions with mocked Chrome APIs.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock, EventListenerPool } from '../helpers/chrome-mock.js';
import {
  waitForPageLoad,
  injectContentScript,
  sendMessageWithRetry,
  takeScreenshot,
  isValidUrl,
  getTabInfo,
  createContentScriptListener,
  setPageLoadConfig,
} from '../../background/tab-manager.js';

describe('tab-manager (integration)', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
    // Override chrome methods with vi.fn() spies
    chromeMock.tabs.get = vi.fn((tabId, cb) => {
      cb({ id: tabId, status: 'complete', url: 'https://example.com' });
    });
    chromeMock.tabs.sendMessage = vi.fn((tabId, msg, cb) => {
      cb({ ok: true, data: null });
    });
    chromeMock.tabs.update = vi.fn((tabId, props, cb) => {
      if (props?.status && chromeMock.tabs.onUpdated) {
        chromeMock.tabs.onUpdated.fire(tabId, { status: props.status });
      }
      if (cb) cb({ id: tabId, ...props });
    });
    chromeMock.tabs.query = vi.fn((queryInfo, cb) => {
      cb([{ id: 1, status: 'complete' }]);
    });
    chromeMock.tabs.onUpdated = new EventListenerPool();
    chromeMock.scripting.executeScript = vi.fn(() => Promise.resolve([]));
    chromeMock.debugger.attach = vi.fn(() => Promise.resolve());
    chromeMock.debugger.detach = vi.fn(() => Promise.resolve());
    chromeMock.debugger.sendCommand = vi.fn(() => Promise.resolve({ data: 'MOCK_SCREENSHOT_BASE64' }));
    chromeMock.tabs.captureVisibleTab = vi.fn((windowId, opts, cb) => {
      cb('data:image/jpeg;base64,MOCK_SCREENSHOT');
    });
    chromeMock.runtime.onMessage = new EventListenerPool();
    chromeMock.runtime.lastError = null;
    setPageLoadConfig({ pageLoadTimeout: 25000 });
  });

  describe('waitForPageLoad', () => {
    it('resolves immediately when tab status is complete', async () => {
      chromeMock.tabs.get.mockImplementation((tabId, cb) => {
        cb({ id: tabId, status: 'complete' });
      });

      await waitForPageLoad(1);
    });

    it('resolves when tab status becomes complete', async () => {
      chromeMock.tabs.get.mockImplementation((tabId, cb) => {
        cb({ id: tabId, status: 'loading' });
      });

      const promise = waitForPageLoad(1);

      setTimeout(() => {
        chromeMock.tabs.onUpdated.fire(1, { status: 'complete' });
      }, 50);

      await promise;
    });

    it('resolves on timeout if status never completes', async () => {
      chromeMock.tabs.get.mockImplementation((tabId, cb) => {
        cb({ id: tabId, status: 'loading' });
      });

      setPageLoadConfig({ pageLoadTimeout: 100 });
      const promise = waitForPageLoad(1);
      await new Promise(r => setTimeout(r, 200));
      // Should have resolved via timeout without error
    });
  });

  describe('injectContentScript', () => {
    it('returns true when content script signals ready', async () => {
      chromeMock.scripting.executeScript.mockResolvedValue([]);

      setTimeout(() => {
        chromeMock.runtime.onMessage.fire(
          { action: 'content_script_ready' },
          { tab: { id: 1 } }
        );
      }, 10);

      const result = await injectContentScript(1);
      expect(result).toBe(true);
      expect(chromeMock.scripting.executeScript).toHaveBeenCalled();
    });

    it('retries on failure then succeeds', async () => {
      let callCount = 0;
      chromeMock.scripting.executeScript.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw new Error('Tab not found');
        return [];
      });

      // The third attempt succeeds but we also need content_script_ready.
      // Fire the ready message synchronously when the 3rd executeScript runs.
      const origExecuteScript = chromeMock.scripting.executeScript;
      chromeMock.scripting.executeScript.mockImplementation(async () => {
        callCount++;
        if (callCount >= 3) {
          // Simulate content_script_ready after successful injection
          chromeMock.runtime.onMessage.fire(
            { action: 'content_script_ready' },
            { tab: { id: 1 } }
          );
        }
        if (callCount < 3) throw new Error('Tab not found');
        return [];
      });

      const result = await injectContentScript(1, 3);
      expect(result).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('returns false after max retries', async () => {
      chromeMock.scripting.executeScript.mockRejectedValue(new Error('Always fails'));

      const result = await injectContentScript(1, 2);
      expect(result).toBe(false);
      expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendMessageWithRetry', () => {
    it('sends message and returns response', async () => {
      chromeMock.tabs.sendMessage.mockResolvedValue({ ok: true, data: { result: 'success' } });

      const result = await sendMessageWithRetry(1, { action: 'test' });
      expect(result).toEqual({ ok: true, data: { result: 'success' } });
    });

    it('throws after max retries exhausted', async () => {
      chromeMock.tabs.sendMessage.mockRejectedValue(new Error('Connection refused'));

      await expect(sendMessageWithRetry(1, { action: 'test' }, 2))
        .rejects.toThrow('Connection refused');
    });
  });

  describe('takeScreenshot', () => {
    it('uses cached screenshot when URL matches', async () => {
      const screenshotCache = {
        cachedBase64Image: 'cached_base64',
        lastScreenshotUrl: 'https://example.com',
      };

      const result = await takeScreenshot(
        1, 1, 'https://example.com', screenshotCache,
        { screenshotCache: true, screenshotQuality: 30 }, 1, vi.fn()
      );

      expect(result).toEqual({
        base64Image: 'cached_base64',
        url: 'https://example.com',
      });
      expect(chromeMock.debugger.attach).not.toHaveBeenCalled();
    });

    it('takes new screenshot via CDP when URL differs', async () => {
      const screenshotCache = {
        cachedBase64Image: null,
        lastScreenshotUrl: null,
      };

      const result = await takeScreenshot(
        1, 1, 'https://example.com', screenshotCache,
        { screenshotCache: true, screenshotQuality: 30 }, 1, vi.fn()
      );

      expect(chromeMock.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
      expect(chromeMock.debugger.sendCommand).toHaveBeenCalled();
      expect(result.base64Image).toBe('MOCK_SCREENSHOT_BASE64');
      expect(screenshotCache.cachedBase64Image).toBe('MOCK_SCREENSHOT_BASE64');
    });

    it('still takes screenshot when cache disabled but no cached image', async () => {
      const screenshotCache = {
        cachedBase64Image: null,
        lastScreenshotUrl: null,
      };

      const result = await takeScreenshot(
        1, 1, 'https://example.com', screenshotCache,
        { screenshotCache: false, screenshotQuality: 30 }, 1, vi.fn()
      );

      // Cache disabled + no cached image means it still takes a screenshot
      expect(result).not.toBeNull();
    });
  });

  describe('isValidUrl', () => {
    it('returns true for http URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
    });

    it('returns true for https URLs', () => {
      expect(isValidUrl('https://example.com/path')).toBe(true);
    });

    it('returns false for non-http URLs', () => {
      expect(isValidUrl('chrome://extensions')).toBe(false);
      expect(isValidUrl('about:blank')).toBe(false);
      expect(isValidUrl('not-a-url')).toBe(false);
    });
  });

  describe('getTabInfo', () => {
    it('returns tab info when tab exists', async () => {
      const tabData = { id: 1, url: 'https://example.com', title: 'Test' };
      chromeMock.tabs.get.mockImplementation((tabId, cb) => {
        cb(tabData);
      });

      const result = await getTabInfo(1);
      expect(result).toEqual(tabData);
    });

    it('returns null when tab does not exist', async () => {
      chromeMock.runtime.lastError = { message: 'Tab not found' };
      chromeMock.tabs.get.mockImplementation((tabId, cb) => {
        cb(undefined);
      });

      const result = await getTabInfo(999);
      expect(result).toBeNull();
      chromeMock.runtime.lastError = null;
    });
  });

  describe('createContentScriptListener', () => {
    it('resolves true when content_script_ready message received', async () => {
      const { promise } = createContentScriptListener(1, 2000);

      setTimeout(() => {
        chromeMock.runtime.onMessage.fire(
          { action: 'content_script_ready' },
          { tab: { id: 1 } }
        );
      }, 10);

      await expect(promise).resolves.toBe(true);
    });

    it('resolves false on timeout', async () => {
      const { promise } = createContentScriptListener(1, 50);

      await expect(promise).resolves.toBe(false);
    });
  });
});
