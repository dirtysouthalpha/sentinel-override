// Sentinel Override v3 -- Shadow DOM Utilities
// Shadow DOM piercing: queryDeep, queryDeepFirst, walkShadowTree, getShadowRoot.
// Stubs for Task 1A -- full implementations added in Task 1B.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.shadow = window.__sentinelUtils.shadow || {};

(function() {
  const shadow = window.__sentinelUtils.shadow;

  // Stubs -- populated with full implementations in Task 1B
  shadow.queryDeep = function(root, selector) {
    return [];
  };

  shadow.queryDeepFirst = function(root, selector) {
    return null;
  };

  shadow.getShadowRoot = function(el) {
    return el && el.shadowRoot ? el.shadowRoot : null;
  };

  shadow.walkShadowTree = function(root, callback) {
    // no-op stub
  };

  shadow.isInShadowDOM = function(el) {
    return false;
  };
})();
