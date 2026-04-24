// Sentinel Override v3 -- Shadow DOM Utilities
// Shadow DOM piercing: queryDeep, queryDeepFirst, walkShadowTree, getShadowRoot.
// Supports both open shadow roots (direct access) and closed shadow roots
// (via attachShadow patch from shadow-intercept.js).

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.shadow = window.__sentinelUtils.shadow || {};

(function() {
  const shadow = window.__sentinelUtils.shadow;

  // ========== Get Shadow Root ==========
  // Returns el.shadowRoot for open roots, or checks the captured WeakMap
  // populated by shadow-intercept.js for closed roots.
  shadow.getShadowRoot = function(el) {
    if (!el) return null;
    // Open shadow root -- direct access
    if (el.shadowRoot) return el.shadowRoot;
    // Closed shadow root -- check intercepted WeakMap
    if (window.__sentinelCapturedRoots) {
      const captured = window.__sentinelCapturedRoots.get(el);
      if (captured) return captured;
    }
    return null;
  };

  // ========== Is In Shadow DOM ==========
  // Returns true if element's root node has a host (i.e., it lives inside a shadow DOM).
  shadow.isInShadowDOM = function(el) {
    if (!el) return false;
    try {
      const rootNode = el.getRootNode();
      return rootNode !== null && rootNode.host !== undefined;
    } catch (e) {
      return false;
    }
  };

  // ========== Walk Shadow Tree ==========
  // Walks entire DOM tree including open shadow roots, calling callback for each element.
  // Does NOT descend into closed shadow roots that were not intercepted.
  shadow.walkShadowTree = function(root, callback) {
    if (!root) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    let node = walker.currentNode;
    while (node) {
      callback(node);

      // If this element has a shadow root (open or intercepted closed), walk into it
      const sr = shadow.getShadowRoot(node);
      if (sr) {
        shadow.walkShadowTree(sr, callback);
      }

      // Also walk into any shadow roots of slot children
      const slots = node.querySelectorAll ? node.querySelectorAll('slot') : [];
      slots.forEach(function(slot) {
        const assignedNodes = slot.assignedNodes ? slot.assignedNodes({ flatten: true }) : [];
        assignedNodes.forEach(function(assigned) {
          if (assigned.nodeType === Node.ELEMENT_NODE) {
            callback(assigned);
            const assignedSR = shadow.getShadowRoot(assigned);
            if (assignedSR) {
              shadow.walkShadowTree(assignedSR, callback);
            }
          }
        });
      });

      node = walker.nextNode();
    }
  };

  // ========== Query Deep ==========
  // Recursively search piercing open shadow roots. Fast path: try querySelectorAll
  // first on the root, then walk all elements checking shadowRoot. Returns Element[].
  shadow.queryDeep = function(root, selector) {
    if (!root || !selector) return [];
    const results = [];

    // Fast path: try normal querySelectorAll on the root
    try {
      const direct = root.querySelectorAll(selector);
      direct.forEach(function(el) { results.push(el); });
    } catch (e) { /* invalid selector */ }

    // Walk the tree looking for shadow roots
    shadow.walkShadowTree(root, function(el) {
      // Skip the root itself (already queried)
      if (el === root) return;
      // Check if this element matches the selector
      try {
        if (el.matches && el.matches(selector)) {
          // Avoid duplicates (element might appear in both light and shadow DOM queries)
          if (results.indexOf(el) === -1) {
            results.push(el);
          }
        }
      } catch (e) { /* matches() not supported or invalid selector */ }

      // If this element has a shadow root, query inside it
      const sr = shadow.getShadowRoot(el);
      if (sr) {
        try {
          const shadowMatches = sr.querySelectorAll(selector);
          shadowMatches.forEach(function(matchEl) {
            if (results.indexOf(matchEl) === -1) {
              results.push(matchEl);
            }
          });
        } catch (e) { /* invalid selector in shadow context */ }
      }
    });

    return results;
  };

  // ========== Query Deep First ==========
  // Returns first match only (more efficient for single element lookups).
  shadow.queryDeepFirst = function(root, selector) {
    if (!root || !selector) return null;

    // Fast path: try normal querySelector on the root
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch (e) { /* invalid selector */ }

    // Walk the tree looking for shadow roots
    let found = null;
    shadow.walkShadowTree(root, function(el) {
      if (found) return; // already found, skip remaining
      if (el === root) return;

      try {
        if (el.matches && el.matches(selector)) {
          found = el;
          return;
        }
      } catch (e) { /* matches() not supported */ }

      // If this element has a shadow root, query inside it
      const sr = shadow.getShadowRoot(el);
      if (sr && !found) {
        try {
          const shadowMatch = sr.querySelector(selector);
          if (shadowMatch) {
            found = shadowMatch;
          }
        } catch (e) { /* invalid selector in shadow context */ }
      }
    });

    return found;
  };
})();
