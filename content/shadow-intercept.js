// Sentinel Override v3 -- Shadow Root Interception
// Early-injection script (document_start) that patches attachShadow to capture
// references to ALL shadow roots including closed ones.
// Stores captured roots in a WeakMap on window.__sentinelCapturedRoots.

(function() {
  'use strict';

  if (window.__sentinelShadowIntercepted) return;
  window.__sentinelShadowIntercepted = true;

  window.__sentinelCapturedRoots = new WeakMap();

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const shadowRoot = originalAttachShadow.call(this, init);
    window.__sentinelCapturedRoots.set(this, shadowRoot);
    return shadowRoot;
  };
})();
