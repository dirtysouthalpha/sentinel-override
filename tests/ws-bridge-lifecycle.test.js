// tests/ws-bridge-lifecycle.test.js
// Coverage for ws-bridge.js: connection lifecycle, message handling, auth flows.

import { jest } from '@jest/globals';

// ===== WebSocket mock =====
let wsInstances = [];
let latestWs = null;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.send = jest.fn();
    this.close = jest.fn(() => { this.readyState = MockWebSocket.CLOSED; });
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    wsInstances.push(this);
    latestWs = this;
  }
}
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;
globalThis.WebSocket = MockWebSocket;

// ===== Chrome storage mock =====
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
};

// ===== Dynamic import mocks =====
let _startAgent = jest.fn(async () => {});
let _stopAgent = jest.fn();
let _agentRunning = false;
let _getActiveTabId = jest.fn(() => null);
let _getTabContext = jest.fn(() => null);

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  get agentRunning() { return _agentRunning; },
  startAgent: async (...a) => _startAgent(...a),
  stopAgent: (...a) => _stopAgent(...a),
}));

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: (...a) => _getActiveTabId(...a),
  getTabContext: (...a) => _getTabContext(...a),
}));

const { startBridge, stopBridge, setAuthTokenForTest, _resetBridgeForTest } =
  await import('../background/ws-bridge.js');

beforeEach(() => {
  wsInstances = [];
  latestWs = null;
  _startAgent = jest.fn(async () => {});
  _stopAgent = jest.fn();
  _agentRunning = false;
  _getActiveTabId = jest.fn(() => null);
  _getTabContext = jest.fn(() => null);
  jest.clearAllMocks();
  _resetBridgeForTest();
  setAuthTokenForTest('test-bridge-token');
  chrome.storage.local.get.mockImplementation((keys, cb) => {
    if (cb) cb({ ws_bridge_token: 'test-bridge-token' });
  });
  chrome.storage.local.set.mockImplementation((obj, cb) => { if (cb) cb(); });
});

afterEach(() => {
  stopBridge();
});

// ===== Helpers =====

async function startAndConnect() {
  await startBridge();
  latestWs.onopen();
}

async function sendMessage(data) {
  await latestWs.onmessage({ data: JSON.stringify(data) });
}

// Flush microtasks so fire-and-forget async chains (sendStatus, handleTask) settle.
function flushAsync() {
  return new Promise(r => setTimeout(r, 0));
}

// ===== startBridge =====

describe('startBridge', () => {
  test('creates a WebSocket connection', async () => {
    await startBridge();
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0].url).toBe('ws://localhost:8001/extension-bridge');
  });

  test('no-op after stopBridge (enabled=false)', async () => {
    stopBridge();
    _resetBridgeForTest();
    // Manually set enabled to false to test guard
    stopBridge(); // sets enabled=false on the already-reset state
    await startBridge();
    expect(wsInstances).toHaveLength(0);
  });

  test('no-op when WebSocket already OPEN', async () => {
    await startBridge();
    latestWs.onopen(); // clears isConnecting flag
    await startBridge(); // ws.readyState === OPEN → skip
    expect(wsInstances).toHaveLength(1);
  });

  test('no-op when already connecting', async () => {
    await startBridge(); // sets isConnecting=true (onopen not called yet)
    await startBridge(); // isConnecting=true → skip
    expect(wsInstances).toHaveLength(1);
  });
});

// ===== stopBridge =====

describe('stopBridge', () => {
  test('closes the WebSocket', async () => {
    await startBridge();
    const ws = latestWs;
    stopBridge();
    expect(ws.close).toHaveBeenCalled();
  });

  test('clears heartbeat timer', async () => {
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    await startBridge();
    latestWs.onopen(); // starts heartbeat timer
    stopBridge();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

// ===== WebSocket constructor failure =====

describe('connect — WebSocket constructor failure', () => {
  test('handles constructor throw and schedules reconnect', async () => {
    const BrokenWebSocket = jest.fn(() => { throw new Error('WebSocket unavailable'); });
    BrokenWebSocket.OPEN = 1;
    BrokenWebSocket.CLOSED = 3;
    globalThis.WebSocket = BrokenWebSocket;

    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    await expect(startBridge()).resolves.toBeUndefined();
    expect(setTimeoutSpy).toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
    globalThis.WebSocket = MockWebSocket;
  });
});

// ===== onopen handler =====

describe('onopen', () => {
  test('sends auth message with token', async () => {
    await startBridge();
    latestWs.onopen();
    expect(latestWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', token: 'test-bridge-token' })
    );
  });

  test('starts heartbeat timer', async () => {
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    await startBridge();
    latestWs.onopen();
    expect(setIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});

// ===== onclose handler =====

describe('onclose', () => {
  test('clears heartbeat timer', async () => {
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    await startBridge();
    latestWs.onopen();
    latestWs.onclose();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  test('schedules reconnect when enabled', async () => {
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    await startBridge();
    latestWs.onopen();
    latestWs.onclose();
    expect(setTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  test('does not schedule reconnect when disabled', async () => {
    await startBridge();
    stopBridge(); // sets enabled=false and closes ws
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    // At this point stopBridge already called ws.close(), but onclose may not have fired
    // Manually trigger onclose with enabled=false
    if (wsInstances[0] && wsInstances[0].onclose) wsInstances[0].onclose();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});

// ===== onerror handler =====

describe('onerror', () => {
  test('does not throw', async () => {
    await startBridge();
    expect(() => latestWs.onerror()).not.toThrow();
  });
});

// ===== onmessage: auth =====

describe('onmessage — auth', () => {
  test('does not crash on auth success', async () => {
    await startAndConnect();
    await expect(sendMessage({ type: 'auth', success: true })).resolves.toBeUndefined();
  });

  test('does not crash on auth failure', async () => {
    await startAndConnect();
    await expect(sendMessage({ type: 'auth', success: false, message: 'bad token' })).resolves.toBeUndefined();
  });

  test('sends status message after auth success', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'auth', success: true });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const statusMsg = calls.find(m => m.type === 'status');
    expect(statusMsg).toBeDefined();
    expect(statusMsg).toMatchObject({ type: 'status', agent_running: false });
  });
});

// ===== onmessage: auth_challenge =====

describe('onmessage — auth_challenge', () => {
  test('sends challenge response', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'auth_challenge', nonce: 'test-nonce' });
    expect(latestWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"auth_challenge_response"')
    );
  });

  test('includes response field in reply', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'auth_challenge', nonce: 'abc123' });
    const sentMsg = JSON.parse(latestWs.send.mock.calls[0][0]);
    expect(sentMsg).toMatchObject({
      type: 'auth_challenge_response',
      response: expect.any(String),
    });
  });
});

// ===== onmessage: task =====

describe('onmessage — task (unauthenticated)', () => {
  test('sends error response', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'task', goal: 'Do something', request_id: 'r1' });
    expect(latestWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"Not authenticated"')
    );
  });
});

describe('onmessage — task (authenticated)', () => {
  test('calls startAgent with the goal', async () => {
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    await sendMessage({ type: 'task', goal: 'Test goal', request_id: 'req-1' });
    await flushAsync();
    expect(_startAgent).toHaveBeenCalledWith('Test goal', expect.anything());
  });

  test('sends started result before calling startAgent', async () => {
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'task', goal: 'Do work', request_id: 'req-2' });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const resultMsg = calls.find(m => m.type === 'result' && m.data?.status === 'started');
    expect(resultMsg).toBeDefined();
  });

  test('sends error when no goal provided', async () => {
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'task', request_id: 'req-3' }); // missing goal
    expect(latestWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"No goal provided"')
    );
  });

  test('sends error when startAgent throws', async () => {
    _startAgent = jest.fn().mockRejectedValue(new Error('Agent crash'));
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'task', goal: 'Crash test', request_id: 'req-4' });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const errMsg = calls.find(m => m.type === 'error');
    expect(errMsg).toBeDefined();
    expect(errMsg.message).toContain('Agent error:');
  });
});

// ===== onmessage: query =====

describe('onmessage — query (unauthenticated)', () => {
  test('sends error response', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'query', message: 'What page?', request_id: 'q1' });
    expect(latestWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"Not authenticated"')
    );
  });
});

describe('onmessage — query (authenticated)', () => {
  test('returns url and title from tab context', async () => {
    _getActiveTabId = jest.fn(() => 42);
    _getTabContext = jest.fn(() => ({ url: 'https://example.com', title: 'Example' }));
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'query', message: 'Where am I?', request_id: 'q2' });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const resultMsg = calls.find(m => m.type === 'result');
    expect(resultMsg).toMatchObject({
      type: 'result',
      success: true,
      data: { url: 'https://example.com', title: 'Example' },
    });
  });

  test('returns unknown url/title when no active tab', async () => {
    _getActiveTabId = jest.fn(() => null);
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'query', message: 'Where?', request_id: 'q3' });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const resultMsg = calls.find(m => m.type === 'result');
    expect(resultMsg?.data?.url).toBe('unknown');
    expect(resultMsg?.data?.title).toBe('unknown');
  });
});

// ===== onmessage: cancel =====

describe('onmessage — cancel (unauthenticated)', () => {
  test('sends error response', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'cancel', request_id: 'c1' });
    expect(latestWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"Not authenticated"')
    );
  });
});

describe('onmessage — cancel (authenticated)', () => {
  test('calls stopAgent and returns cancelled result', async () => {
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'cancel', request_id: 'c2' });
    await flushAsync();
    expect(_stopAgent).toHaveBeenCalled();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const resultMsg = calls.find(m => m.type === 'result');
    expect(resultMsg).toMatchObject({ type: 'result', success: true, data: { status: 'cancelled' } });
  });

  test('sends error when stopAgent throws', async () => {
    _stopAgent = jest.fn(() => { throw new Error('stop failed'); });
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'cancel', request_id: 'c3' });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const errMsg = calls.find(m => m.type === 'error');
    expect(errMsg).toBeDefined();
    expect(errMsg.message).toContain('Cancel error:');
  });
});

// ===== onmessage: edge cases =====

describe('onmessage — edge cases', () => {
  test('drops oversized message without crash', async () => {
    await startAndConnect();
    const oversized = 'x'.repeat(1048577);
    await expect(latestWs.onmessage({ data: oversized })).resolves.toBeUndefined();
  });

  test('does not throw on invalid JSON', async () => {
    await startAndConnect();
    await expect(latestWs.onmessage({ data: '{ bad json {{' })).resolves.toBeUndefined();
  });

  test('drops message with unknown type', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'totally_unknown_type' });
    expect(latestWs.send).not.toHaveBeenCalled();
  });
});

// ===== ensureAuthToken storage branches =====

describe('ensureAuthToken', () => {
  test('uses stored token when available in storage', async () => {
    setAuthTokenForTest(null); // clear in-memory cache
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      if (cb) cb({ ws_bridge_token: 'stored-abc' });
    });
    await startBridge();
    latestWs.onopen();
    expect(latestWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', token: 'stored-abc' })
    );
  });

  test('generates and persists a new token when none exists', async () => {
    setAuthTokenForTest(null); // clear in-memory cache
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      if (cb) cb({}); // nothing in storage
    });
    await startBridge();
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ ws_bridge_token: expect.any(String) }),
      expect.any(Function)
    );
  });
});

// ===== handleMessage default case =====

describe('onmessage — status type (default switch case)', () => {
  // 'status' passes validateMessage but has no case in the switch, hitting default
  test('handles status type without crash', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    await sendMessage({ type: 'status' });
    // No crash, no response sent (default case just logs a warning)
    expect(latestWs.send).not.toHaveBeenCalled();
  });
});

// ===== handleQuery error path =====

describe('onmessage — query error path', () => {
  test('sends error response when getActiveTabId throws', async () => {
    _getActiveTabId = jest.fn(() => { throw new Error('tab access denied'); });
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    latestWs.send.mockClear();
    await sendMessage({ type: 'query', message: 'test', request_id: 'qerr' });
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const errMsg = calls.find(m => m.type === 'error');
    expect(errMsg).toBeDefined();
    expect(errMsg.message).toContain('Query error:');
  });
});

// ===== sendStatus when ws closed =====

describe('sendStatus — ws not open', () => {
  test('does not crash when ws is null (no bridge started)', async () => {
    // sendStatus is internal, but calling stopBridge and then triggering a
    // heartbeat-like scenario: start, open, close, verify no crash from status
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true }); // triggers sendStatus
    latestWs.readyState = MockWebSocket.CLOSED; // simulate disconnect mid-status
    await flushAsync(); // allow sendStatus promise chain to settle
    // No crash = pass
  });
});

// ===== Heartbeat callback body (lines 100-101) =====
// Fake timers don't intercept ESM bare globals reliably; capture the callback directly.

describe('heartbeat timer — callback body executes (lines 100-101)', () => {
  function captureHeartbeat(callback) {
    const origSetInterval = globalThis.setInterval;
    let fn = null;
    globalThis.setInterval = (cb, delay) => { fn = cb; return origSetInterval(cb, delay); };
    return callback().then(() => { globalThis.setInterval = origSetInterval; return fn; });
  }

  test('calls sendStatus when heartbeat fires and ws is OPEN', async () => {
    const heartbeatFn = await captureHeartbeat(async () => {
      await startBridge();
      latestWs.onopen();
    });
    expect(heartbeatFn).not.toBeNull();
    latestWs.send.mockClear();
    heartbeatFn(); // true branch: ws is OPEN → sendStatus()
    await flushAsync();
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.find(m => m.type === 'status')).toBeDefined();
  });

  test('skips sendStatus when ws is not OPEN (false branch, line 100)', async () => {
    const heartbeatFn = await captureHeartbeat(async () => {
      await startBridge();
      latestWs.onopen();
    });
    latestWs.readyState = MockWebSocket.CLOSED; // ws exists but not OPEN
    latestWs.send.mockClear();
    heartbeatFn(); // false branch: condition fails, sendStatus not called
    await flushAsync();
    expect(latestWs.send).not.toHaveBeenCalled();
  });
});

// ===== scheduleReconnect callback body (line 152) =====

describe('scheduleReconnect — callback body executes (line 152)', () => {
  function captureReconnect(callback) {
    let fn = null;
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (cb) => { fn = cb; }; // capture but don't schedule
    callback();
    globalThis.setTimeout = origSetTimeout;
    return fn;
  }

  test('calls connect() when reconnect fires while enabled (true branch)', async () => {
    await startBridge();
    latestWs.onopen();
    const wsBefore = wsInstances.length;
    const reconnectFn = captureReconnect(() => latestWs.onclose());
    expect(reconnectFn).not.toBeNull();
    reconnectFn(); // enabled=true → connect() → new WebSocket
    expect(wsInstances.length).toBeGreaterThan(wsBefore);
  });

  test('skips connect() when bridge is disabled (false branch, line 152)', async () => {
    await startBridge();
    latestWs.onopen();
    const wsBefore = wsInstances.length;
    const reconnectFn = captureReconnect(() => latestWs.onclose());
    expect(reconnectFn).not.toBeNull();
    stopBridge(); // enabled=false
    reconnectFn(); // enabled=false → connect() not called
    expect(wsInstances.length).toBe(wsBefore);
  });
});

// ===== sendResponse when ws is closed (line 300 false branch) =====

describe('sendResponse — skips send when ws is not open', () => {
  test('does not call ws.send when readyState is CLOSED', async () => {
    await startAndConnect();
    latestWs.readyState = MockWebSocket.CLOSED; // ws exists but not OPEN
    latestWs.send.mockClear();
    // Trigger sendResponse via unauthenticated task (authenticated=false after reset)
    await sendMessage({ type: 'task', goal: 'x', request_id: 'closed-test' });
    expect(latestWs.send).not.toHaveBeenCalled();
  });
});

// ===== sendResponse with falsy requestId (line 301 false branch) =====

describe('sendResponse — omits request_id when requestId is falsy (line 301)', () => {
  test('response has no request_id field when message sent without request_id', async () => {
    await startAndConnect();
    latestWs.send.mockClear();
    // Sending without request_id → requestId=undefined → if(requestId) false branch
    await sendMessage({ type: 'task', goal: 'no-id-test' });
    const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
    const errMsg = calls.find(m => m.type === 'error');
    expect(errMsg).toBeDefined();
    expect(errMsg.request_id).toBeUndefined();
  });
});

// ===== sendStatus early return when ws closed (line 307 true branch) =====

describe('sendStatus — early return when ws is not open', () => {
  test('does not crash when ws is null at sendStatus call time', async () => {
    await startAndConnect();
    await sendMessage({ type: 'auth', success: true });
    // _resetBridgeForTest sets ws=null; sendStatus guard fires on next call
    _resetBridgeForTest();
    setAuthTokenForTest('test-bridge-token');
    // Simulate sending auth again — sendStatus fires but ws is now null → early return
    await startBridge();
    latestWs.onopen();
    latestWs.readyState = MockWebSocket.CLOSED;
    latestWs.send.mockClear();
    await sendMessage({ type: 'auth', success: true });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // No crash; send was not called because ws.readyState !== OPEN
    expect(latestWs.send).not.toHaveBeenCalled();
  });
});

// ===== _resetBridgeForTest with active heartbeatTimer (line 338) =====

describe('_resetBridgeForTest — clears active heartbeatTimer (line 338)', () => {
  test('calls clearInterval when heartbeatTimer is set before reset', async () => {
    await startBridge();
    latestWs.onopen(); // sets heartbeatTimer
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    _resetBridgeForTest(); // heartbeatTimer is set → executes line 338 branch
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

// ===== computeChallengeResponse: digestSync path (line 207) =====

describe('computeChallengeResponse — uses digestSync when available (line 207)', () => {
  test('produces hex digest from digestSync result', async () => {
    const origCrypto = globalThis.crypto;
    const mockDigestSync = jest.fn(() => new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    globalThis.crypto = { subtle: { digestSync: mockDigestSync } };
    try {
      await startAndConnect();
      latestWs.send.mockClear();
      await sendMessage({ type: 'auth_challenge', nonce: 'nonce123' });
      expect(mockDigestSync).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      const calls = latestWs.send.mock.calls.map(c => JSON.parse(c[0]));
      const resp = calls.find(m => m.type === 'auth_challenge_response');
      expect(resp).toBeDefined();
      expect(resp.response).toBe('deadbeef');
    } finally {
      globalThis.crypto = origCrypto;
    }
  });
});
