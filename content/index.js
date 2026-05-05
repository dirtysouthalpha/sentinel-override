// Sentinel Override v3 -- Content Script Entry Point
// Handles DOM observation, element scanning, action execution, and dynamic tools.
// Orchestrates utility modules loaded on window.__sentinelUtils.

// Re-injection guard: if already initialized, just signal ready and return early.
// This prevents duplicate message listeners and duplicate MutationObservers
// when content/index.js is injected multiple times (e.g., on page navigation).
if (window.__sentinelInitialized) {
  try { chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {}); } catch (e) {}
} else {
  window.__sentinelInitialized = true;

  // Shorthand references to utility modules
  const dom = window.__sentinelUtils.dom;
  const hl = window.__sentinelUtils.highlight;
  const wait = window.__sentinelUtils.wait;
  const dd = window.__sentinelUtils.dropdown;
  const si = window.__sentinelUtils.specialInputs;
  const ov = window.__sentinelUtils.overlay;
  const fm = window.__sentinelUtils.frame;

  // ========== Message Handler ==========
  async function handleMessage(request) {
    switch (request.action) {
      case 'observe_page': {
        // Scan for interactive elements. Retry up to 3 times for SPAs (React, Vue, Angular)
        // that render content asynchronously after the initial page load.
        let interactiveElements = [];
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            interactiveElements = [];
            const selectorMap = new Map();
            dom.scanDocument(document, interactiveElements, selectorMap, '');
            // Scan iframes using frame-manager
            if (fm && fm.scanIframes) {
              try {
                const iframeResult = fm.scanIframes(document);
                if (iframeResult.elements) {
                  iframeResult.elements.forEach(el => interactiveElements.push(el));
                }
              } catch (e) { /* fallback: no iframe scanning */ }
            }
            // If we found elements, stop retrying
            if (interactiveElements.length >= 5) break;
          } catch (e) {
            if (e.message && e.message.includes('Extension context invalidated')) throw e;
          }
          // Wait for SPA to render
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, 1500));
          }
        }
        return { elements: interactiveElements };
      }

      case 'read_page': {
        const title = document.title;
        const url = window.location.href;

        // Smart content extraction: prefer semantic content areas over raw body.innerText.
        // Includes retry loop for SPAs that render content asynchronously (CNN, React apps, etc.)
        const maxRetries = 3;
        const retryDelay = 1500;
        let content = '';

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            content = '';
            const mainSelectors = ['main', '[role="main"]', 'article', '#main-content', '#content', '.main-content', '.content'];
            let mainEl = null;
            for (const sel of mainSelectors) {
              mainEl = document.querySelector(sel);
              if (mainEl) break;
            }

            if (mainEl) {
              const clone = mainEl.cloneNode(true);
              const skip = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', '[role="banner"]',
                '.cookie-notice', '.cookie-banner', '#cookie', '.ad', '.advertisement', '[aria-hidden="true"]',
                'script', 'style', 'noscript', 'svg'];
              skip.forEach(s => { try { clone.querySelectorAll(s).forEach(el => el.remove()); } catch(e) {} });
              content = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
            }

            if (!content || content.length < 200) {
              const bodyClone = document.body.cloneNode(true);
              ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript'].forEach(tag => {
                bodyClone.querySelectorAll(tag).forEach(el => el.remove());
              });
              content = (bodyClone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
            }

            // If we got meaningful content, stop retrying
            if (content.length >= 200) break;
          } catch (e) {
            if (e.message && e.message.includes('Extension context invalidated')) throw e;
          }
          // Wait for SPA to render before retrying
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, retryDelay));
          }
        }

        // If still empty after retries, try scrolling down to trigger lazy load
        if (content.length < 200) {
          try {
            window.scrollTo(0, document.body.scrollHeight / 3);
            await new Promise(r => setTimeout(r, 1000));
            const bodyText = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
            if (bodyText.length > content.length) content = bodyText;
          } catch (e) { /* page may have navigated away */ }
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

      case 'read_iframe': {
        const frameIndex = request.frameIndex || 0;
        const iframes = document.querySelectorAll('iframe');
        if (!iframes[frameIndex]) throw new Error('Iframe not found at index ' + frameIndex);
        try {
          const iframeDoc = iframes[frameIndex].contentWindow.document;
          const title = iframeDoc.title || '';
          const url = iframes[frameIndex].src || '';
          let content = '';
          const mainSelectors = ['main', '[role="main"]', 'article', '#main-content', '#content'];
          let mainEl = null;
          for (const sel of mainSelectors) {
            mainEl = iframeDoc.querySelector(sel);
            if (mainEl) break;
          }
          if (mainEl) {
            content = (mainEl.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
          } else {
            content = (iframeDoc.body ? iframeDoc.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim();
          }
          return { content: 'Iframe Title: ' + title + '\nURL: ' + url + '\n\n' + content };
        } catch (e) {
          return { ok: false, error: 'Cross-origin iframe -- use background routing' };
        }
      }

      default:
        throw new Error('Unknown action: ' + request.action);
    }
  }

  // ========== Visual Overlay System ==========
  // Shows the user what the agent is doing on the page: action banner + click indicators.

  const SENTINEL_OVERLAY_ID = '__sentinel_overlay__';

  function getOrCreateOverlay() {
    try {
      let overlay = document.getElementById(SENTINEL_OVERLAY_ID);
      if (overlay) return overlay;

      const style = document.createElement('style');
      style.id = SENTINEL_OVERLAY_ID + '_style';
      style.textContent = `
        #__sentinel_overlay__ {
          position: fixed; top: 12px; right: 12px; z-index: 2147483647;
          background: #1a1a2e; color: #e0e0e0; border: 1px solid #4a4a8a;
          border-radius: 8px; padding: 8px 14px; font-family: monospace;
          font-size: 12px; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          pointer-events: none; transition: opacity 0.3s;
        }
        #__sentinel_overlay__ .sentinel-action { color: #7eb8ff; font-weight: bold; }
        #__sentinel_overlay__ .sentinel-target { color: #ffa07a; margin-top: 2px; }
        #__sentinel_click_indicator__ {
          position: fixed; z-index: 2147483646; pointer-events: none;
          width: 24px; height: 24px; border-radius: 50%;
          border: 2px solid #ff4444; background: rgba(255,68,68,0.15);
          transform: translate(-50%, -50%);
          animation: sentinelClickPulse 0.6s ease-out forwards;
        }
        @keyframes sentinelClickPulse {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
        }
      `;
      document.head.appendChild(style);

      overlay = document.createElement('div');
      overlay.id = SENTINEL_OVERLAY_ID;
      overlay.textContent = 'Sentinel Override';
      document.body.appendChild(overlay);
      return overlay;
    } catch (e) {
      return null;
    }
  }

  function showActionBanner(actionType, description) {
    try {
      const overlay = getOrCreateOverlay();
      if (!overlay) return;
      const label = description || actionType;
      overlay.innerHTML = `<span class="sentinel-action">Sentinel:</span> ${label}`;
      overlay.style.opacity = '1';
    } catch (e) { /* extension context may be invalidated */ }
  }

  function hideActionBanner() {
    try {
      const overlay = document.getElementById(SENTINEL_OVERLAY_ID);
      if (overlay) overlay.style.opacity = '0';
    } catch (e) {}
  }

  function showClickIndicator(x, y) {
    try {
      const existing = document.getElementById('__sentinel_click_indicator__');
      if (existing) existing.remove();
      const indicator = document.createElement('div');
      indicator.id = '__sentinel_click_indicator__';
      indicator.style.left = x + 'px';
      indicator.style.top = y + 'px';
      document.body.appendChild(indicator);
      setTimeout(() => { try { if (indicator.parentNode) indicator.remove(); } catch(e) {} }, 700);
    } catch (e) { /* extension context may be invalidated */ }
  }

  // Make overlay functions available for the execute_command handler
  window.__sentinelOverlay = { showActionBanner, hideActionBanner, showClickIndicator };

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
      if (fm && fm.findInIframe) {
        const iframeResult = fm.findInIframe(document, selector);
        if (!iframeResult) return 'Iframe not found for selector: ' + selector;

        if (iframeResult.crossOrigin) {
          // Cross-origin: delegate to background script via chrome.runtime.sendMessage
          return new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({
                action: 'execute_in_frame',
                frameIndex: iframeResult.frameIndex,
                command: cmd
              }, (response) => {
                if (chrome.runtime.lastError) {
                  resolve('Cross-origin iframe error: ' + chrome.runtime.lastError.message);
                } else if (response && response.ok) {
                  resolve(JSON.stringify(response.data || response));
                } else {
                  resolve('Cross-origin iframe error: ' + (response ? response.error : 'Unknown error'));
                }
              });
            } catch (e) {
              resolve('Extension context error during iframe operation');
            }
          });
        }

        // Same-origin: use the iframe's document
        targetDoc = iframeResult.frameDoc;
        selector = iframeResult.remainingSelector || '';
      } else {
        // Fallback: basic iframe handling without frame-manager
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
    }

    switch (cmd.type) {
      case 'click': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;

        // Visual feedback: show banner and highlight
        const ov = window.__sentinelOverlay;
        if (ov) ov.showActionBanner('click', `Clicking: ${(el.innerText || el.tagName || '').substring(0, 60)}`);

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + cmd.selector;
            }
            await wait.sleep(300);
          }
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        // Get element center for click indicator
        try {
          const rect = el.getBoundingClientRect();
          if (window.__sentinelOverlay) window.__sentinelOverlay.showClickIndicator(rect.left + rect.width / 2, rect.top + rect.height / 2);
        } catch (e) {}
        const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: targetDoc.defaultView };
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        // Keep highlight visible for 2 seconds so user can see what was clicked
        setTimeout(() => hl.removeHighlight(el), 2000);

        return 'Clicked ' + cmd.selector;
      }

      case 'click_at': {
        const x = cmd.x;
        const y = cmd.y;
        if (typeof x !== 'number' || typeof y !== 'number') return 'click_at requires numeric x and y coordinates';

        if (window.__sentinelOverlay) window.__sentinelOverlay.showActionBanner('click_at', `Clicking at (${x}, ${y})`);

        const el = targetDoc.elementFromPoint(x, y);
        if (!el) return 'No element found at coordinates (' + x + ', ' + y + ')';
        if (window.__sentinelOverlay) window.__sentinelOverlay.showClickIndicator(x, y);
        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: targetDoc.defaultView, clientX: x, clientY: y };
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        setTimeout(() => hl.removeHighlight(el), 2000);
        return 'Clicked at (' + x + ', ' + y + ') on element: ' + el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : '');
      }

      case 'type': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;

        if (window.__sentinelOverlay) window.__sentinelOverlay.showActionBanner('type', `Typing "${(cmd.text || '').substring(0, 50)}" into ${(el.innerText || el.tagName || '').substring(0, 40)}`);

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + cmd.selector;
            }
            await wait.sleep(300);
          }
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const text = cmd.text || '';

        // Rich text editor (Quill, TinyMCE, CKEditor, contenteditable with rich content)
        if (si && si.isRichTextEditor && si.isRichTextEditor(el)) {
          const result = si.setRichTextValue(el, text);
          hl.removeHighlight(el);
          return 'Typed into rich text editor ' + cmd.selector + ' (' + result.method + ')';
        }

        // Date input
        if (si && si.isDateInput && si.isDateInput(el)) {
          const result = si.setDatePickerValue(el, text);
          hl.removeHighlight(el);
          if (result.success) return 'Set date to ' + text + ' (' + result.method + ')';
          return 'Failed to set date: ' + (result.error || 'unknown error');
        }

        // contenteditable div/span -- used by many enterprise dashboard filter/search inputs
        if (el.isContentEditable) {
          el.textContent = '';
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          // Use execCommand for broadest compatibility with SPA frameworks
          targetDoc.execCommand('selectAll', false, null);
          targetDoc.execCommand('delete', false, null);
          for (const char of text) {
            targetDoc.execCommand('insertText', false, char);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: char }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
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
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          for (const char of text) {
            const currentVal = el.value;
            nativeSetter.call(el, currentVal + char);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: char }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          hl.removeHighlight(el);
          return 'Typed into ' + cmd.selector;
        }

        // Fallback for any other focusable element
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        hl.removeHighlight(el);
        return 'Typed into ' + cmd.selector;
      }

      case 'upload_file': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        if (el.type !== 'file') return 'Element is not a file input: ' + cmd.selector;
        hl.highlightElement(el);
        const uploaded = si && si.uploadFile && si.uploadFile(el, cmd.file_name || 'file.txt', cmd.mime_type || 'text/plain', cmd.content || '');
        hl.removeHighlight(el);
        if (uploaded) return 'Uploaded file ' + (cmd.file_name || 'file.txt') + ' to ' + cmd.selector;
        return 'Failed to upload file to ' + cmd.selector;
      }

      case 'scroll': {
        targetDoc.defaultView.scrollBy(0, cmd.amount || 0);
        return 'Scrolled ' + (cmd.amount || 0);
      }

      case 'select': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + cmd.selector;
            }
            await wait.sleep(300);
          }
        }

        // Check for custom dropdown (non-native <select>)
        if (dd && dd.isCustomDropdown && dd.isCustomDropdown(el)) {
          hl.highlightElement(el);
          const options = await dd.openDropdown(targetDoc, el);
          if (!options) {
            // Failed to open via dropdown utils, fall back to standard click
            el.click();
            await wait.sleep(500);
            const retryOptions = dd.findDropdownOptions(targetDoc, el);
            if (!retryOptions || retryOptions.length === 0) {
              hl.removeHighlight(el);
              return 'Failed to open dropdown: ' + cmd.selector;
            }
            const selected = await dd.selectDropdownOption(targetDoc, retryOptions, cmd.value);
            if (!selected) {
              const availableTexts = retryOptions.map(o => (o.innerText || o.textContent || '').trim()).join(', ');
              dd.dismissDropdown(targetDoc);
              hl.removeHighlight(el);
              return 'Error: No matching option "' + cmd.value + '". Available: ' + availableTexts;
            }
            dd.dismissDropdown(targetDoc);
            hl.removeHighlight(el);
            return 'Selected "' + cmd.value + '" in dropdown ' + cmd.selector;
          }
          const selected = await dd.selectDropdownOption(targetDoc, options, cmd.value);
          if (!selected) {
            const availableTexts = options.map(o => (o.innerText || o.textContent || '').trim()).join(', ');
            dd.dismissDropdown(targetDoc);
            hl.removeHighlight(el);
            return 'Error: No matching option "' + cmd.value + '". Available: ' + availableTexts;
          }
          dd.dismissDropdown(targetDoc);
          hl.removeHighlight(el);
          return 'Selected "' + cmd.value + '" in dropdown ' + cmd.selector;
        }

        // Native <select> element
        if (el.tagName !== 'SELECT') return 'Element is not a <select>: ' + cmd.selector;
        hl.highlightElement(el);
        el.value = cmd.value;
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        hl.removeHighlight(el);
        return 'Selected "' + cmd.value + '" in ' + cmd.selector;
      }

      case 'hover': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + cmd.selector;
            }
            await wait.sleep(300);
          }
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const hoverEvent = new MouseEvent('mouseover', { bubbles: true, cancelable: true, composed: true, view: targetDoc.defaultView });
        el.dispatchEvent(hoverEvent);
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }));
        hl.removeHighlight(el);

        // Check if a submenu appeared after hovering
        let result = 'Hovered over ' + cmd.selector;
        if (dd) {
          await wait.sleep(500);
          const subItems = dd.findDropdownOptions(targetDoc, el);
          if (subItems && subItems.length > 0) {
            const submenuTexts = subItems
              .map(item => (item.innerText || item.textContent || '').trim())
              .filter(t => t.length > 0)
              .slice(0, 20);
            result += '. Submenu items available: ' + submenuTexts.join(', ');
          }
        }
        return result;
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
        activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: keyVal, bubbles: true, composed: true }));
        activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: keyVal, bubbles: true, composed: true }));
        if (keyVal === 'Enter') activeEl.dispatchEvent(new KeyboardEvent('keypress', { key: keyVal, bubbles: true, composed: true }));
        return 'Pressed key: ' + key;
      }

      case 'execute_js': {
        // SECURITY REVIEW (DEB-05):
        // Risk Level: HIGH -- new Function() executes arbitrary JavaScript in the page context.
        //
        // Why it exists: The agent needs to execute custom JavaScript to handle UIs that cannot
        // be automated through standard DOM APIs (e.g., complex React state updates, Angular
        // form controls, custom widget libraries). The LLM generates the code, and the content
        // script runs it in the page's JS context (not the extension's isolated world).
        //
        // Attack surface:
        // 1. LLM prompt injection: A malicious web page could craft content that tricks the LLM
        //    into generating dangerous execute_js commands (e.g., exfiltrating cookies, modifying
        //    page state, redirecting the user).
        // 2. Imported runbooks: Untrusted templates could contain goals that instruct the agent
        //    to execute arbitrary code. See COL-05 for import validation.
        //
        // Current mitigations:
        // - execute_js is only available when the agent is actively running (user-initiated)
        // - The code runs in the PAGE context, not the extension context (no access to chrome.* APIs)
        // - "use strict" mode prevents some dangerous patterns
        //
        // Recommended improvements for v2+:
        // - Add an allowlist of permitted APIs for execute_js code
        // - Add user confirmation prompt before execute_js commands (already exists for approval mode)
        // - For imported runbooks: reject any goal containing "execute_js" (see COL-05)
        // - Consider a sandboxed iframe for code execution instead of new Function()
        //
        // Decision: KEEP new Function() for v2. The agent's core value depends on it.
        // Document the risk and add mitigations incrementally.
        const code = cmd.code || '';
        if (!code) return 'No code provided';

        if (window.__sentinelOverlay) window.__sentinelOverlay.showActionBanner('execute_js', `Running JS${cmd.key ? ' → "' + cmd.key + '"' : ''}: ${code.substring(0, 60)}...`);
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
          const resultStr = typeof result === 'object' ? JSON.stringify(result).substring(0, 3000) : String(result || '').substring(0, 3000);
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

      case 'open_dropdown': {
        const el = dom.findElementBySelector(targetDoc, selector);
        if (!el) return 'Element not found: ' + cmd.selector;
        hl.highlightElement(el);
        if (dd) {
          const options = await dd.openDropdown(targetDoc, el);
          if (!options || options.length === 0) {
            hl.removeHighlight(el);
            return 'Failed to open dropdown or no options found: ' + cmd.selector;
          }
          const optionTexts = options
            .map(o => (o.innerText || o.textContent || '').trim())
            .filter(t => t.length > 0)
            .slice(0, 50);
          hl.removeHighlight(el);
          return 'Dropdown opened. Options: ' + optionTexts.join(', ');
        }
        hl.removeHighlight(el);
        return 'Dropdown utilities not available';
      }

      case 'dismiss_overlay': {
        if (ov) {
          const dismissed = await ov.dismissOverlay(document);
          return dismissed ? 'Overlay dismissed successfully' : 'No overlay detected';
        }
        return 'Overlay utilities not available';
      }

      case 'switch_to_frame': {
        const frameIndex = cmd.frame_index || 0;
        const iframes = document.querySelectorAll('iframe');
        if (!iframes[frameIndex]) return 'Iframe not found at index ' + frameIndex;
        try {
          const iframeDoc = iframes[frameIndex].contentWindow.document;
          const title = iframeDoc.title || '';
          const url = iframes[frameIndex].src || '';
          return 'Switched to iframe ' + frameIndex + ': ' + title + ' (' + url + '). Use read_page to scan content.';
        } catch (e) {
          return 'Cannot access iframe ' + frameIndex + ' (cross-origin)';
        }
      }

      default:
        return 'Unknown command type: ' + cmd.type;
    }
  }

  // Safe chrome.runtime.sendMessage — catches both sync throws and async rejections
  // when extension context is invalidated during page navigation.
  function safeSendMessage(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) {}
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
          safeSendMessage({
            action: 'spa_content_changed',
            url: window.location.href
          });
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
        safeSendMessage({
          action: 'spa_navigation',
          url: url
        });
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
  try { chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {}); } catch (e) {}
}
