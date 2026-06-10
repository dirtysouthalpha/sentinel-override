// Sentinel Override v3.57.0 — WebSocket Bridge Client
// Connects to SENTINEL PRIME bridge server for external orchestration.
// Receives task/query/cancel commands and routes to the agent engine.

// ========== Configuration ==========
const BRIDGE_URL = 'ws://localhost:8001/extension-bridge';
const AUTH_TOKEN = 'sentinel-prime-bridge-2025';
const RECONNECT_BASE_MS = 1000;  // Start with 1s, exponential backoff to 30s
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;

let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let heartbeatTimer = null;
let isConnecting = false;
let enabled = true;  // Can be toggled via settings

// ========== Connection Management ==========

export function startBridge() {
  if (!enabled) return;
  console.log('[WS-BRIDGE] Starting WebSocket bridge client...');
  connect();
}

export function stopBridge() {
  console.log('[WS-BRIDGE] Stopping...');
  enabled = false;
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
    console.warn('[WS-BRIDGE] Failed to create WebSocket:', e.message);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[WS-BRIDGE] Connected to bridge server');
    isConnecting = false;
    reconnectDelay = RECONNECT_BASE_MS;

    // Send auth message
    ws.send(JSON.stringify({
      type: 'auth',
      token: AUTH_TOKEN
    }));

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send a ping-like status message
        sendStatus();
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleMessage(message);
    } catch (e) {
      console.error('[WS-BRIDGE] Error handling message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS-BRIDGE] Disconnected');
    isConnecting = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (e) => {
    console.warn('[WS-BRIDGE] Connection error');
    // onclose will fire after this
  };
}

function scheduleReconnect() {
  if (!enabled) return;
  console.log(`[WS-BRIDGE] Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(() => {
    if (enabled) connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

// ========== Message Handling ==========

async function handleMessage(message) {
  const msgType = message.type;
  const requestId = message.request_id;

  console.log(`[WS-BRIDGE] Received: ${msgType}${requestId ? ` (req: ${requestId})` : ''}`);

  switch (msgType) {
    case 'auth':
      // Auth response from server
      if (message.success) {
        console.log('[WS-BRIDGE] Authenticated successfully');
        sendStatus();
      } else {
        console.error('[WS-BRIDGE] Authentication failed:', message.message);
      }
      break;

    case 'task':
      await handleTask(message.goal, requestId);
      break;

    case 'query':
      await handleQuery(message.message, requestId);
      break;

    case 'cancel':
      await handleCancel(requestId);
      break;

    default:
      console.warn(`[WS-BRIDGE] Unknown message type: ${msgType}`);
  }
}

async function handleTask(goal, requestId) {
  if (!goal) {
    sendResponse(requestId, { type: 'error', message: 'No goal provided' });
    return;
  }

  console.log(`[WS-BRIDGE] Starting agent task: ${goal.slice(0, 80)}...`);

  try {
    // Import and call the agent engine's startAgent function
    const { startAgent } = await import('./agent-engine.js');

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
  console.log(`[WS-BRIDGE] Query: ${queryText?.slice(0, 80)}...`);

  try {
    // Get current page content and answer the query
    const { getActiveTabId, getTabContext } = await import('./tab-context.js');
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
    const { stopAgent } = await import('./agent-engine.js');
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
  import('./agent-engine.js').then(({ agentRunning }) => {
    import('./tab-context.js').then(({ getActiveTabId, getTabContext }) => {
      const tabId = getActiveTabId();
      const ctx = tabId ? getTabContext(tabId) : null;

      ws.send(JSON.stringify({
        type: 'status',
        agent_running: agentRunning || false,
        url: ctx?.url || '',
        title: ctx?.title || '',
      }));
    });
  }).catch(() => {});
}

// ========== Auto-start ==========
// Start the bridge connection when this module loads
console.log('[WS-BRIDGE] Module loaded, will connect to bridge server');
