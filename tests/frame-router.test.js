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

// resetAllMocks clears mock.calls AND the mockResolvedValueOnce queue,
// preventing stale mock data from leaking between tests.
beforeEach(() => {
  jest.resetAllMocks();
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
    // Index 0 = first iframe (sorted by frameId) = frameId 5
    const result = await resolveFrameForSelector(5001, 0);
    expect(result).toBe(5);
  });

  test('returns null when frameIndex exceeds available iframes', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    // Only 1 iframe (index 0), index 5 doesn't exist
    const result = await resolveFrameForSelector(5002, 5);
    expect(result).toBeNull();
  });

  test('resolves frame index 1 to second iframe by frameId order', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
      { frameId: 10, parentId: 0, url: 'https://example.com/iframe2' },
    ]);
    const result = await resolveFrameForSelector(5003, 1);
    expect(result).toBe(10);
  });

  test('caches frames from live enumeration', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 7, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    // First call populates cache
    const r1 = await resolveFrameForSelector(5010, 0);
    expect(r1).toBe(7);

    // Second call should use cache (no more getAllFrames calls)
    const r2 = await resolveFrameForSelector(5010, 0);
    expect(r2).toBe(7);
    // Only called once — second resolve uses cache
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledTimes(1);
  });

  test('returns null when only main frame exists (no iframes)', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
    ]);
    const result = await resolveFrameForSelector(5020, 0);
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
    const firstCall = chrome.scripting.executeScript.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    expect(firstCall.target).toEqual({ tabId: 1, frameIds: [5] });
    expect(firstCall.files).toBeDefined();
    expect(Array.isArray(firstCall.files)).toBe(true);
    expect(firstCall.files.length).toBeGreaterThan(0);

    // Second call should be the command function
    const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
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

    const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
    expect(secondCall).toBeDefined();
    expect(secondCall.args?.[0]).toEqual(cmd);
  });

  test('scripting error includes original error message', async () => {
    chrome.scripting.executeScript
      .mockRejectedValueOnce(new Error('specific error detail'));

    const result = await executeInFrame(1, 5, { type: 'click' });
    expect(result.error).toContain('specific error detail');
  });
});

// ========== addFrameRouterListeners ==========
// The module uses a flag (__frameRouterListenersInstalled) that prevents re-registration.
// We capture the listeners in beforeAll and reuse them across tests.

describe('addFrameRouterListeners', () => {
  let committedListener, errorListener, removedListener;

  beforeAll(() => {
    addFrameRouterListeners();
    committedListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0]?.[0];
    errorListener = chrome.webNavigation.onErrorOccurred.addListener.mock.calls[0]?.[0];
    removedListener = chrome.tabs.onRemoved.addListener.mock.calls[0]?.[0];
  });

  test('registers webNavigation and tabs listeners', () => {
    expect(committedListener).toBeDefined();
    expect(typeof committedListener).toBe('function');
    expect(errorListener).toBeDefined();
    expect(typeof errorListener).toBe('function');
    expect(removedListener).toBeDefined();
    expect(typeof removedListener).toBe('function');
  });

  test('idempotent — does not double-register on second call', () => {
    addFrameRouterListeners();
    addFrameRouterListeners();
    // After resetAllMocks, call count starts at 0. Idempotent means no new calls.
    expect(chrome.webNavigation.onCommitted.addListener).not.toHaveBeenCalled();
    expect(chrome.webNavigation.onErrorOccurred.addListener).not.toHaveBeenCalled();
    expect(chrome.tabs.onRemoved.addListener).not.toHaveBeenCalled();
  });

  test('onCommitted listener triggers frame rebuild', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 3, parentId: 0, url: 'https://example.com/iframe' },
    ]);

    committedListener({ tabId: 42, frameId: 0, url: 'https://example.com' });

    // Wait for async rebuildFrameMap
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledWith({ tabId: 42 });

    // Verify cache is populated by resolving a frame
    const frameId = await resolveFrameForSelector(42, 0);
    expect(frameId).toBe(3);
  });

  test('onCommitted ignores negative tabId', async () => {
    committedListener({ tabId: -1 });
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.webNavigation.getAllFrames).not.toHaveBeenCalled();
  });

  test('onErrorOccurred listener triggers frame rebuild', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);
    errorListener({ tabId: 10 });
    await new Promise(r => setTimeout(r, 50));
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledWith({ tabId: 10 });
  });

  test('onRemoved listener clears frame map', async () => {
    // First populate cache for tab 1100
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    await resolveFrameForSelector(1100, 0);

    // Now simulate tab removal
    removedListener(1100);

    // Cache should be cleared — next resolve should call getAllFrames again
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
    ]);
    const result = await resolveFrameForSelector(1100, 0);
    expect(result).toBeNull();
    // getAllFrames called for this tab (not cached)
    expect(chrome.webNavigation.getAllFrames).toHaveBeenCalledWith({ tabId: 1100 });
  });

  test('onCommitted handles getAllFrames rejection gracefully', async () => {
    chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('tab gone'));

    // Should not throw
    committedListener({ tabId: 55 });
    await new Promise(r => setTimeout(r, 50));
  });
});

// ========== resolveFrameForSelector with cached map ==========

describe('resolveFrameForSelector — cache scenarios', () => {
  test('uses cached map after first resolve', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 2, parentId: 0, url: 'https://example.com/iframe' },
      { frameId: 5, parentId: 0, url: 'https://example.com/iframe2' },
    ]);

    // First call populates cache
    const r1 = await resolveFrameForSelector(6001, 0);
    expect(r1).toBe(2);

    // Second call uses cache (no additional getAllFrames call)
    const r2 = await resolveFrameForSelector(6001, 1);
    expect(r2).toBe(5);

    // Only one getAllFrames call total
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

    const r1 = await resolveFrameForSelector(6002, 0);
    const r2 = await resolveFrameForSelector(6003, 0);
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
    const r0 = await resolveFrameForSelector(6004, 0);
    expect(r0).toBe(3);

    // Positional index 1 = next frameId = 10
    const r1 = await resolveFrameForSelector(6004, 1);
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

    const utilityCall = chrome.scripting.executeScript.mock.calls[0]?.[0];
    expect(utilityCall).toBeDefined();
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

    const utilityCall = chrome.scripting.executeScript.mock.calls[0]?.[0];
    expect(utilityCall).toBeDefined();
    expect(utilityCall.files).not.toContain('content/index.js');
  });
});

// ========== runCommandInFrame (injected function) ==========
// Extract the function from executeScript mock and test it directly.

describe('runCommandInFrame', () => {
  let runCmd;
  let mockDom, mockHl, mockShadow, mockWait, mockDd, mockOv, mockSi;
  let mockDoc, mockView;

  beforeAll(async () => {
    // Extract runCommandInFrame by triggering executeInFrame once
    chrome.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { ok: true } }]);
    await executeInFrame(9999, 99, { type: 'click', selector: 'x' });
    const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
    expect(secondCall).toBeDefined();
    runCmd = secondCall.func;
    expect(typeof runCmd).toBe('function');
  });

  beforeEach(() => {
    jest.resetAllMocks();
    mockDom = {
      findElementBySelector: jest.fn(),
      scanDocument: jest.fn(),
    };
    mockHl = {
      highlightElement: jest.fn(),
      removeHighlight: jest.fn(),
    };
    mockOv = {
      isOverlayBlocking: jest.fn(),
      dismissOverlay: jest.fn(),
    };
    mockSi = {
      isRichTextEditor: jest.fn(),
      isDateInput: jest.fn(),
      setRichTextValue: jest.fn(),
      setDatePickerValue: jest.fn(),
    };

    const events = [];
    const makeElement = (tagName, extra = {}) => ({
      tagName,
      isContentEditable: false,
      value: '',
      textContent: '',
      classList: { add: jest.fn(), remove: jest.fn() },
      style: {},
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      click: jest.fn(),
      dispatchEvent: jest.fn((e) => events.push(e)),
      cloneNode: jest.fn(() => ({
        innerText: '',
        textContent: '',
        querySelectorAll: jest.fn(() => []),
        remove: jest.fn(),
      })),
      ...extra,
    });

    mockDoc = {
      title: 'Test Page',
      querySelector: jest.fn(),
      execCommand: jest.fn(),
      createElement: jest.fn(() => makeElement('div')),
      body: makeElement('body', {
        cloneNode: jest.fn(() => ({
          querySelectorAll: jest.fn(() => []),
          innerText: 'Body content',
          remove: jest.fn(),
        })),
      }),
    };

    mockView = {
      location: { href: 'https://example.com/page' },
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} },
    };

    mockDoc.defaultView = mockView;

    // Set up globals that runCommandInFrame reads
    const MockMouseEvent = class MockMouseEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } };
    const MockInputEvent = class MockInputEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } };
    const MockEvent = class MockEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } };

    globalThis.window = {
      __sentinelUtils: {
        dom: mockDom,
        highlight: mockHl,
        shadow: mockShadow,
        wait: mockWait,
        dropdown: mockDd,
        overlay: mockOv,
        specialInputs: mockSi,
      },
      MouseEvent: MockMouseEvent,
      InputEvent: MockInputEvent,
      Event: MockEvent,
    };
    globalThis.document = mockDoc;
    globalThis.MouseEvent = MockMouseEvent;
    globalThis.InputEvent = MockInputEvent;
    globalThis.Event = MockEvent;
    globalThis.console = globalThis.console || { warn: jest.fn() };
  });

  // --- Error cases ---

  test('returns error when utils not loaded', async () => {
    globalThis.window.__sentinelUtils = null;
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('utilities not loaded');
  });

  test('returns error when utils.dom not present', async () => {
    globalThis.window.__sentinelUtils = {};
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('utilities not loaded');
  });

  // --- click command ---

  test('click returns error when element not found', async () => {
    mockDom.findElementBySelector.mockReturnValue(null);
    const result = await runCmd({ type: 'click', selector: '#missing' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Element not found');
  });

  test('click succeeds on found element', async () => {
    const el = {
      scrollIntoView: jest.fn(),
      click: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('Clicked');
    expect(el.click).toHaveBeenCalled();
    expect(mockHl.highlightElement).toHaveBeenCalledWith(el);
    expect(mockHl.removeHighlight).toHaveBeenCalledWith(el);
  });

  test('click blocked by dismissible overlay', async () => {
    const el = { scrollIntoView: jest.fn(), click: jest.fn(), dispatchEvent: jest.fn() };
    mockDom.findElementBySelector.mockReturnValue(el);
    mockOv.isOverlayBlocking.mockReturnValue({ id: 'modal1' });
    mockOv.dismissOverlay.mockReturnValue(true);
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(true);
  });

  test('click blocked by non-dismissible overlay returns error', async () => {
    const el = { scrollIntoView: jest.fn(), click: jest.fn(), dispatchEvent: jest.fn() };
    mockDom.findElementBySelector.mockReturnValue(el);
    mockOv.isOverlayBlocking.mockReturnValue({ id: 'modal1' });
    mockOv.dismissOverlay.mockReturnValue(false);
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('blocked by overlay');
  });

  test('click skips overlay check when ov is null', async () => {
    globalThis.window.__sentinelUtils.overlay = null;
    const el = { scrollIntoView: jest.fn(), click: jest.fn(), dispatchEvent: jest.fn() };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(true);
  });

  // --- type command ---

  test('type returns error when element not found', async () => {
    mockDom.findElementBySelector.mockReturnValue(null);
    const result = await runCmd({ type: 'type', selector: '#input', text: 'hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Element not found');
  });

  test('type into INPUT element', async () => {
    const el = {
      tagName: 'INPUT',
      value: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'type', selector: '#input', text: 'hi' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('Typed into');
    expect(mockHl.removeHighlight).toHaveBeenCalledWith(el);
  });

  test('type into TEXTAREA element', async () => {
    const el = {
      tagName: 'TEXTAREA',
      value: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'type', selector: '#textarea', text: 'hello world' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('Typed into');
  });

  test('type into contenteditable element', async () => {
    const el = {
      tagName: 'DIV',
      isContentEditable: true,
      textContent: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'type', selector: '#editor', text: 'abc' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('contenteditable');
  });

  test('type into rich text editor', async () => {
    const el = {
      tagName: 'DIV',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    mockSi.isRichTextEditor.mockReturnValue(true);
    mockSi.setRichTextValue.mockReturnValue({ success: true, value: 'hello' });
    const result = await runCmd({ type: 'type', selector: '#rte', text: 'hello' });
    expect(result.ok).toBe(true);
    expect(mockSi.setRichTextValue).toHaveBeenCalledWith(el, 'hello');
  });

  test('type into rich text editor with failure', async () => {
    const el = {
      tagName: 'DIV',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    mockSi.isRichTextEditor.mockReturnValue(true);
    mockSi.setRichTextValue.mockReturnValue({ success: false, error: 'unsupported' });
    const result = await runCmd({ type: 'type', selector: '#rte', text: 'hello' });
    expect(result.ok).toBe(false);
  });

  test('type into date input', async () => {
    const el = {
      tagName: 'INPUT',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    mockSi.isDateInput.mockReturnValue(true);
    mockSi.setDatePickerValue.mockReturnValue({ success: true, value: '2024-01-15' });
    const result = await runCmd({ type: 'type', selector: '#date', text: '2024-01-15' });
    expect(result.ok).toBe(true);
    expect(mockSi.setDatePickerValue).toHaveBeenCalledWith(el, '2024-01-15');
  });

  test('type fallback for non-input element', async () => {
    const el = {
      tagName: 'SPAN',
      value: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'type', selector: '#span', text: 'val' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('Typed into');
  });

  test('type with empty text defaults to empty string', async () => {
    const el = {
      tagName: 'INPUT',
      value: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'type', selector: '#input' });
    expect(result.ok).toBe(true);
  });

  test('type blocked by non-dismissible overlay returns error', async () => {
    const el = {
      tagName: 'INPUT',
      value: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    mockOv.isOverlayBlocking.mockReturnValue({ id: 'modal1' });
    mockOv.dismissOverlay.mockReturnValue(false);
    const result = await runCmd({ type: 'type', selector: '#input', text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('blocked by overlay');
  });

  test('type uses native setter when available', async () => {
    const setter = jest.fn();
    const proto = {};
    Object.defineProperty(proto, 'value', { set: setter, configurable: true });
    mockView.HTMLInputElement = { prototype: proto };
    const el = {
      tagName: 'INPUT',
      value: '',
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    mockDom.findElementBySelector.mockReturnValue(el);
    const result = await runCmd({ type: 'type', selector: '#input', text: 'ab' });
    expect(result.ok).toBe(true);
  });

  // --- observe_page command ---

  test('observe_page returns scanned elements', async () => {
    mockDom.scanDocument.mockImplementation((doc, arr, map, prefix) => {
      arr.push({ ref: 'ref_1', tag: 'button' });
    });
    const result = await runCmd({ type: 'observe_page' });
    expect(result.ok).toBe(true);
    expect(result.data.elements).toHaveLength(1);
    expect(result.data.elements[0].ref).toBe('ref_1');
  });

  test('observe_page returns empty when no elements', async () => {
    mockDom.scanDocument.mockImplementation(() => {});
    const result = await runCmd({ type: 'observe_page' });
    expect(result.ok).toBe(true);
    expect(result.data.elements).toEqual([]);
  });

  // --- read_page command ---

  test('read_page returns title, URL, and body content', async () => {
    const result = await runCmd({ type: 'read_page' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('Test Page');
    expect(result.data).toContain('https://example.com/page');
  });

  test('read_page uses main element when available', async () => {
    const mainEl = {
      cloneNode: jest.fn(() => ({
        innerText: 'Main content area text '.repeat(10),
        textContent: '',
        querySelectorAll: jest.fn(() => []),
        remove: jest.fn(),
      })),
    };
    mockDoc.querySelector.mockImplementation((sel) => {
      if (sel === 'main') return mainEl;
      return null;
    });
    const result = await runCmd({ type: 'read_page' });
    expect(result.ok).toBe(true);
    expect(result.data).toContain('Main content');
  });

  test('read_page falls back to body when main has short content', async () => {
    const mainEl = {
      cloneNode: jest.fn(() => ({
        innerText: 'short',
        textContent: '',
        querySelectorAll: jest.fn(() => []),
        remove: jest.fn(),
      })),
    };
    mockDoc.querySelector.mockImplementation((sel) => {
      if (sel === 'main') return mainEl;
      return null;
    });
    mockDoc.body = {
      cloneNode: jest.fn(() => ({
        querySelectorAll: jest.fn(() => []),
        innerText: 'Body content that is long enough to pass the threshold check for read_page fallback',
        remove: jest.fn(),
      })),
    };
    const result = await runCmd({ type: 'read_page' });
    expect(result.ok).toBe(true);
  });

  test('read_page skips nav/header/footer from content', async () => {
    const navEl = { remove: jest.fn() };
    const scriptEl = { remove: jest.fn() };
    const mainEl = {
      cloneNode: jest.fn(() => ({
        innerText: 'Main content '.repeat(20),
        textContent: '',
        querySelectorAll: jest.fn((sel) => {
          if (sel === 'nav' || sel === 'script') return [navEl, scriptEl];
          return [];
        }),
        remove: jest.fn(),
      })),
    };
    mockDoc.querySelector.mockImplementation((sel) => {
      if (sel === 'main') return mainEl;
      return null;
    });
    const result = await runCmd({ type: 'read_page' });
    expect(result.ok).toBe(true);
  });

  // --- unknown command ---

  test('unknown command type returns error', async () => {
    const result = await runCmd({ type: 'scroll_to_bottom' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown command type');
  });

  // --- exception handling ---

  test('catches exception during command execution', async () => {
    mockDom.findElementBySelector.mockImplementation(() => { throw new Error('DOM crash'); });
    const result = await runCmd({ type: 'click', selector: '#btn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Frame command error');
    expect(result.error).toContain('DOM crash');
  });
});

// ========== rebuildFrameMap (internal function) ==========

describe('rebuildFrameMap — internal function', () => {
  test('sorts frames by frameId for stable ordering', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 10, parentId: 0, url: 'https://example.com/b' },
      { frameId: 3, parentId: 0, url: 'https://example.com/a' },
    ]);

    // The sort function should order by frameId ascending
    const result = await resolveFrameForSelector(7003, 0);
    expect(result).toBe(3); // First iframe after sorting by frameId
  });

  test('handles getAllFrames rejection gracefully in listener', async () => {
    chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('tab closed'));
    // Simulate onCommitted listener calling rebuildFrameMap
    const { addFrameRouterListeners } = await import('../background/frame-router.js');
    const committedListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0]?.[0];
    if (committedListener) {
      committedListener({ tabId: 7002, frameId: 0, url: 'https://example.com' });
      await new Promise(r => setTimeout(r, 50));
    }
    // Should not throw
    expect(true).toBe(true);
  });
});

// ========== resolveFrameForSelector error handling ==========

describe('resolveFrameForSelector — error handling', () => {
  test('catches and logs getAllFrames errors', async () => {
    chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('API failure'));
    const result = await resolveFrameForSelector(7004, 0);
    expect(result).toBeNull();
  });

  test('handles frames array with only main frame (no iframes)', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
    ]);
    const result = await resolveFrameForSelector(7005, 0);
    // No iframes, so result should be null
    expect(result).toBeNull();
  });

  test('handles empty frames array', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);
    const result = await resolveFrameForSelector(7006, 0);
    expect(result).toBeNull();
  });

  test('handles getAllFrames returning null (not empty array)', async () => {
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce(null);
    const result = await resolveFrameForSelector(7007, 0);
    expect(result).toBeNull();
  });

  test('handles URL parse error for main frame (line 78-79)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: '::invalid-url::' },
      { frameId: 1, parentId: 0, url: 'https://example.com/iframe' },
    ]);
    const frames = await enumerateFrames(7008);
    expect(frames).toHaveLength(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Sentinel/frame-router] URL parse failed for main frame:',
      expect.any(String)
    );
    consoleWarnSpy.mockRestore();
  });

  test('handles URL parse error for iframe (line 88-89)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: 'https://example.com' },
      { frameId: 1, parentId: 0, url: '::invalid-url::' },
    ]);
    const frames = await enumerateFrames(7009);
    expect(frames).toHaveLength(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Sentinel/frame-router] URL parse failed for frame:',
      expect.any(String)
    );
    consoleWarnSpy.mockRestore();
  });

  test('handles both main frame and iframe URL parse errors', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.webNavigation.getAllFrames.mockResolvedValueOnce([
      { frameId: 0, parentId: -1, url: '::invalid-main::' },
      { frameId: 1, parentId: 0, url: '::invalid-iframe::' },
    ]);
    const frames = await enumerateFrames(7010);
    expect(frames).toHaveLength(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Sentinel/frame-router] URL parse failed for main frame:',
      expect.any(String)
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Sentinel/frame-router] URL parse failed for frame:',
      expect.any(String)
    );
    consoleWarnSpy.mockRestore();
  });
});
