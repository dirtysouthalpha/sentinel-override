// ========== Global State ==========
let conversationHistory = [];
let selectedAttachments = [];
let currentSearchQuery = '';
let currentSearchIndex = 0;

// ========== DOM Elements ==========
const chatContainer = document.getElementById('chat-container');
const goalInput = document.getElementById('goalInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const voiceBtn = document.getElementById('voiceBtn');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
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
const approvalModeToggle = document.getElementById('approvalModeToggle');
const approvalModeLabel = document.getElementById('approvalModeLabel');
const modeBadge = document.getElementById('modeBadge');
const approvalCardContainer = document.getElementById('approvalCardContainer');
const activeIndicator = document.getElementById('activeIndicator');

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
  loadApprovalMode();
  loadChatHistory();
  setupVoiceInput();
  setupApprovalModeToggle();
});

// ========== Approval Mode ==========
function loadApprovalMode() {
  chrome.storage.local.get(['approvalMode'], (result) => {
    const isApprovalMode = result.approvalMode === true;
    approvalModeToggle.checked = isApprovalMode;
    updateApprovalModeUI(isApprovalMode);
  });
}

function setupApprovalModeToggle() {
  approvalModeToggle.addEventListener('change', () => {
    const isApprovalMode = approvalModeToggle.checked;
    chrome.storage.local.set({ approvalMode: isApprovalMode });
    updateApprovalModeUI(isApprovalMode);
  });
}

function updateApprovalModeUI(isApprovalMode) {
  if (isApprovalMode) {
    approvalModeLabel.textContent = 'ON - Agent asks before each action';
    modeBadge.textContent = 'APPROVAL';
    modeBadge.className = 'mode-badge approval';
  } else {
    approvalModeLabel.textContent = 'OFF - Agent executes autonomously';
    modeBadge.textContent = 'YOLO';
    modeBadge.className = 'mode-badge yolo';
  }
}

function showApprovalCard(payload) {
  removeApprovalCard();

  const card = document.createElement('div');
  card.className = 'approval-card';
  card.id = 'approval-card';

  card.innerHTML = `
    <div class="approval-card-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>Agent requests approval</span>
    </div>
    <div class="approval-card-step">Step #${payload.stepNumber || '?'}</div>
    <div class="approval-card-action">${escapeHtml(payload.description)}</div>
    <div class="approval-card-buttons">
      <button class="approval-btn approve" id="approvalApprove">Approve</button>
      <button class="approval-btn reject" id="approvalReject">Reject</button>
      <button class="approval-btn skip" id="approvalSkip">Skip</button>
    </div>
  `;

  approvalCardContainer.appendChild(card);

  // Scroll to show the card
  approvalCardContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Wire up buttons
  document.getElementById('approvalApprove').addEventListener('click', () => respondApproval('approved'));
  document.getElementById('approvalReject').addEventListener('click', () => respondApproval('rejected'));
  document.getElementById('approvalSkip').addEventListener('click', () => respondApproval('skipped'));
}

function removeApprovalCard() {
  const card = document.getElementById('approval-card');
  if (card) card.remove();
}

function respondApproval(decision) {
  removeApprovalCard();
  chrome.runtime.sendMessage({
    action: 'approval_response',
    approved: decision === 'approved',
    skipped: decision === 'skipped',
    rejected: decision === 'rejected'
  }).catch(() => {});

  if (decision === 'rejected') {
    addMessage('Command rejected by user.', 'assistant');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== Claude-style Action Cards ==========
function addActionCard(payload) {
  const welcome = chatContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const group = document.createElement('div');
  group.className = 'message-group agent-action-group';

  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper assistant-wrapper';

  const msg = document.createElement('div');
  msg.className = 'message assistant-msg agent-action-card';
  msg.id = `agent-action-${payload.stepNumber}`;

  const inner = document.createElement('div');
  inner.className = 'agent-action-inner';

  const header = document.createElement('div');
  header.className = 'agent-action-header';

  const typeLabel = document.createElement('span');
  typeLabel.className = 'agent-action-type';
  typeLabel.textContent = payload.type;

  const stepLabel = document.createElement('span');
  stepLabel.className = 'agent-action-step';
  stepLabel.textContent = `Step ${payload.stepNumber}`;

  const collapseIndicator = document.createElement('span');
  collapseIndicator.className = 'collapse-indicator';

  const resultBadge = document.createElement('span');
  resultBadge.className = 'collapse-result-badge';
  resultBadge.id = `agent-badge-${payload.stepNumber}`;

  header.appendChild(typeLabel);
  header.appendChild(stepLabel);
  header.appendChild(resultBadge);
  header.appendChild(collapseIndicator);

  const desc = document.createElement('div');
  desc.className = 'agent-action-desc';
  desc.textContent = payload.description;

  inner.appendChild(header);
  inner.appendChild(desc);

  // Click to expand/collapse
  inner.addEventListener('click', () => {
    inner.classList.toggle('collapsed');
  });

  msg.appendChild(inner);
  wrapper.appendChild(msg);
  group.appendChild(wrapper);

  chatContainer.appendChild(group);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function updateActionCardResult(stepNumber, resultText, isError) {
  const card = document.getElementById(`agent-action-${stepNumber}`);
  if (!card) return;

  const inner = card.querySelector('.agent-action-inner');
  if (!inner) return;

  const existing = inner.querySelector('.agent-action-result');
  if (existing) existing.remove();

  const result = document.createElement('div');
  result.className = `agent-action-result ${isError ? 'error' : 'success'}`;
  result.textContent = isError ? `Failed: ${resultText}` : resultText;
  inner.appendChild(result);

  // Update the collapsed badge
  const badge = document.getElementById(`agent-badge-${stepNumber}`);
  if (badge) {
    badge.className = `collapse-result-badge ${isError ? 'error' : 'success'}`;
    badge.innerHTML = isError
      ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
      : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  // Auto-collapse after 2 seconds (Claude-style: show then vanish)
  setTimeout(() => {
    inner.classList.add('collapsed');
  }, 2000);
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
  chrome.storage.local.get(['chat_history'], (result) => {
    if (result.chat_history && result.chat_history.length > 0) {
      conversationHistory = result.chat_history;
      chatContainer.innerHTML = '';
      conversationHistory.forEach(turn => {
        addMessage(turn.text, turn.role);
      });
      hideStatus();
    }
  });
}

function saveChatHistory() {
  chrome.storage.local.set({ chat_history: conversationHistory });
}

// ========== Message Handling ==========
function addMessage(text, role = 'assistant') {
  const welcome = chatContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  // Ensure text is always a string
  const textStr = typeof text === 'string' ? text : JSON.stringify(text);

  conversationHistory.push({ text: textStr, role });
  saveChatHistory();

  const messageGroup = document.createElement('div');
  messageGroup.className = 'message-group';
  messageGroup.dataset.messageIndex = conversationHistory.length - 1;

  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`;

  const msg = document.createElement('div');
  msg.className = `message ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;

  if (role === 'user') {
    msg.textContent = textStr;
  } else {
    try {
      msg.innerHTML = sanitizeHtml(marked.parse(textStr));
      addCodeCopyButtons(msg);
    } catch (err) {
      msg.textContent = textStr;
      console.warn('Markdown parse failed, showing raw text:', err);
    }
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'message-copy-btn';
  copyBtn.title = 'Copy message';
  copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const textToCopy = role === 'user' ? textStr : textStr;
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.classList.remove('copied');
      }, 2000);
    });
  });

  wrapper.appendChild(msg);
  wrapper.appendChild(copyBtn);
  messageGroup.appendChild(wrapper);
  chatContainer.appendChild(messageGroup);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

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
  goalInput.disabled = true;
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
  goalInput.disabled = false;
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
    chrome.storage.local.set({ chat_history: [] }, () => {
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
    previewContent.innerHTML = sanitizeHtml(marked.parse(text));
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
      const nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;
      const removeBtn = document.createElement('span');
      removeBtn.className = 'attachment-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', () => {
        selectedAttachments.splice(index, 1);
        updateAttachmentPreview();
      });
      item.appendChild(nameSpan);
      item.appendChild(removeBtn);
      attachmentPreview.appendChild(item);
    });
    attachmentPreview.style.display = 'flex';
  } else {
    attachmentPreview.style.display = 'none';
  }
}

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

  commandList.innerHTML = '';
  commands.forEach((cmd, idx) => {
    const item = document.createElement('div');
    item.className = 'command-item';
    item.dataset.index = idx;
    item.dataset.action = cmd.action;
    item.innerHTML = `
      <div class="command-icon">${cmd.icon}</div>
      <div class="command-text">
        <div class="command-name">${cmd.name}</div>
        <div class="command-desc">${cmd.desc}</div>
      </div>
    `;
    item.addEventListener('click', () => executeCommand(cmd.action));
    commandList.appendChild(item);
  });
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

// ========== HTML Sanitization ==========
function sanitizeHtml(dirtyHtml) {
  const doc = new DOMParser().parseFromString(dirtyHtml, 'text/html');
  // Remove dangerous elements and attributes
  const dangerous = doc.querySelectorAll('script, iframe, object, embed, form, link[rel="import"], base, meta');
  dangerous.forEach(el => el.remove());
  // Remove event handler attributes from all remaining elements
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

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
    removeApprovalCard();
    try {
      addMessage('✅ Task completed!\n\n' + (message.summary || 'Done'), 'assistant');
    } catch (err) {
      console.error('Error displaying completion message:', err);
    }
    resetUI();
  }
  if (message.action === 'request_approval') {
    removeTypingIndicator();
    showApprovalCard(message.payload);
  }
  if (message.action === 'agent_action') {
    removeTypingIndicator();
    addActionCard(message.payload);
  }
  if (message.action === 'agent_action_result') {
    updateActionCardResult(message.stepNumber, message.result, message.isError);
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
