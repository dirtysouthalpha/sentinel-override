// Sentinel Override v3 -- Content Script Entry Point
// Handles DOM observation, element scanning, action execution, and dynamic tools.
// Orchestrates utility modules loaded on window.__sentinelUtils.

// Re-injection guard: if already initialized, just signal ready and return early.
// This prevents duplicate message listeners and duplicate MutationObservers
// when content/index.js is injected multiple times (e.g., on page navigation).
if (window.__sentinelInitialized) {
  chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
} else {
  window.__sentinelInitialized = true;

  // Shorthand references to utility modules
  const dom = window.__sentinelUtils.dom;
  const hl = window.__sentinelUtils.highlight;
  const wait = window.__sentinelUtils.wait;

  // ========== Message Handler ==========
  async function handleMessage(request) {
    switch (request.action) {
      case 'observe_page': {
        const interactiveElements = [];
        const selectorMap = new Map();
        dom.scanDocument(document, interactiveElements, selectorMap, '');
        // Scan iframes
        try {
          const iframes = document.querySelectorAll('iframe');
          iframes.forEach((iframe, frameIndex) => {
            try {
              const iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
              if (iframeDoc) dom.scanDocument(iframeDoc, interactiveElements, selectorMap, `frame:${frameIndex}:`);
            } catch (e) { /* cross-origin */ }
          });
        } catch (e) {}
        return { elements: interactiveElements };
      }

      case 'read_page': {
        const title = document.title;
        const url = window.location.href;

        // Smart content extraction: prefer semantic content areas over raw body.innerText.
        // Raw body on Etsy/eBay/Amazon is 50,000+ chars of mixed nav/cookie/footer garbage.
        // Extract the primary content area and skip boilerplate, cutting the payload by ~80%.
        let content = '';
        const mainSelectors = ['main', '[role="main"]', 'article', '#main-content', '#content', '.main-content', '.content'];
        let mainEl = null;
        for (const sel of mainSelectors) {
          mainEl = document.querySelector(sel);
          if (mainEl) break;
        }

        if (mainEl) {
          // Clone to avoid mutating the live DOM
          const clone = mainEl.cloneNode(true);
          // Remove common boilerplate from within main
          const skip = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', '[role="banner"]',
            '.cookie-notice', '.cookie-banner', '#cookie', '.ad', '.advertisement', '[aria-hidden="true"]',
            'script', 'style', 'noscript', 'svg'];
          skip.forEach(s => { try { clone.querySelectorAll(s).forEach(el => el.remove()); } catch(e) {} });
          content = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        }

        // Fall back to full body if main content area is tiny or missing
        if (!content || content.length < 200) {
          const bodyClone = document.body.cloneNode(true);
          ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript'].forEach(tag => {
            bodyClone.querySelectorAll(tag).forEach(el => el.remove());
          });
          content = (bodyClone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
        }

        return { content: `Page Title: ${title}\nURL: ${url}\n\n${content}` };
      }

      case 'execute_command': {
        const cmd = request.command;
        const result = await executeCommand(cmd);
        // If executeCommand returns an error string, throw so the wrapper sends { ok: false, error }
        if (typeof result === 'string' && (result.startsWith('Error') || result.includes(' not found') || result.includes('Element not found') || result.includes('No element'))) {
          throw new Error(result);
        }
        return { result };
      }

      case 'wait_for': {
        return await wait.handleWaitFor(request.condition);
      }

      default:
        throw new Error('Unknown action: ' + request.action);
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async responses
  });

  // ========== Command Execution ==========
  async function executeCommand(cmd) {
    let targetDoc = document;
    let selector = cmd.selector;

    // Check if command targets an iframe
    if (selector && selector.startsWith('frame:')) {
      const parts = selector.split(':');
      const frameIndex = parseInt(parts[1]);
      const iframeSelector = parts.slice(2).join(':');
      const iframes = document.querySelectorAll('iframe');
      if (iframes[frameIndex]) {
        try {
          targetDoc = iframes[frameIndex].contentWindow.document;
          selector = iframeSelector;
        } catch (e) {
          return 'Cannot access iframe (cross-origin)';
        }
      } else {
        return 'Iframe not found at index ' + frameIndex;
      }
    }

    switch (cmd.type) {
      case 'click': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        // Dispatch full mouse sequence -- many enterprise UIs (SonicWall, Cisco, etc.)
        // bind to mousedown/mouseup rather than click and won't respond to el.click() alone.
        const mouseOpts = { bubbles: true, cancelable: true, view: targetDoc.defaultView };
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        hl.removeHighlight(el);
        return 'Clicked ' + cmd.selector;
      }

      case 'type': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const text = cmd.text || '';

        // contenteditable div/span -- used by many enterprise dashboard filter/search inputs
        if (el.isContentEditable) {
          el.textContent = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          // Use execCommand for broadest compatibility with SPA frameworks
          targetDoc.execCommand('selectAll', false, null);
          targetDoc.execCommand('delete', false, null);
          for (const char of text) {
            targetDoc.execCommand('insertText', false, char);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          hl.removeHighlight(el);
          return 'Typed into contenteditable ' + cmd.selector;
        }

        // Standard INPUT / TEXTAREA -- clear then type char-by-char for React/Vue compatibility
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA'
              ? targetDoc.defaultView.HTMLTextAreaElement.prototype
              : targetDoc.defaultView.HTMLInputElement.prototype,
            'value'
          ).set;
          nativeSetter.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          for (const char of text) {
            const currentVal = el.value;
            nativeSetter.call(el, currentVal + char);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          hl.removeHighlight(el);
          return 'Typed into ' + cmd.selector;
        }

        // Fallback for any other focusable element
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        hl.removeHighlight(el);
        return 'Typed into ' + cmd.selector;
      }

      case 'scroll': {
        targetDoc.defaultView.scrollBy(0, cmd.amount || 0);
        return 'Scrolled ' + (cmd.amount || 0);
      }

      case 'select': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        if (el.tagName !== 'SELECT') return 'Element is not a <select>: ' + cmd.selector;
        hl.highlightElement(el);
        el.value = cmd.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        hl.removeHighlight(el);
        return 'Selected "' + cmd.value + '" in ' + cmd.selector;
      }

      case 'hover': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const hoverEvent = new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: targetDoc.defaultView });
        el.dispatchEvent(hoverEvent);
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        hl.removeHighlight(el);
        return 'Hovered over ' + cmd.selector;
      }

      case 'press_key': {
        const key = cmd.key || 'Enter';
        const keyMap = {
          'Enter': 'Enter', 'Tab': 'Tab', 'Escape': 'Escape', 'Backspace': 'Backspace',
          'ArrowDown': 'ArrowDown', 'ArrowUp': 'ArrowUp', 'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
          ' ': ' ', 'Space': ' '
        };
        const keyVal = keyMap[key] || key;
        const activeEl = targetDoc.activeElement || document.body;
        activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: keyVal, bubbles: true }));
        activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: keyVal, bubbles: true }));
        if (keyVal === 'Enter') activeEl.dispatchEvent(new KeyboardEvent('keypress', { key: keyVal, bubbles: true }));
        return 'Pressed key: ' + key;
      }

      case 'execute_js': {
        const code = cmd.code || '';
        if (!code) return 'No code provided';
        try {
          // Execute with a timeout
          const result = await Promise.race([
            new Promise((resolve) => {
              try {
                const fn = new Function('document', 'window', `"use strict"; return (async () => { ${code} })()`);
                const result = fn(targetDoc, targetDoc.defaultView);
                resolve(result);
              } catch (syncErr) {
                resolve('Execution error: ' + syncErr.message);
              }
            }),
            new Promise(resolve => setTimeout(() => resolve('Code execution timed out (5s)'), 5000))
          ]);
          const resultStr = typeof result === 'object' ? JSON.stringify(result).substring(0, 500) : String(result || '').substring(0, 500);
          return 'JS Result: ' + resultStr;
        } catch (err) {
          return 'JS Error: ' + err.message;
        }
      }

      case 'extract': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        let value;
        const attr = cmd.attribute || 'text';
        if (attr === 'text') {
          value = (el.innerText || el.textContent || '').trim();
        } else if (attr === 'href') {
          value = el.href || '';
        } else {
          value = el.getAttribute(attr) || '';
        }
        return JSON.stringify({ key: cmd.key, value: value.substring(0, 1000) });
      }

      case 'extract_list': {
        // Batch extract: find all containers matching cmd.selector, then for each
        // extract the fields defined in cmd.fields (a map of fieldName -> childSelector).
        // Returns a JSON array stored in agentMemory under cmd.key.
        if (!cmd.selector) return JSON.stringify({ key: cmd.key, value: [] });
        let containers;
        try {
          containers = Array.from(targetDoc.querySelectorAll(cmd.selector));
        } catch (e) {
          return 'Element not found: ' + cmd.selector;
        }
        if (!containers.length) return 'Element not found: ' + cmd.selector;
        const limit = cmd.limit || 20;
        const fields = cmd.fields || {};
        const items = containers.slice(0, limit).map(container => {
          const item = {};
          for (const [fieldName, fieldSelector] of Object.entries(fields)) {
            try {
              const child = fieldSelector === 'self'
                ? container
                : container.querySelector(fieldSelector);
              if (child) {
                item[fieldName] = (child.innerText || child.textContent || child.getAttribute('href') || '').trim().substring(0, 200);
              } else {
                item[fieldName] = '';
              }
            } catch (e) {
              item[fieldName] = '';
            }
          }
          return item;
        });
        return JSON.stringify({ key: cmd.key, value: items });
      }

      default:
        return 'Unknown command type: ' + cmd.type;
    }
  }

  // ========== SPA Page Transition Detection ==========
  function setupSPAObservers() {
    let spaDebounce = null;

    // 1. MutationObserver for DOM content changes (catches SPA renders)
    const domObserver = new MutationObserver((mutations) => {
      const significantChange = mutations.some(m =>
        m.addedNodes.length > 0 || m.removedNodes.length > 0
      );
      if (significantChange) {
        clearTimeout(spaDebounce);
        spaDebounce = setTimeout(() => {
          chrome.runtime.sendMessage({
            action: 'spa_content_changed',
            url: window.location.href
          }).catch(() => {}); // non-critical, best-effort
        }, 500); // 500ms debounce: wait for SPA render to settle
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 2. URL change detection (hash routing, pushState/replaceState)
    let lastUrl = window.location.href;

    const dispatchSPATransition = (url) => {
      clearTimeout(spaDebounce);
      spaDebounce = setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'spa_navigation',
          url: url
        }).catch(() => {});
      }, 300);
    };

    // Patch pushState/replaceState for SPA routers
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        dispatchSPATransition(lastUrl);
      }
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        dispatchSPATransition(lastUrl);
      }
    };

    window.addEventListener('popstate', () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        dispatchSPATransition(lastUrl);
      }
    });
  }

  setupSPAObservers();

  // Signal ready
  chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
}
