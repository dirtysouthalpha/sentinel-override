// Sentinel Override v3 -- Highlight Utilities
// Element highlight/removeHighlight for visual feedback during action execution.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.highlight = window.__sentinelUtils.highlight || {};

(function() {
  const hl = window.__sentinelUtils.highlight;

  hl.highlightElement = function(el) {
    try {
      el._sentinelOriginalOutline = el.style.outline;
      el._sentinelOriginalOutlineOffset = el.style.outlineOffset;
      el._sentinelOriginalTransition = el.style.transition;
      el.style.outline = '3px solid #ff6600';
      el.style.outlineOffset = '2px';
      el.style.transition = 'outline 0.15s ease';
    } catch (e) {}
  };

  hl.removeHighlight = function(el) {
    try {
      setTimeout(() => {
        el.style.outline = el._sentinelOriginalOutline || '';
        el.style.outlineOffset = el._sentinelOriginalOutlineOffset || '';
        el.style.transition = el._sentinelOriginalTransition || '';
      }, 500);
    } catch (e) {}
  };
})();
