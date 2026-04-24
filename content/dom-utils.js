// Sentinel Override v3 -- DOM Utilities
// Core DOM operations: visibility checks, label extraction, selector generation, element scanning.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.dom = window.__sentinelUtils.dom || {};

(function() {
  const dom = window.__sentinelUtils.dom;

  // ========== Visibility Check ==========
  dom.isVisible = function(el) {
    try {
      const style = document.defaultView.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    } catch (e) { /* non-fatal, assume visible */ }
    return true;
  };

  // ========== Label Extraction ==========
  dom.getLabel = function(el) {
    return (
      el.innerText ||
      el.placeholder ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('value') ||
      el.getAttribute('name') ||
      'No label'
    ).trim();
  };

  // ========== Multi-Strategy Selector ==========
  dom.getUniqueSelector = function(el) {
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

    if (el.id) {
      const genericIds = ['button', 'input', 'form', 'container', 'main', 'wrapper', 'div', 'span', 'content', 'body', 'header', 'footer', 'nav'];
      if (!genericIds.includes(el.id.toLowerCase())) return '#' + CSS.escape(el.id);
    }

    const tagName = el.tagName.toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tagName) && el.name) {
      return `${tagName}[name="${CSS.escape(el.name)}"]`;
    }

    return dom.getNthOfTypePath(el);
  };

  dom.getNthOfTypePath = function(el) {
    const MAX_DEPTH = 8;
    const path = [];
    let current = el;
    let depth = 0;
    while (current && current.parentElement && depth < MAX_DEPTH) {
      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      path.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (index + 1) + ')');
      current = current.parentElement;
      depth++;
    }
    return path.join(' > ');
  };

  // ========== Find Element by Selector ==========
  dom.findElementBySelector = function(doc, selector) {
    if (!selector) return null;
    try {
      const el = doc.querySelector(selector);
      if (el) return el;
    } catch (e) {}

    const testIdMatch = selector.match(/^\[data-testid="(.+)"\]$/);
    if (testIdMatch) {
      const el = doc.querySelector(`[data-testid="${testIdMatch[1]}"]`);
      if (el) return el;
    }

    const ariaMatch = selector.match(/^\[aria-label="(.+)"\]$/);
    if (ariaMatch) {
      const el = doc.querySelector(`[aria-label="${ariaMatch[1]}"]`);
      if (el) return el;
    }

    const nameMatch = selector.match(/^(\w+)\[name="(.+)"\]$/);
    if (nameMatch) {
      const el = doc.querySelector(`${nameMatch[1]}[name="${nameMatch[2]}"]`);
      if (el) return el;
    }

    return null;
  };

  // ========== Document Scanning ==========
  dom.scanDocument = function(doc, interactiveElements, selectorMap, prefix) {
    // Extended selector list -- includes enterprise/dashboard UI patterns
    const elements = doc.querySelectorAll([
      'button', 'a', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="textbox"]',
      '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="menuitem"]',
      '[role="tab"]', '[role="switch"]', '[role="radio"]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
      '[onclick]'
    ].join(', '));

    elements.forEach((el) => {
      // Skip hidden, disabled, zero-size, or off-screen elements
      if (!dom.isVisible(el)) return;

      const text = dom.getLabel(el);

      const selector = prefix + dom.getUniqueSelector(el);
      if (selectorMap.has(selector)) return;
      selectorMap.set(selector, true);

      interactiveElements.push({
        index: interactiveElements.length,
        tag: el.tagName,
        text: text.substring(0, 100),
        selector: selector,
        role: el.getAttribute('role') || 'none',
        type: el.getAttribute('type') || 'none'
      });
    });
  };
})();
