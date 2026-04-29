// ========== Global State ==========
let conversationHistory = [];
let selectedAttachments = [];
let currentSearchQuery = '';
let currentSearchIndex = 0;

// ========== Provider Presets ==========
// Common API providers with their endpoints and model lists
const PROVIDER_PRESETS = {
  'openai': {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini', 'gpt-4.5-preview'],
    defaultModel: 'gpt-4o-mini'
  },
  'anthropic': {
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    defaultModel: 'claude-3-5-sonnet-20241022'
  },
  'zai': {
    endpoint: 'https://api.z.ai/v1/chat/completions',
    models: ['zai-org-glm-4.7-flash', 'zai-org-glm-4.7', 'glm-4-plus'],
    defaultModel: 'zai-org-glm-4.7-flash'
  },
  'venice': {
    endpoint: 'https://api.venice.ai/api/v1/chat/completions',
    models: ['gemma-4-uncensored', 'grok-41-fast', 'deepseek-v4-flash', 'mistral-small-3-2-24b-instruct'],
    defaultModel: 'gemma-4-uncensored'
  },
  'openrouter': {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['google/gemini-2.0-flash-enterprise', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'google/gemini-2.5-pro'],
    defaultModel: 'openai/gpt-4o-mini'
  }
};

// ========== DOM Elements ==========
const chatContainer = document.getElementById('chat-container');
const goalInput = document.getElementById('goalInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const voiceBtn = document.getElementById('voiceBtn');
const speakBtn = document.getElementById('speakBtn');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const activeIndicator = document.getElementById('activeIndicator');
const newChatBtn = document.getElementById('newChatBtn');
const settingsBtn = document.getElementById('settingsBtn');
const themeToggle = document.getElementById('themeToggle');
const commandPaletteBtn = document.getElementById('commandPaletteBtn');
const settingsModal = document.getElementById('settings-modal');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const setApiEndpoint = document.getElementById('set-api-endpoint');
const setApiKey = document.getElementById('set-api-key');
const setApiModel = document.getElementById('set-api-model');
const exportFormatSelect = document.getElementById('export-format');
const searchInput = document.getElementById('searchInput');
const previewBtn = document.getElementById('previewBtn');
const markdownPreview = document.getElementById('markdownPreview');
const previewContent = document.getElementById('previewContent');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachmentPreview');
const exportBtn = document.getElementById('exportBtn');
const commandPalette = document.getElementById('commandPalette');
const commandInput = document.getElementById('commandInput');
const commandList = document.getElementById('commandList');
const themeModal = document.getElementById('theme-modal');
const closeThemeBtn = document.getElementById('closeThemeBtn');
const saveThemeBtn = document.getElementById('saveThemeBtn');
const investigationModeBtn = document.getElementById('investigationModeBtn');
const closeResearchTabsBtn = document.getElementById('closeResearchTabsBtn');
const exportInvestigationBtn = document.getElementById('exportInvestigationBtn');
const testApiBtn = document.getElementById('testApiBtn');
const providerSelect = document.getElementById('provider-select');

// Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'en-US';
}

// ========== Initialization ==========
window.addEventListener('DOMContentLoaded', () => {
  loadThemePreference();
  loadSettings();
  loadChatHistory();
  setupEventListeners();
  setupVoiceInput();
  initProviderSelector();
  addTestApiBtn();
  checkForRestorableSession();
});

// ========== Provider Selector ==========
function initProviderSelector() {
  if (!providerSelect) return;
  
  const providers = Object.keys(PROVIDER_PRESETS);
  providerSelect.innerHTML = providers.map(p => `<option value="${p}">${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('');
  
  // Load saved provider
  chrome.storage.local.get(['api_provider'], (result) => {
    if (result.api_provider && PROVIDER_PRESETS[result.api_provider]) {
      providerSelect.value = result.api_provider;
      const preset = PROVIDER_PRESETS[result.api_provider];
      if (!setApiEndpoint.value) setApiEndpoint.value = preset.endpoint;
      if (!setApiModel.value) setApiModel.value = preset.defaultModel;
    }
  });
  
  providerSelect.addEventListener('change', () => {
    const preset = PROVIDER_PRESETS[providerSelect.value];
    if (preset) {
      setApiEndpoint.value = preset.endpoint;
      if (!setApiModel.value) setApiModel.value = preset.defaultModel;
    }
  });
}

// ========== Test API Button ==========
function addTestApiBtn() {
  if (!testApiBtn) return;
  
  testApiBtn.addEventListener('click', async () => {
    const endpoint = setApiEndpoint.value.trim();
    const apiKey = setApiKey.value.trim();
    
    if (!apiKey) {
      showToast('Please enter an API key first', 'error');
      return;
    }
    
    if (!endpoint) {
      showToast('Please enter an API endpoint', 'error');
      return;
    }
    
    testApiBtn.disabled = true;
    testApiBtn.textContent = 'Testing...';
    showToast('Testing API connection...', 'success');
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: setApiModel.value || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 10
        })
      });
      
      if (response.ok) {
        showToast('✅ API connection successful!', 'success');
      } else {
        const error = await response.text();
        showToast('❌ API Error: ' + response.status + ' - ' + error.substring(0, 100), 'error');
      }
    } catch (err) {
      showToast('❌ Connection failed: ' + err.message, 'error');
    } finally {
      testApiBtn.disabled = false;
      testApiBtn.textContent = 'Test API';
    }
  });
}

// ========== TTS Speak Function ==========
function speakLastMessage() {
  const messages = document.querySelectorAll('.assistant-msg');
  if (messages.length === 0) {
    showToast('No assistant message to speak', 'error');
    return;
  }
  
  const lastMsg = messages[messages.length - 1];
  const text = (lastMsg.textContent || lastMsg.innerText).trim();
  
  if (!text) {
    showToast('Message is empty', 'error');
    return;
  }
  
  // Use Web Speech API (built into browsers)
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text.substring(0, 500));
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.voice = speechSynthesis.getVoices().find(v => v.name.includes('Jenny') || v.lang.includes('en-US')) || speechSynthesis.getVoices()[0];
    
    utterance.onend = () => {
      showToast('Speech complete', 'success');
    };
    
    utterance.onerror = (e) => {
      showToast('Speech error: ' + e.error, 'error');
    };
    
    speechSynthesis.speak(utterance);
    showToast('Speaking...', 'success');
  } else {
    // Fallback: Copy to clipboard
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard (no TTS support)', 'success');
    });
  }
}

// Check if there's a restorable session
async function checkForRestorableSession() {
  const now = Date.now();
  const twoHoursAgo = now - (2 * 60 * 60 * 1000);
  
  chrome.storage.local.get(['sentinel_agent_session_v2'], (result) => {
    if (result.sentinel_agent_session_v2) {
      const session = result.sentinel_agent_session_v2;
      if (session.timestamp && session.timestamp > twoHoursAgo) {
        // Show restore option
        const restoreBanner = document.createElement('div');
        restoreBanner.className = 'restore-banner';
        restoreBanner.innerHTML = `
          <div class="restore-info">
            <span>💾 Previous session found</span>
            <small>Last active: ${new Date(session.timestamp).toLocaleTimeString()}</small>
          </div>
          <button id="restore-session-btn" class="restore-btn">Restore Session</button>
          <button id="dismiss-session-btn" class="dismiss-btn">✕</button>
        `;
        restoreBanner.style.cssText = `
          display: flex; align-items: center; gap: 12px; padding: 8px 12px; 
          background: var(--accent-primary); color: white; border-radius: 6px;
          margin-bottom: 10px; animation: slideIn 0.3s ease;
        `;
        document.querySelector('.container').prepend(restoreBanner);
        
        document.getElementById('restore-session-btn').onclick = () => {
          restoreBanner.remove();
          // The session data is already loaded in background
          showToast('Session restored - continuing from last state', 'success');
        };
        document.getElementById('dismiss-session-btn').onclick = () => {
          restoreBanner.remove();
        };
      }
    }
  });
}

// ========== Theme Management ==========
function loadThemePreference() {
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

// ========== Settings Management ==========
function loadSettings() {
  chrome.storage.local.get(['api_endpoint', 'api_key', 'model', 'export_format'], (result) => {
    if (result.api_endpoint) setApiEndpoint.value = result.api_endpoint;
    if (result.api_key) setApiKey.value = result.api_key;
    if (result.model) setApiModel.value = result.model;
    if (result.export_format) exportFormatSelect.value = result.export_format;
  });
}

// ========== Chat History ==========
function loadChatHistory() {
  chrome.storage.local.get(['agent_history'], (result) => {
    if (result.agent_history && result.agent_history.length > 0) {
      conversationHistory = result.agent_history;
      chatContainer.innerHTML = '';
      conversationHistory.forEach(turn => {
        if (turn.result) {
          addMessage(turn.result, 'assistant');
        }
      });
      hideStatus();
    }
  });
}

function saveChatHistory() {
  chrome.storage.local.set({ agent_history: conversationHistory });
}

// ========== Message Handling ==========
function addMessage(text, role = 'assistant') {
  const welcome = chatContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  conversationHistory.push({ text, role });
  saveChatHistory();
  
  // Save investigation state if in investigation mode
  if (investigationMode && role === 'assistant') {
    saveInvestigationSession({
      messages: conversationHistory,
      timestamp: new Date().toISOString()
    });
  }

  const messageGroup = document.createElement('div');
  messageGroup.className = 'message-group';
  messageGroup.dataset.messageIndex = conversationHistory.length - 1;

  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`;

  const msg = document.createElement('div');
  msg.className = `message ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;

  if (role === 'user') {
    msg.textContent = text;
  } else {
    // Format investigation response if in investigation mode
    if (investigationMode) {
      text = formatInvestigationResponse(text);
    }
    msg.innerHTML = marked.parse(text);
    addCodeCopyButtons(msg);
  }

  wrapper.appendChild(msg);
  messageGroup.appendChild(wrapper);
  chatContainer.appendChild(messageGroup);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ========== Code Copy Buttons ==========
function addCodeCopyButtons(messageElement) {
  const codeBlocks = messageElement.querySelectorAll('pre');
  codeBlocks.forEach(pre => {
    const code = pre.querySelector('code');
    if (code) {
      const lang = code.className.replace('language-', '') || 'plaintext';

      const header = document.createElement('div');
      header.className = 'code-header';

      const langSpan = document.createElement('span');
      langSpan.textContent = lang;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.textContent = '📋 Copy';

      copyBtn.addEventListener('click', () => {
        const text = code.textContent;
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '✓ Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '📋 Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        });
      });

      header.appendChild(langSpan);
      header.appendChild(copyBtn);
      pre.insertBefore(header, code);
    }
  });
}

// ========== Typing Indicator ==========
function restoreInvestigationSession(session) {
  conversationHistory = session.messages || [];
  chatContainer.innerHTML = '';
  conversationHistory.forEach(turn => {
    addMessage(turn.text, turn.role);
  });
  showToast('Restored investigation session', 'success');
}

// ========== Typing Indicator ==========
function showTypingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper assistant-wrapper';
  wrapper.id = 'typing-indicator';

  const indicator = document.createElement('div');
  indicator.className = 'status-indicator';
  indicator.innerHTML = `
    <span class="loading-dot"></span>
    <span class="loading-dot"></span>
    <span class="loading-dot"></span>
    <span>SentinelAgent is thinking...</span>
  `;

  wrapper.appendChild(indicator);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

// ========== Status Updates ==========
function updateStatus(text) {
  statusText.textContent = text;
  status.style.display = 'block';
}

function hideStatus() {
  status.style.display = 'none';
}

// ========== Input Area ==========
goalInput.addEventListener('input', () => {
  goalInput.style.height = 'auto';
  goalInput.style.height = Math.min(goalInput.scrollHeight, 100) + 'px';
  updateMarkdownPreview();
});

// ========== Send Message ==========
sendBtn.addEventListener('click', sendMessage);

function setAgentActive(isActive) {
  if (isActive) {
    activeIndicator.classList.add('active');
  } else {
    activeIndicator.classList.remove('active');
  }
}

function sendMessage() {
  const goal = goalInput.value.trim();
  if (!goal) return;

  addMessage(goal, 'user');
  goalInput.value = '';
  goalInput.style.height = 'auto';
  sendBtn.disabled = true;
  stopBtn.style.display = 'flex';
  goalInput.placeholder = 'Waiting for response...';
  selectedAttachments = [];
  attachmentPreview.style.display = 'none';

  showTypingIndicator();
  updateStatus('Agent is starting...');
  setAgentActive(true);

  chrome.runtime.sendMessage({ action: 'run_agent_loop', goal: goal }, (response) => {
    if (chrome.runtime.lastError) {
      removeTypingIndicator();
      addMessage('Error: ' + chrome.runtime.lastError.message, 'assistant');
      resetUI();
    }
  });
}

function resetUI() {
  sendBtn.disabled = false;
  stopBtn.style.display = 'none';
  goalInput.placeholder = 'Tell me what to do...';
  hideStatus();
  setAgentActive(false);
}

// ========== Stop Button ==========
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stop_agent_loop' }, () => {
    removeTypingIndicator();
    addMessage('Agent stopped by user.', 'assistant');
    setAgentActive(false);
    resetUI();
  });
});

// ========== New Chat ==========
newChatBtn.addEventListener('click', () => {
  if (confirm('Start a new chat? This will clear the current conversation.')) {
    chrome.storage.local.set({ agent_history: [] }, () => {
      conversationHistory = [];
      chatContainer.innerHTML = `
        <div class="welcome-message">
          <h2>SentinelAgent</h2>
          <p>Automate your browser tasks with AI. What would you like me to do?</p>
        </div>
      `;
      goalInput.value = '';
      goalInput.style.height = 'auto';
      resetUI();
      showToast('Chat cleared', 'success');
    });
  }
});

// ========== Theme Toggle ==========
themeToggle.addEventListener('click', toggleTheme);

// ========== Settings Modal ==========
settingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('show');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('show');
});

saveSettingsBtn.addEventListener('click', () => {
  const endpoint = setApiEndpoint.value.trim();
  const apiKey = setApiKey.value.trim();
  const model = setApiModel.value.trim();
  const format = exportFormatSelect.value;

  if (!apiKey) {
    showToast('API key is required', 'error');
    return;
  }

  if (endpoint && !isValidUrl(endpoint)) {
    showToast('Invalid API endpoint URL', 'error');
    return;
  }

  chrome.storage.local.set({
    api_endpoint: endpoint,
    api_key: apiKey,
    model: model,
    export_format: format
  }, () => {
    settingsModal.classList.remove('show');
    showToast('Settings saved', 'success');
  });
});

// ========== Message Search ==========
searchInput.addEventListener('input', (e) => {
  currentSearchQuery = e.target.value.toLowerCase();
  currentSearchIndex = 0;

  if (currentSearchQuery) {
    highlightSearchResults();
  } else {
    clearSearchHighlights();
  }
});

function highlightSearchResults() {
  clearSearchHighlights();

  const messages = chatContainer.querySelectorAll('.message-group');
  let matchCount = 0;

  messages.forEach(group => {
    const text = group.textContent.toLowerCase();
    if (text.includes(currentSearchQuery)) {
      group.classList.add('highlighted');
      matchCount++;
    }
  });

  const searchCount = document.getElementById('searchCount');
  if (matchCount > 0) {
    searchCount.textContent = `${matchCount} match${matchCount !== 1 ? 'es' : ''}`;
    searchCount.style.display = 'inline';
  } else {
    searchCount.style.display = 'none';
  }
}

function clearSearchHighlights() {
  document.querySelectorAll('.message-group.highlighted').forEach(group => {
    group.classList.remove('highlighted');
  });
  document.getElementById('searchCount').style.display = 'none';
}

// ========== Markdown Preview ==========
previewBtn.addEventListener('click', () => {
  markdownPreview.classList.toggle('show');
  previewBtn.classList.toggle('active');
});

function updateMarkdownPreview() {
  const text = goalInput.value;
  if (text) {
    previewContent.innerHTML = marked.parse(text);
  } else {
    previewContent.innerHTML = '<p style="color: var(--text-tertiary);">Preview appears here...</p>';
  }
}

// ========== File Attachment ==========
attachBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  selectedAttachments = Array.from(e.target.files);
  updateAttachmentPreview();
});

function updateAttachmentPreview() {
  if (selectedAttachments.length > 0) {
    attachmentPreview.innerHTML = '<span>📎 Attachments:</span>';
    selectedAttachments.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      item.innerHTML = `
        ${file.name}
        <span class="attachment-remove" onclick="removeAttachment(${index})">×</span>
      `;
      attachmentPreview.appendChild(item);
    });
    attachmentPreview.style.display = 'flex';
  } else {
    attachmentPreview.style.display = 'none';
  }
}

window.removeAttachment = (index) => {
  selectedAttachments.splice(index, 1);
  updateAttachmentPreview();
};

// ========== Voice Input ==========
function setupVoiceInput() {
  if (!recognition) {
    voiceBtn.style.opacity = '0.5';
    voiceBtn.disabled = true;
    voiceBtn.title = 'Voice input not supported';
    return;
  }

  voiceBtn.addEventListener('click', () => {
    if (voiceBtn.classList.contains('listening')) {
      recognition.stop();
    } else {
      recognition.start();
      voiceBtn.classList.add('listening');
    }
  });

  recognition.onstart = () => {
    voiceBtn.classList.add('listening');
  };

  recognition.onend = () => {
    voiceBtn.classList.remove('listening');
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    if (transcript) {
      goalInput.value = transcript;
      goalInput.style.height = 'auto';
      goalInput.style.height = Math.min(goalInput.scrollHeight, 100) + 'px';
      showToast('Voice input captured', 'success');
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    showToast(`Voice error: ${event.error}`, 'error');
  };
}

// ========== Conversation Export ==========
exportBtn.addEventListener('click', () => {
  if (conversationHistory.length === 0) {
    showToast('No messages to export', 'error');
    return;
  }

  const format = exportFormatSelect.value;
  let content, filename, mimeType;

  if (format === 'markdown') {
    content = conversationHistory
      .map(turn => `### ${turn.role === 'user' ? '👤 You' : '🤖 Agent'}\n\n${turn.text}`)
      .join('\n\n---\n\n');
    filename = `conversation-${Date.now()}.md`;
    mimeType = 'text/markdown';
  } else if (format === 'json') {
    content = JSON.stringify(conversationHistory, null, 2);
    filename = `conversation-${Date.now()}.json`;
    mimeType = 'application/json';
  } else {
    content = conversationHistory
      .map(turn => `[${turn.role.toUpperCase()}]\n${turn.text}`)
      .join('\n\n---\n\n');
    filename = `conversation-${Date.now()}.txt`;
    mimeType = 'text/plain';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported as ${format.toUpperCase()}`, 'success');
});

// ========== Command Palette ==========
commandPaletteBtn.addEventListener('click', openCommandPalette);

function openCommandPalette() {
  commandPalette.classList.add('show');
  commandInput.focus();
  renderCommandList([]);
}

function closeCommandPalette() {
  commandPalette.classList.remove('show');
  commandInput.value = '';
}

commandInput.addEventListener('input', filterCommands);
commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCommandPalette();
  if (e.key === 'Enter') executeSelectedCommand();
  if (e.key === 'ArrowDown') moveCommandSelection(1);
  if (e.key === 'ArrowUp') moveCommandSelection(-1);
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    newChatBtn.click();
  }
});

const COMMANDS = [
  { name: 'New Chat', desc: 'Start a new conversation', action: 'new-chat', icon: '✍️' },
  { name: 'Export Conversation', desc: 'Download chat history', action: 'export', icon: '💾' },
  { name: 'Clear Search', desc: 'Clear search results', action: 'clear-search', icon: '🔍' },
  { name: 'Toggle Dark Mode', desc: 'Switch theme', action: 'toggle-dark', icon: '🌙' },
  { name: 'Open Settings', desc: 'Configure API and preferences', action: 'settings', icon: '⚙️' },
  { name: 'Customize Theme', desc: 'Customize colors', action: 'theme', icon: '🎨' },
  { name: 'About', desc: 'About SentinelAgent', action: 'about', icon: 'ℹ️' },
];

function filterCommands() {
  const query = commandInput.value.toLowerCase();
  const filtered = COMMANDS.filter(cmd =>
    cmd.name.toLowerCase().includes(query) ||
    cmd.desc.toLowerCase().includes(query)
  );
  renderCommandList(filtered);
}

function renderCommandList(commands) {
  if (commands.length === 0) {
    commands = COMMANDS;
  }

  commandList.innerHTML = commands.map((cmd, idx) => `
    <div class="command-item" data-index="${idx}" onclick="executeCommand('${cmd.action}')">
      <div class="command-icon">${cmd.icon}</div>
      <div class="command-text">
        <div class="command-name">${cmd.name}</div>
        <div class="command-desc">${cmd.desc}</div>
      </div>
    </div>
  `).join('');
}

function moveCommandSelection(direction) {
  const items = commandList.querySelectorAll('.command-item');
  const selected = commandList.querySelector('.command-item.selected');

  if (!selected && items.length > 0) {
    items[0].classList.add('selected');
  } else if (selected) {
    const nextIndex = Array.from(items).indexOf(selected) + direction;
    if (nextIndex >= 0 && nextIndex < items.length) {
      selected.classList.remove('selected');
      items[nextIndex].classList.add('selected');
    }
  }
}

function executeSelectedCommand() {
  const selected = commandList.querySelector('.command-item.selected');
  if (selected) {
    const action = selected.dataset.action || 'about';
    executeCommand(action);
  }
}

window.executeCommand = (action) => {
  closeCommandPalette();

  switch(action) {
    case 'new-chat':
      newChatBtn.click();
      break;
    case 'export':
      exportBtn.click();
      break;
    case 'clear-search':
      searchInput.value = '';
      clearSearchHighlights();
      break;
    case 'toggle-dark':
      toggleTheme();
      break;
    case 'settings':
      settingsBtn.click();
      break;
    case 'theme':
      themeModal.classList.add('show');
      break;
    case 'about':
      showToast('SentinelAgent v1.0 - AI-powered browser automation', 'success');
      break;
  }
};

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
    blue: {
      '--bg-primary': '#f0f6ff',
      '--text-primary': '#001a33',
      '--accent-primary': '#0084ff'
    },
    purple: {
      '--bg-primary': '#f8f4ff',
      '--text-primary': '#330066',
      '--accent-primary': '#7c3aed'
    },
    green: {
      '--bg-primary': '#f0fdf4',
      '--text-primary': '#166534',
      '--accent-primary': '#16a34a'
    }
  };

  if (presets[theme]) {
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

// ========== Utility Functions ==========
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ========== Markdown Configuration ==========
marked.setOptions({
  breaks: true,
  gfm: true,
});

// ========== Background Message Handler ==========
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'agent_update') {
    updateStatus(message.text);
  }
  if (message.action === 'agent_finished') {
    removeTypingIndicator();
    addMessage('✅ Task completed!\n\n' + message.summary, 'assistant');
    resetUI();
  }
  if (message.action === 'close_research_tabs') {
    if (typeof closeResearchTabs !== 'undefined') {
      closeResearchTabs();
    }
  }
});

// ========== Close Modals on Escape ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    settingsModal.classList.remove('show');
    themeModal.classList.remove('show');
    closeCommandPalette();
  }
});

// ========== Click outside modal to close ==========
window.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('show');
  }
  if (e.target === themeModal) {
    themeModal.classList.remove('show');
  }
});

// ========== Investigation Mode ==========
let investigationMode = false;

// Session state storage key
const INVESTIGATION_SESSION_KEY = 'investigation_session_state';

// Save investigation session state
function saveInvestigationSession(data) {
  const session = {
    ...data,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem(INVESTIGATION_SESSION_KEY, JSON.stringify(session));
}

// Load investigation session state
function loadInvestigationSession() {
  try {
    const saved = localStorage.getItem(INVESTIGATION_SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

// Clear investigation session state
function clearInvestigationSession() {
  localStorage.removeItem(INVESTIGATION_SESSION_KEY);
}

// ========== Research Tab Controls ==========

if (closeResearchTabsBtn) {
  closeResearchTabsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'close_research_tabs' });
    showToast('Closed all research tabs', 'success');
  });
}

// ========== Investigation Export ==========

if (exportInvestigationBtn) {
  exportInvestigationBtn.addEventListener('click', () => {
    const session = loadInvestigationSession();
    if (session && session.messages && session.messages.length > 0) {
      const content = session.messages
        .map(turn => `### ${turn.role === 'user' ? '👤 You' : '🤖 Agent'}\n\n${turn.text}`)
        .join('\n\n---\n\n');
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `investigation-report-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Investigation report exported', 'success');
    } else {
      showToast('No investigation data to export', 'error');
    }
  });
}

if (investigationModeBtn) {
  investigationModeBtn.addEventListener('click', () => {
    investigationMode = !investigationMode;
    investigationModeBtn.classList.toggle('active');
    if (investigationMode) {
      investigationModeBtn.textContent = '🔍 Investigating';
      showToast('Investigation Mode ON - Structured output enabled', 'success');
      // Load previous session if exists
      const session = loadInvestigationSession();
      if (session && confirm('Restore previous investigation session?')) {
        restoreInvestigationSession(session);
      }
    } else {
      investigationModeBtn.textContent = '🔍 Investigate';
      showToast('Investigation Mode OFF', 'success');
    }
  });
}

// Investigation prompt template for structured output
function getInvestigationPrompt(userInput) {
  return `You are an expert IT investigator. Provide output in Claude's structured format.

INVESTIGATION MODE:

---

**FACT vs INFERENCE**

**FACTS GATHERED:**
- [List only verifiable facts: device names, models, timestamps, values, statuses]

**INFERENCES:**
- [Analysis and hypothesis based on facts]
- [Root cause ranking with probability percentages]

---

**TIMELINE** (EDT timezone)
- [Chronological sequence of events]

---

**TOP SUSPECT ANALYSIS**
1. [Most likely cause] (XX% probability)
   - Evidence: [specific facts supporting this]
2. [Second candidate] (XX% probability)
3. [Third candidate] (XX% probability)

---

**NEXT ACTIONS** (ticket-ready)
- [Action item] - Who: [person], What: [task], When: [timeline]
- Internal notes: [staff observations]
- Customer-facing: [what to tell the client]

---

**MISSING DATA:**
[MISSING DATA: List critical information needed to complete investigation]

---

${userInput}`;
}

// Enhanced format investigation response with better visual sections
function formatInvestigationResponse(text) {
  // Already has investigation-style sections, enhance formatting
  if (text.includes('**FACT') || text.includes('**FACTS')) {
    return enhanceInvestigationFormatting(text);
  }
  
  // Auto-detect and format if response has investigation-like content
  const hasFacts = /facts?:\s*\n/i.test(text);
  const hasTimeline = /timeline:\s*\n/i.test(text);
  const hasMissing = /missing\s+data:\s*\n/i.test(text);
  
  if (hasFacts || hasTimeline || hasMissing) {
    return enhanceInvestigationFormatting(text);
  }
  
  return text;
}

// Apply visual enhancements to investigation output
function enhanceInvestigationFormatting(text) {
  // Split into sections and format each
  const sections = [
    { name: 'FACTS GATHERED', header: '📋 FACTS GATHERED', emoji: '📋' },
    { name: 'INFERENCES', header: '🎯 INFERENCES', emoji: '🎯' },
    { name: 'TIMELINE', header: '⏰ TIMELINE (EDT)', emoji: '⏰' },
    { name: 'TOP SUSPECT', header: '🔍 TOP SUSPECT ANALYSIS', emoji: '🔍' },
    { name: 'NEXT ACTIONS', header: '📝 NEXT ACTIONS', emoji: '📝' },
    { name: 'MISSING DATA', header: '❓ MISSING DATA', emoji: '❓' }
  ];
  
  let formatted = text;
  
  // Add visual dividers and ensure proper section headers
  sections.forEach(section => {
    if (formatted.includes(section.name) && !formatted.includes(section.header)) {
      const regex = new RegExp(`\\*\\*${section.name}[^:]*\\*\\*`, 'i');
      formatted = formatted.replace(regex, section.header);
    }
  });
  
  // Add proper markdown code block for missing data
  if (formatted.includes('MISSING DATA') && !formatted.includes('```')) {
    formatted = formatted.replace(
      /(MISSING DATA.*?)(---|$)/gis,
      '$1\n```\n[MISSING DATA: List critical information needed here]\n```\n\n---'
    );
  }
  
  // Ensure list items have proper bullets
  formatted = formatted.replace(/(^\s*[-*]\s+(?=[A-Z]))/gm, '\n$1');
  
  // Add visual separator between major sections
  formatted = formatted.replace(/\n---\n/g, '\n\n---\n\n');
  
  // Add Claude-style header if not present
  if (!formatted.includes('---') || !formatted.includes('FACTS GATHERED')) {
    formatted = `**FACT vs INFERENCE**

---

` + formatted;
  }
  
  return formatted;
}

// Override sendMessage to use investigation format when enabled
const originalSendMessage = sendMessage;
sendMessage = function() {
  const goal = goalInput.value.trim();
  if (!goal) return;

  if (investigationMode) {
    // Prepend investigation format instructions
    const investigationGoal = getInvestigationPrompt(goal);
    goalInput.value = investigationGoal;
  }
  
  originalSendMessage.call(this);
};
