// popup-modules/boot-catcher.js
// Global error catcher — loaded FIRST before all other popup scripts.
// Catches and displays any JS errors that prevent the extension from working.
window.__sentinelErrors = [];

function __showBootBanner(text, color) {
  let banner = document.getElementById('__sentinel-boot-err');
  if (!banner && document.body) {
    banner = document.createElement('div');
    banner.id = '__sentinel-boot-err';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:' + (color || '#ff0040') + ';color:#fff;padding:8px 12px;font-size:12px;font-family:monospace;white-space:pre-wrap;max-height:200px;overflow:auto;';
    document.body.prepend(banner);
  }
  if (banner) banner.textContent += text + '\n';
}

window.addEventListener('error', (e) => {
  window.__sentinelErrors.push({
    type: 'error',
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno
  });
  console.error('[Sentinel/BOOT]', e.message, e.filename + ':' + e.lineno);
  __showBootBanner('[ERROR] ' + (e.filename || '').split('/').pop() + ':' + e.lineno + ' — ' + e.message, '#ff0040');
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
  window.__sentinelErrors.push({ type: 'unhandledrejection', message: msg });
  console.error('[Sentinel/BOOT] Unhandled rejection:', msg);
  __showBootBanner('[PROMISE] ' + msg, '#ff8800');
});

// Post-boot diagnostic: check that the service worker is alive and elements exist
setTimeout(() => {
  const goalInput = document.getElementById('goalInput');
  const sendBtn = document.getElementById('sendBtn');
  const errors = window.__sentinelErrors || [];

  if (errors.length > 0) {
    __showBootBanner('Boot errors: ' + errors.length + ' — check console', '#ff0040');
  }

  if (!goalInput) __showBootBanner('[DIAG] goalInput NOT FOUND', '#ff8800');
  if (!sendBtn) __showBootBanner('[DIAG] sendBtn NOT FOUND', '#ff8800');

  // Ping service worker
  try {
    chrome.runtime.sendMessage({ action: 'ping' }, (resp) => {
      if (chrome.runtime.lastError) {
        __showBootBanner('[SW] NOT REACHABLE: ' + (chrome.runtime.lastError.message || 'unknown'), '#ff0040');
        return;
      }
      if (resp && resp.pong) {
        console.log('[Sentinel/BOOT] SW alive, agentRunning:', resp.agentRunning);
      } else {
        __showBootBanner('[SW] Unexpected response: ' + JSON.stringify(resp), '#ff8800');
      }
    });
  } catch (e) {
    __showBootBanner('[SW] Ping threw: ' + e.message, '#ff0040');
  }

  // Check if provider has API key
  chrome.storage.local.get(['active_provider_config'], (result) => {
    const config = result.active_provider_config;
    if (!config || !config.api_key) {
      __showBootBanner('[CONFIG] No API key — open Settings to configure a provider', '#ffaa00');
      const gi = document.getElementById('goalInput');
      if (gi) gi.placeholder = '⚠️ Set up API key in Settings first ⚠️';
    }
  });
}, 600);
