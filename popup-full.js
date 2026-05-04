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
});

// ========== Close Modals on Escape ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('settings-modal').classList.remove('show');
    document.getElementById('theme-modal').classList.remove('show');
    document.getElementById('report-modal').classList.remove('show');
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
});
