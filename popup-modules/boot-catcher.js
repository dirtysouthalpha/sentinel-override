// popup-modules/boot-catcher.js
// Global error catcher — loaded FIRST before all other popup scripts.
// Catches and displays any JS errors that prevent the extension from working.
window.__sentinelErrors = [];

// The on-screen boot banner is disabled. It used to render a fixed colored bar
// (green "[OK] Provider ready", yellow "no API key", red errors) at the top of
// the panel, which was distracting in normal use. We now keep the diagnostic
// trail in the console and on the hidden #__sentinel-boot-err node (queryable
// via `document.getElementById('__sentinel-boot-err').textContent` and
// `window.__sentinelErrors`) WITHOUT showing anything to the user.
// `display:none` keeps the element present so existing diagnostics/tests that
// read its textContent still work, but it never paints.
function __showBootBanner(text, color) {
  let banner = document.getElementById('__sentinel-boot-err');
  if (!banner && document.body) {
    banner = document.createElement('div');
    banner.id = '__sentinel-boot-err';
    // display:none — diagnostic-only, never visible.
    banner.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:999999;background:' + (color || '#ff0040') + ';color:#fff;padding:8px 12px;font-size:12px;font-family:monospace;white-space:pre-wrap;max-height:200px;overflow:auto;';
    document.body.prepend(banner);
  }
  if (banner) banner.textContent += text + '\n';
}

// Shared API-key presence check — used by the boot-time diagnostic below and by
// the storage.onChanged reconciler so both agree on what "configured" means.
// Returns true when the active provider has a key, or a legacy single-key
// config exists.
function __hasUsableApiKey(result) {
  const activeId = result && result.active_provider;
  const providers = result && result.providers;
  if (activeId && providers && providers[activeId] && providers[activeId].api_key) return true;
  if (result && result.api_key) return true; // legacy single-key storage
  return false;
}

// Retract every banner line containing `substr`. If that empties the banner,
// remove the element entirely. Used to take down the stale "No API key found"
// notice once a key is saved: the side panel (manifest: side_panel.default_path)
// keeps its document alive across open/close, so the one-shot boot check never
// re-runs to clear it on its own.
function __retractBannerLines(substr) {
  const banner = document.getElementById('__sentinel-boot-err');
  if (!banner) return;
  const kept = String(banner.textContent || '')
    .split('\n')
    .filter((line) => line.length && line.indexOf(substr) === -1);
  if (kept.length === 0) {
    if (typeof banner.remove === 'function') banner.remove();
    else if (banner.parentNode) banner.parentNode.removeChild(banner);
  } else {
    banner.textContent = kept.join('\n') + '\n';
  }
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
      if (!(resp && (resp.pong || resp.data?.pong))) {
        __showBootBanner('[SW] Unexpected response: ' + JSON.stringify(resp), '#ff8800');
      }
    });
  } catch (e) {
    __showBootBanner('[SW] Ping threw: ' + e.message, '#ff0040');
  }

  // Check if provider has API key (correct storage keys: active_provider + providers)
  chrome.storage.local.get(['active_provider', 'providers', 'api_key'], (result) => {
    const activeId = result.active_provider;
    const providers = result.providers;
    const hasKey = __hasUsableApiKey(result);

    if (!hasKey) {
      __showBootBanner('[CONFIG] No API key found — active_provider=' + (activeId || 'null') + ' providers=' + (providers ? Object.keys(providers).join(',') : 'null'), '#ffaa00');
      const gi = document.getElementById('goalInput');
      if (gi) gi.placeholder = '⚠️ Set up API key in Settings first ⚠️';
    } else {
      __showBootBanner('[OK] Provider: ' + (activeId || 'legacy') + ' — ready', '#00aa44');
    }
  });
}, 600);

// Reconcile the CONFIG banner whenever provider settings change. The boot-time
// check above runs exactly once, but the side panel keeps its document alive
// across open/close — so a user who opens Settings, enters a key, and clicks
// "Test Connection" / "Save Settings" (both persist to active_provider+providers)
// would otherwise keep staring at the stale yellow "No API key found" banner for
// the life of the panel. When a usable key appears, retract the notice and
// restore the input placeholder. Guarded so the no-op storage mock in tests
// (no onChanged) doesn't throw.
try {
  if (chrome && chrome.storage && chrome.storage.onChanged &&
      typeof chrome.storage.onChanged.addListener === 'function') {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes) return;
      if (!('providers' in changes) && !('active_provider' in changes) && !('api_key' in changes)) return;
      chrome.storage.local.get(['active_provider', 'providers', 'api_key'], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        if (!__hasUsableApiKey(result)) return; // still misconfigured — leave the warning up
        __retractBannerLines('[CONFIG] No API key found');
        const gi = document.getElementById('goalInput');
        if (gi && String(gi.placeholder || '').indexOf('API key') !== -1) {
          gi.placeholder = 'Tell me what to do...';
        }
      });
    });
  }
} catch (_e) { /* onChanged unavailable — non-fatal */ }
