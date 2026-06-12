/**
 * Branch coverage for tab-manager.js uncovered paths:
 *   49-51   waitForPageLoad — addListener catch
 *   73-81   getInFlightRequestCount — entries in flight
 *   106-113 _checkDomReadyState — object path with .value
 *   150     waitForPageReady — networkIdleSince reset when inFlight > 0
 *   339-346 recordNetworkStart — buffer eviction past NETWORK_BUFFER_MAX
 *   566-572 onDetach listener callback body
 *   585-586 detachAllDebuggees — catch block
 *   622     ensureDebuggerAttached — wasUserDetached branch
 *
 * Strategy: capture the callbacks registered on chrome.debugger.onDetach and
 * chrome.debugger.onEvent, then fire them directly to exercise internal paths
 * that can't be reached through normal exported-function calls alone.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e && e.message) || String(e)),
  sleep: jest.fn(async () => {}),
}));

let capturedOnDetachListener = null;
let capturedOnEventListener = null;
const detachMock = jest.fn(async () => {});
const tabsSendMessageMock = jest.fn(async () => null);
const runtimeSendMessageMock = jest.fn(async () => ({}));

globalThis.chrome = {
  tabs: {
    get: jest.fn((tabId, cb) => { if (cb) cb({ id: tabId, status: 'complete' }); }),
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    sendMessage: tabsSendMessageMock,
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    sendMessage: runtimeSendMessageMock,
  },
  scripting: { executeScript: jest.fn(async () => []) },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: detachMock,
    sendCommand: jest.fn(async () => ({})),
    onEvent: { addListener: jest.fn((fn) => { capturedOnEventListener = fn; }) },
    onDetach: { addListener: jest.fn((fn) => { capturedOnDetachListener = fn; }) },
  },
};

const {
  waitForPageLoad,
  waitForPageReady,
  setPageLoadConfig,
  detachAllDebuggees,
  cdpExecuteJs,
  readNetworkRequests,
} = await import('../background/tab-manager.js');

const TAB = 77777;

// Bootstrap: one CDP call registers installDetachListenerOnce and
// installObservabilityEventHook listeners and puts TAB in attachedDebuggees.
await cdpExecuteJs(TAB, 'return 0');

// ── waitForPageLoad — addListener catch (lines 49-51) ────────────────────────

describe('waitForPageLoad — addListener catch (lines 49-51)', () => {
  test('resolves cleanly when chrome.tabs.onUpdated.addListener throws', async () => {
    // tabs.get must return a loading tab so waitForPageLoad doesn't exit early at line 37
    chrome.tabs.get.mockImplementationOnce((tabId, cb) => {
      cb({ id: tabId, status: 'loading' });
    });
    chrome.tabs.onUpdated.addListener.mockImplementationOnce(() => {
      throw new Error('addListener blocked in test');
    });
    await expect(waitForPageLoad(TAB)).resolves.toBeUndefined();
  });
});

// ── onDetach listener callback body (lines 566-572) ──────────────────────────

describe('onDetach listener callback — lines 566-572', () => {
  test('fires with a valid tabId source, cleans up tracking state', () => {
    expect(capturedOnDetachListener).not.toBeNull();
    // Fire the registered callback: exercises lines 568-571
    // (delete from attachedDebuggees, clearObservabilityBuffers, add to userDetachedTabs)
    capturedOnDetachListener({ tabId: TAB });
    // Effect: TAB is no longer in attachedDebuggees and is now in userDetachedTabs —
    // verified indirectly by the wasUserDetached test below.
  });

  test('no-ops when source lacks a numeric tabId', () => {
    // Branch: source && typeof source.tabId === 'number' → false → early return
    expect(() => capturedOnDetachListener({ tabId: 'string-not-number' })).not.toThrow();
    expect(() => capturedOnDetachListener({})).not.toThrow();
    expect(() => capturedOnDetachListener(null)).not.toThrow();
  });
});

// ── ensureDebuggerAttached — wasUserDetached branch (line 622) ───────────────

describe('ensureDebuggerAttached — wasUserDetached reattach warning (line 622)', () => {
  test('sends cdp_reattach_warning when tabId was previously user-detached', async () => {
    // After firing the onDetach callback above, TAB is in userDetachedTabs and
    // NOT in attachedDebuggees. Re-attaching via a CDP call exercises line 622.
    runtimeSendMessageMock.mockClear();
    await cdpExecuteJs(TAB, 'return 1');
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdp_reattach_warning', tabId: TAB })
    );
  });
});

// ── detachAllDebuggees — catch block (lines 585-586) ─────────────────────────

describe('detachAllDebuggees — catch block (lines 585-586)', () => {
  test('swallows detach errors without throwing', async () => {
    // TAB is now back in attachedDebuggees (re-added in the wasUserDetached test above).
    detachMock.mockRejectedValueOnce(new Error('already detached'));
    await expect(detachAllDebuggees()).resolves.toBeUndefined();
  });
});

// ── _checkDomReadyState — various parse paths ─────────────────────────────────

describe('_checkDomReadyState — object with .value string (lines 106-113)', () => {
  test('waitForPageReady resolves when sendMessage returns {value: readyStateJSON}', async () => {
    // networkIdleMs: 0 → networkIdle becomes true immediately after first idle check
    setPageLoadConfig({ networkIdleMs: 0, pollInterval: 0 });
    tabsSendMessageMock.mockResolvedValue({
      value: JSON.stringify({ readyState: 'complete', bodyLen: 100, hasSpinner: false })
    });
    await expect(waitForPageReady(TAB, 500)).resolves.toBeUndefined();
  });
});

describe('_checkDomReadyState — sendMessage rejects (line 104 catch handler)', () => {
  test('waitForPageReady continues when sendMessage rejects', async () => {
    setPageLoadConfig({ networkIdleMs: 0, pollInterval: 0, pageLoadTimeout: 100 });
    // First call rejects (exercises the .catch(() => null) handler on line 104),
    // then subsequent calls return null so the loop exits via timeout.
    tabsSendMessageMock.mockRejectedValue(new Error('content script gone'));
    await expect(waitForPageReady(TAB, 200)).resolves.toBeUndefined();
  });
});

describe('_checkDomReadyState — string data paths (lines 107-108, 114-123)', () => {
  test('resolves when sendMessage returns a valid JSON string (line 108 parse succeeds → object path)', async () => {
    setPageLoadConfig({ networkIdleMs: 0, pollInterval: 0 });
    // Returns a JSON string (not an object) — exercises lines 107-108 (string → JSON.parse → object)
    tabsSendMessageMock.mockResolvedValue(
      JSON.stringify({ readyState: 'complete', bodyLen: 200, hasSpinner: false })
    );
    await expect(waitForPageReady(TAB, 500)).resolves.toBeUndefined();
  });

  test('continues when sendMessage returns an invalid JSON string (lines 114-118 else-if branch)', async () => {
    setPageLoadConfig({ networkIdleMs: 0, pollInterval: 0, pageLoadTimeout: 100 });
    // Returns a non-JSON string → JSON.parse throws → data stays a string → else-if branch (line 114)
    tabsSendMessageMock.mockResolvedValue('not-valid-json{{{{');
    await expect(waitForPageReady(TAB, 200)).resolves.toBeUndefined();
  });

  test('resolves when sendMessage returns a double-encoded JSON string (line 117 return true)', async () => {
    setPageLoadConfig({ networkIdleMs: 0, pollInterval: 0 });
    // Outer JSON.parse yields another string (not an object) → else-if (typeof data === 'string') at line 114
    // Inner JSON.parse then succeeds → return true at line 117
    const innerJson = JSON.stringify({ readyState: 'complete', bodyLen: 200, hasSpinner: false });
    tabsSendMessageMock.mockResolvedValue(JSON.stringify(innerJson));
    await expect(waitForPageReady(TAB, 500)).resolves.toBeUndefined();
  });
});

// ── getInFlightRequestCount + networkIdleSince reset (lines 73-81, 150) ──────

describe('getInFlightRequestCount and networkIdleSince=null (lines 73-81, 150)', () => {
  test('waitForPageReady reads in-flight count when networkBuffers has an open request', async () => {
    expect(capturedOnEventListener).not.toBeNull();
    const TAB3 = 33333;
    // Seed one in-flight (endTs=0) network request for TAB3
    capturedOnEventListener({ tabId: TAB3 }, 'Network.requestWillBeSent', {
      requestId: 'pending-req',
      request: { method: 'GET', url: 'https://example.com/slow' },
      type: 'XHR'
    });
    // pageLoadTimeout small so the while loop exits quickly even with inFlight > 0
    setPageLoadConfig({ networkIdleMs: 1000, pollInterval: 0, pageLoadTimeout: 100 });
    tabsSendMessageMock.mockResolvedValue(null); // domReady = false → loop runs until cap
    // resolves after cap (100ms) without throwing
    await expect(waitForPageReady(TAB3, 200)).resolves.toBeUndefined();
    // Verify the in-flight request was counted (readNetworkRequests confirms the entry exists)
    const reqs = readNetworkRequests(TAB3, { limit: 10 });
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://example.com/slow');
  });
});

// ── recordNetworkStart — buffer eviction (lines 339-346) ─────────────────────

describe('recordNetworkStart — NETWORK_BUFFER_MAX eviction (lines 339-346)', () => {
  test('trims oldest entries when buffer exceeds 200 entries', () => {
    const TAB4 = 44444;
    // Fire 201 requestWillBeSent events → 201st entry triggers the eviction path
    for (let i = 0; i < 201; i++) {
      capturedOnEventListener({ tabId: TAB4 }, 'Network.requestWillBeSent', {
        requestId: `r${i}`,
        request: { method: 'GET', url: `https://example.com/${i}` },
        type: 'XHR'
      });
    }
    const reqs = readNetworkRequests(TAB4, { limit: 300 });
    expect(reqs.length).toBeLessThanOrEqual(200);
  });
});

// ── wasUserDetached: .catch() fires (line 629) ────────────────────────────────

describe('ensureDebuggerAttached — wasUserDetached .catch() callback (line 629)', () => {
  test('logs error when sendMessage promise rejects', async () => {
    const TAB5 = 55555;
    // Put TAB5 in userDetachedTabs via the onDetach listener
    capturedOnDetachListener({ tabId: TAB5 });
    // sendMessage returns a rejecting promise → .catch() at line 629 fires
    runtimeSendMessageMock.mockReturnValueOnce(Promise.reject(new Error('send rejected')));
    // No throw from cdpExecuteJs — the rejection is handled by .catch()
    await expect(cdpExecuteJs(TAB5, 'return 0')).resolves.toBeDefined();
  });
});

// ── wasUserDetached: outer catch fires (line 631) ─────────────────────────────

describe('ensureDebuggerAttached — wasUserDetached outer catch (line 631)', () => {
  test('logs warning when sendMessage throws synchronously', async () => {
    const TAB6 = 66666;
    capturedOnDetachListener({ tabId: TAB6 });
    // sendMessage throws synchronously → outer catch at line 631 fires
    runtimeSendMessageMock.mockImplementationOnce(() => { throw new Error('sync throw'); });
    await expect(cdpExecuteJs(TAB6, 'return 0')).resolves.toBeDefined();
  });
});
