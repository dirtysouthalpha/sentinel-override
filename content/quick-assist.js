// content/quick-assist.js
// Sentinel Quick Assist — floating AI panel on any webpage.
// Triggers on text selection (>10 chars) or right-click context menu.
// Uses Shadow DOM for style isolation.

(function sentinelQuickAssist() {
  'use strict';

  if (window.__sentinelQuickAssistLoaded) return;
  window.__sentinelQuickAssistLoaded = true;

  let enabled = true;
  let panelVisible = false;
  let triggerVisible = false;
  let currentSelection = '';
  let currentUrl = '';
  let currentTitle = '';

  // ===== Action Definitions =====
  const ACTIONS = [
    { id: 'summarize',  label: 'Summarize',     icon: '📋', prompt: 'Summarize the following concisely, highlighting key points:' },
    { id: 'explain',    label: 'Explain',       icon: '🔍', prompt: 'Explain this in plain language for a non-technical audience:' },
    { id: 'troubleshoot', label: 'Fix',         icon: '🔧', prompt: 'Given the following error or message, suggest troubleshooting steps for an IT technician:' },
    { id: 'playbook',   label: 'Playbook',      icon: '📝', prompt: 'Based on the following, create a step-by-step IT runbook/playbook for an MSP technician:' },
    { id: 'extract',    label: 'Extract',       icon: '📊', prompt: 'Extract all structured data (IPs, email addresses, dates, ticket numbers, hostnames, URLs) from the following and present as a clean list:' },
    { id: 'rewrite',    label: 'Rewrite',       icon: '✏️', prompt: 'Rewrite the following in a professional tone suitable for client communication:' },
  ];

  // ===== Shadow DOM Setup =====
  const host = document.createElement('div');
  host.id = '__sentinel-qa-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  // ===== Styles =====
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .qa-trigger {
      position: fixed;
      width: 36px; height: 36px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.5);
      transition: transform 0.15s, box-shadow 0.15s;
      pointer-events: auto;
      z-index: 2147483647;
      font-size: 16px;
    }
    .qa-trigger:hover {
      transform: scale(1.15);
      box-shadow: 0 4px 20px rgba(0,132,255,0.4);
      border-color: #0084ff;
    }

    .qa-panel {
      position: fixed;
      width: 420px;
      max-height: 600px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      pointer-events: auto;
      z-index: 2147483647;
      animation: qaFadeIn 0.2s ease-out;
    }
    @keyframes qaFadeIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .qa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      cursor: move;
      user-select: none;
    }
    .qa-header-title {
      font-size: 12px;
      font-weight: 600;
      color: #e6edf3;
      letter-spacing: 0.5px;
    }
    .qa-close {
      background: none; border: none;
      color: #8b949e; font-size: 18px;
      cursor: pointer; padding: 0 4px; line-height: 1;
    }
    .qa-close:hover { color: #f85149; }

    .qa-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid #21262d;
    }
    .qa-action-btn {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 4px;
      color: #c9d1d9;
      font-size: 11px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .qa-action-btn:hover {
      background: #1f2937;
      border-color: #0084ff;
      color: #fff;
    }
    .qa-action-btn:active { transform: scale(0.96); }
    .qa-action-btn .qa-icon { font-size: 14px; display: block; margin-bottom: 2px; }

    .qa-selection {
      padding: 8px 12px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
      color: #8b949e;
      max-height: 60px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .qa-response {
      flex: 1;
      padding: 12px;
      overflow-y: auto;
      font-size: 13px;
      color: #e6edf3;
      line-height: 1.6;
      min-height: 80px;
      max-height: 300px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .qa-response code {
      background: #161b22;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 12px;
      color: #79c0ff;
    }
    .qa-response pre {
      background: #161b22;
      padding: 8px 10px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .qa-response pre code { padding: 0; background: none; }
    .qa-response strong { color: #f0f6fc; }
    .qa-response ul, .qa-response ol { padding-left: 20px; margin: 4px 0; }
    .qa-response li { margin: 2px 0; }
    .qa-response p { margin: 4px 0; }

    .qa-loading {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 12px;
      color: #8b949e;
      font-size: 13px;
    }
    .qa-loading-dot {
      width: 6px; height: 6px;
      background: #0084ff;
      border-radius: 50%;
      animation: qaPulse 1.2s ease-in-out infinite;
    }
    .qa-loading-dot:nth-child(2) { animation-delay: 0.2s; }
    .qa-loading-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes qaPulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1.2); }
    }

    .qa-footer {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid #21262d;
    }
    .qa-footer-btn {
      flex: 1;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 8px;
      color: #c9d1d9;
      font-size: 11px;
      cursor: pointer;
      text-align: center;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .qa-footer-btn:hover { border-color: #0084ff; color: #fff; }
    .qa-footer-btn.primary { background: #0084ff; border-color: #0084ff; color: #fff; }
    .qa-footer-btn.primary:hover { background: #0066cc; }

    .qa-error {
      color: #f85149;
      font-size: 12px;
      padding: 12px;
    }
  `;
  shadow.appendChild(style);

  // ===== Create DOM Elements =====
  // Trigger button
  const trigger = document.createElement('div');
  trigger.className = 'qa-trigger';
  trigger.textContent = '⚡';
  trigger.style.display = 'none';
  shadow.appendChild(trigger);

  // Panel
  const panel = document.createElement('div');
  panel.className = 'qa-panel';
  panel.style.display = 'none';
  shadow.appendChild(panel);

  panel.innerHTML = `
    <div class="qa-header">
      <span class="qa-header-title">⚡ SENTINEL QUICK ASSIST</span>
      <button class="qa-close">&times;</button>
    </div>
    <div class="qa-actions">
      ${ACTIONS.map(a => `<button class="qa-action-btn" data-action="${a.id}"><span class="qa-icon">${a.icon}</span>${a.label}</button>`).join('')}
    </div>
    <div class="qa-selection" id="qa-sel-preview"></div>
    <div class="qa-response" id="qa-response"></div>
    <div class="qa-footer">
      <button class="qa-footer-btn" id="qa-copy">📋 Copy</button>
      <button class="qa-footer-btn primary" id="qa-send-agent">🚀 Send to Agent</button>
    </div>
  `;

  const headerEl = panel.querySelector('.qa-header');
  const closeBtn = panel.querySelector('.qa-close');
  const actionBtns = panel.querySelectorAll('.qa-action-btn');
  const selPreview = panel.querySelector('#qa-sel-preview');
  const responseEl = panel.querySelector('#qa-response');
  const copyBtn = panel.querySelector('#qa-copy');
  const sendAgentBtn = panel.querySelector('#qa-send-agent');

  // ===== Dragging =====
  let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
  headerEl.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn) return;
    isDragging = true;
    dragOffsetX = e.clientX - panel.getBoundingClientRect().left;
    dragOffsetY = e.clientY - panel.getBoundingClientRect().top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragOffsetX) + 'px';
    panel.style.top = (e.clientY - dragOffsetY) + 'px';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  // ===== Panel Positioning =====
  function positionPanel(x, y) {
    const pw = 420, ph = 400;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x + 10;
    let top = y - 40;
    if (left + pw > vw - 20) left = vw - pw - 20;
    if (left < 20) left = 20;
    if (top + ph > vh - 20) top = vh - ph - 20;
    if (top < 20) top = 20;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function showPanel(x, y, text) {
    currentSelection = text;
    currentUrl = location.href;
    currentTitle = document.title;
    selPreview.textContent = text.substring(0, 300) + (text.length > 300 ? '...' : '');
    responseEl.innerHTML = '';
    positionPanel(x, y);
    panel.style.display = 'flex';
    panelVisible = true;
    trigger.style.display = 'none';
    triggerVisible = false;
  }

  function hidePanel() {
    panel.style.display = 'none';
    panelVisible = false;
  }

  function showTrigger(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x + 10;
    let top = y - 40;
    if (left + 36 > vw) left = x - 46;
    if (top < 10) top = 10;
    trigger.style.left = left + 'px';
    trigger.style.top = top + 'px';
    trigger.style.display = 'flex';
    triggerVisible = true;
  }

  function hideTrigger() {
    trigger.style.display = 'none';
    triggerVisible = false;
  }

  // ===== Event Handlers =====
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text.length > 0) {
      const rect = trigger.getBoundingClientRect();
      showPanel(rect.left, rect.top + 36, text);
    }
  });

  closeBtn.addEventListener('click', hidePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panelVisible) hidePanel();
      if (triggerVisible) hideTrigger();
    }
  });

  document.addEventListener('mousedown', (e) => {
    // Close panel if click is outside
    if (panelVisible && !panel.contains(e.target) && !trigger.contains(e.target)) {
      // Small delay to not conflict with trigger click
      setTimeout(() => {
        if (panelVisible) hidePanel();
      }, 150);
    }
  });

  // Text selection detection
  document.addEventListener('mouseup', (e) => {
    if (!enabled) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (text.length > 10) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showTrigger(rect.right, rect.top);
      } else {
        hideTrigger();
      }
    }, 50);
  });

  // ===== Action Buttons =====
  actionBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const actionId = btn.dataset.action;
      const action = ACTIONS.find(a => a.id === actionId);
      if (!action || !currentSelection) return;

      // Show loading
      responseEl.innerHTML = '<div class="qa-loading"><div class="qa-loading-dot"></div><div class="qa-loading-dot"></div><div class="qa-loading-dot"></div> Analyzing...</div>';

      const prompt = `You are Sentinel Quick Assist, an AI assistant for MSP technicians.\nCurrent page: ${currentTitle} (${currentUrl})\n\n${action.prompt}\n\n---\n${currentSelection}`;

      try {
        const response = await chrome.runtime.sendMessage({ action: 'quick_assist_request', prompt: prompt });
        // Handle wrapMessageHandler wrapping: response may be { ok, data: { text } } or { text }
        let text = response?.text;
        if (!text && response?.data?.text) text = response.data.text;
        if (!text && response?.data) text = typeof response.data === 'string' ? response.data : null;
        if (!text) text = 'No response received.';

        responseEl.innerHTML = renderMarkdown(text);
      } catch (err) {
        responseEl.innerHTML = `<div class="qa-error">${escapeHtml(err.message || 'Unknown error')}</div>`;
      }
    });
  });

  // ===== Copy Button =====
  copyBtn.addEventListener('click', () => {
    const text = responseEl.innerText || responseEl.textContent;
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
      });
    }
  });

  // ===== Send to Agent Button =====
  sendAgentBtn.addEventListener('click', () => {
    const text = responseEl.innerText || responseEl.textContent;
    if (text) {
      chrome.runtime.sendMessage({ action: 'set_goal', goal: text });
      sendAgentBtn.textContent = '✅ Sent!';
      setTimeout(() => { sendAgentBtn.textContent = '🚀 Send to Agent'; }, 1500);
    }
  });

  // ===== Context Menu Message =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'show_quick_assist' && msg.selectedText) {
      // Show in center of viewport
      const x = window.innerWidth / 2 - 210;
      const y = window.innerHeight / 2 - 200;
      showPanel(x, y, msg.selectedText);
    }
  });

  // ===== Settings Listener =====
  try {
    chrome.storage.local.get(['quickAssist'], (result) => {
      enabled = result.quickAssist !== false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.quickAssist) {
        enabled = changes.quickAssist.newValue !== false;
        if (!enabled) {
          hidePanel();
          hideTrigger();
        }
      }
    });
  } catch (e) { /* storage not available */ }

  // ===== Utility Functions =====
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Inline code: `text`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Code blocks: ```...```
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Unordered lists: - item or * item
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    // Ordered lists: 1. item
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Paragraphs: double newline
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    return html;
  }
})();
