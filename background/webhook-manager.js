// Webhook Manager — v14 Enterprise
// Sends run results to external services (Teams, Slack, PagerDuty, custom)

const WEBHOOKS_KEY = 'sentinel_webhooks';
const WEBHOOK_LOG_KEY = 'sentinel_webhook_log';

let _webhooks = [];
let _log = [];
const MAX_LOG = 100;

/**
 * Initialize webhook manager — load from storage.
 */
export async function initWebhooks() {
  try {
    const stored = await chrome.storage.local.get([WEBHOOKS_KEY, WEBHOOK_LOG_KEY]);
    _webhooks = stored[WEBHOOKS_KEY] || [];
    _log = stored[WEBHOOK_LOG_KEY] || [];
  } catch (e) {
    console.warn('[Sentinel/Webhook] Init failed:', e.message);
  }
}

/**
 * Add a webhook endpoint.
 * @param {{ name: string, url: string, events: string[], headers?: object }} config
 */
export function addWebhook(config) {
  const webhook = {
    id: 'wh_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
    name: config.name || 'Unnamed',
    url: config.url,
    events: config.events || ['run_complete'],
    headers: config.headers || {},
    enabled: true,
    createdAt: Date.now(),
    lastTriggered: null,
    failureCount: 0
  };
  _webhooks.push(webhook);
  _persist();
  return webhook;
}

/**
 * Remove a webhook by ID.
 */
export function removeWebhook(id) {
  const idx = _webhooks.findIndex(w => w.id === id);
  if (idx === -1) return false;
  _webhooks.splice(idx, 1);
  _persist();
  return true;
}

/**
 * Toggle webhook enabled/disabled.
 */
export function toggleWebhook(id, enabled) {
  const wh = _webhooks.find(w => w.id === id);
  if (!wh) return false;
  wh.enabled = enabled;
  _persist();
  return true;
}

/**
 * Trigger webhooks for a specific event.
 * @param {string} event - Event type (run_complete, run_failed, scheduled_complete)
 * @param {object} payload - Event data
 */
export async function triggerWebhooks(event, payload) {
  const matching = _webhooks.filter(w => w.enabled && w.events.includes(event));
  if (matching.length === 0) return;

  const results = await Promise.allSettled(
    matching.map(async (wh) => {
      const body = {
        event,
        timestamp: new Date().toISOString(),
        source: 'sentinel-override',
        version: '10.3.1',
        data: payload
      };

      try {
        const response = await fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'SentinelOverride/1.0',
            ...wh.headers
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        });

        wh.lastTriggered = Date.now();
        wh.failureCount = 0;

        const logEntry = {
          webhookId: wh.id,
          webhookName: wh.name,
          event,
          status: response.ok ? 'success' : 'error',
          statusCode: response.status,
          timestamp: Date.now()
        };
        _log.push(logEntry);

        return logEntry;
      } catch (e) {
        wh.failureCount++;
        const logEntry = {
          webhookId: wh.id,
          webhookName: wh.name,
          event,
          status: 'error',
          error: e.message,
          timestamp: Date.now()
        };
        _log.push(logEntry);
        return logEntry;
      }
    })
  );

  // Trim log
  if (_log.length > MAX_LOG) {
    _log = _log.slice(-MAX_LOG);
  }

  _persist();
  return results;
}

/**
 * Get all configured webhooks.
 */
export function getWebhooks() {
  return [..._webhooks];
}

/**
 * Get webhook delivery log.
 */
export function getWebhookLog() {
  return [..._log];
}

/**
 * Test a webhook by sending a test payload.
 */
export async function testWebhook(id) {
  const wh = _webhooks.find(w => w.id === id);
  if (!wh) throw new Error('Webhook not found');

  return triggerWebhooks('test', {
    message: 'Test webhook from Sentinel Override',
    webhookId: wh.id,
    webhookName: wh.name
  });
}

async function _persist() {
  try {
    await chrome.storage.local.set({
      [WEBHOOKS_KEY]: _webhooks,
      [WEBHOOK_LOG_KEY]: _log
    });
  } catch (e) {
    console.warn('[Sentinel/Webhook] Persist failed:', e.message);
  }
}
