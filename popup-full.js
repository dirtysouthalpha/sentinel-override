// popup-full.js -- Bootstrap
// Global state initialization, DOMContentLoaded wiring, and modal close handlers.
// Loaded last (after ui-common.js, settings.js, chat.js) so all module functions
// are available in global scope.

// ========== Global State ==========
window.__popupState = {
  conversationHistory: [],
  selectedAttachments: [],
  currentSearchQuery: '',
  currentSearchIndex: 0,
  activeProviderId: 'anthropic',
  providerConfigs: { anthropic: {}, openai: {} },
  currentReportMarkdown: null,
  isAgentRunning: false,
  pendingStepLogs: {},
};

// ========== Initialization ==========
window.addEventListener('DOMContentLoaded', () => {
  loadThemePreference();
  loadSettings();
  loadApprovalMode();
  loadChatHistory();
  setupVoiceInput();
  setupApprovalModeToggle();

  // Templates button toggle
  document.getElementById('templatesBtn').addEventListener('click', () => {
    const panel = document.getElementById('templates-panel');
    if (panel.style.display === 'none' || !panel.style.display) {
      showTemplatesPanel();
    } else {
      hideTemplatesPanel();
    }
  });

  // Scheduler panel toggle
  const schedulerBtn = document.getElementById('schedulerBtn');
  if (schedulerBtn) {
    schedulerBtn.addEventListener('click', () => {
      const panel = document.getElementById('schedules-panel');
      if (panel && panel.style.display === 'none') {
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
    document.getElementById('schedule-modal').classList.remove('show');
  });
  document.getElementById('closeHistoryModalBtn')?.addEventListener('click', () => {
    document.getElementById('schedule-history-modal').classList.remove('show');
  });

  // Schedule create/save buttons
  document.getElementById('createScheduleBtn')?.addEventListener('click', () => {
    window.openCreateScheduleModal();
  });
  document.getElementById('saveScheduleBtn')?.addEventListener('click', () => {
    window._handleSaveSchedule?.();
  });
});

// ========== Close Modals on Escape ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('settings-modal').classList.remove('show');
    document.getElementById('theme-modal').classList.remove('show');
    document.getElementById('report-modal').classList.remove('show');
    document.getElementById('template-modal').classList.remove('show');
    document.getElementById('template-run-modal').classList.remove('show');
    document.getElementById('schedule-modal')?.classList.remove('show');
    document.getElementById('schedule-history-modal')?.classList.remove('show');
    closeCommandPalette();
  }
});

// ========== Click outside modal to close ==========
window.addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-modal')) {
    document.getElementById('settings-modal').classList.remove('show');
  }
  if (e.target === document.getElementById('theme-modal')) {
    document.getElementById('theme-modal').classList.remove('show');
  }
  if (e.target === document.getElementById('report-modal')) {
    closeReportModal();
  }
  if (e.target === document.getElementById('template-modal')) {
    document.getElementById('template-modal').classList.remove('show');
  }
  if (e.target === document.getElementById('template-run-modal')) {
    document.getElementById('template-run-modal').classList.remove('show');
  }
  if (e.target === document.getElementById('schedule-modal')) {
    document.getElementById('schedule-modal').classList.remove('show');
  }
  if (e.target === document.getElementById('schedule-history-modal')) {
    document.getElementById('schedule-history-modal').classList.remove('show');
  }
});
