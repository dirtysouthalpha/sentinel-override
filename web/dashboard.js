// Sentinel Override Dashboard — v15
// Connects to the extension's REST API via chrome.runtime.sendMessage

const _EXTENSION_ID = 'fignfifoniblkonapihmkfakmlgkbkcf'; // Will be dynamic in production

// API helper — sends requests through chrome.runtime.sendMessage
async function api(method, path, body) {
  try {
    // In production, this would be a fetch to localhost:PORT
    // For now, use chrome.runtime.sendMessage
    const msg = {
      type: 'api_request',
      method,
      path,
      body
    };

    // Try chrome.runtime first (if loaded as extension page)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, (response) => {
          resolve(response || { error: 'No response' });
        });
      });
    }

    // Fallback: fetch from local API server
    const res = await fetch(`http://localhost:9876/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
  } catch (e) {
    return { error: e.message };
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

// Goal submission
goalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const goal = goalInput.value.trim();
  if (!goal) return;

  goalInput.disabled = true;
  const result = await api('POST', '/runs/start', { goal });
  goalInput.disabled = false;

  if (result.error) {
    alert('Failed to start: ' + result.error);
  } else {
    goalInput.value = '';
    refresh();
  }
});

// Refresh dashboard data
async function refresh() {
  try {
    // Status
    const status = await api('GET', '/status');
    if (status.error) {
      connectionStatus.textContent = 'Disconnected';
      return;
    }
    connectionStatus.textContent = 'Connected';

    // Queue status
    const queue = await api('GET', '/queue');
    statActive.textContent = queue.activeCount || 0;

    // Runs
    const runs = await api('GET', '/runs');
    statRuns.textContent = runs.count || 0;

    // Render runs table
    if (runs.runs && runs.runs.length > 0) {
      runsTable.innerHTML = runs.runs.slice(-10).reverse().map(r => {
        const statusBadge = r.completed ? '<span class="badge green">Done</span>' : '<span class="badge orange">Running</span>';
        const ago = r.startedAt ? timeAgo(r.startedAt) : '—';
        const duration = r.duration ? Math.round(r.duration / 1000) + 's' : '—';
        return `<tr><td>${(r.goal || '').substring(0, 60)}</td><td>${statusBadge}</td><td>${r.stepCount || 0}</td><td>${duration}</td><td>${ago}</td></tr>`;
      }).join('');
    } else {
      runsTable.innerHTML = '<tr><td colspan="5" class="empty">No runs yet</td></tr>';
    }

    // Health
    const health = await api('GET', '/health');
    if (health.status === 'ok') {
      statHealth.textContent = health.costTracking ? '$' + health.costTracking.estimatedCost : 'OK';
      statHealthSub.textContent = health.costTracking ? health.costTracking.totalCalls + ' calls' : '';
    }

    // Playbooks
    const playbooks = await api('GET', '/playbooks');
    if (playbooks.playbooks && playbooks.playbooks.length > 0) {
      playbooksTable.innerHTML = playbooks.playbooks.map(p => {
        const rate = Math.round(p.successRate * 100);
        const rateBadge = rate >= 80 ? 'green' : rate >= 50 ? 'orange' : 'red';
        const ago = p.lastUsed ? timeAgo(p.lastUsed) : '—';
        return `<tr><td>${p.platform || '—'}</td><td>${(p.goalKey || '').substring(0, 40)}</td><td>${p.runCount}</td><td><span class="badge ${rateBadge}">${rate}%</span></td><td>${ago}</td></tr>`;
      }).join('');
    } else {
      playbooksTable.innerHTML = '<tr><td colspan="5" class="empty">No playbooks learned yet</td></tr>';
    }
  } catch (_e) {
    connectionStatus.textContent = 'Error';
  }
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
  return Math.round(diff / 86400000) + 'd ago';
}

// Auto-refresh every 5 seconds
refresh();
setInterval(refresh, 5000);
