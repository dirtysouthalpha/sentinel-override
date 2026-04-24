// Sentinel Override v3 — Tab Manager
// Tab locking, page load waiting, content script injection, screenshot capture.
// Imports from message-protocol.js only (no circular dependency risk).

// ========== Page Load Waiting ==========
let pageLoadConfig = {
  pageLoadTimeout: 25000
};

export function setPageLoadConfig(config) {
  pageLoadConfig = { ...pageLoadConfig, ...config };
}

export async function waitForPageLoad(tabId) {
  const tab = await new Promise(resolve => { chrome.tabs.get(tabId, (i) => { resolve(chrome.runtime.lastError ? null : i); }); });
  if (!tab || tab.status === 'complete') return;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, pageLoadConfig.pageLoadTimeout);
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timeout); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ========== Content Script Injection ==========
export function createContentScriptListener(tabId, timeout = 3000) {
  let timer, listener, resolved = false;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => { if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); resolve(false); }, timeout);
    listener = (msg, sender) => {
      if (msg.action === 'content_script_ready' && sender.tab && sender.tab.id === tabId) {
        if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); clearTimeout(timer); resolve(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
  return { promise, cancel() { if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); clearTimeout(timer); } };
}

/**
 * Inject the content script into the target tab, with retry logic.
 * Returns true if the content script signaled ready, false otherwise.
 *
 * @param {number} tabId
 * @param {number} [maxAttempts=3]
 * @returns {Promise<boolean>}
 */
export async function injectContentScript(tabId, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const csListener = createContentScriptListener(tabId);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const scriptReady = await csListener.promise;
      if (scriptReady) return true;
    } catch (err) { csListener.cancel(); }
    await sleep(500);
  }
  return false;
}

// ========== Message Sending with Retry ==========
export async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      if (i < maxRetries - 1) {
        const csListener = createContentScriptListener(tabId, 2000);
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await csListener.promise; } catch (e) { csListener.cancel(); }
        await sleep(500 * (i + 1));
      } else { throw err; }
    }
  }
}

// ========== Screenshot Capture ==========
/**
 * Take a screenshot of the given tab using CDP, with captureVisibleTab as fallback.
 * Returns { base64Image, url } or null if screenshot fails.
 *
 * @param {number} tabId
 * @param {number} windowId
 * @param {string} currentUrl - The current URL (for caching)
 * @param {object} screenshotCache - { cachedBase64Image, lastScreenshotUrl } mutable ref
 * @param {object} CONFIG - { screenshotQuality, screenshotCache }
 * @param {number} stepNumber - For status messages
 * @param {function} sendSilentUpdateFn - Reference to sendSilentUpdate
 * @returns {Promise<{ base64Image: string, url: string }|null>}
 */
export async function takeScreenshot(tabId, windowId, currentUrl, screenshotCache, CONFIG, stepNumber, sendSilentUpdateFn) {
  if (CONFIG.screenshotCache && screenshotCache.cachedBase64Image && screenshotCache.lastScreenshotUrl === currentUrl) {
    return { base64Image: screenshotCache.cachedBase64Image, url: currentUrl };
  }

  let base64Image = null;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    const screenshotResult = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'jpeg', quality: CONFIG.screenshotQuality });
    await chrome.debugger.detach({ tabId });
    base64Image = screenshotResult.data;
  } catch (debuggerErr) {
    try { await chrome.debugger.detach({ tabId }); } catch(e) {}
    try {
      const screenshot_data_url = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: CONFIG.screenshotQuality }, (dataUrl) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(dataUrl);
        });
      });
      base64Image = screenshot_data_url.split(',')[1];
    } catch (err) {
      if (sendSilentUpdateFn) sendSilentUpdateFn('Screenshot skipped (text-only mode)', stepNumber);
      return null;
    }
  }

  if (base64Image) {
    screenshotCache.cachedBase64Image = base64Image;
    screenshotCache.lastScreenshotUrl = currentUrl;
    return { base64Image, url: currentUrl };
  }
  return null;
}

// ========== Validation ==========
export function isValidUrl(url) {
  try { const p = new URL(url); return ['http:', 'https:'].includes(p.protocol); } catch { return false; }
}

// ========== Tab Info ==========
/**
 * Get tab info with lastError handling.
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getTabInfo(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, (info) => { resolve(chrome.runtime.lastError ? null : info); });
  });
}

// ========== Utilities ==========
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
