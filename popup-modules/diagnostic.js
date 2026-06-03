// Sentinel Override — Startup Diagnostic
// Runs immediately on popup load. Tests SW connection and shows results.
// Remove this file once the startup bug is fixed.

(function runDiagnostic() {
  const results = [];
  const container = document.createElement('div');
  container.id = 'diag-overlay';
  container.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#0d1117;color:#58a6ff;font:11px/1.5 monospace;padding:8px 12px;border-bottom:2px solid #f85149;max-height:40vh;overflow-y:auto;';

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function log(msg, ok) {
    const icon = ok === true ? '✅' : ok === false ? '❌' : 'ℹ️';
    results.push(`${icon} ${_esc(msg)}`);
    container.innerHTML = results.map(r => `<div>${r}</div>`).join('');
  }

  if (document.body) {
    document.body.prepend(container);
    log('Sentinel Diagnostic v4.0.1 starting...', null);
  }

  // Test 1: Service Worker reachable?
  log('Testing chrome.runtime.sendMessage...', null);
  chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
    if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && chrome.runtime.lastError) {
      log('SW NOT REACHABLE: ' + (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : 'Unknown error'), false);
      log('The service worker is crashed or not running. Try:', null);
      log('1. Remove extension completely', null);
      log('2. Close ALL Chrome windows', null);
      log('3. Reopen Chrome and reload unpacked', null);
    } else {
      let respStr;
      try {
        respStr = JSON.stringify(response).slice(0, 200);
      } catch (_e) {
        respStr = '(unserializable response)';
      }
      log('SW responded: ' + respStr, true);
    }
  });

  // Test 2: Can we read settings?
  chrome.storage.local.get(['active_provider', 'providers', 'api_key', 'api_endpoint', 'model'], (stored) => {
    if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && chrome.runtime.lastError) {
      log('Storage read failed: ' + (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : 'Unknown error'), false);
      return;
    }
    const provider = stored.active_provider || 'none';
    const hasProviders = !!(stored.providers && Object.keys(stored.providers).length);
    const hasKey = !!(stored.providers?.[provider]?.api_key || stored.api_key);
    const model = stored.providers?.[provider]?.model || stored.model || 'none';

    log(`Provider: ${provider}`, !!provider && provider !== 'none');
    log(`Has provider configs: ${hasProviders ? Object.keys(stored.providers).join(', ') : 'none'}`, hasProviders);
    log(`API key set: ${hasKey ? 'yes (' + (stored.providers?.[provider]?.api_key || stored.api_key || '').slice(0, 8) + '...)' : 'NO'}`, hasKey);
    log(`Model: ${model}`, !!model && model !== 'none');

    if (!hasKey) {
      log('⚠️ No API key configured! Go to Settings tab.', false);
    }
  });

  // Test 3: Check if sendBtn listener is attached
  setTimeout(() => {
    const btn = document.getElementById('sendBtn');
    if (btn) {
      log('Send button found ✅ (click Run to test full flow)', true);
      // Add a one-time click listener for debugging
      btn.addEventListener('click', function diagClick() {
        log('Run button clicked!', true);
        btn.removeEventListener('click', diagClick);
      }, true);
    } else {
      log('Send button NOT FOUND in DOM', false);
    }

    const input = document.getElementById('goalInput');
    if (input) {
      log('Goal input found', true);
    } else {
      log('Goal input NOT FOUND', false);
    }

    // Test 4: Check for JS errors
    log('If you see all ✅ above, the popup is working.', null);
    log('If Run still does nothing, check service worker logs:', null);
    log('chrome://extensions → Sentinel Override → "Inspect views: service worker"', null);
  }, 500);

  // Auto-hide after 15 seconds if everything passes
  setTimeout(() => {
    const fails = results.filter(r => r.includes('❌'));
    if (fails.length === 0) {
      container.style.borderBottom = '2px solid #3fb950';
      setTimeout(() => { container.style.display = 'none'; }, 3000);
    }
  }, 15000);
})();
