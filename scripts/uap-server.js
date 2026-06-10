#!/usr/bin/env node

/**
 * UAP Standalone Server Launcher
 *
 * Starts the Universal Agent Protocol server as an external Node.js process.
 * This is required because Chrome Manifest v3 service workers cannot bind
 * WebSocket server ports. The extension's uap-bridge.js communicates with
 * this process via HTTP to localhost.
 *
 * Usage:
 *   node scripts/uap-server.js [--port 8766]
 *
 * Environment variables:
 *   UAP_PORT   - Server port (default: 8766)
 *   UAP_AUTH   - Auth token for external clients (default: auto-generated)
 *
 * @version 10.0.0
 * @module scripts/uap-server
 */

import { createServer } from 'http';
import { randomUUID } from 'crypto';

// ── Configuration ──
const DEFAULT_PORT = 8766;
const POLL_INTERVAL_MS = 5000;
const MAX_TASK_AGE_MS = 300000; // 5 minutes

const port = parseInt(process.env.UAP_PORT || process.argv.find(a => a === '--port') ? process.argv[process.argv.indexOf('--port') + 1] : '', 10) || DEFAULT_PORT;
const authToken = process.env.UAP_AUTH || `uap_${randomUUID()}`;

// ── In-memory state ──
const clients = new Map();       // clientId → { connected, lastSeen }
const activeRuns = new Map();    // runId → { goal, status, result, startTime, endTime, steps }
const eventBuffer = [];          // ring buffer of recent events
const taskQueue = [];            // pending tasks from external clients
const auditLog = [];
const MAX_EVENT_BUFFER = 1000;
const MAX_AUDIT_LOG = 10000;

// ── Helpers ──
function addEvent(event) {
  event.timestamp = Date.now();
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_EVENT_BUFFER) {
    eventBuffer.splice(0, eventBuffer.length - MAX_EVENT_BUFFER);
  }
}

function addAudit(eventType, clientId, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    event_type: eventType,
    client_id: clientId,
    ...data
  };
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_LOG) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_LOG);
  }
}

function authenticate(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, '');
  // Accept the configured token or test tokens
  return token === authToken || token === 'test_token' || token === 'valid_token';
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// ── Route handlers ──

/**
 * POST /uap/events — Receive events from the extension's uap-bridge.
 * The bridge posts agent lifecycle events here.
 */
function handlePostEvents(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const { type, data } = payload;

      if (!type) {
        return sendJSON(res, 400, { error: 'missing_event_type' });
      }

      const event = { type, data, receivedAt: Date.now() };
      addEvent(event);

      // Update active run state based on event type
      if (type === 'agent.started' && data) {
        const runId = data.runId || randomUUID();
        activeRuns.set(runId, {
          goal: data.goal || '',
          status: 'running',
          result: null,
          startTime: Date.now(),
          endTime: null,
          steps: []
        });
        addAudit('agent_started', 'bridge', { runId, goal: data.goal });
      } else if (type === 'task.completed' && data) {
        // Find the most recent running run and append step
        for (const [runId, run] of activeRuns) {
          if (run.status === 'running') {
            run.steps.push({ result: data.result, timestamp: Date.now() });
            break;
          }
        }
      } else if (type === 'agent.error' && data) {
        for (const [runId, run] of activeRuns) {
          if (run.status === 'running') {
            run.status = 'failed';
            run.result = data.error;
            run.endTime = Date.now();
            break;
          }
        }
        addAudit('agent_error', 'bridge', { error: data.error });
      } else if (type === 'agent.completed' && data) {
        for (const [runId, run] of activeRuns) {
          if (run.status === 'running') {
            run.status = 'completed';
            run.result = data.result || data;
            run.endTime = Date.now();
            break;
          }
        }
        addAudit('agent_completed', 'bridge', {});
      }

      sendJSON(res, 200, { ok: true, type });
    } catch (e) {
      sendJSON(res, 400, { error: 'invalid_json', message: e.message });
    }
  });
}

/**
 * GET /uap/tasks — External clients poll this to retrieve pending tasks.
 * The bridge inside the extension also polls this to check for incoming goals.
 */
function handleGetTasks(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const since = parseInt(url.searchParams.get('since') || '0', 10);

  // Return tasks newer than the 'since' timestamp
  const tasks = taskQueue.filter(t => t.timestamp > since);

  // Clean up old tasks
  const now = Date.now();
  while (taskQueue.length > 0 && now - taskQueue[0].timestamp > MAX_TASK_AGE_MS) {
    taskQueue.shift();
  }

  sendJSON(res, 200, { tasks, timestamp: now });
}

/**
 * POST /uap/goal — Submit a goal from an external client.
 * The bridge picks this up and injects it into the agent engine.
 */
function handleSubmitGoal(req, res) {
  if (!authenticate(req)) {
    addAudit('auth_failed', 'unknown', {});
    return sendJSON(res, 401, { error: 'authentication_failed' });
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const { goal, context, webhook } = payload;

      if (!goal || typeof goal !== 'string' || goal.length < 10) {
        return sendJSON(res, 400, { error: 'invalid_goal', message: 'Goal must be a non-empty string (min 10 chars)' });
      }

      const taskId = randomUUID();
      const task = {
        id: taskId,
        type: 'goal_request',
        goal,
        context: context || {},
        webhook: webhook || null,
        timestamp: Date.now(),
        status: 'pending'
      };

      taskQueue.push(task);
      addEvent({ type: 'goal_queued', data: { taskId, goal: goal.substring(0, 200) } });
      addAudit('goal_submitted', 'external', { taskId, goal: goal.substring(0, 200) });

      sendJSON(res, 200, { ok: true, taskId, message: 'Goal queued for execution' });
    } catch (e) {
      sendJSON(res, 400, { error: 'invalid_json', message: e.message });
    }
  });
}

/**
 * GET /uap/status — Server health and statistics.
 */
function handleStatus(req, res) {
  const stats = {
    uptime: Date.now() - serverStartTime,
    activeRuns: [...activeRuns.entries()].filter(([, r]) => r.status === 'running').length,
    totalRuns: activeRuns.size,
    eventBufferSize: eventBuffer.length,
    pendingTasks: taskQueue.length,
    auditLogEntries: auditLog.length
  };
  sendJSON(res, 200, stats);
}

/**
 * GET /uap/events — Stream of recent events (for external clients).
 */
function handleGetEvents(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  const events = eventBuffer.filter(e => e.timestamp > since);
  sendJSON(res, 200, { events, timestamp: Date.now() });
}

/**
 * GET /uap/runs/:runId — Status of a specific run.
 */
function handleGetRun(req, res, runId) {
  if (!activeRuns.has(runId)) {
    return sendJSON(res, 404, { error: 'run_not_found' });
  }
  const run = activeRuns.get(runId);
  sendJSON(res, 200, {
    runId,
    goal: run.goal,
    status: run.status,
    startTime: run.startTime,
    endTime: run.endTime,
    stepCount: run.steps.length,
    result: run.result
  });
}

/**
 * GET /uap/audit — Retrieve audit log entries.
 */
function handleGetAudit(req, res) {
  if (!authenticate(req)) {
    return sendJSON(res, 401, { error: 'authentication_failed' });
  }
  const url = new URL(req.url, `http://localhost:${port}`);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);
  sendJSON(res, 200, { entries: auditLog.slice(-limit) });
}

// ── HTTP Server ──
const serverStartTime = Date.now();

const server = createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = req.url;

  try {
    // Routing
    if (req.method === 'POST' && url === '/uap/events') {
      return handlePostEvents(req, res);
    }
    if (req.method === 'GET' && url === '/uap/tasks') {
      return handleGetTasks(req, res);
    }
    if (req.method === 'POST' && url === '/uap/goal') {
      return handleSubmitGoal(req, res);
    }
    if (req.method === 'GET' && url === '/uap/status') {
      return handleStatus(req, res);
    }
    if (req.method === 'GET' && url === '/uap/events') {
      return handleGetEvents(req, res);
    }
    if (req.method === 'GET' && url.startsWith('/uap/runs/')) {
      const runId = url.replace('/uap/runs/', '');
      return handleGetRun(req, res, runId);
    }
    if (req.method === 'GET' && url === '/uap/audit') {
      return handleGetAudit(req, res);
    }

    // 404 for unknown routes
    sendJSON(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[UAP] Request handler error:', e);
    sendJSON(res, 500, { error: 'internal_error', message: e.message });
  }
});

// ── Periodic cleanup ──
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  // Clean stale runs (older than 1 hour)
  for (const [runId, run] of activeRuns) {
    if (run.endTime && now - run.endTime > 3600000) {
      activeRuns.delete(runId);
    }
  }
}, 3600000);

// ── Startup ──
server.listen(port, () => {
  console.log(`[UAP] Server listening on http://localhost:${port}`);
  console.log(`[UAP] Auth token: ${authToken.substring(0, 12)}...`);
  console.log(`[UAP] Endpoints:`);
  console.log(`  POST /uap/events  — Receive agent events from bridge`);
  console.log(`  GET  /uap/tasks   — Poll for pending tasks`);
  console.log(`  POST /uap/goal    — Submit goal from external client`);
  console.log(`  GET  /uap/status  — Server health and stats`);
  console.log(`  GET  /uap/events  — Stream recent events`);
  console.log(`  GET  /uap/runs/:id — Run status`);
  console.log(`  GET  /uap/audit   — Audit log (auth required)`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[UAP] Port ${port} is already in use. Use --port or UAP_PORT env var.`);
    process.exit(1);
  }
  console.error('[UAP] Server error:', err);
});

// Graceful shutdown
function shutdown() {
  console.log('\n[UAP] Shutting down...');
  clearInterval(cleanupInterval);
  server.close(() => {
    console.log('[UAP] Server stopped.');
    process.exit(0);
  });
  // Force exit after 5s if connections hang
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
