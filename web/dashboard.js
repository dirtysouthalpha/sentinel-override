// Sentinel Override Dashboard — v9 data layer
// Connects to the extension's REST API via chrome.runtime.sendMessage,
// falling back to the local REST server.

// Escaping helpers come from lib/dash-escape.js, loaded by dashboard.html as a
// classic script before this file. Fail loudly rather than silently rendering
// unescaped attacker-influenced strings if that script is missing.
const { escHtml } = globalThis.DashEscape || {};
if (typeof escHtml !== 'function') {
  throw new Error('dashboard.js requires lib/dash-escape.js to be loaded first');
}

// Configurable rather than hardcoded. Resolution order:
//   1. window.SENTINEL_EXTENSION_ID (set by an inline <script> or a deploy step)
//   2. chrome.runtime.id, when this page is served from the extension itself
//   3. the historical development ID, as a last resort
const DEFAULT_EXTENSION_ID = 'fignfifoniblkonapihmkfakmlgkbkcf';
const EXTENSION_ID =
  globalThis.SENTINEL_EXTENSION_ID ||
  (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ||
  DEFAULT_EXTENSION_ID;

const API_BASE = globalThis.SENTINEL_API_BASE || 'http://localhost:9876/api/v1';
const REQUEST_TIMEOUT_MS = 6000;
const REFRESH_INTERVAL_MS = 5000;

// API helper — sends requests through chrome.runtime.sendMessage
async function api(method, path, body) {
  try {
    const msg = { type: 'api_request', method, path, body };

    // Try chrome.runtime first (if loaded as extension page)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve) => {
        const done = (response) => resolve(response || { error: 'No response' });
        if (chrome.runtime.id) {
          // Served from the extension itself — implicit target.
          chrome.runtime.sendMessage(msg, done);
        } else {
          // An externally_connectable page must name the extension explicitly.
          chrome.runtime.sendMessage(EXTENSION_ID, msg, done);
        }
      });
    }

    // Fallback: fetch from local API server.
    // AbortSignal.timeout keeps a hung API from stalling the refresh loop
    // forever, which used to let refresh cycles overlap and pile up.
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Fleet convention: an unhealthy-but-reachable service answers 503 with a
    // JSON body. Surface that as "degraded" rather than a generic failure.
    if (res.status === 503) {
      let detail = 'service unhealthy';
      try {
        const payload = await res.json();
        detail = payload.detail || payload.status || detail;
      } catch { /* non-JSON 503 body */ }
      return { error: detail, degraded: true };
    }

    // Without this check a 4xx/5xx HTML error page reached res.json() and threw
    // an opaque "Unexpected token <" instead of the real status.
    if (!res.ok) {
      return { error: `HTTP ${res.status} ${res.statusText || ''}`.trim() };
    }

    try {
      return await res.json();
    } catch {
      return { error: 'malformed JSON response' };
    }
  } catch (e) {
    if (e && e.name === 'TimeoutError') {
      return { error: `timed out after ${REQUEST_TIMEOUT_MS}ms`, offline: true };
    }
    return { error: e.message, offline: true };
  }
}

// DOM elements
const goalInput = document.getElementById('goal-input');
const goalForm = document.getElementById('goal-form');
const statRuns = document.getElementById('stat-runs');
const statActive = document.getElementById('stat-active');
const statHealth = document.getElementById('stat-health');
const statHealthSub = document.getElementById('stat-health-sub');
const _statCost = document.getElementById('stat-cost');
const runsTable = document.getElementById('runs-table');
const playbooksTable = document.getElementById('playbooks-table');
const connectionStatus = document.getElementById('connection-status');
const statusDot = document.querySelector('.status-dot');
const goalStatus = document.getElementById('goal-status');

// Inline status instead of a modal alert() that blocks the refresh loop.
function setStatus(text, tone) {
  if (!goalStatus) return;
  goalStatus.textContent = text || '';
  goalStatus.className = tone ? `goal-status ${tone}` : 'goal-status';
}

function setConnection(state, detail) {
  const labels = { ok: 'Connected', degraded: 'Degraded', offline: 'Disconnected', error: 'Error' };
  const colors = { ok: 'green', degraded: 'orange', offline: 'red', error: 'red' };
  if (connectionStatus) {
    connectionStatus.textContent = labels[state] || state;
    connectionStatus.title = detail || '';
  }
  if (statusDot) {
    statusDot.className = `status-dot ${colors[state] || 'red'}`;
  }
}

// Classify an api() result into a connection state.
function stateOf(result) {
  if (!result || !result.error) return 'ok';
  if (result.degraded) return 'degraded';
  if (result.offline) return 'offline';
  return 'error';
}

// Goal submission
goalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const goal = goalInput.value.trim();
  if (!goal) return;

  goalInput.disabled = true;
  setStatus('Starting…', '');
  try {
    const result = await api('POST', '/runs/start', { goal });
    if (result.error) {
      setStatus(`Failed to start: ${result.error}`, 'error');
    } else {
      goalInput.value = '';
      setStatus('Run started.', 'ok');
      refresh();
    }
  } finally {
    goalInput.disabled = false;
  }
});

// ── Refresh loop ──────────────────────────────────────────────────────────
// `refreshing` guards against overlapping cycles: refresh() awaits six
// sequential requests, so a slow API used to let the 5s interval start a new
// cycle before the previous one finished, stacking requests indefinitely.
let refreshing = false;
let refreshTimer = null;

function startRefreshTimer() {
  if (refreshTimer === null) {
    refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS);
  }
}

function stopRefreshTimer() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function tick() {
  // Don't burn requests while the tab is in the background.
  if (typeof document.hidden === 'boolean' && document.hidden) return;
  refresh();
}

// Pause polling entirely when the page is hidden, resume (and refresh at once)
// when it comes back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopRefreshTimer();
  } else {
    startRefreshTimer();
    refresh();
  }
});

// Refresh dashboard data
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    // Status
    const status = await api('GET', '/status');
    if (status.error) {
      setConnection(stateOf(status), status.error);
      return;
    }
    setConnection('ok');

    // Queue status
    const queue = await api('GET', '/queue');
    if (!queue.error) statActive.textContent = queue.activeCount || 0;

    // Runs
    const runs = await api('GET', '/runs');
    if (!runs.error) {
      statRuns.textContent = runs.count || 0;
      renderRuns(runs.runs);
    }

    // Health
    const health = await api('GET', '/health');
    if (health.status === 'ok') {
      statHealth.textContent = health.costTracking ? '$' + health.costTracking.estimatedCost : 'OK';
      statHealthSub.textContent = health.costTracking ? health.costTracking.totalCalls + ' calls' : '';
    } else if (health.error) {
      statHealth.textContent = '—';
      statHealthSub.textContent = health.degraded ? 'degraded' : 'unreachable';
    }

    // Playbooks
    const playbooks = await api('GET', '/playbooks');
    if (!playbooks.error) renderPlaybooks(playbooks.playbooks);
  } catch (e) {
    // Should not happen (api() swallows its own errors) but never let the
    // interval die silently on an unexpected throw.
    setConnection('error', e && e.message);
  } finally {
    refreshing = false;
  }
}

// `goal` is agent-run input and was previously interpolated raw into
// innerHTML — a goal of `<img src=x onerror=...>` executed on render.
function renderRuns(runs) {
  if (!runs || runs.length === 0) {
    runsTable.innerHTML = '<tr><td colspan="5" class="empty">No runs yet</td></tr>';
    return;
  }
  runsTable.innerHTML = runs.slice(-10).reverse().map((r) => {
    const statusBadge = r.completed
      ? '<span class="badge green">Done</span>'
      : '<span class="badge orange">Running</span>';
    const ago = r.startedAt ? timeAgo(r.startedAt) : '—';
    const duration = r.duration ? Math.round(r.duration / 1000) + 's' : '—';
    const goalCell = escHtml(String(r.goal || '').substring(0, 60));
    const steps = escHtml(r.stepCount || 0);
    return `<tr><td>${goalCell}</td><td>${statusBadge}</td><td>${steps}</td><td>${escHtml(duration)}</td><td>${escHtml(ago)}</td></tr>`;
  }).join('');
}

// `platform` and `goalKey` are learned from browsed third-party pages, so they
// are attacker-influenced and must be escaped.
function renderPlaybooks(playbooks) {
  if (!playbooks || playbooks.length === 0) {
    playbooksTable.innerHTML = '<tr><td colspan="5" class="empty">No playbooks learned yet</td></tr>';
    return;
  }
  playbooksTable.innerHTML = playbooks.map((p) => {
    const rate = Math.round((Number(p.successRate) || 0) * 100);
    const rateBadge = rate >= 80 ? 'green' : rate >= 50 ? 'orange' : 'red';
    const ago = p.lastUsed ? timeAgo(p.lastUsed) : '—';
    const platform = escHtml(p.platform || '—');
    const goalKey = escHtml(String(p.goalKey || '').substring(0, 40));
    const runCount = escHtml(p.runCount || 0);
    return `<tr><td>${platform}</td><td>${goalKey}</td><td>${runCount}</td><td><span class="badge ${rateBadge}">${rate}%</span></td><td>${escHtml(ago)}</td></tr>`;
  }).join('');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
  return Math.round(diff / 86400000) + 'd ago';
}

// Auto-refresh
refresh();
startRefreshTimer();
