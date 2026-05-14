// tests/frame-router.test.js
// Unit tests for background/frame-router.js — enumerateFrames, resolveFrameForSelector, executeInFrame.

import { jest } from '@jest/globals';

globalThis.chrome = {
  webNavigation: {
    getAllFrames: jest.fn(),
    onCommitted: { addListener: jest.fn() },
    onErrorOccurred: { addListener: jest.fn() },
  },
  scripting: {
    executeScript: jest.fn(),
  },
  tabs: {
    onRemoved: { addListener: jest.fn() },
  },
};

const {
  enumerateFrames,
  resolveFrameForSelector,
  executeInFrame,
  addFrameRouterListeners,
} = await import('../background/frame-router.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('enumerateFrames', () => {
  test('returns empty array for null frames', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce(null);
    const frames = await enumerateFrames(1);
    expect(frames).toEqual([]);
  });

  test('returns empty array for empty frames', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);
    const frames = await enumerateFrames(1);
    expect(frames).toEqual([]);
  });

  test('returns frames with correct metadata', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 1, parentId: 0, url: 'https://ads.example.com/banner' },
      { frameId: 2, parentId: 0, url: 'https://example.com/widget' },
    ]);
    const frames = await enumerateFrames(1);

    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({
      frameId: 0,
      parentId: -1,
      url: 'https://example.com',
      isIframe: false,
      isCrossOrigin: false,
    });
    expect(frames[1]).toEqual({
      frameId: 1,
      parentId: 0,
      url: 'https://ads.example.com/banner',
      isIframe: true,
      isCrossOrigin: true,
    });
    expect(frames[2]).toEqual({
      frameId: 2,
      parentId: 0,
      url: 'https://example.com/widget',
      isIframe: true,
      isCrossOrigin: false,
    });
  });

  test('returns empty on API error', async () => {
    chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('tab closed'));
    const frames = await enumerateFrames(1);
    expect(frames).toEqual([]);
  });

  test('handles unparseable URLs gracefully', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'about:blank' },
      { frameId: 1, parentId: 0, url: 'javascript:void(0)' },
    ]);
    const frames = await enumerateFrames(1);
    expect(frames).toHaveLength(2);
    expect(frames[1].isIframe).toBe(true);
  });
});

describe('resolveFrameForSelector', () => {
  test('returns null for null tabId', async () => {
    const result = await resolveFrameForSelector(null, 0);
    expect(result).toBeNull();
  });

  test('returns null for negative frameIndex', async () => {
    const result = await resolveFrameForSelector(1, -1);
    expect(result).toBeNull();
  });

  test('returns null for null frameIndex', async () => {
    const result = await resolveFrameForSelector(1, null);
    expect(result).toBeNull();
  });

  test('resolves frame from live enumeration fallback', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
      { frameId: 10, parentId: 0, url: 'https://example.com/iframe2' },
    ]);
    // Index 0 = first iframe = frameId 5
    const result = await resolveFrameForSelector(99, 0);
    expect(result).toBe(5);
  });

  test('returns null when frameIndex exceeds available iframes', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    // Only 1 iframe (index 0), index 5 doesn't exist
    const result = await resolveFrameForSelector(99, 5);
    expect(result).toBeNull();
  });
});

describe('executeInFrame', () => {
  test('returns error for null tabId', async () => {
    const result = await executeInFrame(null, 1, { type: 'click' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing tabId or frameId');
  });

  test('returns error for null frameId', async () => {
    const result = await executeInFrame(1, null, { type: 'click' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing tabId or frameId');
  });

  test('returns error for missing command type', async () => {
    const result = await executeInFrame(1, 5, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing command type');
  });

  test('returns error for null command', async () => {
    const result = await executeInFrame(1, 5, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing command type');
  });

  test('returns script result on success', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])  // utility injection
      .mockResolvedValueOnce([{ result: { ok: true, data: 'Clicked btn' } }]);

    const result = await executeInFrame(1, 5, { type: 'click', selector: 'btn' });
    expect(result.ok).toBe(true);
    expect(result.data).toBe('Clicked btn');
  });

  test('returns error when no result from execution', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])  // utility injection
      .mockResolvedValueOnce([]); // empty results

    const result = await executeInFrame(1, 5, { type: 'click', selector: 'btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No result returned');
  });

  test('returns error on scripting exception', async () => {
    chrome.scripting.executeScript
      .mockRejectedValueOnce(new Error('cannot access frame'));

    const result = await executeInFrame(1, 5, { type: 'click', selector: 'btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Frame execution failed');
  });

  test('handles frameId 0 (main frame) as valid', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { ok: true, data: 'main frame ok' } }]);

    const result = await executeInFrame(1, 0, { type: 'read_page' });
    expect(result.ok).toBe(true);
  });
});

describe('addFrameRouterListeners', () => {
  test('registers webNavigation and tabs listeners', () => {
    addFrameRouterListeners();
    expect(chrome.webNavigation.onCommitted.addListener).toHaveBeenCalled();
    expect(chrome.webNavigation.onErrorOccurred.addListener).toHaveBeenCalled();
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
  });

  test('idempotent — does not double-register on second call', () => {
    const committedCount = chrome.webNavigation.onCommitted.addListener.mock.calls.length;
    addFrameRouterListeners();
    addFrameRouterListeners();
    expect(chrome.webNavigation.onCommitted.addListener.mock.calls.length).toBe(committedCount);
  });
});
