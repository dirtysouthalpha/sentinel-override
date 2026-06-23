// agent-narration.js
// Extracted from agent-engine.js — Live Status Narration (Phase 8.2).
// Emits structured status messages to the popup for real-time narration.

// Uses `type: 'agent_status'` (distinct from the existing `action: 'agent_status'
// from message-protocol.js) so the popup can render a dedicated status bar
// with tab-scoped context alongside the legacy ticker.
function emitAgentStatus(tabId, status, detail) {
  try {
    chrome.runtime.sendMessage({
      type: 'agent_status',
      tabId: tabId || 0,
      status: status || 'idle',
      detail: detail || '',
      timestamp: Date.now()
    }).catch(() => {});
  } catch (_) { /* non-fatal */ }
}

export { emitAgentStatus };
