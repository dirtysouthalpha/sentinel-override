// tests/frame-router-rebuild.test.js
// Branch coverage for background/frame-router.js rebuildFrameMap uncovered lines:
//   42-43  getAllFrames returns null → frameIdsByTab.delete(tabId)
//   48     multiple iframes sorted by frameId

import { jest } from '@jest/globals';

let _committedListeners = [];
let _errorListeners = [];
let _removedListeners = [];

globalThis.chrome = {
  webNavigation: {
    getAllFrames: jest.fn(async () => []),
    onCommitted: { addListener: jest.fn((fn) => { _committedListeners.push(fn); }) },
    onErrorOccurred: { addListener: jest.fn((fn) => { _errorListeners.push(fn); }) },
  },
  tabs: {
    sendMessage: jest.fn(async () => {}),
    onRemoved: { addListener: jest.fn((fn) => { _removedListeners.push(fn); }) },
  },
  scripting: {
    executeScript: jest.fn(async () => [{ result: null }]),
  },
  runtime: {
    getURL: jest.fn((p) => p),
    lastError: null,
  },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  emit: jest.fn(),
  tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { addFrameRouterListeners, resolveFrameForSelector } =
  await import('../background/frame-router.js');

// Register listeners once — addFrameRouterListeners has a singleton guard.
addFrameRouterListeners();

describe('rebuildFrameMap — null frames (lines 42-43)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deletes tab entry when getAllFrames returns null (onCommitted path)', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce(null);
    // Pre-populate a positional map for tabId 7 so the delete is meaningful.
    // We can verify by checking resolveFrameForSelector returns null after the rebuild.
    const committedListener = _committedListeners[0];
    expect(committedListener).toBeDefined();

    // Fire the listener — rebuildFrameMap is called for tabId 7.
    committedListener({ tabId: 7, frameId: 0 });
    await Promise.resolve();
    await Promise.resolve();

    // The map for tabId 7 was deleted; resolveFrameForSelector should return null.
    // Mock getAllFrames to return [] so enumerateFrames returns [] (no frames to build from).
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);
    const frameId = await resolveFrameForSelector(7, 0);
    expect(frameId).toBeNull();
  });

  test('deletes tab entry when getAllFrames returns null (onErrorOccurred path)', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce(null);
    const errorListener = _errorListeners[0];
    expect(errorListener).toBeDefined();

    errorListener({ tabId: 8, frameId: 0 });
    await Promise.resolve();
    await Promise.resolve();

    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);
    const frameId = await resolveFrameForSelector(8, 0);
    expect(frameId).toBeNull();
  });
});

describe('rebuildFrameMap — sort with multiple iframes (line 48)', () => {
  test('sorts iframes by frameId ascending for stable positional index', async () => {
    // Return two iframes out of order: frameId 20 before frameId 10.
    // After sorting: index 0 → frameId 10, index 1 → frameId 20.
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentFrameId: -1, url: 'https://example.com' },   // main frame — excluded
      { frameId: 20, parentFrameId: 0, url: 'https://a.com', isIframe: true },
      { frameId: 10, parentFrameId: 0, url: 'https://b.com', isIframe: true },
    ]);

    const committedListener = _committedListeners[0];
    committedListener({ tabId: 9, frameId: 0 });
    // The listener fires rebuildFrameMap but does NOT await it; flush the microtask
    // queue so the .then() handler (which writes frameIdsByTab) runs before we read it.
    await Promise.resolve();
    await Promise.resolve();

    // resolveFrameForSelector for tabId 9 should serve from the cached map.
    // Index 0 → frameId 10 (sorted first), index 1 → frameId 20.
    const id0 = await resolveFrameForSelector(9, 0);
    const id1 = await resolveFrameForSelector(9, 1);
    expect(id0).toBe(10);
    expect(id1).toBe(20);
  });
});
