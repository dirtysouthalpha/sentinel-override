/**
 * Coverage for tab-manager.js takeScreenshot() — lines 932-1024.
 * Tests the cache-hit paths, CDP success path, and captureVisibleTab fallback.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e && e.message) || String(e)),
  sleep: jest.fn(async () => {}),
}));

const sendMsgMock = jest.fn(async () => null);
const captureVisibleTabMock = jest.fn();

globalThis.chrome = {
  tabs: {
    get: jest.fn((tabId, cb) => { if (cb) cb({ id: tabId, status: 'complete' }); }),
    sendMessage: sendMsgMock,
    captureVisibleTab: captureVisibleTabMock,
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(async () => ({})),
  },
  scripting: { executeScript: jest.fn(async () => []) },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: jest.fn(async () => {}),
    sendCommand: jest.fn(async () => ({})),
    onEvent: { addListener: jest.fn() },
    onDetach: { addListener: jest.fn() },
  },
};

const { takeScreenshot, setPageLoadConfig, cdpExecuteJs } =
  await import('../background/tab-manager.js');

// Bootstrap: install listeners, put BOOTSTRAP_TAB in attachedDebuggees
const BOOTSTRAP_TAB = 11001;
await cdpExecuteJs(BOOTSTRAP_TAB, 'return 0');

const WINDOW_ID = 1;
const CURRENT_URL = 'https://example.com/page';

// Unique tab IDs per test to avoid attachedDebuggees state interference
let tabCounter = 11100;
function freshTab() { return ++tabCounter; }

beforeEach(() => {
  jest.clearAllMocks();
  chrome.debugger.attach.mockResolvedValue(undefined);
  chrome.debugger.detach.mockResolvedValue(undefined);
  chrome.debugger.sendCommand.mockResolvedValue({});
  chrome.runtime.lastError = null;
});

// ─── Cache hit: new snapshot shape (lines 936-939) ───────────────────────────

describe('takeScreenshot — cache hit (new snapshot shape, lines 936-939)', () => {
  test('returns cached snapshot merged with current url', async () => {
    const cached = { base64Image: 'abc123', width: 1024, height: 768, dpr: 2, scrollX: 0, scrollY: 0 };
    const screenshotCache = { lastScreenshotUrl: CURRENT_URL, cachedSnapshot: cached };
    const result = await takeScreenshot(BOOTSTRAP_TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: true }, 1, null);
    expect(result).toMatchObject({ base64Image: 'abc123', width: 1024, url: CURRENT_URL });
    // Pure cache hit — no CDP calls
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
  });
});

// ─── Cache hit: legacy base64Image shape (lines 940-948) ─────────────────────

describe('takeScreenshot — cache hit (legacy shape, lines 940-948)', () => {
  test('wraps legacy cachedBase64Image in new object form', async () => {
    const screenshotCache = {
      lastScreenshotUrl: CURRENT_URL,
      cachedSnapshot: null,
      cachedBase64Image: 'legacy_data',
    };
    const result = await takeScreenshot(BOOTSTRAP_TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: true }, 1, null);
    expect(result).toMatchObject({
      base64Image: 'legacy_data',
      url: CURRENT_URL,
      width: 0,
      dpr: 1,
    });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
  });
});

// ─── CDP success path with viewport from content script (lines 951-1022) ─────

describe('takeScreenshot — CDP success path (lines 951-1024)', () => {
  test('returns snapshot with viewport dimensions from content script', async () => {
    const TAB = freshTab();
    // Viewport response must use sendMessageWithRetry envelope: { ok: true, data: ... }
    sendMsgMock.mockResolvedValueOnce({
      ok: true,
      data: { width: 1280, height: 720, dpr: 2, scrollX: 0, scrollY: 100 },
    });
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Page.captureScreenshot') return { data: 'cdp_screenshot_data' };
      return {};
    });

    const screenshotCache = {};
    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: false, screenshotQuality: 80 }, 1, null);

    expect(result).toMatchObject({
      base64Image: 'cdp_screenshot_data',
      width: 1280,
      height: 720,
      dpr: 2,
      scrollY: 100,
      url: CURRENT_URL,
    });
    // screenshotCache updated
    expect(screenshotCache.cachedSnapshot).toBeDefined();
    expect(screenshotCache.lastScreenshotUrl).toBe(CURRENT_URL);
    expect(screenshotCache.cachedBase64Image).toBeNull();
  });

  test('uses default viewport when sendMessageWithRetry throws (line 970 catch)', async () => {
    const TAB = freshTab();
    // maxRetries=1 → rejects immediately → sendMessageWithRetry throws → caught at line 970
    sendMsgMock.mockRejectedValueOnce(new Error('content script gone'));
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Page.captureScreenshot') return { data: 'cdp_default_vp' };
      return {};
    });

    const screenshotCache = {};
    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: false, screenshotQuality: 70 }, 1, null);

    // Default viewport: width=0, dpr=1
    expect(result).toMatchObject({ base64Image: 'cdp_default_vp', width: 0, dpr: 1 });
  });

  test('returns null when CDP sendCommand returns no data (line 1024)', async () => {
    const TAB = freshTab();
    // Default sendCommand returns {} → screenshotResult.data is undefined → base64Image=null
    const screenshotCache = {};
    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: false, screenshotQuality: 70 }, 1, null);
    expect(result).toBeNull();
  });
});

// ─── CDP failure → captureVisibleTab fallback (lines 981-1006) ───────────────

describe('takeScreenshot — CDP failure, captureVisibleTab fallback (lines 981-1007)', () => {
  test('falls back to captureVisibleTab and returns snapshot on success', async () => {
    const TAB = freshTab();
    chrome.debugger.attach.mockRejectedValueOnce(new Error('attach blocked'));
    captureVisibleTabMock.mockImplementationOnce((wid, opts, cb) => {
      cb('data:image/jpeg;base64,fallback_data');
    });

    const screenshotCache = {};
    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: false, screenshotQuality: 70 }, 1, null);
    expect(result).toMatchObject({ base64Image: 'fallback_data', url: CURRENT_URL });
  });

  test('covers detach-also-throws path (line 986) during CDP failure cleanup', async () => {
    const TAB = freshTab();
    chrome.debugger.attach.mockRejectedValueOnce(new Error('attach failed'));
    chrome.debugger.detach.mockRejectedValueOnce(new Error('already detached'));
    captureVisibleTabMock.mockImplementationOnce((wid, opts, cb) => {
      cb('data:image/jpeg;base64,detach_err_fallback');
    });

    const screenshotCache = {};
    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, screenshotCache, { screenshotCache: false, screenshotQuality: 70 }, 1, null);
    expect(result).toMatchObject({ base64Image: 'detach_err_fallback' });
  });

  test('returns null and calls sendSilentUpdateFn when captureVisibleTab has lastError', async () => {
    const TAB = freshTab();
    chrome.debugger.attach.mockRejectedValueOnce(new Error('attach failed'));
    captureVisibleTabMock.mockImplementationOnce((wid, opts, cb) => {
      chrome.runtime.lastError = { message: 'No tab with id: 99' };
      cb(null);
      chrome.runtime.lastError = null;
    });

    const sendSilentUpdateFn = jest.fn();
    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, {}, { screenshotCache: false, screenshotQuality: 70 }, 3, sendSilentUpdateFn);
    expect(result).toBeNull();
    expect(sendSilentUpdateFn).toHaveBeenCalledWith('Screenshot skipped (text-only mode)', 3);
  });

  test('returns null when captureVisibleTab returns an empty string (lines 993-994)', async () => {
    const TAB = freshTab();
    chrome.debugger.attach.mockRejectedValueOnce(new Error('attach failed'));
    captureVisibleTabMock.mockImplementationOnce((wid, opts, cb) => {
      cb(''); // empty — triggers "empty data" rejection
    });

    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, {}, { screenshotCache: false, screenshotQuality: 70 }, 1, null);
    expect(result).toBeNull();
  });

  test('returns null when captureVisibleTab returns a data URL without base64 part (line 1001)', async () => {
    const TAB = freshTab();
    chrome.debugger.attach.mockRejectedValueOnce(new Error('attach failed'));
    captureVisibleTabMock.mockImplementationOnce((wid, opts, cb) => {
      cb('no-comma-at-all'); // split(',') → ['no-comma-at-all'], length < 2 → throw
    });

    const result = await takeScreenshot(TAB, WINDOW_ID, CURRENT_URL, {}, { screenshotCache: false, screenshotQuality: 70 }, 1, null);
    expect(result).toBeNull();
  });
});
