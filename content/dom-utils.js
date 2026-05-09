// Sentinel Override v3 -- DOM Utilities
// Core DOM operations: visibility checks, label extraction, selector generation, element scanning.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.dom = window.__sentinelUtils.dom || {};
// Wave 2: ref id + bbox emission per element. See ref helpers below.

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

  // ========== Interactability Check (#20) ==========
  dom.checkInteractable = function(el, action) {
    if (!el) return 'Element not found';
    try {
      const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const style = view.getComputedStyle(el);
      if (action === 'click' && style.pointerEvents === 'none') {
        return 'Element is pointer-events:none';
      }
      if (el.disabled === true) return 'Element is disabled';
      const ariaDisabled = el.getAttribute && el.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') return 'Element is aria-disabled';
    } catch (e) { /* non-fatal */ }
    return null;
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

    const shadow = window.__sentinelUtils && window.__sentinelUtils.shadow;
    if (shadow && shadow.queryDeepFirst) {
      const shadowEl = shadow.queryDeepFirst(doc, selector);
      if (shadowEl) return shadowEl;
    }

    return null;
  };

  // ========== Ref ID System (#10 -- Wave 2) ==========
  // Scan-local stable ref ids ("ref_1", "ref_2", ...). Each scanDocument call
  // resets the counter and rebuilds the lookup map. WeakRef map lets the
  // dispatcher resolve a ref back to the live Element node; old refs deref to
  // null after the next scan -- the dispatcher treats that as a stale-ref
  // fallback to selector.

  let __sentinelRefCounter = 0;
  let __sentinelRefLookup = new Map();
  let __sentinelScanId = 0;

  dom._beginScan = function() {
    __sentinelRefCounter = 0;
    __sentinelRefLookup = new Map();
    __sentinelScanId++;
  };

  dom._assignRef = function(el) {
    __sentinelRefCounter++;
    const refId = 'ref_' + __sentinelRefCounter;
    try {
      const wr = (typeof WeakRef === 'function') ? new WeakRef(el) : { deref: () => el };
      __sentinelRefLookup.set(refId, wr);
    } catch (e) {
      __sentinelRefLookup.set(refId, { deref: () => el });
    }
    return refId;
  };

  dom.findElementByRef = function(refId) {
    if (!refId || typeof refId !== 'string') return null;
    const wr = __sentinelRefLookup.get(refId);
    if (!wr) return null;
    let el = null;
    try { el = wr.deref ? wr.deref() : null; } catch (e) { el = null; }
    if (!el) return null;
    try {
      if (!el.isConnected) return null;
    } catch (e) { return null; }
    return el;
  };

  dom.getCurrentScanId = function() { return __sentinelScanId; };

  // ========== Document Scanning ==========
  dom.scanDocument = function(doc, interactiveElements, selectorMap, prefix) {
    const shadow = window.__sentinelUtils && window.__sentinelUtils.shadow;
    if (!prefix) {
      dom._beginScan();
    }

    const interactiveSelectors = [
      'button', 'a', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="textbox"]',
      '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="menuitem"]',
      '[role="tab"]', '[role="switch"]', '[role="radio"]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
      '[onclick]'
    ].join(', ');

    const elements = doc.querySelectorAll(interactiveSelectors);
    elements.forEach((el) => {
      if (!dom.isVisible(el)) return;
      dom._addElement(el, interactiveElements, selectorMap, prefix, false);
    });

    if (shadow && shadow.walkShadowTree && shadow.isInShadowDOM) {
      shadow.walkShadowTree(doc, function(el) {
        if (el === doc || doc.contains(el)) return;
        try {
          if (el.matches && el.matches(interactiveSelectors)) {
            if (dom.isVisible(el)) {
              dom._addElement(el, interactiveElements, selectorMap, prefix, shadow.isInShadowDOM(el));
            }
          }
        } catch (e) {}
      });
    }
  };

  // Internal helper: add an element to the interactive elements list
  dom._addElement = function(el, interactiveElements, selectorMap, prefix, inShadowDOM) {
    const text = dom.getLabel(el);
    const selector = prefix + dom.getUniqueSelector(el);
    if (selectorMap.has(selector)) return;
    selectorMap.set(selector, true);

    // (#10) Stable ref id + bbox per element so the LLM can use refs and the
    // model can correlate screenshot pixels to DOM nodes.
    const refId = dom._assignRef(el);
    let bbox = null;
    try {
      const r = el.getBoundingClientRect();
      bbox = {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    } catch (e) {}

    const elementData = {
      index: interactiveElements.length,
      tag: el.tagName,
      text: text.substring(0, 100),
      selector: selector,
      role: el.getAttribute('role') || 'none',
      type: el.getAttribute('type') || 'none',
      ref: refId,
      bbox: bbox
    };

    if (el.tagName === 'SELECT') {
      const opts = Array.from(el.options).slice(0, 30);
      elementData.options = opts.map(o => ({ value: o.value, text: o.textContent.trim().substring(0, 60) }));
      elementData.multiple = el.multiple;
    }

    if (el.type === 'checkbox' || el.type === 'radio') {
      elementData.checked = el.checked;
    }

    if (inShadowDOM) {
      elementData.inShadowDOM = true;
    }

    interactiveElements.push(elementData);
  };
})();
