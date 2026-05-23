// tests/tab-context-edge-cases.test.js
// Edge case tests for background/tab-context.js error paths

import { jest } from '@jest/globals';

globalThis.chrome = {
  tabs: {
    create: jest.fn(async () => ({ id: 123 })),
    update: jest.fn(async () => ({ id: 123 })),
    remove: jest.fn(async () => {}),
    get: jest.fn(async () => ({ id: 123, url: 'https://example.com', title: 'Test' })),
  },
};

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test Page' })),
  closeTab: jest.fn(async () => {}),
  takeScreenshot: jest.fn(async () => 'data:image/png;base64,abc'),
}));

describe('tab-context edge cases', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset all tab contexts before each test
    const { resetAllContexts } = await import('../background/tab-context.js');
    resetAllContexts();
  });

  describe('openTab error paths', () => {
    test('should handle chrome.tabs.create rejection', async () => {
      const { openTab } = await import('../background/tab-context.js');

      chrome.tabs.create.mockRejectedValueOnce(new Error('Tab creation failed'));

      const result = await openTab('https://example.com');
      expect(result).toBeNull();
    });

    test('should handle waitForPageLoad error gracefully', async () => {
      const { openTab } = await import('../background/tab-context.js');
      const { waitForPageLoad } = await import('../background/tab-manager.js');

      waitForPageLoad.mockRejectedValueOnce(new Error('Page load timeout'));

      // Should not throw and should still return a context
      const result = await openTab('https://example.com');
      expect(result).not.toBeNull();
      expect(result.tabId).toBeDefined();
    });

    test('should handle getTabInfo error gracefully', async () => {
      const { openTab } = await import('../background/tab-context.js');
      const { getTabInfo } = await import('../background/tab-manager.js');

      getTabInfo.mockRejectedValueOnce(new Error('Tab info failed'));

      // Should not throw and should still return a context with original URL
      const result = await openTab('https://example.com');
      expect(result).not.toBeNull();
      expect(result.url).toBe('https://example.com');
    });

    test('should handle LRU eviction when tab limit is reached', async () => {
      const { openTab } = await import('../background/tab-context.js');

      // TAB_LIMIT is 10, so creating 11 tabs should trigger eviction
      for (let i = 0; i < 11; i++) {
        chrome.tabs.create.mockResolvedValueOnce({ id: 100 + i });
        await openTab(`https://example.com/${i}`);
      }

      // chrome.tabs.remove should have been called for LRU eviction
      expect(chrome.tabs.remove).toHaveBeenCalled();
    });

    test('should handle closeTab failure during LRU eviction', async () => {
      const { openTab } = await import('../background/tab-context.js');
      const { closeTab } = await import('../background/tab-manager.js');

      // Fill up to the limit
      for (let i = 0; i < 11; i++) {
        chrome.tabs.create.mockResolvedValueOnce({ id: 100 + i });
        await openTab(`https://example.com/${i}`);
      }

      // Make closeTab fail
      closeTab.mockRejectedValueOnce(new Error('Close failed'));

      // Should not throw despite closeTab failure
      chrome.tabs.create.mockResolvedValueOnce({ id: 200 });
      const result = await openTab('https://example.com/new');
      expect(result).not.toBeNull();
    });
  });

  describe('switchToTab error paths', () => {
    test('should return false for non-existent tab', async () => {
      const { switchToTab } = await import('../background/tab-context.js');

      const result = await switchToTab(999);
      expect(result).toBe(false);
    });

    test('should handle chrome.tabs.update rejection', async () => {
      const { switchToTab } = await import('../background/tab-context.js');
      const { openTab } = await import('../background/tab-context.js');

      // Create a tab first
      chrome.tabs.create.mockResolvedValueOnce({ id: 123 });
      const ctx = await openTab('https://example.com');

      // Make tabs.update reject
      chrome.tabs.update.mockRejectedValueOnce(new Error('Update failed'));

      const result = await switchToTab(ctx.tabId);
      expect(result).toBe(false);
    });
  });

  describe('closeTab error paths', () => {
    test('should handle chrome.tabs.remove rejection for agent-created tabs', async () => {
      const { closeTab: closeTabContext } = await import('../background/tab-context.js');
      const { openTab } = await import('../background/tab-context.js');

      // Create a tab first
      chrome.tabs.create.mockResolvedValueOnce({ id: 123 });
      const ctx = await openTab('https://example.com');

      // Make tabs.remove reject
      chrome.tabs.remove.mockRejectedValueOnce(new Error('Remove failed'));

      // Should not throw
      await expect(closeTabContext(ctx.tabId)).resolves.not.toThrow();
    });

    test('should handle closing active tab and switching to another', async () => {
      const { closeTab: closeTabContext, setActiveTab } = await import('../background/tab-context.js');
      const { openTab } = await import('../background/tab-context.js');

      // Create two tabs
      chrome.tabs.create.mockResolvedValueOnce({ id: 123 });
      const ctx1 = await openTab('https://example.com/1');
      chrome.tabs.create.mockResolvedValueOnce({ id: 124 });
      const ctx2 = await openTab('https://example.com/2');

      // Set ctx1 as active
      setActiveTab(ctx1.tabId);

      // Close ctx1 - should switch to ctx2
      await closeTabContext(ctx1.tabId);

      // Verify ctx2 is now active
      const { getActiveTabId } = await import('../background/tab-context.js');
      const activeId = getActiveTabId();
      expect(activeId).toBe(ctx2.tabId);
    });
  });

  describe('getTabContext edge cases', () => {
    test('should return undefined for non-existent tab', async () => {
      const { getTabContext } = await import('../background/tab-context.js');

      const result = getTabContext(999);
      expect(result).toBeUndefined();
    });

    test('should return context for existing tab', async () => {
      const { getTabContext, openTab } = await import('../background/tab-context.js');

      chrome.tabs.create.mockResolvedValueOnce({ id: 123 });
      const ctx = await openTab('https://example.com');

      // getTabContext returns the context from the internal map
      const result = getTabContext(ctx.tabId);
      expect(result).not.toBeUndefined();
      expect(result.tabId).toBe(ctx.tabId);
    });
  });

  describe('getAllTabContexts edge cases', () => {
    test('should return empty array when no tabs exist', async () => {
      const { getAllTabContexts } = await import('../background/tab-context.js');

      // Contexts were already reset in beforeEach
      const result = getAllTabContexts();
      expect(result).toEqual([]);
    });

    test('should return all tab contexts', async () => {
      const { getAllTabContexts, openTab } = await import('../background/tab-context.js');

      // Create multiple tabs
      chrome.tabs.create.mockResolvedValueOnce({ id: 123 });
      await openTab('https://example.com/1');
      chrome.tabs.create.mockResolvedValueOnce({ id: 124 });
      await openTab('https://example.com/2');

      const result = getAllTabContexts();
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('setActiveTab edge cases', () => {
    test('should return false when setting active tab that does not exist', async () => {
      const { setActiveTab, getActiveTabId } = await import('../background/tab-context.js');

      const result = setActiveTab(999);
      const activeId = getActiveTabId();

      // setActiveTab returns false and doesn't change activeTabId for non-existent tabs
      expect(result).toBe(false);
      expect(activeId).toBeNull();
    });

    test('should update isActive flag on tab contexts', async () => {
      const { setActiveTab, openTab, getTabContext } = await import('../background/tab-context.js');

      chrome.tabs.create.mockResolvedValueOnce({ id: 123 });
      const ctx1 = await openTab('https://example.com/1');
      chrome.tabs.create.mockResolvedValueOnce({ id: 124 });
      const ctx2 = await openTab('https://example.com/2');

      setActiveTab(ctx1.tabId);

      const activeCtx = getTabContext(ctx1.tabId);
      expect(activeCtx.isActive).toBe(true);
    });
  });
});
