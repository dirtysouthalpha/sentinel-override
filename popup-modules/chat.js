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


// ========== Tenant Chip (3.7.0) ==========
function renderTenantChip(tenant, expected) {
  const chip = document.getElementById('tenantChip');
  if (!chip) return;
  if (!tenant || (!tenant.tid && !tenant.onmicrosoft && !tenant.chipText)) {
    chip.style.display = 'none';
    chip.classList.remove('match', 'mismatch');
    chip.textContent = '';
    chip.removeAttribute('title');
    return;
  }
  // Display priority: chipText > onmicrosoft > tid (truncated)
  const display = tenant.chipText || tenant.onmicrosoft || (tenant.tid ? ('tid:' + String(tenant.tid).slice(0, 8) + '…') : 'tenant');
  chip.textContent = display;
  chip.style.display = 'inline-flex';

  // Match logic — case-insensitive substring match against any signal.
  if (expected && typeof expected === 'string' && expected.trim()) {
    const expLow = expected.trim().toLowerCase();
    const signals = [
      tenant.chipText || '',
      tenant.onmicrosoft || '',
      tenant.tid || ''
    ].map(s => String(s).toLowerCase());
    const matches = signals.some(s => s && (s.includes(expLow) || expLow.includes(s)));
    chip.classList.toggle('match', matches);
    chip.classList.toggle('mismatch', !matches);
    chip.title = matches
      ? 'Tenant matches expected (' + expected + ')'
      : 'Tenant MISMATCH — expected "' + expected + '", saw "' + display + '"';
  } else {
    chip.classList.remove('match', 'mismatch');
    chip.title = 'Detected tenant: ' + display + ' (set expected tenant in Settings to enable match check)';
  }
}

// ========== Active Tab Strip (3.7.1) ==========
// Surfaces what tab the agent is on, what step it's on, and what it's doing
// right now — so users watching the side-panel popup can see WHERE and WHAT
// without having to flip to the page tab.

let __atsStripState = {
  visible: false,
  url: '',
  title: '',
  hostname: '',
  tabId: null,
  stepNumber: 0,
  totalSteps: null,
  lastAction: ''
};

function showActiveTabStrip() {
  const strip = document.getElementById('active-tab-strip');
  if (!strip) return;
  strip.style.display = 'flex';
  __atsStripState.visible = true;
}

function hideActiveTabStrip() {
  const strip = document.getElementById('active-tab-strip');
  if (!strip) return;
  strip.style.display = 'none';
  __atsStripState.visible = false;
  __atsStripState.lastAction = '';
}

function updateActiveTabPage(url, title) {
  if (!url) return;
  let host = url;
  try { host = new URL(url).hostname; } catch (e) {}
  __atsStripState.url = url;
  __atsStripState.title = title || '';
  __atsStripState.hostname = host;

  const elHost = document.getElementById('ats-host');
  const elTitle = document.getElementById('ats-title');
  const elFav = document.getElementById('ats-favicon');
  if (elHost) elHost.textContent = host;
  if (elTitle) elTitle.textContent = title || '';
  if (elFav) {
    // Use Google's favicon service as a stable, no-CORS path. Fallback to a
    // tiny blank if we can't compute a clean URL.
    try {
      elFav.src = 'https://www.google.com/s2/favicons?sz=32&domain_url=' + encodeURIComponent(host);
    } catch (e) { elFav.src = ''; }
  }
  showActiveTabStrip();
}

function updateActiveTabStep(stepNumber, totalSteps) {
  __atsStripState.stepNumber = stepNumber || 0;
  if (typeof totalSteps === 'number') __atsStripState.totalSteps = totalSteps;
  const elStep = document.getElementById('ats-step');
  if (!elStep) return;
  if (__atsStripState.totalSteps) {
    elStep.textContent = 'STEP ' + __atsStripState.stepNumber + '/' + __atsStripState.totalSteps;
  } else if (__atsStripState.stepNumber > 0) {
    elStep.textContent = 'STEP ' + __atsStripState.stepNumber;
  } else {
    elStep.textContent = '';
  }
}

// Convert an agent_action payload into a plain-English live status string.
function describeActionPlain(payload) {
  if (!payload) return '';
  const t = payload.type;
  const desc = payload.description || '';
  switch (t) {
    case 'click':       return 'Clicking ' + (payload.targetText ? '"' + (payload.targetText.length > 50 ? payload.targetText.slice(0, 50) + '…' : payload.targetText) + '"' : (desc || payload.selector || 'element'));
    case 'click_at':    return 'Clicking at coordinates' + (payload.x !== undefined ? ' (' + Math.round(payload.x) + ',' + Math.round(payload.y) + ')' : '');
    case 'type': {
      const text = payload.text || payload.value || '';
      const safe = (payload.sensitive ? '[sensitive — blocked]' : (text.length > 60 ? text.slice(0, 60) + '…' : text));
      const target = payload.targetText
        ? '"' + (payload.targetText.length > 40 ? payload.targetText.slice(0, 40) + '…' : payload.targetText) + '"'
        : (desc || '');
      return 'Typing "' + safe + '"' + (target ? ' into ' + target : '');
    }
    case 'navigate':    return 'Navigating to ' + (payload.url || desc || '');
    case 'scroll':      return 'Scrolling ' + (payload.amount > 0 ? 'down' : 'up');
    case 'select':      return 'Selecting "' + (payload.value || '') + '"' + (payload.targetText ? ' in "' + payload.targetText + '"' : (desc ? ' in ' + desc : ''));
    case 'check':       return (payload.checked ? 'Checking ' : 'Unchecking ') + (payload.targetText ? '"' + payload.targetText + '"' : (desc || payload.selector || 'element'));
    case 'hover':       return 'Hovering over ' + (payload.targetText ? '"' + payload.targetText + '"' : (desc || payload.selector || 'element'));
    case 'press_key':   return 'Pressing ' + (payload.key || 'key');
    case 'execute_js':  return 'Running JavaScript' + (payload.key ? ' → memory["' + payload.key + '"]' : '');
    case 'extract':     return 'Extracting ' + (payload.attribute || 'text') + ' from ' + (desc || payload.selector || 'element');
    case 'extract_list':return 'Extracting list of items' + (payload.fields ? ' (' + Object.keys(payload.fields).join(', ') + ')' : '');
    case 'read_page':   return 'Reading page content';
    case 'read_console_messages': return 'Reading console messages';
    case 'read_network_requests': return 'Reading network requests';
    case 'wait_for_text':    return 'Waiting for text "' + (payload.text || '') + '"';
    case 'wait_for_element': return 'Waiting for element ' + (payload.selector || payload.ref || '');
    case 'wait_for_navigation': return 'Waiting for navigation';
    case 'open_tab':    return 'Opening new tab' + (payload.label ? ' "' + payload.label + '"' : '');
    case 'switch_tab':  return 'Switching to tab ' + (payload.label || '');
    case 'close_tab':   return 'Closing tab ' + (payload.label || '');
    case 'note':        return 'Recording note';
    case 'finish':      return 'Finishing task';
    case 'scroll_to':   return 'Scrolling to ' + (desc || payload.ref || payload.selector || '');
    case 'dismiss_overlay': return 'Dismissing overlay';
    case 'open_dropdown': return 'Opening dropdown';
    case 'switch_to_frame': return 'Switching to iframe ' + (payload.frame_index || 0);
    default: return t + (desc ? ': ' + desc : '');
  }
}

function updateActiveTabAction(payload) {
  const elAction = document.getElementById('ats-action');
  if (!elAction) return;
  const text = describeActionPlain(payload);
  __atsStripState.lastAction = text;
  elAction.textContent = text;
  // Color-code by action family
  elAction.classList.remove('is-clicking', 'is-typing', 'is-blocked');
  if (payload && (payload.type === 'click' || payload.type === 'click_at')) {
    elAction.classList.add('is-clicking');
  } else if (payload && payload.type === 'type') {
    elAction.classList.add('is-typing');
  }
}

// Wire the Focus button — opens the agent's working tab in Chrome and brings
// it to the front so the user can watch cursor + highlights live alongside.
// (3.8.1) Robust: if no tabId was captured yet, fall back to URL/hostname
// queries so the button always works.
(function wireAtsFocusButton() {
  const btn = document.getElementById('ats-focus-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    let tabId = __atsStripState.tabId;
    // Fallback 1: query by exact URL
    if (!tabId && __atsStripState.url) {
      try {
        const tabs = await chrome.tabs.query({ url: __atsStripState.url });
        if (tabs && tabs.length > 0) tabId = tabs[0].id;
      } catch (e) {}
    }
    // Fallback 2: query by hostname pattern
    if (!tabId && __atsStripState.hostname) {
      try {
        const pattern = '*://*.' + __atsStripState.hostname.replace(/^www\./, '') + '/*';
        const tabs = await chrome.tabs.query({ url: pattern });
        if (tabs && tabs.length > 0) tabId = tabs[0].id;
      } catch (e) {}
    }
    // Fallback 3: bare hostname in URL string match across all tabs
    if (!tabId && __atsStripState.hostname) {
      try {
        const all = await chrome.tabs.query({});
        const match = (all || []).find(t => t.url && t.url.includes(__atsStripState.hostname));
        if (match) tabId = match.id;
      } catch (e) {}
    }
    if (!tabId) {
      try { showToast('Could not find the agent\'s tab to focus', 'error'); } catch (e) {}
      return;
    }
    try { await chrome.tabs.update(tabId, { active: true }); } catch (e) {}
    try {
      chrome.tabs.get(tabId, (info) => {
        if (info && typeof info.windowId === 'number') {
          try { chrome.windows.update(info.windowId, { focused: true }); } catch (e) {}
        }
      });
    } catch (e) {}
  });
})();

// ========== Mini Screenshot Panel (3.7.1) ==========
// Collapsible thumbnail of the most recent observation. Shows the user
// exactly what the agent is "seeing" without leaving the popup.

let __miniShotPanelEl = null;
let __miniShotCollapsed = false;

function ensureMiniShotPanel() {
  if (__miniShotPanelEl) return __miniShotPanelEl;
  const wrap = document.createElement('div');
  wrap.className = 'mini-shot-panel';
  wrap.innerHTML = `
    <div class="mini-shot-header">
      <span>Agent's view (latest)</span>
      <span class="mini-shot-toggle">▾ HIDE</span>
    </div>
    <div class="mini-shot-img-wrap"><img id="mini-shot-img" alt=""></div>
  `;
  // Insert below the active-tab strip, before the chat container.
  const strip = document.getElementById('active-tab-strip');
  if (strip && strip.parentNode) {
    strip.parentNode.insertBefore(wrap, strip.nextSibling);
  } else {
    document.body.insertBefore(wrap, document.body.firstChild);
  }
  // Toggle collapse on header click
  wrap.querySelector('.mini-shot-header').addEventListener('click', () => {
    __miniShotCollapsed = !__miniShotCollapsed;
    wrap.classList.toggle('collapsed', __miniShotCollapsed);
    const tog = wrap.querySelector('.mini-shot-toggle');
    if (tog) tog.textContent = __miniShotCollapsed ? '▸ SHOW' : '▾ HIDE';
  });
  __miniShotPanelEl = wrap;
  return wrap;
}

function updateMiniShot(base64Image) {
  if (!base64Image) return;
  const panel = ensureMiniShotPanel();
  const img = panel.querySelector('#mini-shot-img');
  if (img) img.src = 'data:image/jpeg;base64,' + base64Image;
}

function hideMiniShot() {
  if (__miniShotPanelEl) __miniShotPanelEl.style.display = 'none';
}
function showMiniShot() {
  if (__miniShotPanelEl) __miniShotPanelEl.style.display = '';
}

// ========== Approval Mode ==========
// On first run (when `approvalMode` has never been written), default to ON
// for safety. Users must explicitly opt out via a confirmation dialog.
function loadApprovalMode() {
  chrome.storage.local.get(['approvalMode'], (result) => {
    let isApprovalMode;
    if (typeof result.approvalMode === 'undefined' || result.approvalMode === null) {
      // First run -- default to ON and persist so subsequent reads are deterministic.
      isApprovalMode = true;
      chrome.storage.local.set({ approvalMode: true });
    } else {
      isApprovalMode = result.approvalMode === true;
    }
    approvalModeToggle.checked = isApprovalMode;
    updateApprovalModeUI(isApprovalMode);

    // Optional first-run safety banner (#5 from the task list)
    maybeShowSafetyBanner();
  });
}

function setupApprovalModeToggle() {
  approvalModeToggle.addEventListener('change', () => {
    const isApprovalMode = approvalModeToggle.checked;

    // Disabling approvals is the dangerous direction -- confirm first.
    if (!isApprovalMode) {
      const ok = window.confirm(
        'Disabling approvals lets the agent submit forms, click buy/send, and run JavaScript without asking. Continue?\n\n' +
        'OK = I understand the risks (continue without approvals)\n' +
        'Cancel = Keep approvals on (recommended)'
      );
      if (!ok) {
        // Revert the toggle; do NOT persist.
        approvalModeToggle.checked = true;
        updateApprovalModeUI(true);
        return;
      }
      // User accepted the risk: persist OFF + acknowledgement flag.
      chrome.storage.local.set({
        approvalMode: false,
        approvalModeAcknowledged: true
      });
      updateApprovalModeUI(false);
      return;
    }

    // Re-enabling approvals is always safe; persist immediately.
    chrome.storage.local.set({ approvalMode: true });
    updateApprovalModeUI(true);
  });
}

function updateApprovalModeUI(isApprovalMode) {
  if (isApprovalMode) {
    approvalModeLabel.textContent = 'APPROVAL REQUIRED (recommended)';
    modeBadge.textContent = 'APPROVAL';
    modeBadge.className = 'mode-badge approval';
  } else {
    approvalModeLabel.textContent = 'AUTONOMOUS (caution)';
    modeBadge.textContent = 'AUTONOMOUS';
    modeBadge.className = 'mode-badge yolo';
  }
}

// ========== First-run Safety Banner ==========
function maybeShowSafetyBanner() {
  chrome.storage.local.get(['seenSafetyBanner'], (result) => {
    if (result.seenSafetyBanner) return;

    const welcome = chatContainer.querySelector('.welcome-message');
    const banner = document.createElement('div');
    banner.className = 'safety-banner';
    banner.id = 'safety-banner';
    banner.innerHTML = `
      <div class="safety-banner-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L3 7v6c0 5 3.5 9.5 9 11 5.5-1.5 9-6 9-11V7l-9-5z"></path>
        </svg>
        <span>Before you start</span>
      </div>
      <ul class="safety-banner-list">
        <li>The agent runs with your full browser session privileges (cookies, logged-in sites).</li>
        <li>Approval mode is <strong>on by default</strong>. You will be asked before risky actions.</li>
        <li>Sensitive fields (passwords, SSN, credit cards) are blocked at the content-script level.</li>
        <li>See the README for the complete safety model.</li>
      </ul>
      <div class="safety-banner-actions">
        <button class="safety-banner-dismiss" id="dismissSafetyBanner">Got it</button>
      </div>
    `;

    // Insert above the welcome message if present, otherwise at the top of the chat.
    if (welcome) {
      chatContainer.insertBefore(banner, welcome);
    } else {
      chatContainer.insertBefore(banner, chatContainer.firstChild);
    }

    document.getElementById('dismissSafetyBanner').addEventListener('click', () => {
      chrome.storage.local.set({ seenSafetyBanner: true });
      banner.remove();
    });
  });
}

// Words that indicate a high-risk action — used to highlight the approval card.
const RISKY_ACTION_PATTERN = /\b(submit|buy|send|transfer|wire|delete|publish|purchase|checkout|post|confirm|accept terms)\b/i;

function showApprovalCard(payload) {
  removeApprovalCard();

  const description = (payload && typeof payload.description === 'string') ? payload.description : '';
  const stepNumber = (payload && payload.stepNumber) || '?';
  const requestId = payload && payload.requestId;
  const actionType = payload && payload.type;
  // Code body for execute_js / run_js -style actions. Several historical field
  // names are tolerated so this card stays compatible regardless of which one
  // the background sends.
  const code = payload && (payload.code || payload.script || payload.js);
  const isCode = (actionType === 'execute_js' || actionType === 'run_js' || !!code);
  const isRisky = RISKY_ACTION_PATTERN.test(description);

  const card = document.createElement('div');
  card.className = 'approval-card';
  card.id = 'approval-card';
  if (requestId) card.dataset.requestId = requestId;
  card.dataset.description = description;

  // Build the action body separately so we can choose between the scrollable
  // text view and the monospace code view.
  let bodyHtml;
  if (isCode) {
    const codeText = code || description;
    bodyHtml = `
      <div class="approval-card-code-label">JavaScript code (will run with full page privileges)</div>
      <div class="approval-card-action approval-card-code${isRisky ? ' risky' : ''}">${escapeHtml(codeText)}</div>
    `;
  } else {
    bodyHtml = `<div class="approval-card-action${isRisky ? ' risky' : ''}">${escapeHtml(description)}</div>`;
  }

  card.innerHTML = `
    <div class="approval-card-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>Agent requests approval${isRisky ? ' — risky' : ''}</span>
    </div>
    <div class="approval-card-step">Step #${escapeHtml(String(stepNumber))}${actionType ? ' &middot; ' + escapeHtml(String(actionType)) : ''}</div>
    ${bodyHtml}
    <div class="approval-card-buttons">
      <button class="approval-btn approve" id="approvalApprove">Approve</button>
      <button class="approval-btn reject" id="approvalReject">Reject</button>
      <button class="approval-btn skip" id="approvalSkip">Skip</button>
    </div>
  `;

  approvalCardContainer.appendChild(card);

  // Scroll to show the card
  approvalCardContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Wire up buttons. Capture description + requestId so the response handler
  // and the skip/reject system note can reference them.
  document.getElementById('approvalApprove').addEventListener('click', () => respondApproval('approved', { requestId, description }));
  document.getElementById('approvalReject').addEventListener('click', () => respondApproval('rejected', { requestId, description }));
  document.getElementById('approvalSkip').addEventListener('click', () => respondApproval('skipped', { requestId, description }));
}

function removeApprovalCard() {
  const card = document.getElementById('approval-card');
  if (card) card.remove();
}

function respondApproval(decision, context) {
  const ctx = context || {};
  removeApprovalCard();

  const message = {
    action: 'approval_response',
    approved: decision === 'approved',
    skipped: decision === 'skipped',
    rejected: decision === 'rejected'
  };
  // Mirror the requestId back so the background can match the response to the
  // pending request (per the contract with Agent A).
  if (ctx.requestId) message.requestId = ctx.requestId;

  chrome.runtime.sendMessage(message).catch(() => {});

  // Show a UX-only system note for skip/reject so the user can see the
  // rejection in the chat history. The actual injection into the LLM history
  // is handled server-side.
  if (decision === 'rejected' || decision === 'skipped') {
    appendSkipRejectionNote(decision, ctx.description);
  }
}

function appendSkipRejectionNote(decision, description) {
  const desc = (description && description.trim()) ? description.trim() : '(no description)';
  const verb = decision === 'rejected' ? 'rejected' : 'skipped';

  const wrapper = document.createElement('div');
  wrapper.className = 'message-group skip-note-group';

  const note = document.createElement('div');
  note.className = 'skip-note';
  note.textContent = `User ${verb}: ${desc}. Agent should choose an alternative path.`;

  wrapper.appendChild(note);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
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

// ========== MFA Pause Banner (3.7.0) ==========
function showMfaBanner(url, hint, stepNumber) {
  // Remove any existing MFA banner first so we don't stack them.
  const existing = document.getElementById('mfa-banner');
  if (existing) existing.remove();

  let host = '';
  try { host = new URL(url || '').hostname; } catch (e) { host = url || 'the page'; }

  const banner = document.createElement('div');
  banner.id = 'mfa-banner';
  banner.className = 'safety-banner';
  banner.style.borderColor = 'var(--accent-primary, #ff6b00)';
  banner.style.background = 'linear-gradient(180deg, rgba(255,107,0,0.08) 0%, transparent 100%)';
  banner.innerHTML = `
    <div class="safety-banner-header" style="color: var(--accent-primary, #ff6b00);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>MFA challenge — agent paused</span>
    </div>
    <div style="font-size: 12px; line-height: 1.5; margin: 6px 0 8px 22px;">
      Detected on <strong>${escapeHtml(host)}</strong>${hint ? ` (${escapeHtml(String(hint).substring(0, 60))})` : ''}.
      Approve the prompt or enter the code on the page, then click Resume.
    </div>
    <div class="safety-banner-actions" style="margin-left: 22px;">
      <button class="safety-banner-dismiss" id="mfaResumeBtn" style="background: var(--accent-primary, #ff6b00); color: white; border-color: var(--accent-primary, #ff6b00);">Resume</button>
      <button class="safety-banner-dismiss" id="mfaDismissBtn" style="margin-left: 6px;">Dismiss</button>
    </div>
  `;

  chatContainer.appendChild(banner);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  document.getElementById('mfaResumeBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'resume_agent_loop' }).catch(() => {});
    banner.remove();
  });
  document.getElementById('mfaDismissBtn').addEventListener('click', () => {
    banner.remove();
  });
}

// ========== Download Capture (3.9.0) ==========
function showDownloadCaptured(dl) {
  if (!dl) return;
  const filename = (dl.filename || '').split(/[\\/]/).pop() || 'file';
  const wrapper = document.createElement('div');
  wrapper.className = 'message-group';
  wrapper.innerHTML = `
    <div class="skip-note" style="border-left: 3px solid #2EA043; background: rgba(46,160,67,0.10); padding: 8px 12px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2EA043" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <strong style="color:#2EA043;">File downloaded</strong>
      </div>
      <div style="font-size:12px; margin-top:4px;">${escapeHtml(filename)}</div>
      <div style="font-size:10px; color:var(--text-secondary,#999); margin-top:2px; word-break:break-all;">${escapeHtml(dl.filename || '')}</div>
    </div>
  `;
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ========== Run Log Export (3.9.0) ==========
let __lastRunLogId = null;
function showRunLogExportButton(runLogId, entryCount) {
  __lastRunLogId = runLogId;
  // Remove any prior export banner
  const existing = document.getElementById('run-log-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'run-log-banner';
  banner.className = 'safety-banner';
  banner.style.borderColor = 'var(--accent-primary, #ff6b00)';
  banner.innerHTML = `
    <div class="safety-banner-header" style="color: var(--accent-primary, #ff6b00);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
      <span>Forensic run log available</span>
    </div>
    <div style="font-size: 12px; margin: 6px 0 8px 22px;">
      ${entryCount} structured log entries captured for this run. Export as JSON or CSV for the ticket.
    </div>
    <div class="safety-banner-actions" style="margin-left: 22px;">
      <button class="safety-banner-dismiss" id="exportRunLogJsonBtn" style="background: var(--accent-primary, #ff6b00); color: white; border-color: var(--accent-primary, #ff6b00);">Export JSON</button>
      <button class="safety-banner-dismiss" id="exportRunLogCsvBtn" style="margin-left: 6px;">Export CSV</button>
      <button class="safety-banner-dismiss" id="dismissRunLogBtn" style="margin-left: 6px;">Dismiss</button>
    </div>
  `;
  chatContainer.appendChild(banner);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  document.getElementById('exportRunLogJsonBtn').addEventListener('click', () => exportRunLog('json'));
  document.getElementById('exportRunLogCsvBtn').addEventListener('click', () => exportRunLog('csv'));
  document.getElementById('dismissRunLogBtn').addEventListener('click', () => banner.remove());
}

async function exportRunLog(format) {
  if (!__lastRunLogId) return;
  try {
    const stored = await chrome.storage.local.get('run_log_' + __lastRunLogId);
    const log = stored['run_log_' + __lastRunLogId];
    if (!log) {
      try { showToast('Run log not found in storage', 'error'); } catch (e) {}
      return;
    }
    let content, mime, ext;
    if (format === 'csv') {
      const headers = ['step', 'timestamp', 'kind', 'url', 'tenant', 'action_type', 'selector_or_ref', 'text_preview', 'result', 'failed'];
      const escape = (v) => {
        if (v === undefined || v === null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n\r]/.test(s) ? '"' + s + '"' : s;
      };
      const rows = log.entries.map(e => [
        e.step, e.timestamp, e.kind, e.url || '', e.tenant || '',
        e.action_type || '',
        (e.action && (e.action.ref || e.action.selector)) || '',
        (e.action && e.action.text) ? String(e.action.text).slice(0, 100) : '',
        e.result || (e.summary_preview || ''),
        e.failed === true ? 'true' : (e.failed === false ? 'false' : '')
      ].map(escape).join(','));
      content = headers.join(',') + '\n' + rows.join('\n');
      mime = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(log, null, 2);
      mime = 'application/json';
      ext = 'json';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sentinel_run_log_' + __lastRunLogId.slice(0, 8) + '.' + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    try { showToast('Export failed: ' + e.message, 'error'); } catch (ee) {}
  }
}

// ========== Resume Banner (3.9.0) ==========
async function checkResumeOnLoad() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'check_resume_available' });
    const data = (resp && resp.data) ? resp.data : resp;
    if (!data || !data.available) return;
    showResumeBanner(data.goal, data.stepCount, data.ageSeconds);
  } catch (e) { /* non-fatal */ }
}

function showResumeBanner(goal, stepCount, ageSeconds) {
  const banner = document.createElement('div');
  banner.id = 'resume-banner';
  banner.className = 'safety-banner';
  banner.style.borderColor = 'var(--accent-primary, #ff6b00)';
  const ageText = ageSeconds < 60 ? ageSeconds + 's ago' : Math.floor(ageSeconds / 60) + 'm ago';
  const preview = (goal || '').slice(0, 200) + ((goal || '').length > 200 ? '…' : '');
  banner.innerHTML = `
    <div class="safety-banner-header" style="color: var(--accent-primary, #ff6b00);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
      <span>Resume previous run?</span>
    </div>
    <div style="font-size: 12px; margin: 6px 0 6px 22px; opacity: 0.85;">
      Last run reached step ${stepCount} (${ageText}). Goal preview:
    </div>
    <div style="font-size: 11px; margin: 0 0 8px 22px; padding: 6px 8px; background: rgba(0,0,0,0.18); border-radius: 4px; font-family: 'Inter', sans-serif; line-height: 1.4;">
      ${escapeHtml(preview)}
    </div>
    <div class="safety-banner-actions" style="margin-left: 22px;">
      <button class="safety-banner-dismiss" id="resumeRunBtn" style="background: var(--accent-primary, #ff6b00); color: white; border-color: var(--accent-primary, #ff6b00);">Resume</button>
      <button class="safety-banner-dismiss" id="dismissResumeBtn" style="margin-left: 6px;">Dismiss</button>
    </div>
  `;
  chatContainer.insertBefore(banner, chatContainer.firstChild);

  document.getElementById('resumeRunBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'resume_from_checkpoint' }).catch(() => {});
    banner.remove();
  });
  document.getElementById('dismissResumeBtn').addEventListener('click', () => banner.remove());
}

// Run resume check on load (after DOM is ready).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkResumeOnLoad);
} else {
  checkResumeOnLoad();
}

// ========== Source Tag Chips (3.10.0) ==========
// Convert inline [src:memory_key] markers in agent finish summaries into
// clickable chips that expand the underlying memory entry inline. Builds
// auditability: every specific claim becomes traceable to extracted data.

function renderSourceChipsIn(rootEl) {
  if (!rootEl) return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const texts = [];
  let n; while ((n = walker.nextNode())) texts.push(n);
  const re = /\[src:([a-z0-9_\-]+)\]|\[unverified\]/gi;
  for (const tn of texts) {
    if (!re.test(tn.textContent)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0; let m;
    while ((m = re.exec(tn.textContent)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(tn.textContent.slice(last, m.index)));
      const chip = document.createElement('span');
      chip.className = 'sentinel-src-chip';
      const isUnverified = m[0].toLowerCase() === '[unverified]';
      const key = isUnverified ? null : m[1];
      chip.textContent = isUnverified ? '⚠ unverified' : ('🔖 ' + key);
      chip.dataset.key = key || '';
      chip.dataset.unverified = isUnverified ? '1' : '0';
      chip.title = isUnverified
        ? 'This claim has no verified source — treat with caution'
        : 'Source: agentMemory["' + key + '"]. Click to view.';
      chip.style.cssText = 'display:inline-flex; align-items:center; gap:3px; padding:1px 7px; margin:0 2px; ' +
        'border-radius:9px; font-size:10px; font-weight:600; cursor:pointer; vertical-align:baseline; ' +
        (isUnverified
          ? 'background:rgba(220,60,60,0.20); color:#ff8a8a; border:1px solid rgba(220,60,60,0.5);'
          : 'background:rgba(255,107,0,0.18); color:#ff9a4a; border:1px solid rgba(255,107,0,0.45);');
      chip.addEventListener('click', () => toggleSourceChipExpansion(chip));
      frag.appendChild(chip);
      last = m.index + m[0].length;
    }
    if (last < tn.textContent.length) frag.appendChild(document.createTextNode(tn.textContent.slice(last)));
    tn.parentNode.replaceChild(frag, tn);
  }
}

async function toggleSourceChipExpansion(chip) {
  const key = chip.dataset.key;
  const unverified = chip.dataset.unverified === '1';
  // Toggle: if a sibling expansion exists, remove it.
  const next = chip.nextElementSibling;
  if (next && next.classList && next.classList.contains('sentinel-src-expansion')) {
    next.remove(); return;
  }
  const exp = document.createElement('div');
  exp.className = 'sentinel-src-expansion';
  exp.style.cssText = 'margin: 6px 0 6px 22px; padding: 8px 12px; background: rgba(255,255,255,0.05); ' +
    'border-left: 3px solid var(--accent-primary, #ff6b00); border-radius: 4px; ' +
    'font-size: 11px; font-family: monospace; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto;';
  if (unverified || !key) {
    exp.textContent = 'No verified source for this claim. Treat as model-prior or caveat content.';
    chip.parentNode.insertBefore(exp, chip.nextSibling);
    return;
  }
  try {
    const stored = await chrome.storage.local.get('agent_memory');
    const mem = stored && stored.agent_memory;
    const value = mem && Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
    if (value === null || value === undefined) {
      exp.textContent = '(memory key "' + key + '" not found in current agent_memory; may have been cleared since the run completed)';
    } else {
      exp.textContent = (typeof value === 'string') ? value.slice(0, 4000) : JSON.stringify(value, null, 2).slice(0, 4000);
    }
  } catch (e) {
    exp.textContent = 'Error reading source: ' + e.message;
  }
  chip.parentNode.insertBefore(exp, chip.nextSibling);
}

// Hook: render chips after addMessage paints content. Patch addMessage.
const __originalAddMessage = (typeof addMessage === 'function') ? addMessage : null;

// ========== Tenant Override Card (3.11.0) ==========
// Hard-stop modal-style card when the agent attempts a modifying action on
// a Microsoft admin URL whose tenant doesn't match the user's expectedTenant.
// Career-risk gate: forces an explicit "yes, intentional cross-tenant work"
// click before dispatching. Forensic log captures the timestamped decision.

function showTenantOverrideCard(payload) {
  if (!payload) return;
  const requestId = payload.requestId;
  // Remove any prior card so we don't stack
  const existing = document.getElementById('tenant-override-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'tenant-override-card';
  card.className = 'safety-banner';
  card.style.cssText = 'border: 2px solid #C00000; background: rgba(192,0,0,0.12); margin: 8px 14px; padding: 14px 16px; border-radius: 8px;';
  card.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; color:#FF8A8A; font-weight:700; font-size:13px; margin-bottom:8px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>CROSS-TENANT ACTION BLOCKED</span>
    </div>
    <div style="font-size: 12px; line-height: 1.5; margin-bottom: 10px;">
      The agent is about to <strong>${escapeHtml(payload.actionType || 'modify')}</strong> on <code style="background:rgba(0,0,0,0.18); padding:1px 4px; border-radius:3px;">${escapeHtml(payload.host || '')}</code> but the detected tenant doesn&#x2019;t match your expected tenant.
    </div>
    <div style="font-size:11px; line-height:1.5; padding:8px 10px; background:rgba(0,0,0,0.18); border-radius:4px; margin-bottom:10px; font-family:monospace;">
      <div><span style="color:#888;">Expected:</span> <strong style="color:#6fcf80;">${escapeHtml(payload.expected || '')}</strong></div>
      <div><span style="color:#888;">Detected:</span> <strong style="color:#FF8A8A;">${escapeHtml(payload.detected || '(none)')}</strong></div>
      <div style="margin-top:4px; color:#bbb;">Action: ${escapeHtml(payload.actionDescription || payload.actionType || '')}</div>
    </div>
    <div style="font-size:11px; color:#FFB070; margin-bottom: 10px;">
      ⚠ Modifying actions in the wrong tenant can affect the wrong client. This decision is logged with a timestamp to the forensic run log.
    </div>
    <div style="display:flex; gap:8px;">
      <button id="tenantOverrideApproveBtn" style="flex:1; padding:9px 12px; border-radius:6px; border:1px solid #C00000; background:#C00000; color:white; cursor:pointer; font-size:12px; font-weight:600;">Yes — intentional cross-tenant work</button>
      <button id="tenantOverrideRejectBtn" style="flex:1; padding:9px 12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; font-size:12px;">Cancel — wrong tenant</button>
    </div>
  `;
  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  document.getElementById('tenantOverrideApproveBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'tenant_override_response',
      requestId,
      approved: true,
      rejected: false
    }).catch(() => {});
    card.remove();
  });
  document.getElementById('tenantOverrideRejectBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'tenant_override_response',
      requestId,
      approved: false,
      rejected: true
    }).catch(() => {});
    card.remove();
  });
}

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
      // (3.7.1) Update the prominent active-tab strip
      updateActiveTabPage(message.url, message.title || '');
      if (message.stepNumber) updateActiveTabStep(message.stepNumber);
      // (3.8.1) Capture the tabId so the Focus button can target it directly.
      if (typeof message.tabId === 'number') {
        __atsStripState.tabId = message.tabId;
      }
    }
  }
  if (message.action === 'agent_finished') {
    removeTypingIndicator();
    removeApprovalCard();
    renderTabBar([]);
    // (3.7.1) Hide the active-tab strip + screenshot panel between runs
    hideActiveTabStrip();
    hideMiniShot();
    try {
      const summary = message.summary || 'Done';
      // If summary already has substantial content, don't prefix with "Task completed"
      const prefix = summary.length > 100 ? '' : '✅ Task completed\n\n';
      addMessage(prefix + summary, 'assistant');
      // (3.10.0) Decorate any [src:key] / [unverified] markers in the rendered
      // summary as clickable chips. Run on the most-recent assistant message.
      try {
        const lastMsg = chatContainer.querySelector('.message-group:last-child .message.assistant-msg, .message-group:last-child .assistant-wrapper');
        if (lastMsg) renderSourceChipsIn(lastMsg);
      } catch (e) { /* non-fatal */ }
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
    // (3.7.1) Update the strip with a plain-English description of the action
    updateActiveTabAction(message.payload);
    if (message.payload && message.payload.stepNumber) updateActiveTabStep(message.payload.stepNumber);
  }
  if (message.action === 'agent_action_result') {
    updateActionCardResult(message.stepNumber, message.result, message.isError);
  }
  if (message.action === 'tab_state_update' && message.tabs) {
    renderTabBar(message.tabs);
    // (3.7.1) Capture the active tabId so the strip's Focus button can target it
    try {
      const active = (message.tabs || []).find(t => t.isActive);
      if (active && active.tabId) __atsStripState.tabId = active.tabId;
    } catch (e) {}
  }
  if (message.action === 'screenshot_update' && message.base64Image) {
    // (3.7.1) Live agent's-view thumbnail — updates every step
    updateMiniShot(message.base64Image);
    showMiniShot();
  }
  if (message.action === 'request_tenant_override') {
    showTenantOverrideCard(message.payload);
  }
  if (message.action === 'mfa_pause') {
    // (3.7.0) MFA challenge detected on the page — show a chat-level banner
    // with a Resume button. The agent is already paused server-side; we just
    // need to tell the user and give them a one-click resume.
    showMfaBanner(message.url, message.hint, message.stepNumber);
  }
  if (message.action === 'tenant_detected') {
    renderTenantChip(message.tenant, message.expected);
  }
  if (message.action === 'download_captured') {
    showDownloadCaptured(message.download);
  }
  if (message.action === 'run_log_available') {
    showRunLogExportButton(message.runLogId, message.entryCount);
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
