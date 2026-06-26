
// ========== (v21.6) Anti-Detection: Patch navigator.webdriver ==========
// Many admin panels (M365, SentinelOne, ConnectWise) detect automation
// via navigator.webdriver === true and block the session. This patch
// runs in the MAIN world at document_start to remove that fingerprint.
try {
  if (typeof navigator !== 'undefined' && 'webdriver' in navigator) {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true
    });
  }
  // Also patch common detection vectors
  if (typeof navigator !== 'undefined') {
    // Remove Headless Chrome indicators
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5], // fake plugins array
        configurable: true
      });
    }
    // Add realistic languages
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
      });
    }
  }
  // Mask the WebDriver Chrome runtime flag
  if (typeof window !== 'undefined' && window.chrome) {
    // Ensure chrome.runtime exists but doesn't expose automation
    if (!window.chrome.runtime) {
      window.chrome.runtime = {};
    }
  }
} catch (_e) {
  // Non-fatal — some pages lock navigator props
}

// Sentinel Override v3 -- Shadow Root Interception (MAIN world, document_start)
// Patches Element.prototype.attachShadow as early as possible so that closed
// shadow roots created by inline <head> scripts are still captured.
//
// Runs in MAIN world (see manifest.json content_scripts entry) so the patch
// is visible to page scripts that create shadow roots before any ISOLATED-world
// content script could install hooks.
//
// Exposes captured roots via:
//   window.__sentinelCapturedRoots  -- WeakMap<Element, ShadowRoot>
//   window.__sentinelShadowRoots    -- Set<ShadowRoot> (iterable, for ISOLATED world)
//
// Contains NO chrome.* API access -- MAIN world has no access to extension APIs.
// ISOLATED-world content scripts read the stashed roots from these globals.

(function() {
  'use strict';

  if (window.__sentinelShadowIntercepted) return;
  window.__sentinelShadowIntercepted = true;

  // WeakMap: host element -> shadowRoot (preferred lookup)
  window.__sentinelCapturedRoots = new WeakMap();
  // Set of all captured shadow roots (iterable for scanning)
  window.__sentinelShadowRoots = new Set();

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const shadowRoot = originalAttachShadow.call(this, init);
    try {
      window.__sentinelCapturedRoots.set(this, shadowRoot);
      window.__sentinelShadowRoots.add(shadowRoot);
    } catch (error) {
      console.error('[Sentinel] Failed to intercept shadow root:', typeof error === 'object' && error !== null && typeof error.message === 'string' ? error.message : String(error));
    }
    return shadowRoot;
  };
})();