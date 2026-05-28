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
  Element.prototype.attachShadow = async function(init) {
    try {
      const shadowRoot = await originalAttachShadow.call(this, init);
      window.__sentinelCapturedRoots.set(this, shadowRoot);
      window.__sentinelShadowRoots.add(shadowRoot);
    } catch (error) {
      console.error('Failed to intercept shadow root:', error);
    }
  };
})();