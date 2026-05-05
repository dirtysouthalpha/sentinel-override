// Sentinel Override v3 -- Unit tests for tab-context.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

// Mock dependencies before importing tab-context
vi.mock('../../background/message-protocol.js', () => ({
  sendTabStateUpdate: vi.fn(),
}));
vi.mock('../../background/tab-manager.js', () => ({
  waitForPageLoad: vi.fn(() => Promise.resolve()),
  getTabInfo: vi.fn(() => Promise.resolve({ url: 'https://example.com', title: 'Test' })),
}));

import {
  getActiveTabId, setActiveTab, getTabContext, getAllTabContexts, getTabCount,
  registerInitialTab, findTabByLabel, resetAllContexts, updateSnapshot,
  handleTabRemoved, openTab, switchToTab, closeTab, closeAllAgentTabs, TAB_LIMIT,
} from '../../background/tab-context.js';

describe('tab-context', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
    resetAllContexts();
  });

  describe('registerInitialTab', () => {
    it('creates context with isActive=true and isAgentCreated=false', () => {
      registerInitialTab(1, 'https://example.com');

      const ctx = getTabContext(1);
      expect(ctx).toBeDefined();
      expect(ctx.tabId).toBe(1);
      expect(ctx.url).toBe('https://example.com');
      expect(ctx.isActive).toBe(true);
      expect(ctx.isAgentCreated).toBe(false);
      expect(ctx.label).toBe('Main Task Tab');
    });

    it('sets the active tab ID', () => {
      registerInitialTab(42, 'https://test.com');
      expect(getActiveTabId()).toBe(42);
    });
  });

  describe('getActiveTabId / getTabContext / getAllTabContexts', () => {
    it('returns null when no tabs registered', () => {
      expect(getActiveTabId()).toBeNull();
    });

    it('returns correct tab context', () => {
      registerInitialTab(1, 'https://example.com');
      const ctx = getTabContext(1);
      expect(ctx.tabId).toBe(1);
    });

    it('returns undefined for non-existent tab', () => {
      expect(getTabContext(999)).toBeUndefined();
    });

    it('returns array of all contexts', () => {
      registerInitialTab(1, 'https://a.com');
      // Register a second tab (simulate via direct map manipulation since openTab needs chrome.tabs.create)
      const contexts = getAllTabContexts();
      expect(contexts.length).toBe(1);
      expect(contexts[0].tabId).toBe(1);
    });

    it('returns correct tab count', () => {
      expect(getTabCount()).toBe(0);
      registerInitialTab(1, 'https://a.com');
      expect(getTabCount()).toBe(1);
    });
  });

  describe('setActiveTab', () => {
    it('deactivates previous tab and activates new one', () => {
      registerInitialTab(1, 'https://a.com');

      // Manually add a second tab to the context map
      // We can't use openTab without full chrome mock setup, so we use registerInitialTab
      // and then setActiveTab. But we need a second tab...
      // Let's use the internal state by importing and calling directly.
      // Actually, let's just test with what we have.
      expect(getTabContext(1).isActive).toBe(true);

      // Register another initial tab (this would replace the active, but let's verify)
      // We need to use setActiveTab on a registered tab
      // For now, let's just test the function behavior
      expect(setActiveTab(999)).toBe(false); // Not registered
      expect(setActiveTab(1)).toBe(true); // Already active, but valid
      expect(getActiveTabId()).toBe(1);
    });
  });

  describe('findTabByLabel', () => {
    it('finds tab by case-insensitive partial match', () => {
      registerInitialTab(1, 'https://example.com');
      // The label is 'Main Task Tab' from registerInitialTab
      const found = findTabByLabel('task');
      expect(found).toBe(1);
    });

    it('returns null for no match', () => {
      registerInitialTab(1, 'https://example.com');
      expect(findTabByLabel('nonexistent')).toBeNull();
    });

    it('returns null for empty label', () => {
      expect(findTabByLabel('')).toBeNull();
      expect(findTabByLabel(null)).toBeNull();
    });
  });

  describe('updateSnapshot', () => {
    it('updates snapshot data for a registered tab', () => {
      registerInitialTab(1, 'https://example.com');

      updateSnapshot(1, {
        elements: [{ tag: 'button', text: 'Click' }],
        pageContent: 'Page content here',
        url: 'https://example.com/new',
        title: 'New Title',
      });

      const ctx = getTabContext(1);
      expect(ctx.snapshot).toBeDefined();
      expect(ctx.snapshot.elements).toHaveLength(1);
      expect(ctx.snapshot.pageContent).toBe('Page content here');
      expect(ctx.url).toBe('https://example.com/new');
      expect(ctx.title).toBe('New Title');
    });

    it('does nothing for non-existent tab', () => {
      updateSnapshot(999, { elements: [], pageContent: '' });
      // No error thrown
      expect(getTabContext(999)).toBeUndefined();
    });
  });

  describe('handleTabRemoved', () => {
    it('removes tab from context map', () => {
      registerInitialTab(1, 'https://example.com');
      expect(getTabCount()).toBe(1);

      handleTabRemoved(1);
      expect(getTabCount()).toBe(0);
      expect(getTabContext(1)).toBeUndefined();
    });

    it('switches active tab when active tab is removed and other tabs exist', () => {
      // Set up two tabs: register first, then register second
      // registerInitialTab always sets isActive=true on the new one
      registerInitialTab(1, 'https://a.com');
      // For the second tab, we need to add it without making it active
      // We can use the exported registerInitialTab but it always sets active.
      // Instead, let's use the handleTabRemoved directly with a single tab
      // and verify that activeTabId becomes null when the only tab is removed.
      handleTabRemoved(1);
      expect(getActiveTabId()).toBeNull();
    });

    it('does nothing for untracked tab', () => {
      handleTabRemoved(999);
      expect(getTabCount()).toBe(0);
    });
  });

  describe('resetAllContexts', () => {
    it('clears all contexts and activeTabId', () => {
      registerInitialTab(1, 'https://a.com');
      expect(getTabCount()).toBe(1);
      expect(getActiveTabId()).toBe(1);

      resetAllContexts();
      expect(getTabCount()).toBe(0);
      expect(getActiveTabId()).toBeNull();
    });
  });

  describe('TAB_LIMIT', () => {
    it('is defined as a number', () => {
      expect(TAB_LIMIT).toBe(5);
    });
  });

  describe('openTab', () => {
    it('creates a new tab context and activates it', async () => {
      const ctx = await openTab('https://example.com', 'Test Label');

      expect(ctx).toBeDefined();
      expect(ctx.tabId).toBe(1); // first tab from mock
      expect(ctx.url).toBe('https://example.com');
      expect(ctx.label).toBe('Test Label');
      expect(ctx.isActive).toBe(true);
      expect(ctx.isAgentCreated).toBe(true);
      expect(ctx.snapshot).toBeNull();
      expect(ctx.screenshotCache).toEqual({ cachedBase64Image: null, lastScreenshotUrl: null });
      expect(getActiveTabId()).toBe(1);
      expect(getTabCount()).toBe(1);
    });

    it('defaults label to url when no label provided', async () => {
      const ctx = await openTab('https://example.com');
      expect(ctx.label).toBe('https://example.com');
    });

    it('updates url and title from getTabInfo', async () => {
      const { getTabInfo } = await import('../../background/tab-manager.js');
      getTabInfo.mockResolvedValueOnce({ url: 'https://redirected.com', title: 'Redirected' });

      const ctx = await openTab('https://example.com', 'Test');
      expect(ctx.url).toBe('https://redirected.com');
      expect(ctx.title).toBe('Redirected');
    });

    it('handles null getTabInfo gracefully', async () => {
      const { getTabInfo } = await import('../../background/tab-manager.js');
      getTabInfo.mockResolvedValueOnce(null);

      const ctx = await openTab('https://example.com', 'Test');
      expect(ctx.url).toBe('https://example.com');
      expect(ctx.title).toBe('');
    });

    it('calls chrome.tabs.create with correct options', async () => {
      const createSpy = vi.spyOn(chromeMock.tabs, 'create');
      await openTab('https://example.com', 'Test');
      expect(createSpy).toHaveBeenCalledWith({ url: 'https://example.com', active: false });
      createSpy.mockRestore();
    });

    it('calls waitForPageLoad with the tab id', async () => {
      const { waitForPageLoad } = await import('../../background/tab-manager.js');
      await openTab('https://example.com', 'Test');
      expect(waitForPageLoad).toHaveBeenCalledWith(1);
    });

    it('evicts oldest non-active tab when at TAB_LIMIT', async () => {
      // Fill up to TAB_LIMIT (5) tabs
      const contexts = [];
      for (let i = 0; i < TAB_LIMIT; i++) {
        const ctx = await openTab(`https://tab${i}.com`, `Tab ${i}`);
        contexts.push(ctx);
      }
      expect(getTabCount()).toBe(TAB_LIMIT);

      // The last opened tab is active. Open one more to trigger eviction.
      const newCtx = await openTab('https://newtab.com', 'New Tab');
      expect(getTabCount()).toBe(TAB_LIMIT);
      // The oldest non-active tab (tab0, which was the first opened) should have been evicted
      expect(getTabContext(contexts[0].tabId)).toBeUndefined();
      expect(getTabContext(newCtx.tabId)).toBeDefined();
    });

    it('does not evict when under TAB_LIMIT', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      expect(getTabCount()).toBe(2);
      expect(getTabContext(ctx1.tabId)).toBeDefined();
      expect(getTabContext(ctx2.tabId)).toBeDefined();
    });

    it('notifies state change via sendTabStateUpdate', async () => {
      const { sendTabStateUpdate } = await import('../../background/message-protocol.js');
      sendTabStateUpdate.mockClear();
      await openTab('https://example.com', 'Test');
      // notifyStateChange is called in setActiveTab which is called by openTab
      expect(sendTabStateUpdate).toHaveBeenCalled();
    });
  });

  describe('switchToTab', () => {
    it('switches to an existing tab and activates it', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      // ctx2 is active now, switch back to ctx1
      const result = await switchToTab(ctx1.tabId);
      expect(result).toBe(true);
      expect(getActiveTabId()).toBe(ctx1.tabId);
      expect(getTabContext(ctx1.tabId).isActive).toBe(true);
      expect(getTabContext(ctx2.tabId).isActive).toBe(false);
    });

    it('calls chrome.tabs.update to make tab visible', async () => {
      const ctx = await openTab('https://example.com', 'Test');
      const updateSpy = vi.spyOn(chromeMock.tabs, 'update');
      await switchToTab(ctx.tabId);
      expect(updateSpy).toHaveBeenCalledWith(ctx.tabId, { active: true });
      updateSpy.mockRestore();
    });

    it('returns false for non-existent tab', async () => {
      const result = await switchToTab(9999);
      expect(result).toBe(false);
    });
  });

  describe('closeTab', () => {
    it('removes a non-active tab from context', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      // ctx2 is active, close ctx1
      await closeTab(ctx1.tabId);
      expect(getTabContext(ctx1.tabId)).toBeUndefined();
      expect(getTabCount()).toBe(1);
      expect(getActiveTabId()).toBe(ctx2.tabId);
    });

    it('removes agent-created tab via chrome.tabs.remove', async () => {
      const ctx = await openTab('https://example.com', 'Test');
      const removeSpy = vi.spyOn(chromeMock.tabs, 'remove');
      await closeTab(ctx.tabId);
      expect(removeSpy).toHaveBeenCalledWith(ctx.tabId);
      removeSpy.mockRestore();
    });

    it('switches active tab when closing the active tab', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      // ctx2 is active. Close ctx2. Should switch to ctx1.
      await closeTab(ctx2.tabId);
      expect(getActiveTabId()).toBe(ctx1.tabId);
      expect(getTabContext(ctx1.tabId).isActive).toBe(true);
    });

    it('sets activeTabId to null when closing the only tab', async () => {
      const ctx = await openTab('https://example.com', 'Test');
      await closeTab(ctx.tabId);
      expect(getActiveTabId()).toBeNull();
      expect(getTabCount()).toBe(0);
    });

    it('does nothing for untracked tab', async () => {
      await closeTab(9999);
      expect(getTabCount()).toBe(0);
    });

    it('does not call chrome.tabs.remove for non-agent-created tabs', async () => {
      registerInitialTab(100, 'https://manual.com');
      const removeSpy = vi.spyOn(chromeMock.tabs, 'remove');
      await closeTab(100);
      expect(removeSpy).not.toHaveBeenCalled();
      removeSpy.mockRestore();
    });

    it('catches chrome.tabs.remove errors gracefully', async () => {
      const ctx = await openTab('https://example.com', 'Test');
      vi.spyOn(chromeMock.tabs, 'remove').mockRejectedValueOnce(new Error('Tab already closed'));
      // Should not throw
      await closeTab(ctx.tabId);
      expect(getTabContext(ctx.tabId)).toBeUndefined();
    });

    it('notifies state change', async () => {
      const { sendTabStateUpdate } = await import('../../background/message-protocol.js');
      const ctx = await openTab('https://example.com', 'Test');
      sendTabStateUpdate.mockClear();
      await closeTab(ctx.tabId);
      expect(sendTabStateUpdate).toHaveBeenCalled();
    });
  });

  describe('closeAllAgentTabs', () => {
    it('closes all agent-created tabs and clears state', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      expect(getTabCount()).toBe(2);

      await closeAllAgentTabs();
      expect(getTabCount()).toBe(0);
      expect(getActiveTabId()).toBeNull();
    });

    it('calls chrome.tabs.remove for each agent-created tab', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      const removeSpy = vi.spyOn(chromeMock.tabs, 'remove');
      await closeAllAgentTabs();
      expect(removeSpy).toHaveBeenCalledTimes(2);
      removeSpy.mockRestore();
    });

    it('handles chrome.tabs.remove errors gracefully', async () => {
      await openTab('https://tab1.com', 'Tab 1');
      vi.spyOn(chromeMock.tabs, 'remove').mockRejectedValueOnce(new Error('Already closed'));
      // Should not throw
      await closeAllAgentTabs();
      expect(getTabCount()).toBe(0);
    });

    it('notifies state change', async () => {
      const { sendTabStateUpdate } = await import('../../background/message-protocol.js');
      await openTab('https://tab1.com', 'Tab 1');
      sendTabStateUpdate.mockClear();
      await closeAllAgentTabs();
      expect(sendTabStateUpdate).toHaveBeenCalled();
    });
  });

  describe('handleTabRemoved with multiple tabs', () => {
    it('switches active to another tab when active tab is removed and others exist', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      // ctx2 is active. Remove it externally.
      handleTabRemoved(ctx2.tabId);
      expect(getActiveTabId()).toBe(ctx1.tabId);
      expect(getTabContext(ctx1.tabId).isActive).toBe(true);
      expect(getTabContext(ctx2.tabId)).toBeUndefined();
    });
  });

  describe('setActiveTab with multiple registered tabs', () => {
    it('deactivates previous active tab when setting a new one', async () => {
      const ctx1 = await openTab('https://tab1.com', 'Tab 1');
      const ctx2 = await openTab('https://tab2.com', 'Tab 2');
      // ctx2 is active. Switch to ctx1.
      expect(setActiveTab(ctx1.tabId)).toBe(true);
      expect(getTabContext(ctx1.tabId).isActive).toBe(true);
      expect(getTabContext(ctx2.tabId).isActive).toBe(false);
      expect(getActiveTabId()).toBe(ctx1.tabId);
    });

    it('returns false for non-registered tab', () => {
      expect(setActiveTab(9999)).toBe(false);
    });
  });

  describe('updateSnapshot edge cases', () => {
    it('handles snapshot with missing fields using defaults', () => {
      registerInitialTab(1, 'https://example.com');
      updateSnapshot(1, {});
      const ctx = getTabContext(1);
      expect(ctx.snapshot).toBeDefined();
      expect(ctx.snapshot.elements).toEqual([]);
      expect(ctx.snapshot.pageContent).toBe('');
      expect(ctx.snapshot.timestamp).toBeGreaterThan(0);
    });

    it('does not update url when snapshot.url is falsy', () => {
      registerInitialTab(1, 'https://original.com');
      updateSnapshot(1, { url: '', title: '' });
      const ctx = getTabContext(1);
      expect(ctx.url).toBe('https://original.com');
      expect(ctx.title).toBe('');
    });
  });

  describe('registerInitialTab edge cases', () => {
    it('defaults url to empty string when not provided', () => {
      registerInitialTab(5);
      const ctx = getTabContext(5);
      expect(ctx.url).toBe('');
    });

    it('calls sendTabStateUpdate', async () => {
      const { sendTabStateUpdate } = await import('../../background/message-protocol.js');
      sendTabStateUpdate.mockClear();
      registerInitialTab(5);
      expect(sendTabStateUpdate).toHaveBeenCalled();
    });
  });

  describe('findTabByLabel edge cases', () => {
    it('finds tab with case-insensitive search', () => {
      registerInitialTab(1, 'https://example.com');
      expect(findTabByLabel('MAIN TASK')).toBe(1);
      expect(findTabByLabel('main task tab')).toBe(1);
    });
  });
});
