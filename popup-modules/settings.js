// popup-modules/settings.js
// Settings UI: theme management, provider switching, settings modal, test connection, presets.
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
function loadSettings() {
  const state = getState();
  chrome.storage.local.get(['active_provider', 'providers', 'api_endpoint', 'api_key', 'model', 'export_format', 'agent_context'], (result) => {
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
    if (result.export_format) exportFormatSelect.value = result.export_format;
    if (result.agent_context) document.getElementById('set-agent-context').value = result.agent_context;
  });
}

// ========== Theme Toggle ==========
themeToggle.addEventListener('click', toggleTheme);

// ========== Settings Modal ==========
settingsBtn.addEventListener('click', async () => {
  const state = getState();
  // Load provider settings from storage
  const stored = await chrome.storage.local.get(['active_provider', 'providers', 'api_endpoint', 'api_key', 'model']);

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
  const agentContext = document.getElementById('set-agent-context').value.trim();

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
  const primary = document.getElementById('colorPrimary').value;
  const bg = document.getElementById('colorBg').value;
  const text = document.getElementById('colorText').value;

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
document.getElementById('testConnectionBtn').addEventListener('click', async () => {
  const endpoint = setProviderEndpoint.value.trim();
  const apiKey = setProviderKey.value.trim();
  const model = setProviderModel.value.trim();

  if (!endpoint || !apiKey || !model) {
    showToast('Fill in endpoint, API key, and model first', 'error');
    return;
  }

  const btn = document.getElementById('testConnectionBtn');
  btn.textContent = 'Testing...';
  btn.disabled = true;

  try {
    // Determine provider format from endpoint (popup context cannot import background modules)
    const isAnthropic = endpoint.includes('api.anthropic.com');
    const headers = isAnthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const body = isAnthropic
      ? JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] })
      : JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });

    const response = await fetch(endpoint, { method: 'POST', headers, body });

    if (response.ok) {
      showToast('Connection successful', 'success');
    } else {
      const errText = await response.text().catch(() => 'Unknown error');
      showToast(`Connection failed: ${response.status} - ${errText.substring(0, 100)}`, 'error');
    }
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, 'error');
  } finally {
    btn.textContent = 'Test Connection';
    btn.disabled = false;
  }
});
