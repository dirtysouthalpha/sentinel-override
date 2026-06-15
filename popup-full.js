// popup-full.js -- Bootstrap
// Global state initialization, DOMContentLoaded wiring, and modal close handlers.
// Loaded last (after ui-common.js, settings.js, chat.js) so all module functions
// are available in global scope.

// ========== Global State (initialized by popup-state.js) ==========
initPopupState();

// ========== Initialization ==========
window.addEventListener('DOMContentLoaded', () => {
  loadThemePreference();
  loadSettings();
  loadApprovalMode();
  loadChatHistory();
  setupVoiceInput();
  setupApprovalModeToggle();

  // Templates button toggle
  const templatesBtn = document.getElementById('templatesBtn');
  if (templatesBtn) {
    templatesBtn.addEventListener('click', () => {
      const panel = document.getElementById('templates-panel');
      if (panel && (panel.style.display === 'none' || !panel.style.display)) {
        showTemplatesPanel();
        const schBtn = document.getElementById('schedulerBtn');
        if (schBtn) schBtn.classList.remove('active');
      } else {
        hideTemplatesPanel();
      }
    });
  }

  // Scheduler panel toggle
  const schedulerBtn = document.getElementById('schedulerBtn');
  if (schedulerBtn) {
    schedulerBtn.addEventListener('click', () => {
      const panel = document.getElementById('schedules-panel');
      if (panel && (panel.style.display === 'none' || !panel.style.display)) {
        window.showSchedulesPanel();
        schedulerBtn.classList.add('active');
        if (templatesBtn) templatesBtn.classList.remove('active');
      } else {
        window.hideSchedulesPanel();
        schedulerBtn.classList.remove('active');
      }
    });
  }

  // Schedule modal close handlers
  document.getElementById('closeScheduleModalBtn')?.addEventListener('click', () => {
    document.getElementById('schedule-modal')?.classList.remove('show');
  });
  document.getElementById('closeHistoryModalBtn')?.addEventListener('click', () => {
    document.getElementById('schedule-history-modal')?.classList.remove('show');
  });

  // Schedule create/save buttons
  document.getElementById('createScheduleBtn')?.addEventListener('click', () => {
    window.openCreateScheduleModal();
  });
  document.getElementById('saveScheduleBtn')?.addEventListener('click', () => {
    window._handleSaveSchedule?.();
  });

  // Collaboration buttons
  document.getElementById('importTemplatesBtn')?.addEventListener('click', () => {
    window.openImportDialog?.();
  });
  document.getElementById('exportAllTemplatesBtn')?.addEventListener('click', () => {
    window.exportAllTemplatesFile?.();
  });
});

// ========== Close Modals on Escape ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('settings-modal')?.classList.remove('show');
    document.getElementById('theme-modal')?.classList.remove('show');
    document.getElementById('report-modal')?.classList.remove('show');
    document.getElementById('template-modal')?.classList.remove('show');
    document.getElementById('template-run-modal')?.classList.remove('show');
    document.getElementById('schedule-modal')?.classList.remove('show');
    document.getElementById('schedule-history-modal')?.classList.remove('show');
    document.getElementById('import-modal')?.classList.remove('show');
    if (typeof closeCommandPalette === 'function') closeCommandPalette();
  }
});

// ========== Click outside modal to close ==========
window.addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-modal')) {
    document.getElementById('settings-modal')?.classList.remove('show');
  }
  if (e.target === document.getElementById('theme-modal')) {
    document.getElementById('theme-modal')?.classList.remove('show');
  }
  if (e.target === document.getElementById('report-modal')) {
    closeReportModal();
  }
  if (e.target === document.getElementById('template-modal')) {
    document.getElementById('template-modal')?.classList.remove('show');
  }
  if (e.target === document.getElementById('template-run-modal')) {
    document.getElementById('template-run-modal')?.classList.remove('show');
  }
  if (e.target === document.getElementById('schedule-modal')) {
    document.getElementById('schedule-modal')?.classList.remove('show');
  }
  if (e.target === document.getElementById('schedule-history-modal')) {
    document.getElementById('schedule-history-modal')?.classList.remove('show');
  }
  if (e.target === document.getElementById('import-modal')) {
    document.getElementById('import-modal')?.classList.remove('show');
  }
});

// ========== Boot Diagnostic ==========
// Runs after ALL scripts have loaded. Checks that critical listeners exist.
// (Provider config check is handled by boot-catcher.js with correct storage keys)
const _bootTimer = setTimeout(() => {
  const goalInput = document.getElementById('goalInput');
  const sendBtn = document.getElementById('sendBtn');
  const errors = window.__sentinelErrors || [];
  if (errors.length > 0) {
    console.error('[Sentinel/BOOT] Errors during load:', errors);
  }
  // Verify elements exist
  if (!goalInput) console.error('[Sentinel/BOOT] goalInput NOT FOUND in DOM');
  if (!sendBtn) console.error('[Sentinel/BOOT] sendBtn NOT FOUND in DOM');

}, 500);
window.addEventListener('unload', () => clearTimeout(_bootTimer), { once: true });

// ========== ROBUST SEND PATH (hardened + self-diagnosing) ==========
// Replaces the old fallback listeners. Symptom this fixes: "I press Enter and
// NOTHING happens — no toast, no message, no error." That meant a handler was
// firing (Enter was swallowed, no newline) but the send silently did nothing,
// with no way for the user to see why. This path guarantees three things:
//
//   1. A keypress is NEVER silent. Empty field → the input flashes. A broken
//      send → a visible banner (the boot banner, which renders reliably — the
//      user has already seen it for the API-key notice).
//   2. Sending can't be disabled by a broken chat module. We prefer the full
//      sendMessage(), but if it's missing or throws we dispatch run_agent_loop
//      inline and render the user's bubble directly into #chat-container.
//   3. No double-send. sendMessage() clears #goalInput synchronously on a real
//      send, so the existing chat.js handlers (and our own re-check) see an
//      empty field and no-op. The inline fallback only fires when sendMessage
//      did NOT consume the field (i.e. it bailed/threw) — so the goal is never
//      both sent twice nor lost.
//
// Capture phase so we run even if another handler stops propagation, and
// delegated on `document` so a re-rendered input still works.
(function attachRobustSend() {
  function _banner(text, color) {
    try { if (typeof __showBootBanner === 'function') __showBootBanner(text, color); } catch (_e) { /* non-fatal */ }
    try { console.error('[Sentinel/SEND]', text); } catch (_e) { /* non-fatal */ }
  }

  function _flashInput(el, color) {
    if (!el || !el.style) return;
    try {
      const prev = el.style.boxShadow || '';
      el.style.boxShadow = '0 0 0 2px ' + color;
      setTimeout(() => { try { el.style.boxShadow = prev; } catch (_e) { /* non-fatal */ } }, 600);
    } catch (_e) { /* non-fatal */ }
  }

  // Minimal send used only when sendMessage() is unavailable or threw. Renders
  // the user's text into #chat-container and fires the goal so the agent starts.
  function _inlineSend(goal) {
    try {
      const cc = document.getElementById('chat-container');
      if (cc) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper user-wrapper';
        const msg = document.createElement('div');
        msg.className = 'message user-msg';
        msg.textContent = goal;
        wrapper.appendChild(msg);
        cc.appendChild(wrapper);
        cc.scrollTop = cc.scrollHeight;
      }
    } catch (_e) { /* rendering is best-effort */ }
    try {
      chrome.runtime.sendMessage({ action: 'run_agent_loop', goal }, () => { void chrome.runtime.lastError; });
    } catch (e) {
      _banner('[SEND] dispatch failed: ' + ((e && e.message) || e), '#ff0040');
    }
  }

  function _doSend() {
    const gi = document.getElementById('goalInput');
    const goal = gi && typeof gi.value === 'string' ? gi.value.trim() : '';
    if (!goal) {
      // Make the empty case visible instead of doing nothing silently.
      _flashInput(gi, 'rgba(255,170,0,0.9)');
      return;
    }
    if (typeof sendMessage === 'function') {
      try {
        sendMessage();
        // If sendMessage didn't consume the field, it bailed before sending —
        // fall back so the goal isn't lost. (A real send clears it synchronously.)
        if (gi && gi.value.trim() === goal) {
          _inlineSend(goal);
          gi.value = '';
        }
      } catch (err) {
        _banner('[SEND] sendMessage threw: ' + ((err && err.message) || err) + ' — using fallback', '#ff8800');
        _inlineSend(goal);
        if (gi) gi.value = '';
      }
      return;
    }
    // sendMessage missing entirely — chat.js failed to load. Send anyway.
    _banner('[SEND] sendMessage missing — using fallback dispatch', '#ff8800');
    _inlineSend(goal);
    if (gi) gi.value = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const ae = document.activeElement;
    if (!ae || ae.id !== 'goalInput') return;
    e.preventDefault();
    _doSend();
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#sendBtn');
    if (!btn) return;
    _doSend();
  }, true);
})();
