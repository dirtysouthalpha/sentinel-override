// REST API Server — v15 Platform
// Provides a local REST API for controlling the extension from external tools.
// Runs on the extension's side panel port or a dedicated port.

const API_VERSION = 'v1';

/**
 * Handle REST API requests from the web dashboard or external tools.
 * Routes messages through chrome.runtime message passing.
 */
export function createApiRouter() {
  const routes = new Map();

  // Register API routes
  routes.set('GET /status', async (params) => {
    return {
      version: '10.3.1',
      status: 'running',
      uptime: Date.now(),
      endpoints: Array.from(routes.keys())
    };
  });

  routes.set('GET /runs', async (params) => {
    try {
      const stored = await chrome.storage.local.get(['run_logs_index']);
      const index = stored.run_logs_index || [];
      return { runs: index, count: index.length };
    } catch (e) {
      return { error: e.message, runs: [], count: 0 };
    }
  });

  routes.set('GET /runs/:id', async (params) => {
    try {
      const stored = await chrome.storage.local.get([`run_log_${params.id}`]);
      const log = stored[`run_log_${params.id}`];
      if (!log) return { error: 'Run not found', statusCode: 404 };
      return { id: params.id, entries: log };
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('POST /runs/start', async (params) => {
    const goal = params.goal;
    if (!goal || typeof goal !== 'string') {
      return { error: 'goal is required', statusCode: 400 };
    }

    try {
      // Get active tab
      const tabs = await new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      if (!tabs || !tabs[0]) return { error: 'No active tab', statusCode: 400 };

      // Send start message
      const response = await chrome.runtime.sendMessage({
        action: 'run_agent_loop',
        goal: goal
      });

      return { ok: true, response };
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('POST /runs/stop', async (params) => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'stop_agent_loop' });
      return { ok: true, response };
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('GET /queue', async (params) => {
    try {
      const { getQueueStatus } = await import('./run-queue.js');
      return getQueueStatus();
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('GET /patterns', async (params) => {
    try {
      const { getPlatformPatterns } = await import('./agent-learning.js');
      return getPlatformPatterns();
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('GET /playbooks', async (params) => {
    try {
      const { getPlaybooks } = await import('./agent-learning.js');
      return { playbooks: getPlaybooks() };
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('GET /webhooks', async (params) => {
    try {
      const { getWebhooks } = await import('./webhook-manager.js');
      return { webhooks: getWebhooks() };
    } catch (e) {
      return { error: e.message, statusCode: 500 };
    }
  });

  routes.set('GET /health', async (params) => {
    try {
      const { getCostTracker } = await import('./llm-client.js');
      const cost = getCostTracker();
      return { status: 'ok', costTracking: cost };
    } catch (e) {
      return { status: 'ok', costTracking: null };
    }
  });

  return routes;
}

/**
 * Process an API request.
 */
export async function handleApiRequest(method, path, body) {
  const routes = createApiRouter();

  // Normalize path
  const normalizedPath = path.replace(/^\/api\/v1\/?/, '').replace(/^\/+|\/+$/g, '');
  const routeKey = `${method.toUpperCase()} /${normalizedPath}`;

  // Try exact match first
  let handler = routes.get(routeKey);
  let params = body || {};

  // Try parameterized match
  if (!handler) {
    for (const [key, fn] of routes) {
      const keyParts = key.split(' ');
      const pattern = keyParts[1];
      const routeParts = pattern.split('/');
      const pathParts = '/' + normalizedPath;

      if (keyParts[0] !== method.toUpperCase()) continue;

      const rParts = pattern.split('/');
      const pParts = normalizedPath.split('/');

      if (rParts.length !== pParts.length) continue;

      let match = true;
      const extractedParams = {};

      for (let i = 0; i < rParts.length; i++) {
        if (rParts[i].startsWith(':')) {
          extractedParams[rParts[i].substring(1)] = pParts[i];
        } else if (rParts[i] !== pParts[i]) {
          match = false;
          break;
        }
      }

      if (match) {
        handler = fn;
        params = { ...body, ...extractedParams };
        break;
      }
    }
  }

  if (!handler) {
    return { error: 'Not found', statusCode: 404, availableRoutes: Array.from(routes.keys()) };
  }

  try {
    return await handler(params);
  } catch (e) {
    return { error: e.message, statusCode: 500 };
  }
}
