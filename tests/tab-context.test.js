// tests/tab-context.test.js
// Unit tests for background/tab-context.js — tab lifecycle, context tracking, snapshots.

import { jest } from '@jest/globals';

globalThis.chrome = {
  tabs: {
    create: jest.fn(async ({ url }) => ({ id: Math.floor(Math.random() * 100000), url })),
    update: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
};

jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendTabStateUpdate: jest.fn(),
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  getTabInfo: jest.fn(async (tabId) => ({ url: 'https://example.com/page', title: 'Test Page' })),
}));

const {
  getActiveTabId,
  setActiveTab,
  getTabContext,
  getAllTabContexts,
  getTabCount,
  openTab,
  switchToTab,
  closeTab,
  closeAllAgentTabs,
  updateSnapshot,
  resetAllContexts,
  registerInitialTab,
  findTabByLabel,
  handleTabRemoved,
  TAB_LIMIT,
} = await import('../background/tab-context.js');

const { sendTabStateUpdate } = await import('../background/message-protocol.js');

beforeEach(() => {
  jest.clearAllMocks();
  resetAllContexts();
});

describe('constants', () => {
  test('TAB_LIMIT is 10', () => {
    expect(TAB_LIMIT).toBe(10);
  });
});

describe('initial state', () => {
  test('getActiveTabId returns null', () => {
    expect(getActiveTabId()).toBeNull();
  });

  test('getTabCount returns 0', () => {
    expect(getTabCount()).toBe(0);
  });

  test('getAllTabContexts returns empty array', () => {
    expect(getAllTabContexts()).toEqual([]);
  });
});

describe('registerInitialTab', () => {
  test('registers a tab and makes it active', () => {
    registerInitialTab(42, 'https://example.com');
    expect(getActiveTabId()).toBe(42);
    expect(getTabCount()).toBe(1);
    const ctx = getTabContext(42);
    expect(ctx).toBeTruthy();
    expect(ctx.isAgentCreated).toBe(false);
    expect(ctx.isActive).toBe(true);
    expect(ctx.url).toBe('https://example.com');
  });

  test('deactivates previous active tab', () => {
    registerInitialTab(1, 'https://a.com');
    registerInitialTab(2, 'https://b.com');
    expect(getActiveTabId()).toBe(2);
    expect(getTabContext(1).isActive).toBe(false);
    expect(getTabContext(2).isActive).toBe(true);
  });
});

describe('openTab', () => {
  test('creates a new agent tab and activates it', async () => {
    const ctx = await openTab('https://example.com', 'Test Tab');
    expect(ctx).toBeTruthy();
    expect(ctx.label).toBe('Test Tab');
    expect(ctx.isAgentCreated).toBe(true);
    expect(ctx.isActive).toBe(true);
    expect(getActiveTabId()).toBe(ctx.tabId);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com', active: false });
  });

  test('updates URL and title from getTabInfo', async () => {
    const ctx = await openTab('https://example.com', 'Test');
    expect(ctx.url).toBe('https://example.com/page');
    expect(ctx.title).toBe('Test Page');
  });

  test('sends tab state update', async () => {
    await openTab('https://example.com', 'Tab');
    expect(sendTabStateUpdate).toHaveBeenCalled();
  });
});

describe('setActiveTab', () => {
  test('returns false for untracked tab', () => {
    expect(setActiveTab(999)).toBe(false);
  });

  test('sets active and deactivates others', () => {
    registerInitialTab(1, 'https://a.com');
    registerInitialTab(2, 'https://b.com');
    expect(setActiveTab(1)).toBe(true);
    expect(getActiveTabId()).toBe(1);
    expect(getTabContext(1).isActive).toBe(true);
    expect(getTabContext(2).isActive).toBe(false);
  });
});

describe('switchToTab', () => {
  test('returns false for untracked tab', async () => {
    expect(await switchToTab(999)).toBe(false);
  });

  test('makes tab visible and active', async () => {
    registerInitialTab(1, 'https://a.com');
    registerInitialTab(2, 'https://b.com');
    const result = await switchToTab(1);
    expect(result).toBe(true);
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(getActiveTabId()).toBe(1);
  });
});

describe('closeTab', () => {
  test('removes agent-created tab from chrome', async () => {
    registerInitialTab(1, 'https://a.com');
    const ctx = await openTab('https://b.com', 'Agent Tab');
    await closeTab(ctx.tabId);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(ctx.tabId);
    expect(getTabContext(ctx.tabId)).toBeUndefined();
  });

  test('does not remove non-agent tab from chrome', async () => {
    registerInitialTab(1, 'https://a.com');
    await closeTab(1);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(getTabContext(1)).toBeUndefined();
  });

  test('switches active when closing the active tab', async () => {
    registerInitialTab(1, 'https://a.com');
    registerInitialTab(2, 'https://b.com');
    // Tab 2 is active. Close it.
    await closeTab(2);
    expect(getActiveTabId()).toBe(1);
    expect(getTabContext(1).isActive).toBe(true);
  });

  test('sets active to null when closing last tab', async () => {
    registerInitialTab(1, 'https://a.com');
    await closeTab(1);
    expect(getActiveTabId()).toBeNull();
  });

  test('no-ops for untracked tab', async () => {
    await closeTab(999);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });
});

describe('closeAllAgentTabs', () => {
  test('closes all agent-created tabs, keeps user tabs', async () => {
    registerInitialTab(1, 'https://a.com');
    const ctx = await openTab('https://b.com', 'Agent Tab');
    await closeAllAgentTabs();
    expect(chrome.tabs.remove).toHaveBeenCalledWith(ctx.tabId);
    expect(getTabCount()).toBe(0);
    expect(getActiveTabId()).toBeNull();
  });
});

describe('updateSnapshot', () => {
  test('updates snapshot for tracked tab', () => {
    registerInitialTab(1, 'https://a.com');
    updateSnapshot(1, { elements: [{ id: 'btn' }], pageContent: 'Hello', url: 'https://a.com/new', title: 'New Title' });
    const ctx = getTabContext(1);
    expect(ctx.snapshot.elements).toEqual([{ id: 'btn' }]);
    expect(ctx.snapshot.pageContent).toBe('Hello');
    expect(ctx.url).toBe('https://a.com/new');
    expect(ctx.title).toBe('New Title');
    expect(ctx.snapshot.timestamp).toBeGreaterThan(0);
  });

  test('no-ops for untracked tab', () => {
    expect(() => updateSnapshot(999, { elements: [] })).not.toThrow();
  });

  test('defaults empty elements and content', () => {
    registerInitialTab(1, 'https://a.com');
    updateSnapshot(1, {});
    const ctx = getTabContext(1);
    expect(ctx.snapshot.elements).toEqual([]);
    expect(ctx.snapshot.pageContent).toBe('');
  });
});

describe('findTabByLabel', () => {
  test('finds tab by case-insensitive partial match', () => {
    registerInitialTab(1, 'https://a.com');
    const ctx = getTabContext(1);
    ctx.label = 'Dashboard Portal';
    expect(findTabByLabel('dashboard')).toBe(1);
    expect(findTabByLabel('PORTAL')).toBe(1);
  });

  test('returns null for no match', () => {
    registerInitialTab(1, 'https://a.com');
    expect(findTabByLabel('nonexistent')).toBeNull();
  });

  test('returns null for falsy label', () => {
    expect(findTabByLabel(null)).toBeNull();
    expect(findTabByLabel('')).toBeNull();
  });
});

describe('handleTabRemoved', () => {
  test('removes tab from tracking', () => {
    registerInitialTab(1, 'https://a.com');
    handleTabRemoved(1);
    expect(getTabContext(1)).toBeUndefined();
  });

  test('switches active when active tab removed externally', () => {
    registerInitialTab(1, 'https://a.com');
    registerInitialTab(2, 'https://b.com');
    handleTabRemoved(2);
    expect(getActiveTabId()).toBe(1);
  });

  test('no-ops for untracked tab', () => {
    expect(() => handleTabRemoved(999)).not.toThrow();
  });
});

describe('resetAllContexts', () => {
  test('clears all state', () => {
    registerInitialTab(1, 'https://a.com');
    registerInitialTab(2, 'https://b.com');
    resetAllContexts();
    expect(getTabCount()).toBe(0);
    expect(getActiveTabId()).toBeNull();
  });
});
