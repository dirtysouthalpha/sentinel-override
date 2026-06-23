// popup-modules/federation-ui.js
// Federation UI: list peers, show jobs, distribute goals, toggle federation.
// Communicates with background via chrome.runtime.sendMessage (federation_* actions).

// ========== Constants ==========
const FED_REFRESH_INTERVAL_MS = 3000; // 3 seconds

// ========== Module-level State ==========
let fedRefreshIntervalId = null;
let fedPanelVisible = false;

// ========== Helper Functions ==========
function _hasLastError() {
  return typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && chrome.runtime.lastError;
}

function _getLastErrorMessage() {
  if (!_hasLastError()) return '';
  const err = chrome.runtime.lastError;
  if (typeof err === 'object' && err !== null && typeof err.message === 'string') return err.message;
  return String(err || '');
}

function getErrorMessage(e) {
  if (typeof e === 'object' && e !== null && typeof e.message === 'string') return e.message;
  return String(e || '');
}

// ========== Core Functions ==========

/**
 * Show the federation panel (called when user navigates to federation view).
 */
function showFederationPanel() {
  const panel = document.getElementById('federation-panel');
  if (!panel) return;

  panel.style.display = 'flex';
  fedPanelVisible = true;

  // Start auto-refresh
  if (!fedRefreshIntervalId) {
    refreshFederationStatus();
    fedRefreshIntervalId = setInterval(refreshFederationStatus, FED_REFRESH_INTERVAL_MS);
  }
}

/**
 * Hide the federation panel and stop auto-refresh.
 */
function hideFederationPanel() {
  const panel = document.getElementById('federation-panel');
  if (panel) panel.style.display = 'none';

  fedPanelVisible = false;
  if (fedRefreshIntervalId) {
    clearInterval(fedRefreshIntervalId);
    fedRefreshIntervalId = null;
  }
}

/**
 * Fetch and render federation status from background.
 */
function refreshFederationStatus() {
  if (!fedPanelVisible) return;

  chrome.runtime.sendMessage({ action: 'federation_status' }, (response) => {
    if (_hasLastError()) {
      console.warn('[Federation-UI] Status refresh failed:', _getLastErrorMessage());
      return;
    }
    if (!response) return;

    updateFederationToggle(response.enabled);
    renderPeerList(response.peers || []);
    renderJobList(response.jobs || []);
  });
}

/**
 * Render the list of peers with trust scores and status.
 * @param {Array} peers - Array of peer objects from federation_status.
 */
function renderPeerList(peers) {
  const container = document.getElementById('fed-peer-list');
  if (!container) return;

  container.innerHTML = '';

  if (peers.length === 0) {
    container.innerHTML = '<div class="fed-peer-item fed-empty">No peers registered. Enable federation to start.</div>';
    return;
  }

  for (const peer of peers) {
    const item = document.createElement('div');
    item.className = 'fed-peer-item';

    const name = document.createElement('span');
    name.className = 'fed-peer-name';
    name.textContent = peer.name || peer.id || 'Unknown Peer';

    const trust = document.createElement('span');
    trust.className = 'fed-peer-trust';
    trust.textContent = 'Trust: ' + (peer.trust !== undefined ? peer.trust : 'N/A');

    const state = document.createElement('span');
    const stateClass = peer.status || 'idle';
    state.className = 'fed-peer-state ' + stateClass;
    state.textContent = stateClass;

    item.appendChild(name);
    item.appendChild(trust);
    item.appendChild(state);
    container.appendChild(item);
  }
}

/**
 * Render the list of active jobs with sub-goal progress.
 * @param {Array} jobs - Array of job objects from federation_status.
 */
function renderJobList(jobs) {
  const container = document.getElementById('fed-job-list');
  if (!container) return;

  container.innerHTML = '';

  if (jobs.length === 0) {
    container.innerHTML = '<div class="fed-job-item fed-empty">No active jobs.</div>';
    return;
  }

  for (const job of jobs) {
    const item = document.createElement('div');
    item.className = 'fed-job-item';

    const goal = document.createElement('div');
    goal.className = 'fed-job-goal';
    goal.textContent = job.goal || 'Unknown goal';

    const status = document.createElement('div');
    status.className = 'fed-job-status';
    status.textContent = 'Status: ' + (job.status || 'unknown') +
      (job.subGoalCount !== undefined ? ' | Sub-goals: ' + job.subGoalCount : '');

    item.appendChild(goal);
    item.appendChild(status);
    container.appendChild(item);
  }
}

/**
 * Handle the "Distribute" button click.
 * Sends the goal in the input field to the federation for distribution.
 */
function handleDistributeGoal() {
  const input = document.getElementById('fed-goal-input');
  if (!input || !input.value.trim()) {
    console.warn('[Federation-UI] No goal entered');
    return;
  }

  const goal = input.value.trim();
  const btn = document.getElementById('fed-distribute-btn');
  if (btn) btn.disabled = true;

  chrome.runtime.sendMessage({ action: 'federation_distribute', goal, context: {} }, (response) => {
    if (btn) btn.disabled = false;

    if (_hasLastError()) {
      console.error('[Federation-UI] Distribute failed:', _getLastErrorMessage());
      return;
    }

    if (response && response.jobId) {
      input.value = '';
      refreshFederationStatus();
    }
  });
}

/**
 * Handle the enable/disable toggle button.
 */
function handleFederationToggle() {
  const btn = document.getElementById('fed-toggle-btn');
  const isEnabled = btn && btn.classList.contains('active');
  const action = isEnabled ? 'federation_disable' : 'federation_enable';

  if (btn) btn.disabled = true;

  chrome.runtime.sendMessage({ action }, (response) => {
    if (btn) btn.disabled = false;

    if (_hasLastError()) {
      console.error('[Federation-UI] Toggle failed:', _getLastErrorMessage());
      return;
    }

    if (response) {
      updateFederationToggle(response.enabled);
      refreshFederationStatus();
    }
  });
}

/**
 * Update the toggle button visual state.
 * @param {boolean} enabled
 */
function updateFederationToggle(enabled) {
  const btn = document.getElementById('fed-toggle-btn');
  if (!btn) return;

  if (enabled) {
    btn.textContent = 'Disable';
    btn.classList.add('active');
  } else {
    btn.textContent = 'Enable';
    btn.classList.remove('active');
  }
}

/**
 * Initialize federation UI event listeners.
 * Called on DOMContentLoaded.
 */
function initFederationUI() {
  const toggleBtn = document.getElementById('fed-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', handleFederationToggle);
  }

  const distributeBtn = document.getElementById('fed-distribute-btn');
  if (distributeBtn) {
    distributeBtn.addEventListener('click', handleDistributeGoal);
  }

  const goalInput = document.getElementById('fed-goal-input');
  if (goalInput) {
    goalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleDistributeGoal();
      }
    });
  }

  // Check if federation panel should be visible (based on settings)
  const settingsToggle = document.getElementById('fed-show-panel');
  if (settingsToggle && settingsToggle.checked) {
    showFederationPanel();
  }
}

// ========== Boot ==========
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFederationUI);
} else {
  initFederationUI();
}

// Expose for popup-full.js integration
window.FederationUI = {
  show: showFederationPanel,
  hide: hideFederationPanel,
  refresh: refreshFederationStatus,
  renderPeers: renderPeerList,
  renderJobs: renderJobList,
};
