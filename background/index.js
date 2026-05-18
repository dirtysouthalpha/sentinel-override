// Sentinel Override — Diagnostic Service Worker
// Tests each module import individually to find the crash

const MODULES = [
  './message-protocol.js',
  './shared-state.js',
  './telemetry.js',
  './audit-log.js',
  './adaptive-prompts.js',
  './trust-score.js',
  './provider-registry.js',
  './template-manager.js',
  './scheduler.js',
  './collaboration.js',
  './tab-context.js',
  './tab-manager.js',
  './frame-router.js',
  './report-generator.js',
  './export-report.js',
  './context-menu.js',
  './page-monitor.js',
  './macro-recorder.js',
  './skills/index.js',
  './llm-client.js',
  './client-knowledge.js',
  './agent-engine.js',
];

async function testImports() {
  for (const mod of MODULES) {
    try {
      await import(mod);
      console.log('[DIAG] ✅ ' + mod);
    } catch (e) {
      console.error('[DIAG] ❌ ' + mod + ': ' + e.message);
    }
  }
  console.log('[DIAG] Import test complete');
}

testImports();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DIAG] onInstalled fired');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'diag_results') {
    testImports().then(() => sendResponse({ ok: true }));
    return true;
  }
});
