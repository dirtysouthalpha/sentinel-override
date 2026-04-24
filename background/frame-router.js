// Sentinel Override v3 -- Frame Router (Background Script)
// Cross-origin iframe enumeration and command execution via chrome.scripting API.
// Enables the agent to interact with elements inside cross-origin iframes.

// ========== Content Script Files for Frame Injection ==========
// Same set as tab-manager.js CONTENT_SCRIPT_FILES, minus index.js (handler injected separately)
const FRAME_UTILITY_FILES = [
  'content/dom-utils.js',
  'content/shadow-dom.js',
  'content/highlight.js',
  'content/wait-utils.js',
  'content/dropdown-utils.js',
  'content/special-inputs.js',
  'content/overlay-detector.js'
];

// ========== Enumerate Frames ==========
// Use chrome.webNavigation.getAllFrames to get all frames in a tab.
// Returns array of { frameId, parentId, url, isIframe, isCrossOrigin }.
export async function enumerateFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames || frames.length === 0) return [];

    // Get the main frame URL for cross-origin detection
    const mainFrame = frames.find(f => f.frameId === 0);
    let mainOrigin = '';
    if (mainFrame) {
      try {
        mainOrigin = new URL(mainFrame.url).origin;
      } catch (e) {
        mainOrigin = mainFrame.url;
      }
    }

    return frames.map(f => {
      let frameOrigin = '';
      try {
        frameOrigin = new URL(f.url).origin;
      } catch (e) {
        frameOrigin = f.url;
      }

      return {
        frameId: f.frameId,
        parentId: f.parentId,
        url: f.url,
        isIframe: f.frameId !== 0,
        isCrossOrigin: f.frameId !== 0 && frameOrigin !== mainOrigin
      };
    });
  } catch (e) {
    return [];
  }
}

// ========== Resolve Frame For Selector ==========
// Given a frame index (from content script's frame:N: prefix), map it to a Chrome frameId.
// The mapping is positional: frame index 0 = first iframe in DOM order.
export async function resolveFrameForSelector(tabId, frameIndex) {
  const frames = await enumerateFrames(tabId);

  // Filter to only iframes (exclude main frame) and match by DOM position
  const iframes = frames.filter(f => f.isIframe);
  if (frameIndex < 0 || frameIndex >= iframes.length) return null;

  return iframes[frameIndex].frameId;
}

// ========== Execute In Frame ==========
// Execute a DOM command inside a specific cross-origin iframe.
// TWO-STEP injection: first inject utility modules, then run command using those utilities.
export async function executeInFrame(tabId, frameId, command) {
  if (!tabId || !frameId) {
    return { ok: false, error: 'Missing tabId or frameId' };
  }
  if (!command || !command.type) {
    return { ok: false, error: 'Missing command type' };
  }

  try {
    // Step 1: Inject utility modules into the target frame
    // This makes scanDocument, findElementBySelector, isVisible, shadow DOM utils, etc.
    // available inside the cross-origin iframe's isolated world.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: FRAME_UTILITY_FILES
    });

    // Step 2: Inject and run the command using the loaded utilities
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: runCommandInFrame,
      args: [command]
    });

    if (results && results.length > 0 && results[0].result !== undefined) {
      return results[0].result;
    }

    return { ok: false, error: 'No result returned from frame command execution' };
  } catch (e) {
    return { ok: false, error: 'Frame execution failed: ' + e.message };
  }
}

// ========== Command Runner (injected into iframe) ==========
// This function runs inside the target iframe. It has access to window.__sentinelUtils
// because Step 1 injected the utility files that populate that namespace.
function runCommandInFrame(command) {
  const utils = window.__sentinelUtils;
  if (!utils || !utils.dom) {
    return { ok: false, error: 'Sentinel utilities not loaded in frame' };
  }

  const dom = utils.dom;
  const hl = utils.highlight;
  const shadow = utils.shadow;
  const wait = utils.wait;
  const dd = utils.dropdown;
  const ov = utils.overlay;
  const si = utils.specialInputs;
  const doc = document;
  const view = doc.defaultView;
  const eventOpts = { bubbles: true, composed: true };

  try {
    switch (command.type) {
      case 'click': {
        const el = dom.findElementBySelector(doc, command.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + command.selector };

        // Overlay check
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(doc, el);
          if (blocking) {
            if (ov.dismissOverlay(doc, blocking)) {
              // Wait for overlay to be dismissed, then retry
            } else {
              return { ok: false, error: 'Element blocked by overlay that could not be dismissed' };
            }
          }
        }

        if (hl) hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: view };
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        if (hl) hl.removeHighlight(el);
        return { ok: true, data: 'Clicked ' + command.selector };
      }

      case 'type': {
        const el = dom.findElementBySelector(doc, command.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + command.selector };

        // Overlay check
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(doc, el);
          if (blocking) {
            if (ov.dismissOverlay(doc, blocking)) {
              // Wait for overlay to be dismissed, then retry
            } else {
              return { ok: false, error: 'Element blocked by overlay that could not be dismissed' };
            }
          }
        }

        if (hl) hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const text = command.text || '';

        // Rich text editor
        if (si && si.isRichTextEditor && si.isRichTextEditor(el)) {
          const result = si.setRichTextValue(el, text);
          if (hl) hl.removeHighlight(el);
          return { ok: result.success, data: result };
        }

        // Date input
        if (si && si.isDateInput && si.isDateInput(el)) {
          const result = si.setDatePickerValue(el, text);
          if (hl) hl.removeHighlight(el);
          return { ok: result.success, data: result };
        }

        // contenteditable
        if (el.isContentEditable) {
          el.textContent = '';
          el.dispatchEvent(new Event('input', eventOpts));
          doc.execCommand('selectAll', false, null);
          doc.execCommand('delete', false, null);
          for (const char of text) {
            doc.execCommand('insertText', false, char);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: char }));
          }
          el.dispatchEvent(new Event('change', eventOpts));
          if (hl) hl.removeHighlight(el);
          return { ok: true, data: 'Typed into contenteditable' };
        }

        // Standard INPUT/TEXTAREA
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA'
              ? view.HTMLTextAreaElement.prototype
              : view.HTMLInputElement.prototype,
            'value'
          ).set;
          nativeSetter.call(el, '');
          el.dispatchEvent(new Event('input', eventOpts));
          for (const char of text) {
            const currentVal = el.value;
            nativeSetter.call(el, currentVal + char);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: char }));
          }
          el.dispatchEvent(new Event('change', eventOpts));
          if (hl) hl.removeHighlight(el);
          return { ok: true, data: 'Typed into ' + command.selector };
        }

        // Fallback
        el.value = text;
        el.dispatchEvent(new Event('input', eventOpts));
        el.dispatchEvent(new Event('change', eventOpts));
        if (hl) hl.removeHighlight(el);
        return { ok: true, data: 'Typed into ' + command.selector };
      }

      case 'observe_page': {
        const interactiveElements = [];
        const selectorMap = new Map();
        dom.scanDocument(doc, interactiveElements, selectorMap, '');
        return { ok: true, data: { elements: interactiveElements } };
      }

      case 'read_page': {
        const title = doc.title;
        const url = view.location.href;
        let content = '';
        const mainSelectors = ['main', '[role="main"]', 'article', '#main-content', '#content', '.main-content', '.content'];
        let mainEl = null;
        for (const sel of mainSelectors) {
          mainEl = doc.querySelector(sel);
          if (mainEl) break;
        }
        if (mainEl) {
          const clone = mainEl.cloneNode(true);
          const skip = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'svg'];
          skip.forEach(s => { try { clone.querySelectorAll(s).forEach(el => el.remove()); } catch(e) {} });
          content = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        }
        if (!content || content.length < 200) {
          const bodyClone = doc.body.cloneNode(true);
          ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript'].forEach(tag => {
            bodyClone.querySelectorAll(tag).forEach(el => el.remove());
          });
          content = (bodyClone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
        }
        return { ok: true, data: 'Page Title: ' + title + '\nURL: ' + url + '\n\n' + content };
      }

      default:
        return { ok: false, error: 'Unknown command type in frame: ' + command.type };
    }
  } catch (e) {
    return { ok: false, error: 'Frame command error: ' + e.message };
  }
}
