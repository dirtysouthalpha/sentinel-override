// tests/frame-router.test.js
// Unit tests for background/frame-router.js — enumerateFrames, resolveFrameForSelector, executeInFrame, addFrameRouterListeners.

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

// ========== enumerateFrames ==========

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

  test('main frame with about:blank URL is not cross-origin with itself', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'about:blank' },
    ]);
    const frames = await enumerateFrames(1);
    expect(frames[0].isCrossOrigin).toBe(false);
    expect(frames[0].isIframe).toBe(false);
  });

  test('iframe with same origin as main frame is not cross-origin', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com/page' },
      { frameId: 1, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    const frames = await enumerateFrames(1);
    expect(frames[1].isCrossOrigin).toBe(false);
  });

  test('iframe with different port is cross-origin', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 1, parentId: 0, url: 'https://example.com:8443/admin' },
    ]);
    const frames = await enumerateFrames(1);
    expect(frames[1].isCrossOrigin).toBe(true);
  });

  test('iframe with different protocol is cross-origin', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 1, parentId: 0, url: 'http://example.com/iframe' },
    ]);
    const frames = await enumerateFrames(1);
    expect(frames[1].isCrossOrigin).toBe(true);
  });

  test('multiple iframes with mixed origins', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 1, parentId: 0, url: 'https://cdn.example.com/widget' },
      { frameId: 2, parentId: 0, url: 'https://example.com/embed' },
      { frameId: 3, parentId: 0, url: 'https://ads.other.com' },
    ]);
    const frames = await enumerateFrames(1);
    expect(frames).toHaveLength(4);
    expect(frames[1].isCrossOrigin).toBe(true);
    expect(frames[2].isCrossOrigin).toBe(false);
    expect(frames[3].isCrossOrigin).toBe(true);
  });
});

// ========== resolveFrameForSelector ==========

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

  test('returns null for undefined tabId', async () => {
    const result = await resolveFrameForSelector(undefined, 0);
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

  test('resolves frame index 1 to second iframe by frameId order', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
      { frameId: 10, parentId: 0, url: 'https://example.com/iframe2' },
    ]);
    const result = await resolveFrameForSelector(99, 1);
    expect(result).toBe(10);
  });

  test('caches frames from live enumeration', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 7, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    // First call populates cache
    const r1 = await resolveFrameForSelector(50, 0);
    expect(r1).toBe(7);

    // Second call should use cache (no more getAllFrames calls)
    const r2 = await resolveFrameForSelector(50, 0);
    expect(r2).toBe(7);
    // Only called once — second resolve uses cache
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledTimes(1);
  });

  test('returns null when only main frame exists (no iframes)', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
    ]);
    const result = await resolveFrameForSelector(99, 0);
    expect(result).toBeNull();
  });
});

// ========== executeInFrame ==========

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

  test('returns error for undefined command', async () => {
    const result = await executeInFrame(1, 5, undefined);
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

  test('injects utility files before running command', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])  // utility injection step
      .mockResolvedValueOnce([{ result: { ok: true, data: 'ok' } }]);

    await executeInFrame(1, 5, { type: 'click', selector: '#btn' });

    // First call should be utility injection
    const firstCall = chrome.scripting.executeScript.mock.calls[0][0];
    expect(firstCall.target).toEqual({ tabId: 1, frameIds: [5] });
    expect(firstCall.files).toBeDefined();
    expect(Array.isArray(firstCall.files)).toBe(true);
    expect(firstCall.files.length).toBeGreaterThan(0);

    // Second call should be the command function
    const secondCall = chrome.scripting.executeScript.mock.calls[1][0];
    expect(secondCall.target).toEqual({ tabId: 1, frameIds: [5] });
    expect(secondCall.func).toBeDefined();
    expect(secondCall.args).toBeDefined();
  });

  test('returns error when result is undefined', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: undefined }]);

    const result = await executeInFrame(1, 5, { type: 'click', selector: 'btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No result returned');
  });

  test('returns error when results array has no elements', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const result = await executeInFrame(1, 5, { type: 'click', selector: 'btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No result returned');
  });

  test('command args include the command object', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { ok: true, data: 'ok' } }]);

    const cmd = { type: 'type', selector: 'input', text: 'hello' };
    await executeInFrame(1, 5, cmd);

    const secondCall = chrome.scripting.executeScript.mock.calls[1][0];
    expect(secondCall.args[0]).toEqual(cmd);
  });

  test('scripting error includes original error message', async () => {
    chrome.scripting.executeScript
      .mockRejectedValueOnce(new Error('specific error detail'));

    const result = await executeInFrame(1, 5, { type: 'click' });
    expect(result.error).toContain('specific error detail');
  });
});

// ========== addFrameRouterListeners ==========

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

  test('onCommitted listener triggers frame rebuild', async () => {
    addFrameRouterListeners();
    const listener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 3, parentId: 0, url: 'https://example.com/iframe' },
    ]);

    listener({ tabId: 42, frameId: 0, url: 'https://example.com' });

    // Wait for async rebuildFrameMap
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledWith({ tabId: 42 });

    // Verify cache is populated by resolving a frame
    const frameId = await resolveFrameForSelector(42, 0);
    expect(frameId).toBe(3);
  });

  test('onCommitted ignores negative tabId', async () => {
    addFrameRouterListeners();
    const listener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    listener({ tabId: -1 });
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.webNavigation.getAllFrames).not.toHaveBeenCalled();
  });

  test('onErrorOccurred listener triggers frame rebuild', async () => {
    addFrameRouterListeners();
    const listener = chrome.webNavigation.onErrorOccurred.addListener.mock.calls[0][0];

    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);
    listener({ tabId: 10 });
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledWith({ tabId: 10 });
  });

  test('onRemoved listener clears frame map', async () => {
    addFrameRouterListeners();

    // First populate cache for tab 100
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    await resolveFrameForSelector(100, 0);

    // Now simulate tab removal
    const removeListener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    removeListener(100);

    // Cache should be cleared — next resolve should call getAllFrames again
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
    ]);
    const result = await resolveFrameForSelector(100, 0);
    expect(result).toBeNull();
    // getAllFrames called again (not cached)
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledTimes(2);
  });

  test('onCommitted handles getAllFrames rejection gracefully', async () => {
    addFrameRouterListeners();
    const listener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('tab gone'));

    // Should not throw
    listener({ tabId: 55 });
    await new Promise(r => setTimeout(r, 50));
  });
});

// ========== resolveFrameForSelector with cached map ==========

describe('resolveFrameForSelector — cache scenarios', () => {
  test('uses cached map after first resolve', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 2, parentId: 0, url: 'https://example.com/iframe' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe2' },
    ]);

    // First call populates cache
    const r1 = await resolveFrameForSelector(200, 0);
    expect(r1).toBe(2);

    // Second call uses cache
    const r2 = await resolveFrameForSelector(200, 1);
    expect(r2).toBe(5);

    // Only one getAllFrames call
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledTimes(1);
  });

  test('different tabs have separate caches', async () => {
    chrome.webNavigation.getAllFrames
      .mockResolvedValueOnce([
        { frameId: 0, parentId: -1, url: 'https://example.com' },
        { frameId: 3, parentId: 0, url: 'https://example.com/iframe' },
      ])
      .mockResolvedValueOnce([
        { frameId: 0, parentId: -1, url: 'https://other.com' },
        { frameId: 7, parentId: 0, url: 'https://other.com/iframe' },
      ]);

    const r1 = await resolveFrameForSelector(300, 0);
    const r2 = await resolveFrameForSelector(301, 0);
    expect(r1).toBe(3);
    expect(r2).toBe(7);
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledTimes(2);
  });

  test('sorts frames by frameId for stable ordering', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 10, parentId: 0, url: 'https://example.com/b' },
      { frameId: 3, parentId: 0, url: 'https://example.com/a' },
    ]);

    // Positional index 0 = lowest frameId = 3
    const r0 = await resolveFrameForSelector(400, 0);
    expect(r0).toBe(3);

    // Positional index 1 = next frameId = 10
    const r1 = await resolveFrameForSelector(400, 1);
    expect(r1).toBe(10);
  });
});

// ========== executeInFrame — utility files verification ==========

describe('executeInFrame — utility injection', () => {
  test('injects correct utility files', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { ok: true } }]);

    await executeInFrame(1, 5, { type: 'observe_page' });

    const utilityCall = chrome.scripting.executeScript.mock.calls[0][0];
    expect(utilityCall.files).toEqual(
      expect.arrayContaining([
        'content/dom-utils.js',
        'content/shadow-dom.js',
        'content/highlight.js',
        'content/cursor.js',
        'content/wait-utils.js',
        'content/dropdown-utils.js',
        'content/special-inputs.js',
        'content/overlay-detector.js'
      ])
    );
  });

  test('does not include content/index.js in utility files', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { ok: true } }]);

    await executeInFrame(1, 5, { type: 'read_page' });

    const utilityCall = chrome.scripting.executeScript.mock.calls[0][0];
    expect(utilityCall.files).not.toContain('content/index.js');
  });
});
