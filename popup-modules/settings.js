// popup-modules/settings.js
// Settings UI: theme management, provider switching, settings modal, test connection, presets.
// Verified 2026-05-06.
// Depends on: ui-common.js (showToast, isValidUrl, sanitizeHtml).

// ========== DOM Elements ==========
const settingsBtn = document.getElementById('settingsBtn');
const themeToggle = document.getElementById('themeToggle');
const settingsModal = document.getElementById('settings-modal');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const setProviderEndpoint = document.getElementById('set-provider-endpoint');
const setProviderKey = document.getElementById('set-provider-key');
const setProviderModel = document.getElementById('set-provider-model');
const exportFormatSelect = document.getElementById('export-format');
const themeModal = document.getElementById('theme-modal');
const closeThemeBtn = document.getElementById('closeThemeBtn');
const saveThemeBtn = document.getElementById('saveThemeBtn');

// ========== Theme Management ==========
// eslint-disable-next-line no-unused-vars
function loadThemePreference() {
  // Restore named theme (tron, matrix, etc.)
  const savedNamedTheme = localStorage.getItem('theme-named');
  if (savedNamedTheme && savedNamedTheme !== 'light') {
    applyThemePreset(savedNamedTheme);
    // Update active preset button
    document.querySelectorAll('[data-theme]').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === savedNamedTheme);
    });
    return;
  }
  const savedTheme = localStorage.getItem('theme-preference');
  if (savedTheme) {
    document.body.classList.toggle('dark-mode', savedTheme === 'dark');
    updateThemeToggle();
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark-mode', prefersDark);
    updateThemeToggle();
  }
}

function updateThemeToggle() {
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('theme-preference', isDark ? 'dark' : 'light');
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  updateThemeToggle();
}

// ========== Provider Card Switching ==========
function switchProviderCard(providerId) {
  const state = getState();
  state.activeProviderId = providerId;

  // Update active provider button styling
  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.classList.toggle('active-provider', btn.dataset.provider === providerId);
  });

  // Populate fields from provider config
  const config = state.providerConfigs[providerId] || {};
  setProviderEndpoint.value = config.endpoint || '';
  setProviderKey.value = config.api_key || '';
  setProviderModel.value = config.model || '';

  // Auto-fill defaults if fields are empty
  const defaults = providerId === 'anthropic'
    ? { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-5-20251001' }
    : { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' };

  if (!setProviderEndpoint.value) setProviderEndpoint.placeholder = defaults.endpoint;
  if (!setProviderModel.value) setProviderModel.placeholder = defaults.model;
}

// Wire up provider selector buttons
document.querySelectorAll('.provider-btn').forEach(btn => {
  btn.addEventListener('click', () => switchProviderCard(btn.dataset.provider));
});

// ========== Settings Management ==========
// eslint-disable-next-line no-unused-vars
function loadSettings() {
  const state = getState();
  chrome.storage.local.get(['active_provider', 'providers', 'api_endpoint', 'api_key', 'model', 'export_format', 'agent_context'], (result) => {
    if (chrome.runtime.lastError) return;
    // Handle both new provider structure and legacy keys
    if (result.providers) {
      state.providerConfigs = result.providers;
      state.activeProviderId = result.active_provider || 'openai';
    } else {
      // Legacy fallback -- migrate on the fly for display
      const providerId = (result.api_endpoint || '').includes('api.anthropic.com') ? 'anthropic' : 'openai';
      state.providerConfigs = {
        anthropic: { api_key: '', model: 'claude-haiku-4-5-20251001', endpoint: 'https://api.anthropic.com/v1/messages', max_tokens: 8000, temperature: 0.3 },
        openai: { api_key: result.api_key || '', model: result.model || 'gpt-4o', endpoint: result.api_endpoint || 'https://api.openai.com/v1/chat/completions', max_tokens: 8000, temperature: 0.3 }
      };
      state.activeProviderId = providerId;
    }
    if (result.export_format && exportFormatSelect) exportFormatSelect.value = result.export_format;
    if (result.agent_context) {
      const el = document.getElementById('set-agent-context');
      if (el) el.value = result.agent_context;
    }
  });
}

// ========== Quick Assist Toggle (3.46.0) ==========
// Controls whether the floating Quick Assist panel appears on text selection.
const quickAssistToggle = document.getElementById('quickAssistToggle');
const quickAssistLabel = document.getElementById('quickAssistLabel');
if (quickAssistToggle) {
  chrome.storage.local.get(['quickAssist'], (result) => {
    if (chrome.runtime.lastError) return;
    const enabled = result.quickAssist !== false; // default ON
    quickAssistToggle.checked = enabled;
    if (quickAssistLabel) {
      quickAssistLabel.textContent = enabled
        ? 'ON — Select text on any page'
        : 'OFF — Quick Assist disabled';
    }
  });
  quickAssistToggle.addEventListener('change', () => {
    const enabled = quickAssistToggle.checked;
    chrome.storage.local.set({ quickAssist: enabled }, () => {
      if (quickAssistLabel) {
        quickAssistLabel.textContent = enabled
          ? 'ON — Select text on any page'
          : 'OFF — Quick Assist disabled';
      }
    });
  });
}

// ========== Trusted Input Toggle (#9 — CDP-based input dispatch) ==========
// Opt-in: when enabled, the agent routes click/type/press_key through
// chrome.debugger so events are dispatched with isTrusted: true. Default OFF
// because attaching the debugger surfaces the "Sentinel Override is debugging
// this browser" banner — acceptable cost only when sites need trusted events.
const useTrustedInputToggle = document.getElementById('useTrustedInputToggle');
if (useTrustedInputToggle) {
  chrome.storage.local.get(['useTrustedInput'], (result) => {
    if (chrome.runtime.lastError) return;
    useTrustedInputToggle.checked = result.useTrustedInput === true;
  });
  useTrustedInputToggle.addEventListener('change', () => {
    const enabled = useTrustedInputToggle.checked;
    chrome.storage.local.set({ useTrustedInput: enabled }, () => {
      try {
        showToast(
          enabled
            ? 'Trusted input ON — debugger banner will appear during runs'
            : 'Trusted input OFF — using synthetic events',
          enabled ? 'success' : 'info'
        );
      } catch { /* showToast may not be available */ }
    });
  });
}

// ========== Sound Notifications Toggle (3.11.3) ==========
// Off by default. When enabled, the agent posts desktop notifications
// (Windows notification chime) for events like MFA challenges, agent stop,
// scheduled-task completion, and mode changes. Chat banners and the Errors
// tab are unaffected either way. The toggle is checked by every
// chrome.notifications.create call site via notifyIfEnabled() in
// background/shared-state.js, so flipping this silences ALL six sites at once.
const soundEnabledToggle = document.getElementById('soundEnabledToggle');
if (soundEnabledToggle) {
  chrome.storage.local.get({ sentinelSoundEnabled: false }, (result) => {
    if (chrome.runtime.lastError) return;
    soundEnabledToggle.checked = result.sentinelSoundEnabled === true;
  });
  soundEnabledToggle.addEventListener('change', () => {
    const enabled = soundEnabledToggle.checked;
    chrome.storage.local.set({ sentinelSoundEnabled: enabled }, () => {
      try {
        showToast(
          enabled
            ? 'Sound notifications ON — desktop toasts enabled'
            : 'Sound notifications OFF — silent mode',
          'info'
        );
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

// ========== Adaptive Prompts (3.15.0) ==========
// Pre-execution platform-aware goal rewrite. Two settings:
//   adaptivePromptsMode: 'auto' | 'approval' | 'off' (default 'auto')
//   adaptiveExpansionMode: 'off' | 'light' | 'full' (default 'light')
const adaptivePromptsModeSelect = document.getElementById('adaptivePromptsModeSelect');
const adaptiveExpansionModeSelect = document.getElementById('adaptiveExpansionModeSelect');

if (adaptivePromptsModeSelect) {
  chrome.storage.local.get(['adaptivePromptsMode', 'adaptiveExpansionMode'], (result) => {
    if (chrome.runtime.lastError) return;
    adaptivePromptsModeSelect.value = result.adaptivePromptsMode || 'auto';
    if (adaptiveExpansionModeSelect) {
      adaptiveExpansionModeSelect.value = result.adaptiveExpansionMode || 'light';
    }
  });
  adaptivePromptsModeSelect.addEventListener('change', () => {
    const v = adaptivePromptsModeSelect.value;
    chrome.storage.local.set({ adaptivePromptsMode: v }, () => {
      try {
        const label = v === 'auto' ? 'Auto (silent rewrite)' : v === 'approval' ? 'Approval (review diff)' : 'Off';
        showToast('Adaptive Prompts: ' + label, 'info');
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

if (adaptiveExpansionModeSelect) {
  adaptiveExpansionModeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ adaptiveExpansionMode: adaptiveExpansionModeSelect.value }).catch((e) => { console.error('[Sentinel] Error in settings.js:', e); });
  });
}

// ========== Telemetry Verbosity (3.25.0) ==========
// Live Telemetry panel verbosity. Background/telemetry.js reads this on
// every emit() to decide whether to broadcast the event. Storage changes
// take effect immediately via the onChanged listener in telemetry.js.
const telemetryLevelSelect = document.getElementById('telemetryLevelSelect');
if (telemetryLevelSelect) {
  chrome.storage.local.get(['telemetryLevel'], (result) => {
    if (chrome.runtime.lastError) return;
    telemetryLevelSelect.value = result.telemetryLevel || 'normal';
  });
  telemetryLevelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ telemetryLevel: telemetryLevelSelect.value }, () => {
      try { showToast('Telemetry verbosity: ' + telemetryLevelSelect.value, 'info'); } catch { /* showToast may fail in detached popup */ }
    });
  });
}

// ========== Telemetry Persistence (3.27.0) ==========
// Opt-in checkbox. When enabled, background/telemetry.js mirrors every emit
// into chrome.storage.local keyed by runLogId, with the last 5 runs retained
// (older runs auto-evicted). Survives panel close + browser restart.
// Off by default to keep the storage footprint minimal for users who don't
// need cross-session debugging.
const telemetryPersistToggle = document.getElementById('telemetryPersistToggle');
if (telemetryPersistToggle) {
  chrome.storage.local.get(['telemetryPersist'], (result) => {
    if (chrome.runtime.lastError) return;
    telemetryPersistToggle.checked = !!result.telemetryPersist;
  });
  telemetryPersistToggle.addEventListener('change', () => {
    chrome.storage.local.set({ telemetryPersist: telemetryPersistToggle.checked }, () => {
      try {
        showToast(telemetryPersistToggle.checked
          ? 'Telemetry will now persist across sessions (last 5 runs)'
          : 'Telemetry persistence disabled', 'info');
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

// ========== Telemetry Redaction (3.28.0) ==========
// Default ON. Scrubs API keys, bearer/Basic auth, JWT tokens, OAuth query
// params, and JSON fields named password/secret/apikey/etc. before broadcast
// + persist + export. The SW console (chrome://extensions DevTools) always
// shows raw events regardless of this setting — it's a trust boundary anyway.
// Operators can disable for deep debugging when they need to see raw payloads.
const telemetryRedactToggle = document.getElementById('telemetryRedactToggle');
if (telemetryRedactToggle) {
  chrome.storage.local.get(['telemetryRedact'], (result) => {
    if (chrome.runtime.lastError) return;
    // Default ON: only set false if explicitly stored as false.
    telemetryRedactToggle.checked = (result.telemetryRedact === false) ? false : true;
  });
  telemetryRedactToggle.addEventListener('change', () => {
    chrome.storage.local.set({ telemetryRedact: telemetryRedactToggle.checked }, () => {
      try {
        showToast(telemetryRedactToggle.checked
          ? 'Telemetry redaction ON — secrets scrubbed before persist'
          : 'Telemetry redaction OFF — raw payloads will be stored', 'info');
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

// ========== Adaptive Skill Priority (3.29.0) ==========
// Default ON. Re-ranks recovery skills based on observed outcomes — a skill
// with high success rate (next step succeeded after it fired) gets a boost,
// noisy skills with low success rate get penalized. The "View skill stats"
// button opens a modal showing per-skill fire count, success rate, and the
// gap between base vs effective priority.
const telemetrySkillAdaptToggle = document.getElementById('telemetrySkillAdaptToggle');
if (telemetrySkillAdaptToggle) {
  chrome.storage.local.get(['telemetrySkillAdapt'], (result) => {
    if (chrome.runtime.lastError) return;
    telemetrySkillAdaptToggle.checked = (result.telemetrySkillAdapt === false) ? false : true;
  });
  telemetrySkillAdaptToggle.addEventListener('change', () => {
    chrome.storage.local.set({ telemetrySkillAdapt: telemetrySkillAdaptToggle.checked }, () => {
      try {
        showToast(telemetrySkillAdaptToggle.checked
          ? 'Adaptive skill priority ON — outcomes will re-rank skills'
          : 'Adaptive skill priority OFF — static priorities only', 'info');
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

const skillStatsResetBtn = document.getElementById('skillStatsResetBtn');
if (skillStatsResetBtn) {
  skillStatsResetBtn.addEventListener('click', () => {
    if (!confirm('Reset all skill outcome stats? This clears fire counts, success rates, and timing data for every recovery skill. The static priority numbers remain unchanged.')) return;
    chrome.runtime.sendMessage({ action: 'reset_skill_stats' }, (resp) => {
      if (chrome.runtime.lastError && !resp) return;
      try {
        if (resp && resp.ok) showToast('Skill stats reset', 'success');
        else showToast('Reset failed: ' + ((resp && resp.error) || 'unknown'), 'error');
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

const skillStatsViewBtn = document.getElementById('skillStatsViewBtn');
if (skillStatsViewBtn) {
  skillStatsViewBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'list_skills_with_stats' }, (skills) => {
      if (chrome.runtime.lastError) return;
      if (!Array.isArray(skills)) skills = [];
      _renderSkillStatsModal(skills);
    });
  });
}

function _renderSkillStatsModal(skills) {
  // Strip any existing modal first so re-clicks always show fresh data.
  const existing = document.getElementById('skillStatsModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'skillStatsModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1500; display:flex; align-items:center; justify-content:center; padding:24px;';

  const inner = document.createElement('div');
  inner.className = 'modal-content';
  inner.style.cssText = 'background:var(--bg-secondary, #161616); border:1px solid var(--border-color); border-radius:8px; max-width:min(720px, calc(100vw - 48px)); width:100%; max-height:calc(100vh - 48px); display:flex; flex-direction:column; overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText = 'padding:14px 18px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;';
  header.innerHTML = '<strong style="font-size:14px;">Recovery skill stats</strong><button id="skillStatsCloseBtn" style="background:transparent; border:none; color:var(--text-secondary); font-size:18px; cursor:pointer;">×</button>';
  inner.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto; padding:12px 18px; font-size:12px;';

  if (skills.length === 0) {
    body.innerHTML = '<p style="color:var(--text-tertiary);">No skills registered.</p>';
  } else {
    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:12px;';
    table.innerHTML = '<thead><tr style="text-align:left; color:var(--text-tertiary); border-bottom:1px solid var(--border-color);"><th style="padding:6px 4px;">Skill</th><th style="padding:6px 4px; text-align:right;">Fires</th><th style="padding:6px 4px; text-align:right;">Success</th><th style="padding:6px 4px; text-align:right;">Rate</th><th style="padding:6px 4px; text-align:right;">Base</th><th style="padding:6px 4px; text-align:right;">Effective</th></tr></thead>';
    const tbody = document.createElement('tbody');
    // Sort by effectivePriority descending so the most-impactful skills lead.
    skills.sort((a, b) => (b.effectivePriority || 0) - (a.effectivePriority || 0));
    for (const s of skills) {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid var(--border-color);';
      const stats = s.stats || { fires: 0, successes: 0, failures: 0 };
      const rate = stats.fires > 0 ? (stats.successes / stats.fires) : null;
      const rateStr = rate === null ? '—' : (Math.round(rate * 100) + '%');
      const rateColor = rate === null ? 'var(--text-tertiary)' :
        rate >= 0.7 ? '#9ece6a' :
        rate >= 0.4 ? '#e0af68' :
        '#f44';
      const delta = (s.effectivePriority || 0) - (s.priority || 0);
      const deltaStr = delta === 0 ? '' : (delta > 0 ? ' (+' + delta + ')' : ' (' + delta + ')');
      const deltaColor = delta > 0 ? '#9ece6a' : delta < 0 ? '#f44' : 'var(--text-tertiary)';
      tr.innerHTML =
        '<td style="padding:6px 4px;"><strong>' + escapeHtml(s.id) + '</strong><div style="font-size:10px; color:var(--text-tertiary); margin-top:1px;">' + escapeHtml(s.description || '') + '</div></td>' +
        '<td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums;">' + stats.fires + '</td>' +
        '<td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums;">' + stats.successes + ' / ' + stats.failures + '</td>' +
        '<td style="padding:6px 4px; text-align:right; color:' + rateColor + '; font-variant-numeric:tabular-nums;">' + rateStr + '</td>' +
        '<td style="padding:6px 4px; text-align:right; color:var(--text-tertiary); font-variant-numeric:tabular-nums;">' + (s.priority || 0) + '</td>' +
        '<td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums;">' + (s.effectivePriority || 0) + '<span style="color:' + deltaColor + ';">' + deltaStr + '</span></td>';
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
    const note = document.createElement('p');
    note.style.cssText = 'margin-top:14px; font-size:11px; color:var(--text-tertiary); line-height:1.5;';
    note.textContent = 'Effective priority = base ± up to 20 based on success rate. Requires ≥3 fires before adjusting (avoids judging on tiny samples). Sorted by effective priority descending — top rows fire first when multiple skills match.';
    body.appendChild(note);
  }

  inner.appendChild(body);
  modal.appendChild(inner);
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('skillStatsCloseBtn').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  const escClose = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); } };
  document.addEventListener('keydown', escClose);
}

// (3.45.0) Quick Mode — skip planning, reduce delays, action-oriented prompts
const quickModeToggle = document.getElementById('quickModeToggle');
const quickModeLabel = document.getElementById('quickModeLabel');
if (quickModeToggle) {
  chrome.storage.local.get(['quickMode'], (result) => {
    const enabled = result.quickMode === true;
    quickModeToggle.checked = enabled;
    if (quickModeLabel) {
      quickModeLabel.textContent = enabled
        ? 'ON — Fast execution, no planning'
        : 'OFF - Standard pace';
    }
  });
  quickModeToggle.addEventListener('change', () => {
    const enabled = quickModeToggle.checked;
    chrome.storage.local.set({ quickMode: enabled }, () => {
      if (quickModeLabel) {
        quickModeLabel.textContent = enabled
          ? 'ON — Fast execution, no planning'
          : 'OFF - Standard pace';
      }
      showToast(enabled ? 'Quick Mode ON — agent will move fast' : 'Quick Mode OFF — standard pace', 'success');
    });
  });
}

// ========== Ticket Mode (3.14.0) ==========
// Toggle wraps every finish summary into one of six MSP templates
// (TICKET_KICKOFF / FINAL_NOTES / WAITING_ON_CLIENT / WAITING_ON_VENDOR /
// IT_GLUE_KB / CLIENT_EMAIL). When off, only ticket-shaped goals get
// auto-formatted into FINAL_NOTES (legacy 3.8.0 behavior).
// Technician details are persisted to chrome.storage.local.technicianInfo
// and consumed by background/agent-engine.js's getTechnicianInfo().
const ticketModeToggle = document.getElementById('ticketModeToggle');
const ticketFormatRow = document.getElementById('ticketFormatRow');
const ticketFormatSelect = document.getElementById('ticketFormatSelect');
const __TECH_INPUTS = {
  name:    document.getElementById('techNameInput'),
  title:   document.getElementById('techTitleInput'),
  company: document.getElementById('techCompanyInput'),
  phone:   document.getElementById('techPhoneInput'),
  email:   document.getElementById('techEmailInput'),
};
const TECH_DEFAULTS = {
  name: '',
  title: '',
  company: '',
  phone: '',
  email: ''
};

function __setTicketFormatRowVisible(visible) {
  if (!ticketFormatRow) return;
  ticketFormatRow.style.display = visible ? 'block' : 'none';
}

if (ticketModeToggle) {
  // Load saved state and prefill technician fields.
  chrome.storage.local.get(['ticketMode', 'ticketFormat', 'technicianInfo'], (result) => {
    if (chrome.runtime.lastError) return;
    const enabled = result.ticketMode === true;
    ticketModeToggle.checked = enabled;
    __setTicketFormatRowVisible(enabled);
    if (ticketFormatSelect) {
      ticketFormatSelect.value = result.ticketFormat || 'auto';
    }
    const tech = Object.assign({}, TECH_DEFAULTS, result.technicianInfo || {});
    for (const key of Object.keys(__TECH_INPUTS)) {
      const el = __TECH_INPUTS[key];
      if (el) el.value = tech[key] || '';
    }
  });

  ticketModeToggle.addEventListener('change', () => {
    const enabled = ticketModeToggle.checked;
    __setTicketFormatRowVisible(enabled);
    chrome.storage.local.set({ ticketMode: enabled }, () => {
      try {
        showToast(
          enabled
            ? 'Ticket Mode ON — finish summaries will be formatted as ticket blocks'
            : 'Ticket Mode OFF — auto-formatting on ticket-shaped goals only',
          enabled ? 'success' : 'info'
        );
      } catch { /* showToast may fail in detached popup */ }
    });
  });
}

if (ticketFormatSelect) {
  ticketFormatSelect.addEventListener('change', () => {
    chrome.storage.local.set({ ticketFormat: ticketFormatSelect.value });
  });
}

// Debounced save for technician inputs — on every keystroke.
{
  let __techSaveTimer = null;
  const queueTechSave = () => {
    if (__techSaveTimer) clearTimeout(__techSaveTimer);
    __techSaveTimer = setTimeout(() => {
      const tech = {};
      for (const key of Object.keys(__TECH_INPUTS)) {
        const el = __TECH_INPUTS[key];
        if (el && el.value && el.value.trim()) tech[key] = el.value.trim();
      }
      chrome.storage.local.set({ technicianInfo: tech }).catch((e) => { console.error('[Sentinel] Error in settings.js:', e); });
    }, 400);
  };
  for (const key of Object.keys(__TECH_INPUTS)) {
    const el = __TECH_INPUTS[key];
    if (el) el.addEventListener('input', queueTechSave);
  }
}

// ========== Expected Tenant (3.7.0) ==========
// Cross-client safety: when set, the header chip on Microsoft admin URLs
// turns green when the detected tenant matches and red when it doesn't.
const expectedTenantInput = document.getElementById('expectedTenantInput');
if (expectedTenantInput) {
  chrome.storage.local.get(['expectedTenant'], (result) => {
    if (chrome.runtime.lastError) return;
    if (typeof result.expectedTenant === 'string') {
      expectedTenantInput.value = result.expectedTenant;
    }
  });
  // Save on every change (debounced lightly so we don't spam storage).
  let __tenantSaveTimer = null;
  expectedTenantInput.addEventListener('input', () => {
    if (__tenantSaveTimer) clearTimeout(__tenantSaveTimer);
    __tenantSaveTimer = setTimeout(() => {
      const v = (expectedTenantInput.value || '').trim();
      chrome.storage.local.set({ expectedTenant: v }).catch((e) => { console.error('[Sentinel] Error in settings.js:', e); });
    }, 350);
  });
}

// ========== Theme Toggle ==========
themeToggle.addEventListener('click', toggleTheme);

// ========== Settings Modal ==========
// ========== Learned Patterns Viewer ==========
function _renderLearnedPatterns(patterns) {
  const list = document.getElementById('learnedPatternsList');
  if (!list) return;
  if (!patterns || patterns.length === 0) {
    list.innerHTML = '<em style="color:var(--text-tertiary,#666);">No patterns saved yet.</em>';
    return;
  }
  list.innerHTML = patterns.map((p, i) => {
    const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString() : '';
    const steps = Array.isArray(p.steps) ? p.steps.length : '?';
    const safeGoal = escapeHtml(p.goal || '(no goal)');
    return `<div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border-color);">
      <span title="${safeGoal}" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">${i + 1}. ${safeGoal} <span style="color:var(--text-tertiary,#666);">(${steps} steps, ${date})</span></span>
      <button data-idx="${i}" class="delete-pattern-btn" style="font-size:10px; padding:1px 6px; border-radius:4px; border:1px solid var(--error-color,#ef4444); background:transparent; color:var(--error-color,#ef4444); cursor:pointer; flex-shrink:0;">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.delete-pattern-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const idx = parseInt(btn.dataset.idx, 10);
        if (isNaN(idx)) return;
        const s = await chrome.storage.local.get(['learned_patterns']);
        const arr = s.learned_patterns || [];
        arr.splice(idx, 1);
        await chrome.storage.local.set({ learned_patterns: arr });
        _renderLearnedPatterns(arr);
      } catch (e) { console.warn('[Sentinel] delete pattern failed:', e && e.message); }
    });
  });
}

const clearAllPatternsBtn = document.getElementById('clearAllPatternsBtn');
if (clearAllPatternsBtn) {
  clearAllPatternsBtn.addEventListener('click', async () => {
    try {
      await chrome.storage.local.set({ learned_patterns: [] });
      _renderLearnedPatterns([]);
    } catch (e) { console.warn('[Sentinel] clear patterns failed:', e && e.message); }
  });
}

const downloadAuditLogBtn = document.getElementById('downloadAuditLogBtn');
if (downloadAuditLogBtn) {
  downloadAuditLogBtn.addEventListener('click', async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'get_audit_log' });
      if (!resp || !resp.ok) {
        downloadAuditLogBtn.textContent = 'No log available';
        setTimeout(() => { downloadAuditLogBtn.textContent = 'Download Audit Log CSV'; }, 2000);
        return;
      }
      const csv = resp.csv || '';
      if (!csv || csv.split('\n').length <= 1) {
        downloadAuditLogBtn.textContent = 'Log is empty';
        setTimeout(() => { downloadAuditLogBtn.textContent = 'Download Audit Log CSV'; }, 2000);
        return;
      }
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sentinel-audit-log.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      downloadAuditLogBtn.textContent = 'Error: ' + (e.message || 'unknown');
      setTimeout(() => { downloadAuditLogBtn.textContent = 'Download Audit Log CSV'; }, 3000);
    }
  });
}

settingsBtn.addEventListener('click', async () => {
  const state = getState();
  // Load provider settings from storage
  let stored;
  try {
    stored = await chrome.storage.local.get(['active_provider', 'providers', 'api_endpoint', 'api_key', 'model']);
  } catch (e) {
    console.warn('[Sentinel/settings] storage read failed:', e && e.message);
    stored = {};
  }

  if (stored.providers) {
    state.providerConfigs = stored.providers;
    state.activeProviderId = stored.active_provider || 'openai';
  } else {
    // Legacy fallback -- migrate on the fly for display
    const providerId = (stored.api_endpoint || '').includes('api.anthropic.com') ? 'anthropic' : 'openai';
    state.providerConfigs = {
      anthropic: { api_key: '', model: 'claude-haiku-4-5-20251001', endpoint: 'https://api.anthropic.com/v1/messages', max_tokens: 8000, temperature: 0.3 },
      openai: { api_key: stored.api_key || '', model: stored.model || 'gpt-4o', endpoint: stored.api_endpoint || 'https://api.openai.com/v1/chat/completions', max_tokens: 8000, temperature: 0.3 }
    };
    state.activeProviderId = providerId;
  }

  switchProviderCard(state.activeProviderId);
  settingsModal.classList.add('show');
  // Load and render learned patterns
  chrome.storage.local.get(['learned_patterns'], (s) => {
    if (chrome.runtime.lastError) return;
    _renderLearnedPatterns(s.learned_patterns || []);
  });
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('show');
});

saveSettingsBtn.addEventListener('click', () => {
  const state = getState();
  const endpoint = setProviderEndpoint.value.trim();
  const apiKey = setProviderKey.value.trim();
  const model = setProviderModel.value.trim();
  const format = exportFormatSelect.value;
  const agentContextEl = document.getElementById('set-agent-context');
  const agentContext = agentContextEl ? agentContextEl.value.trim() : '';

  if (!apiKey) {
    showToast('API key is required', 'error');
    return;
  }

  if (endpoint && !isValidUrl(endpoint)) {
    showToast('Invalid API endpoint URL', 'error');
    return;
  }

  // Save to per-provider structure
  state.providerConfigs[state.activeProviderId] = {
    api_key: apiKey,
    model: model,
    endpoint: endpoint,
    max_tokens: 8000,
    temperature: 0.3
  };

  chrome.storage.local.set({
    active_provider: state.activeProviderId,
    providers: state.providerConfigs,
    export_format: format,
    agent_context: agentContext
  }, () => {
    if (chrome.runtime.lastError) return;
    settingsModal.classList.remove('show');
    showToast(`Settings saved (${state.activeProviderId})`, 'success');
  });
});

// ========== Theme Customization ==========
document.querySelectorAll('[data-theme]').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    document.querySelectorAll('[data-theme]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyThemePreset(theme);
  });
});

function applyThemePreset(theme) {
  const presets = {
    light: {
      '--bg-primary': '#ffffff',
      '--text-primary': '#0d0d0d',
      '--accent-primary': '#0084ff'
    },
    dark: {
      '--bg-primary': '#0d0d0d',
      '--text-primary': '#ffffff',
      '--accent-primary': '#0084ff'
    },
    matrix: {
      '--bg-primary': '#0a0a0a',
      '--bg-secondary': '#0d1a0d',
      '--bg-tertiary': '#112211',
      '--bg-input': '#0d1a0d',
      '--text-primary': '#00ff41',
      '--text-secondary': '#00cc33',
      '--text-tertiary': '#00802a',
      '--accent-primary': '#00ff41',
      '--accent-hover': '#00cc33',
      '--border-color': '#004d1a',
      '--message-user-bg': '#00ff41',
      '--message-user-text': '#0a0a0a',
      '--message-assistant-bg': '#0d1a0d',
      '--message-assistant-text': '#00ff41',
      '--code-bg': '#050d05',
      '--error-color': '#ff3333',
      '--success-color': '#00ff41',
      '--warning-color': '#ffcc00'
    },
    tron: {
      '--bg-primary': '#000000',
      '--bg-secondary': '#0a0a14',
      '--bg-tertiary': '#10102a',
      '--bg-input': '#0a0a1a',
      '--text-primary': '#00d4ff',
      '--text-secondary': '#80e8ff',
      '--text-tertiary': '#4a6a7a',
      '--accent-primary': '#00d4ff',
      '--accent-hover': '#00a8cc',
      '--border-color': '#003344',
      '--message-user-bg': '#00d4ff',
      '--message-user-text': '#000000',
      '--message-assistant-bg': '#0a0a18',
      '--message-assistant-text': '#80e8ff',
      '--code-bg': '#050510',
      '--error-color': '#ff4444',
      '--success-color': '#00d4ff',
      '--warning-color': '#ff8800'
    },
    cyberpunk: {
      '--bg-primary': '#0d0221',
      '--bg-secondary': '#150535',
      '--bg-tertiary': '#1e0845',
      '--bg-input': '#1a0640',
      '--text-primary': '#ff2a6d',
      '--text-secondary': '#d1c4e9',
      '--text-tertiary': '#7c6f99',
      '--accent-primary': '#ff2a6d',
      '--accent-hover': '#ff5599',
      '--border-color': '#3d1a6e',
      '--message-user-bg': '#ff2a6d',
      '--message-user-text': '#0d0221',
      '--message-assistant-bg': '#150535',
      '--message-assistant-text': '#d1c4e9',
      '--code-bg': '#0a0118',
      '--error-color': '#ff0040',
      '--success-color': '#05d9e8',
      '--warning-color': '#f5f500'
    },
    neon: {
      '--bg-primary': '#0a0014',
      '--bg-secondary': '#12001f',
      '--bg-tertiary': '#1a002a',
      '--bg-input': '#160025',
      '--text-primary': '#e040fb',
      '--text-secondary': '#ce93d8',
      '--text-tertiary': '#7b5e80',
      '--accent-primary': '#e040fb',
      '--accent-hover': '#ab47bc',
      '--border-color': '#38006b',
      '--message-user-bg': '#e040fb',
      '--message-user-text': '#0a0014',
      '--message-assistant-bg': '#12001f',
      '--message-assistant-text': '#ce93d8',
      '--code-bg': '#08000f',
      '--error-color': '#ff1744',
      '--success-color': '#00e676',
      '--warning-color': '#ffea00'
    },
    terminal: {
      '--bg-primary': '#1a1a1a',
      '--bg-secondary': '#222222',
      '--bg-tertiary': '#2a2a2a',
      '--bg-input': '#1e1e1e',
      '--text-primary': '#33ff33',
      '--text-secondary': '#b0b0b0',
      '--text-tertiary': '#666666',
      '--accent-primary': '#33ff33',
      '--accent-hover': '#22cc22',
      '--border-color': '#333333',
      '--message-user-bg': '#33ff33',
      '--message-user-text': '#1a1a1a',
      '--message-assistant-bg': '#222222',
      '--message-assistant-text': '#cccccc',
      '--code-bg': '#111111',
      '--error-color': '#ff4444',
      '--success-color': '#33ff33',
      '--warning-color': '#ffaa00'
    },
    blood: {
      '--bg-primary': '#0a0000',
      '--bg-secondary': '#140000',
      '--bg-tertiary': '#1e0000',
      '--bg-input': '#160000',
      '--text-primary': '#ff1a1a',
      '--text-secondary': '#cc8888',
      '--text-tertiary': '#664444',
      '--accent-primary': '#ff1a1a',
      '--accent-hover': '#cc0000',
      '--border-color': '#330000',
      '--message-user-bg': '#ff1a1a',
      '--message-user-text': '#0a0000',
      '--message-assistant-bg': '#140000',
      '--message-assistant-text': '#cc8888',
      '--code-bg': '#080000',
      '--error-color': '#ff0000',
      '--success-color': '#00cc44',
      '--warning-color': '#ff6600'
    }
  };

  if (presets[theme]) {
    // Save to localStorage
    localStorage.setItem('theme-named', theme);
    // Remove all theme glow classes
    document.body.className = document.body.className
      .replace(/theme-\S+/g, '')
      .trim();

    // Toggle dark-mode class for dark themes
    const darkThemes = ['dark', 'matrix', 'tron', 'cyberpunk', 'neon', 'terminal', 'blood'];
    document.body.classList.toggle('dark-mode', darkThemes.includes(theme));

    // Add theme glow class for themed presets
    if (!['light', 'dark'].includes(theme)) {
      document.body.classList.add('theme-' + theme);
    }

    Object.entries(presets[theme]).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }
}

saveThemeBtn.addEventListener('click', () => {
  const primaryEl = document.getElementById('colorPrimary');
  const bgEl = document.getElementById('colorBg');
  const textEl = document.getElementById('colorText');
  const primary = primaryEl ? primaryEl.value : '';
  const bg = bgEl ? bgEl.value : '';
  const text = textEl ? textEl.value : '';

  document.documentElement.style.setProperty('--accent-primary', primary);
  document.documentElement.style.setProperty('--bg-primary', bg);
  document.documentElement.style.setProperty('--text-primary', text);

  localStorage.setItem('custom-theme', JSON.stringify({ primary, bg, text }));
  themeModal.classList.remove('show');
  showToast('Theme applied', 'success');
});

closeThemeBtn.addEventListener('click', () => {
  themeModal.classList.remove('show');
});

// ========== Preset Buttons ==========
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const provider = btn.dataset.provider || ((btn.dataset.endpoint || '').includes('api.anthropic.com') ? 'anthropic' : 'openai');
    switchProviderCard(provider);
    setProviderEndpoint.value = btn.dataset.endpoint;
    setProviderModel.value = btn.dataset.model;
    showToast(`Preset loaded: ${btn.textContent}`, 'success');
  });
});

// ========== Test Connection Button ==========
const testConnectionBtn = document.getElementById('testConnectionBtn');
if (testConnectionBtn) testConnectionBtn.addEventListener('click', async () => {
  const endpoint = setProviderEndpoint.value.trim();
  const apiKey = setProviderKey.value.trim();
  const model = setProviderModel.value.trim();

  if (!endpoint || !apiKey || !model) {
    showToast('Fill in endpoint, API key, and model first', 'error');
    return;
  }

  const btn = document.getElementById('testConnectionBtn');
  const prevText = btn.textContent;
  btn.textContent = 'Testing...';
  btn.disabled = true;

  try {
    // Determine provider format from endpoint (popup context cannot import background modules)
    const isAnthropic = endpoint.includes('api.anthropic.com');
    const headers = isAnthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
    const body = JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timer);

    if (resp.ok) {
      showToast('Connection OK (' + resp.status + ')', 'success');
    } else {
      const errText = (await resp.text()).slice(0, 200);
      showToast('Connection failed: ' + resp.status + ' ' + errText, 'error');
    }
  } catch (err) {
    showToast('Connection error: ' + (err && err.message ? err.message : String(err)), 'error');
  } finally {
    btn.textContent = prevText;
    btn.disabled = false;
  }
});

// ========== Provider Catalog Auto-Detect (3.10.0) ==========
// Loads the 16-provider catalog from the background, populates the dropdown,
// auto-fills the endpoint on selection, and provides a Detect Models button
// that calls the provider's /models endpoint with the user's API key.


(function wireProviderCatalog() {
  const sel = document.getElementById('providerCatalogSelect');
  const detectBtn = document.getElementById('detectModelsBtn');
  const modelsSel = document.getElementById('detectedModelsSelect');
  const useBtn = document.getElementById('useDetectedModelBtn');
  if (!sel || !detectBtn) return;

  let catalog = [];

  function refreshCatalog() {
    chrome.runtime.sendMessage({ action: 'get_provider_catalog' }, (resp) => {
      if (chrome.runtime.lastError) return;
      const data = (resp && resp.data) ? resp.data : resp;
      if (!Array.isArray(data)) return;
      catalog = data;
      sel.innerHTML = '<option value="">- Pick a provider -</option>';
      for (const p of catalog) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        sel.appendChild(opt);
      }
    });
  }
  refreshCatalog();

  sel.addEventListener('change', () => {
    const id = sel.value;
    if (!id) return;
    const provider = catalog.find(p => p.id === id);
    if (!provider) return;
    if (provider.endpoint) {
      const epInput = document.getElementById('set-provider-endpoint');
      if (epInput) epInput.value = provider.endpoint;
    }
    if (provider.defaultModel) {
      const modelInput = document.getElementById('set-provider-model');
      if (modelInput && !modelInput.value) modelInput.value = provider.defaultModel;
    }
    modelsSel.innerHTML = '<option value="">(click Detect Models to populate)</option>';
    modelsSel.disabled = true;
    useBtn.disabled = true;
    try { showToast('Endpoint set for ' + provider.label, 'info'); } catch { /* showToast may fail in detached popup */ }
  });

  detectBtn.addEventListener('click', async () => {
    const id = sel.value;
    if (!id) {
      try { showToast('Pick a provider first', 'error'); } catch { /* showToast may fail in detached popup */ }
      return;
    }
    const apiKey = (document.getElementById('set-provider-key') || {}).value || '';
    const customEndpoint = (document.getElementById('set-provider-endpoint') || {}).value || '';
    const prevText = detectBtn.textContent;
    detectBtn.textContent = 'Detecting...';
    detectBtn.disabled = true;
    modelsSel.innerHTML = '<option value="">(fetching...)</option>';
    modelsSel.disabled = true;
    useBtn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'fetch_provider_models',
        providerId: id,
        apiKey,
        customEndpoint
      });
      const data = (resp && resp.data) ? resp.data : resp;
      if (!data || !data.ok) {
        const msg = (data && data.error) || 'Unknown error';
        try { showToast('Detect failed: ' + msg, 'error'); } catch { /* showToast may fail in detached popup */ }
        modelsSel.innerHTML = '<option value="">(detection failed - see toast)</option>';
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        modelsSel.innerHTML = '<option value="">(no models returned)</option>';
        try { showToast('No models returned', 'error'); } catch { /* showToast may fail in detached popup */ }
        return;
      }
      modelsSel.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '- Select a model (' + models.length + ' available) -';
      modelsSel.appendChild(placeholder);
      for (const m of models) {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m;
        modelsSel.appendChild(o);
      }
      modelsSel.disabled = false;
      useBtn.disabled = false;
      try { showToast('Detected ' + models.length + ' models', 'success'); } catch { /* showToast may fail in detached popup */ }
    } catch (e) {
      try { showToast('Error: ' + e.message, 'error'); } catch { /* showToast may fail in detached popup */ }
      modelsSel.innerHTML = '<option value="">(error - see toast)</option>';
    } finally {
      detectBtn.textContent = prevText;
      detectBtn.disabled = false;
    }
  });

  useBtn.addEventListener('click', () => {
    const value = modelsSel.value;
    if (!value) {
      try { showToast('Pick a model from the list first', 'error'); } catch { /* showToast may fail in detached popup */ }
      return;
    }
    const modelInput = document.getElementById('set-provider-model');
    if (modelInput) {
      modelInput.value = value;
      try { showToast('Model set to ' + value, 'success'); } catch { /* showToast may fail in detached popup */ }
    }
  });
})();

(function wireCustomCss() {
  const STYLE_ID = 'sentinel-custom-css';
  const STORAGE_KEY = 'sentinel-custom-css';

  function applyCustomCss(css) {
    try {
      let el = document.getElementById(STYLE_ID);
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
      }
      el.textContent = css || '';
    } catch { /* CSS application may fail */ }
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) applyCustomCss(saved);
  } catch { /* localStorage may be restricted */ }

  function wire() {
    const ta = document.getElementById('customCssTextarea');
    const applyBtn = document.getElementById('customCssApplyBtn');
    const clearBtn = document.getElementById('customCssClearBtn');
    const statusEl = document.getElementById('customCssStatus');
    if (!ta) return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) ta.value = saved;
    } catch { /* localStorage may be restricted */ }

    let saveTimer = null;
    const setStatus = (text, color) => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.style.color = color || 'var(--text-tertiary)';
      if (text) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { statusEl.textContent = ''; }, 2200);
      }
    };

    let debounce = null;
    ta.addEventListener('input', () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const css = ta.value || '';
        try { localStorage.setItem(STORAGE_KEY, css); } catch { /* localStorage may be restricted */ }
        applyCustomCss(css);
        setStatus('saved', '#6fcf80');
      }, 350);
    });

    if (applyBtn) applyBtn.addEventListener('click', () => {
      const css = ta.value || '';
      try { localStorage.setItem(STORAGE_KEY, css); } catch { /* localStorage may be restricted */ }
      applyCustomCss(css);
      setStatus('applied', '#6fcf80');
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      ta.value = '';
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* localStorage may be restricted */ }
      applyCustomCss('');
      setStatus('cleared', 'var(--text-tertiary)');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();

(function wireThemeAutoSave() {
  function init() {
    document.querySelectorAll('.theme-preset[data-theme]').forEach(el => {
      el.addEventListener('click', () => {
        const theme = el.dataset.theme;
        if (!theme) return;
        document.body.className = document.body.className.split(/\s+/).filter(c => !c.startsWith('theme-')).join(' ');
        if (theme !== 'light' && theme !== 'dark') {
          document.body.classList.add('theme-' + theme);
        }
        if (theme === 'dark') document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
        try { localStorage.setItem('theme-named', theme); } catch { /* localStorage may be restricted */ }
        document.querySelectorAll('.theme-preset').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
        try { showToast('Theme: ' + theme + ' (saved)', 'success'); } catch { /* showToast may fail in detached popup */ }
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
