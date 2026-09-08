// Sentinel Override v20.0.0 — WebSocket Bridge Client
// Connects to SENTINEL PRIME bridge server for external orchestration.
// Receives task/query/cancel commands and routes to the agent engine.

import { getErrorMessage } from './error-utils.js';
import {startAgent as _wsStartAgent, stopAgent as _wsStopAgent, agentRunning as _wsAgentRunning} from './agent-engine.js';
import {getActiveTabId as _wsGetActiveTabId, getTabContext as _wsGetTabContext} from './tab-context.js';
// (v21.6) Global unhandled rejection guard — SW context only, skips test envs
if (typeof self !== 'undefined' && self.addEventListener && typeof window === 'undefined') {
  self.addEventListener('unhandledrejection', (event) => {
    console.warn('[Sentinel] Unhandled rejection:', event.reason?.message || event.reason);
    event.preventDefault();
  });
}



// ========== Configuration ==========
const BRIDGE_URL = 'ws://localhost:8001/extension-bridge';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;
// Dead-connection threshold: if no inbound message received within this window,
// the socket is treated as dead and closed (onclose triggers reconnect).
const DEAD_CONNECTION_MS = 30000;
const MAX_MESSAGE_SIZE = 1048576;
const VALID_MSG_TYPES = new Set(['auth', 'auth_challenge', 'task', 'query', 'cancel', 'status']);

let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let heartbeatTimer = null;
let isConnecting = false;
let enabled = true;
let authenticated = false;
let challengeNonce = null;
// Timestamp of the last inbound frame from the server. Drives dead-connection
// detection in the heartbeat callback. Updated on every onmessage and on open.
let lastMessageAt = Date.now();

// Auth token loaded from chrome.storage.local — never hardcoded.
// Generated once on install, persisted, and read at connect time.
let authToken = null;

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureAuthToken() {
  if (authToken) return authToken;
  return new Promise((resolve) => {
    chrome.storage.local.get(['ws_bridge_token'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[WS-BRIDGE] Failed to read auth token:', getErrorMessage(chrome.runtime.lastError));
        const token = generateToken();
        authToken = token;
        resolve(token);
        return;
      }
      if (result.ws_bridge_token) {
        authToken = result.ws_bridge_token;
        resolve(authToken);
      } else {
        const token = generateToken();
        chrome.storage.local.set({ ws_bridge_token: token }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[WS-BRIDGE] Failed to persist auth token:', getErrorMessage(chrome.runtime.lastError));
          }
          authToken = token;
          resolve(authToken);
        });
      }
    });
  });
}

// ========== Connection Management ==========

export async function startBridge() {
  if (!enabled) return;
  await ensureAuthToken();
  connect();
}

export function stopBridge() {
  enabled = false;
  authenticated = false;
  if (ws) {
    ws.close();
    ws = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function connect() {
  if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  isConnecting = true;

  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch (e) {
    console.warn('[WS-BRIDGE] Failed to create WebSocket:', getErrorMessage(e));
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    isConnecting = false;
    reconnectDelay = RECONNECT_BASE_MS;
    authenticated = false;

    ws.send(JSON.stringify({
      type: 'auth',
      token: authToken
    }));

    // Reset liveness timestamp on fresh connection.
    lastMessageAt = Date.now();

    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Dead-connection detection (WSB-04): if no inbound frame has arrived
        // within DEAD_CONNECTION_MS, the link is presumed dead — close it so
        // onclose fires and triggers reconnect rather than sending into a void.
        if (Date.now() - lastMessageAt >= DEAD_CONNECTION_MS) {
          console.warn('[WS-BRIDGE] Dead connection detected — no message for', DEAD_CONNECTION_MS, 'ms. Closing.');
          ws.close();
          return;
        }
        sendStatus();
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  ws.onmessage = async (event) => {
    try {
      // Any inbound frame (even one that later fails validation) proves the
      // link is live — refresh liveness before doing any work.
      lastMessageAt = Date.now();
      if (typeof event.data === 'string' && event.data.length > MAX_MESSAGE_SIZE) {
        console.warn('[WS-BRIDGE] Oversized message dropped');
        return;
      }
      const message = JSON.parse(event.data);
      if (!validateMessage(message)) {
        console.warn('[WS-BRIDGE] Invalid message structure dropped');
        return;
      }
      await handleMessage(message);
    } catch (e) {
      console.error('[WS-BRIDGE] Error handling message:', e);
    }
  };

  ws.onclose = () => {
    isConnecting = false;
    authenticated = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    console.warn('[WS-BRIDGE] Connection error');
  };
}


// Per-type field validators (WSB-03). These enforce STRUCTURAL validity at the
// inbound boundary — the fields a message MUST carry to be routable/safe:
//   - auth_challenge needs a nonce (can't compute a response without it)
//   - cancel needs a request_id (can't route its response without it)
//   - query needs a message (an empty query is not routable)
// task.goal is intentionally NOT enforced here: handleTask() validates it and
// responds with a precise "No goal provided" error, which is the established
// contract for that command. Schema = structure; handler = semantics.
const MSG_SCHEMA = {
  auth: () => true, // server → client; success optional (lenient for compat)
  auth_challenge: (m) => typeof m.nonce === 'string' && m.nonce.length > 0,
  task: () => true, // goal validated semantically by handleTask()
  query: (m) => typeof m.message === 'string' && m.message.length > 0,
  cancel: (m) => typeof m.request_id === 'string' && m.request_id.length > 0,
  status: () => true,
};

function validateMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (!VALID_MSG_TYPES.has(msg.type)) return false;
  const check = MSG_SCHEMA[msg.type];
  return check ? check(msg) : false;
}

function scheduleReconnect() {
  if (!enabled) return;
  const jitter = Math.random() * 0.3 * reconnectDelay;
  const delay = reconnectDelay + jitter;
  setTimeout(() => {
    if (enabled) connect();
  }, delay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

// ========== Message Handling ==========

async function handleMessage(message) {
  try {

  const msgType = message.type;
  const requestId = message.request_id;


  switch (msgType) {
    case 'auth':
      if (message.success) {
        authenticated = true;
        sendStatus();
      } else {
        console.error('[WS-BRIDGE] Authentication failed:', message.message);
      }
      break;

    case 'auth_challenge': {
      challengeNonce = message.nonce;
      const response = await computeChallengeResponse(challengeNonce);
      ws.send(JSON.stringify({ type: 'auth_challenge_response', response }));
      break;
    }

    case 'task':
      if (!authenticated) { sendResponse(requestId, { type: 'error', message: 'Not authenticated' }); return; }
      await handleTask(message.goal, requestId);
      break;

    case 'query':
      if (!authenticated) { sendResponse(requestId, { type: 'error', message: 'Not authenticated' }); return; }
      await handleQuery(message.message, requestId);
      break;

    case 'cancel':
      if (!authenticated) { sendResponse(requestId, { type: 'error', message: 'Not authenticated' }); return; }
      await handleCancel(requestId);
      break;

    default:
      console.warn(`[WS-BRIDGE] Unknown message type: ${msgType}`);
  }
  } catch (e) {
    console.error('[Sentinel] Error in handleMessage:', e);
    throw e;
  }
}

async function computeChallengeResponse(nonce) {
  const enc = new TextEncoder();
  const data = enc.encode(authToken + ':' + nonce);
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_e) {
    return btoa(authToken + ':' + nonce);
  }
}

async function handleTask(goal, requestId) {
  if (!goal) {
    sendResponse(requestId, { type: 'error', message: 'No goal provided' });
    return;
  }


  try {
    // Import and call the agent engine's startAgent function
    const startAgent = _wsStartAgent;

    // Send progress update
    sendResponse(requestId, {
      type: 'result',
      success: true,
      data: { status: 'started', goal: goal.slice(0, 100) },
      request_id: requestId,
    });

    // Start the agent - this runs asynchronously
    // The agent will send updates via the sidepanel, and we relay them
    const sender = { tab: { id: -1 } };  // Synthetic sender for bridge
    await startAgent(goal, sender);

  } catch (e) {
    console.error('[WS-BRIDGE] Task error:', e);
    sendResponse(requestId, {
      type: 'error',
      message: `Agent error: ${e.message}`,
      request_id: requestId,
    });
  }
}

async function handleQuery(queryText, requestId) {

  try {
    // Get current page content and answer the query
    const getActiveTabId = _wsGetActiveTabId, getTabContext = _wsGetTabContext;
    const tabId = getActiveTabId();
    const ctx = tabId ? getTabContext(tabId) : null;

    const pageUrl = ctx?.url || 'unknown';
    const pageTitle = ctx?.title || 'unknown';

    sendResponse(requestId, {
      type: 'result',
      success: true,
      data: {
        url: pageUrl,
        title: pageTitle,
        query: queryText,
      },
      request_id: requestId,
    });
  } catch (e) {
    sendResponse(requestId, {
      type: 'error',
      message: `Query error: ${e.message}`,
      request_id: requestId,
    });
  }
}

async function handleCancel(requestId) {
  try {
    const stopAgent = _wsStopAgent;
    stopAgent();
    sendResponse(requestId, {
      type: 'result',
      success: true,
      data: { status: 'cancelled' },
      request_id: requestId,
    });
  } catch (e) {
    sendResponse(requestId, {
      type: 'error',
      message: `Cancel error: ${e.message}`,
      request_id: requestId,
    });
  }
}

// ========== Send Helpers ==========

function sendResponse(requestId, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (requestId) message.request_id = requestId;
    ws.send(JSON.stringify(message));
  }
}

function sendStatus() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Get agent state asynchronously
  Promise.resolve({ agentRunning: _wsAgentRunning }).then(({ agentRunning }) => {
    return Promise.resolve({ getActiveTabId: _wsGetActiveTabId, getTabContext: _wsGetTabContext }).then(({ getActiveTabId, getTabContext }) => {
      const tabId = getActiveTabId();
      const ctx = tabId ? getTabContext(tabId) : null;

      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'status',
        agent_running: agentRunning || false,
        url: ctx?.url || '',
        title: ctx?.title || '',
      }));
    });
  }).catch(() => {});
}

// ========== Test exports ==========
// Pure functions exported for unit testing.
// Tests must set authToken before calling computeChallengeResponse.
export { validateMessage, computeChallengeResponse };
export function setAuthTokenForTest(token) { authToken = token; }
// Test helper: force the liveness timestamp so the heartbeat's dead-connection
// check can be exercised deterministically without waiting DEAD_CONNECTION_MS.
export function setLastMessageAtForTest(ts) { lastMessageAt = ts; }
export function getLastMessageAtForTest() { return lastMessageAt; }
export function _resetBridgeForTest() {
  enabled = true;
  authenticated = false;
  isConnecting = false;
  challengeNonce = null;
  authToken = null;
  reconnectDelay = RECONNECT_BASE_MS;
  lastMessageAt = Date.now();
  ws = null;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ========== Auto-start ==========
// Start the bridge connection when this module loads
