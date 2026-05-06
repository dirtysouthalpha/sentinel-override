// popup-modules/chat.js
// Chat UI: goal input, message rendering, action cards, typing indicator, file attachments,
// voice input, command palette, search, export, report card/modal, background message handler.
// Depends on: ui-common.js (sanitizeHtml, isValidUrl, showToast, marked config).
// Depends on: settings.js (toggleTheme).

// ========== DOM Elements ==========
const chatContainer = document.getElementById('chat-container');
const goalInput = document.getElementById('goalInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const voiceBtn = document.getElementById('voiceBtn');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const newChatBtn = document.getElementById('newChatBtn');
const commandPaletteBtn = document.getElementById('commandPaletteBtn');
const searchInput = document.getElementById('searchInput');
const previewBtn = document.getElementById('previewBtn');
const markdownPreview = document.getElementById('markdownPreview');
const previewContent = document.getElementById('previewContent');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachmentPreview');
const exportBtn = document.getElementById('exportBtn');
const commandPalette = document.getElementById('commandPalette');
const commandPaletteBackdrop = document.getElementById('commandPaletteBackdrop');
const commandInput = document.getElementById('commandInput');
const commandList = document.getElementById('commandList');
const approvalModeToggle = document.getElementById('approvalModeToggle');
const approvalModeLabel = document.getElementById('approvalModeLabel');
const modeBadge = document.getElementById('modeBadge');
const approvalCardContainer = document.getElementById('approvalCardContainer');
const activeIndicator = document.getElementById('activeIndicator');

// ========== Report Modal Elements ==========
const reportModal = document.getElementById('report-modal');
const reportContent = document.getElementById('report-content');
const closeReportBtn = document.getElementById('closeReportBtn');
const copyReportMdBtn = document.getElementById('copyReportMdBtn');
const downloadReportBtn = document.getElementById('downloadReportBtn');
const copyReportTextBtn = document.getElementById('copyReportTextBtn');

// Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'en-US';
}

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

// ========== Claude-style Action Cards ==========
function addActionCard(payload) {
  const state = getState();
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

  // Click header only to expand/collapse (not the whole card, so log lines are selectable)
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    inner.classList.toggle('collapsed');
  });

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

  // Step log area: shows observing/consulting/executing timeline within the card
  const logArea = document.createElement('div');
  logArea.className = 'step-log';
  logArea.id = `step-log-${payload.stepNumber}`;

  inner.appendChild(header);
  inner.appendChild(desc);
  inner.appendChild(logArea);

  msg.appendChild(inner);
  wrapper.appendChild(msg);
  group.appendChild(wrapper);

  chatContainer.appendChild(group);

  // Drain any log lines that arrived before this card was created
  if (state.pendingStepLogs[payload.stepNumber]) {
    state.pendingStepLogs[payload.stepNumber].forEach(text => appendLogLine(payload.stepNumber, text));
    delete state.pendingStepLogs[payload.stepNumber];
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Append a log line to the step log area. If the card doesn't exist yet, buffer it.
function appendLogLine(stepNumber, text) {
  const state = getState();
  const logArea = document.getElementById(`step-log-${stepNumber}`);
  if (!logArea) {
    // Card not created yet -- buffer it
    if (!state.pendingStepLogs[stepNumber]) state.pendingStepLogs[stepNumber] = [];
    state.pendingStepLogs[stepNumber].push(text);
    return;
  }
  const line = document.createElement('div');
  line.className = 'step-log-line';
  // Detect error/warning state for styling
  if (text.startsWith('❌') || text.includes('Error') || text.includes('failed')) {
    line.classList.add('log-error');
  } else if (text.startsWith('⚠️') || text.includes('Retrying')) {
    line.classList.add('log-warn');
  } else if (text.startsWith('✅')) {
    line.classList.add('log-success');
  }
  line.textContent = text;
  logArea.appendChild(line);
  // Auto-scroll the chat
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

// ========== Chat History ==========
function loadChatHistory() {
  const state = getState();
  chrome.storage.local.get(['chat_history'], (result) => {
    if (result.chat_history && result.chat_history.length > 0) {
      state.conversationHistory = result.chat_history;
      chatContainer.innerHTML = '';
      state.conversationHistory.forEach(turn => {
        addMessage(turn.text, turn.role);
      });
      hideStatus();
    }
  });
}

function saveChatHistory() {
  const state = getState();
  chrome.storage.local.set({ chat_history: state.conversationHistory });
}

// ========== Message Handling ==========
function addMessage(text, role = 'assistant') {
  const state = getState();
  const welcome = chatContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  // Ensure text is always a string
  const textStr = typeof text === 'string' ? text : JSON.stringify(text);

  state.conversationHistory.push({ text: textStr, role });
  saveChatHistory();

  const messageGroup = document.createElement('div');
  messageGroup.className = 'message-group';
  messageGroup.dataset.messageIndex = state.conversationHistory.length - 1;

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
      copyBtn.textContent = 'Copy';

      copyBtn.addEventListener('click', () => {
        const text = code.textContent;
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
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
    <span>Sentinel Override is thinking...</span>
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

goalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
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
  const state = getState();
  const goal = goalInput.value.trim();
  if (!goal) return;

  addMessage(goal, 'user');
  goalInput.value = '';
  goalInput.style.height = 'auto';
  sendBtn.disabled = true;
  goalInput.disabled = true;
  stopBtn.style.display = 'flex';
  goalInput.placeholder = 'Waiting for response...';
  state.selectedAttachments = [];
  attachmentPreview.style.display = 'none';

  showTypingIndicator();
  updateStatus('Agent is starting...');
  setAgentActive(true);

  // Carry over the last goal if the new message seems like a follow-up
  let fullGoal = goal;
  chrome.storage.local.get(['last_agent_goal', 'agent_history'], (stored) => {
    const lastGoal = stored.last_agent_goal || '';
    const history = stored.agent_history || [];
    // If the message is short and looks like a follow-up (not a URL or specific instruction), prepend context
    const isFollowUp = goal.length < 50 && history.length > 0 &&
      !goal.startsWith('http') &&
      !goal.includes('go to') &&
      !goal.includes('navigate') &&
      !goal.includes('search');
    if (isFollowUp && lastGoal) {
      fullGoal = `Previous task: "${lastGoal}"
Follow-up instruction: ${goal}
The user wants you to continue or adjust the previous task. Look at the current page and respond accordingly.`;
    }
    chrome.storage.local.set({ last_agent_goal: isFollowUp ? lastGoal : goal });
    chrome.runtime.sendMessage({ action: 'run_agent_loop', goal: fullGoal }, (response) => {
      if (chrome.runtime.lastError) {
        removeTypingIndicator();
        addMessage('Error: ' + chrome.runtime.lastError.message, 'assistant');
        resetUI();
        return;
      }
      if (response && response.ok === false) {
        removeTypingIndicator();
        addMessage('Error: ' + (response.error || 'Unknown error'), 'assistant');
        resetUI();
      }
    });
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
  chrome.runtime.sendMessage({ action: 'stop_agent_loop' }, (response) => {
    removeTypingIndicator();
    if (response && response.ok === false) {
      addMessage('Error stopping agent: ' + (response.error || 'Unknown error'), 'assistant');
    } else {
      addMessage('Agent stopped by user.', 'assistant');
    }
    setAgentActive(false);
    resetUI();
    renderTabBar([]);
  });
});

// ========== Speed Controls ==========
// Speed buttons are in the UI already — wire them up to the agent engine
document.querySelectorAll('[data-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-speed');
    chrome.runtime.sendMessage({ action: 'set_agent_speed', mode }, (resp) => {
      if (resp && !resp.ok === false) {
        // Update active state on buttons
        document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });
});

// Pause/resume toggle
const pauseBtn = document.getElementById('pauseBtn');
if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    const isPaused = pauseBtn.dataset.paused === 'true';
    const action = isPaused ? 'resume_agent_loop' : 'pause_agent_loop';
    chrome.runtime.sendMessage({ action }, () => {
      pauseBtn.dataset.paused = isPaused ? 'false' : 'true';
      pauseBtn.textContent = isPaused ? '⏸ Pause' : '▶ Resume';
    });
  });
}

// ========== New Chat ==========
newChatBtn.addEventListener('click', () => {
  if (confirm('Start a new chat? This will clear the current conversation.')) {
    chrome.storage.local.set({ chat_history: [] }, () => {
      const state = getState();
      state.conversationHistory = [];
      chatContainer.innerHTML = `
        <div class="welcome-message">
          <h2>Sentinel Override</h2>
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

// ========== Message Search ==========
searchInput.addEventListener('input', (e) => {
  const state = getState();
  state.currentSearchQuery = e.target.value.toLowerCase();
  state.currentSearchIndex = 0;

  if (state.currentSearchQuery) {
    highlightSearchResults();
  } else {
    clearSearchHighlights();
  }
});

function highlightSearchResults() {
  const state = getState();
  clearSearchHighlights();

  const messages = chatContainer.querySelectorAll('.message-group');
  let matchCount = 0;

  messages.forEach(group => {
    const text = group.textContent.toLowerCase();
    if (text.includes(state.currentSearchQuery)) {
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
  const state = getState();
  state.selectedAttachments = Array.from(e.target.files);
  updateAttachmentPreview();
});

function updateAttachmentPreview() {
  const state = getState();
  if (state.selectedAttachments.length > 0) {
    attachmentPreview.innerHTML = '<span>Attachments:</span>';
    state.selectedAttachments.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;
      const removeBtn = document.createElement('span');
      removeBtn.className = 'attachment-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        state.selectedAttachments.splice(index, 1);
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
  const state = getState();
  if (state.conversationHistory.length === 0) {
    showToast('No messages to export', 'error');
    return;
  }

  const format = exportFormatSelect.value;
  let content, filename, mimeType;

  if (format === 'markdown') {
    content = state.conversationHistory
      .map(turn => `### ${turn.role === 'user' ? 'You' : 'Agent'}\n\n${turn.text}`)
      .join('\n\n---\n\n');
    filename = `conversation-${Date.now()}.md`;
    mimeType = 'text/markdown';
  } else if (format === 'json') {
    content = JSON.stringify(state.conversationHistory, null, 2);
    filename = `conversation-${Date.now()}.json`;
    mimeType = 'application/json';
  } else {
    content = state.conversationHistory
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
commandPaletteBackdrop.addEventListener('click', closeCommandPalette);

function openCommandPalette() {
  commandPalette.classList.add('show');
  commandPaletteBackdrop.classList.add('show');
  commandInput.focus();
  renderCommandList([]);
}

function closeCommandPalette() {
  commandPalette.classList.remove('show');
  commandPaletteBackdrop.classList.remove('show');
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
  { name: 'New Chat', desc: 'Start a new conversation', action: 'new-chat', icon: 'edit' },
  { name: 'Export Conversation', desc: 'Download chat history', action: 'export', icon: 'save' },
  { name: 'Clear Search', desc: 'Clear search results', action: 'clear-search', icon: 'search' },
  { name: 'Toggle Dark Mode', desc: 'Switch theme', action: 'toggle-dark', icon: 'moon' },
  { name: 'Open Settings', desc: 'Configure API and preferences', action: 'settings', icon: 'settings' },
  { name: 'Customize Theme', desc: 'Customize colors', action: 'theme', icon: 'palette' },
  { name: 'About', desc: 'About Sentinel Override', action: 'about', icon: 'info' },
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

window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;

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
      showToast('Sentinel Override v2.0 - AI-powered browser automation', 'success');
      break;
  }
};

// ========== Agent Tab Bar ==========
function renderTabBar(tabs) {
  const tabBar = document.getElementById('agent-tab-bar');
  if (!tabBar) return;
  if (!tabs || tabs.length === 0) {
    tabBar.style.display = 'none';
    return;
  }
  tabBar.style.display = 'block';
  tabBar.innerHTML = '';
  tabs.forEach(ctx => {
    const tab = document.createElement('div');
    tab.className = 'agent-tab-item' + (ctx.isActive ? ' active' : '');
    // Show hostname and label
    let hostname = '';
    try { hostname = new URL(ctx.url).hostname.replace(/^www\./, ''); } catch (e) {}
    const displayText = ctx.label ? `${ctx.label} (${hostname})` : hostname || ctx.url;
    tab.textContent = displayText;
    tab.title = ctx.url;
    tab.addEventListener('click', () => {
      // User observation: switch their VIEW but do NOT change agent's active tab
      if (ctx.tabId) {
        chrome.tabs.update(ctx.tabId, { active: true });
      }
    });
    tabBar.appendChild(tab);
  });
}

// ========== Report Card & Modal ==========

/**
 * Adds a "Generating report..." indicator in the chat feed.
 */
function addReportGeneratingIndicator() {
  // Remove existing indicator if any
  removeReportGeneratingIndicator();

  const group = document.createElement('div');
  group.className = 'message-group report-group';
  group.id = 'report-generating';

  const indicator = document.createElement('div');
  indicator.className = 'report-generating-indicator';
  indicator.innerHTML = '<span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span><span>Generating report...</span>';

  group.appendChild(indicator);
  chatContainer.appendChild(group);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Removes the generating indicator from the chat feed.
 */
function removeReportGeneratingIndicator() {
  const existing = document.getElementById('report-generating');
  if (existing) existing.remove();
}

/**
 * Adds an inline report card to the chat feed with summary preview
 * and a "View Full Report" button.
 *
 * @param {object} report - Report object with summary, fullReport, goal, timestamp
 */
function addReportCard(report) {
  const state = getState();
  state.currentReport = report;

  const welcome = chatContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const group = document.createElement('div');
  group.className = 'message-group report-group';

  const header = document.createElement('div');
  header.className = 'report-card-header';

  const title = document.createElement('div');
  title.className = 'report-card-title';
  title.textContent = 'Investigation Report';

  const time = document.createElement('div');
  time.className = 'report-card-time';
  try {
    time.textContent = new Date(report.timestamp).toLocaleTimeString();
  } catch (e) {
    time.textContent = '';
  }

  header.appendChild(title);
  header.appendChild(time);

  const summary = document.createElement('div');
  summary.className = 'report-card-summary';
  summary.textContent = report.summary || 'Report generated.';

  const actions = document.createElement('div');
  actions.className = 'report-card-actions';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'report-view-btn';
  viewBtn.textContent = 'View Full Report';
  viewBtn.addEventListener('click', () => {
    openReportModal(report.fullReport);
  });

  const exportBtn = document.createElement('button');
  exportBtn.className = 'report-view-btn';
  exportBtn.textContent = 'Export .md';
  exportBtn.addEventListener('click', () => {
    if (window.exportReportFile) window.exportReportFile(report);
  });

  actions.appendChild(viewBtn);
  actions.appendChild(exportBtn);

  group.appendChild(header);
  group.appendChild(summary);
  group.appendChild(actions);
  chatContainer.appendChild(group);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Opens the report modal with the full report rendered as markdown.
 *
 * @param {string} markdown - The full report markdown
 */
function openReportModal(markdown) {
  const state = getState();
  state.currentReportMarkdown = markdown;

  // Close other modals
  settingsModal.classList.remove('show');
  themeModal.classList.remove('show');

  // Render markdown with sanitization
  try {
    reportContent.innerHTML = sanitizeHtml(marked.parse(markdown));
    addCodeCopyButtons(reportContent);
  } catch (err) {
    reportContent.textContent = markdown;
  }

  reportModal.classList.add('show');
}

/**
 * Closes the report modal.
 */
function closeReportModal() {
  reportModal.classList.remove('show');
}

// Report modal close button
closeReportBtn.addEventListener('click', closeReportModal);

// Close report modal on backdrop click
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) {
    closeReportModal();
  }
});

// Export: Copy as Markdown
copyReportMdBtn.addEventListener('click', () => {
  const state = getState();
  if (!state.currentReportMarkdown) {
    showToast('No report to copy', 'error');
    return;
  }
  navigator.clipboard.writeText(state.currentReportMarkdown).then(() => {
    showToast('Markdown copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
});

// Export: Download as .md (with YAML frontmatter via collaboration module)
downloadReportBtn.addEventListener('click', () => {
  const state = getState();
  if (!state.currentReportMarkdown) {
    showToast('No report to download', 'error');
    return;
  }
  if (window.exportReportFile && state.currentReport) {
    window.exportReportFile(state.currentReport);
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `report-${timestamp}.md`;
    const blob = new Blob([state.currentReportMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report downloaded', 'success');
  }
});

// Export: Copy as Plain Text
copyReportTextBtn.addEventListener('click', () => {
  const state = getState();
  if (!state.currentReportMarkdown) {
    showToast('No report to copy', 'error');
    return;
  }
  // Strip markdown formatting for plain text
  const plainText = state.currentReportMarkdown
    .replace(/^#{1,6}\s+/gm, '')      // Remove headers
    .replace(/\*\*(.+?)\*\*/g, '$1')   // Remove bold
    .replace(/\*(.+?)\*/g, '$1')       // Remove italic
    .replace(/`(.+?)`/g, '$1')         // Remove inline code
    .replace(/^- /gm, '')              // Remove unordered list markers
    .replace(/^\d+\.\s/gm, '')         // Remove ordered list markers
    .replace(/^---+$/gm, '')           // Remove horizontal rules
    .replace(/>\s+/gm, '')             // Remove blockquote markers
    .replace(/\n{3,}/g, '\n\n')        // Collapse multiple newlines
    .trim();
  navigator.clipboard.writeText(plainText).then(() => {
    showToast('Plain text copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
});

// ========== Background Message Handler ==========
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'agent_update') {
    // Route to the step card's log area. Step 0 = pre-loop messages (planning, startup).
    if (message.stepNumber && message.stepNumber > 0) {
      appendLogLine(message.stepNumber, message.text);
    } else {
      // Pre-loop status (planning phase etc) -- show in the status bar
      updateStatus(message.text);
    }
  }
  if (message.action === 'page_context') {
    // Show current page URL in the status bar so user can track where the agent is
    if (message.url) {
      try {
        const hostname = new URL(message.url).hostname;
        updateStatus(`On: ${hostname}${message.title ? ' — ' + message.title.substring(0, 50) : ''}`);
      } catch (e) {
        updateStatus('On: ' + message.url.substring(0, 60));
      }
    }
  }
  if (message.action === 'agent_finished') {
    removeTypingIndicator();
    removeApprovalCard();
    renderTabBar([]);
    try {
      const summary = message.summary || 'Done';
      // If summary already has substantial content, don't prefix with "Task completed"
      const prefix = summary.length > 100 ? '' : '✅ Task completed\n\n';
      addMessage(prefix + summary, 'assistant');
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
  if (message.action === 'tab_state_update' && message.tabs) {
    renderTabBar(message.tabs);
  }
  if (message.action === 'report_update') {
    if (message.status === 'generating') {
      addReportGeneratingIndicator();
    } else if (message.status === 'ready' && message.report) {
      removeReportGeneratingIndicator();
      addReportCard(message.report);
    } else if (message.status === 'error') {
      removeReportGeneratingIndicator();
      showToast('Report generation failed: ' + (message.error || 'Unknown error'), 'error');
    }
  }
});
