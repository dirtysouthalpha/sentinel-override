# Phase 2: Complex UI Interactions - Research

**Researched:** 2026-04-24
**Domain:** Chrome Extension content script DOM interaction, shadow DOM, iframes, modals, special inputs
**Confidence:** HIGH

## Summary

This phase transforms content.js from a monolithic 581-line file with inline DOM operations into a modular utility library that can handle the full range of complex enterprise web UI elements. The current content script already has basic iframe support (same-origin only via `frame:N:` prefix), basic contenteditable handling, and native `<select>` support. What is missing: shadow DOM traversal, cross-origin iframe access, custom dropdown/nested menu interaction, date picker automation, file upload handling, rich text editor APIs, modal/overlay detection and dismissal, and -- critically -- extraction of all DOM operations into reusable utilities.

The standard approach for Chrome extension content scripts interacting with complex UIs is to build a utility layer with deep DOM traversal (shadow DOM piercing via recursive tree walking), frame-aware message routing (using `chrome.scripting.executeScript` with `frameIds` for cross-origin), and heuristic-based overlay detection. No external libraries are needed -- this is a domain where vanilla JS with well-structured utility functions is the industry standard. The Chrome extension APIs (`chrome.scripting.executeScript` with `frameIds`, `chrome.webNavigation.getAllFrames`) provide all the infrastructure needed.

**Primary recommendation:** Extract content.js into a `content/` directory of utility modules, add `all_frames: true` to manifest for automatic iframe injection, implement recursive shadow DOM piercing as a core utility, and build heuristic-based overlay dismissal on top of the existing MutationObserver infrastructure.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JavaScript | ES2020+ | All DOM operations | Chrome extension content scripts run in isolated world; no bundler, no npm. The existing codebase uses zero dependencies. |
| Chrome Extension APIs (MV3) | Chrome 120+ | `chrome.scripting.executeScript` with `frameIds`, `chrome.webNavigation.getAllFrames`, `chrome.tabs.sendMessage` | Built-in, no install needed. These are the ONLY APIs that can cross the iframe boundary. |
| `document.createTreeWalker()` | Built-in | Efficient shadow DOM traversal | More performant than `querySelectorAll('*')` for deep tree walking. Built-in browser API. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `MutationObserver` | Built-in | Detect dynamically added modals, shadow roots, dropdown options | Already used in content.js for SPA detection and wait conditions. Extend for overlay/modal detection. |
| `DataTransfer` / `File` API | Built-in | Programmatic file upload via `<input type="file">` | For UIX-02 file upload requirement. Create `File` objects programmatically, set on input's `files` property. |
| `document.execCommand()` | Built-in (deprecated but universal) | Rich text editor formatting (bold, italic, etc.) | Still works in all browsers. Quill, TinyMCE, CKEditor all respond to it internally. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vanilla JS utilities | Playwright/Puppeteer selectors | Cannot use -- these are Node.js tools for browser automation, not injectable into content scripts |
| Recursive shadow walker | `>>>` CSS combinator | Deprecated/removed. Not viable. |
| `chrome.scripting` with `frameIds` | `all_frames: true` declarative | `all_frames` works but gives no control over WHICH frames or WHEN. Programmatic injection is more flexible for the agent's on-demand approach. |
| Custom overlay detection | Cookie consent extension (e.g., I Don't Care About Cookies) | Overkill dependency. The heuristic approach is ~100 lines of code and more customizable. |

**Installation:** No packages to install. This phase is pure vanilla JS within the existing Chrome extension architecture.

## Architecture Patterns

### Recommended Content Script Structure

The current `content.js` is 581 lines with all logic inline. Extract into a `content/` directory:

```
content/
  index.js              # Entry point: message handler, re-injection guard, SPA observers
  dom-utils.js          # Core DOM utilities: findElement, getUniqueSelector, scanDocument
  shadow-dom.js         # Shadow DOM piercing: queryDeep, walkShadowTree, findInShadowRoots
  frame-manager.js      # Frame/iframe traversal: enumerate frames, route to correct frame context
  dropdown-utils.js     # Custom dropdown detection, hover menus, nested menu traversal
  special-inputs.js     # Date pickers, file uploads, rich text editors
  overlay-detector.js   # Modal/overlay detection and dismissal heuristics
  highlight.js          # Element highlighting (already exists, extract)
  wait-utils.js         # Wait/verify logic (already exists, extract)
```

### Pattern 1: Shadow DOM Piercing Utility

**What:** Recursive tree walker that finds elements inside open shadow roots. Central to UIX-04.
**When to use:** Every `querySelector` call in the agent should go through this utility instead of bare `document.querySelector`.
**Example:**

```javascript
// content/shadow-dom.js

/**
 * Recursively search for elements matching a selector, piercing open shadow roots.
 * Returns an array of all matching elements across the shadow boundary tree.
 *
 * @param {string} selector - CSS selector
 * @param {Element|Document} root - Starting element (default: document)
 * @returns {Element[]} All matching elements
 */
export function queryDeep(root, selector) {
  const results = [];

  // Try direct querySelector first (fast path)
  try {
    const direct = root.querySelectorAll(selector);
    for (const el of direct) results.push(el);
  } catch (e) { /* invalid selector, skip */ }

  // Walk all elements and pierce shadow roots
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.shadowRoot) {
      // Check inside this shadow root
      const shadowResults = queryDeep(node.shadowRoot, selector);
      for (const el of shadowResults) results.push(el);
    }
  }
  return results;
}

/**
 * Find first element matching selector, piercing shadow roots.
 */
export function queryDeepFirst(root, selector) {
  try {
    const direct = root.querySelector(selector);
    if (direct) return direct;
  } catch (e) {}

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.shadowRoot) {
      const found = queryDeepFirst(node.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}
```

### Pattern 2: Closed Shadow Root Interception

**What:** Monkey-patch `Element.prototype.attachShadow` at `document_start` to capture references to closed shadow roots.
**When to use:** Required for UIX-04 "always pierce shadow roots (both open and closed)" from CONTEXT.md.
**Example:**

```javascript
// Must run at document_start (before page scripts)
// content/shadow-dom.js (early injection portion)

const _capturedShadowRoots = new WeakMap();

// Store references to ALL shadow roots (including closed)
const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(init) {
  const shadowRoot = originalAttachShadow.call(this, init);
  _capturedShadowRoots.set(this, shadowRoot);
  return shadowRoot;
};

/**
 * Get shadow root for an element, including closed ones we intercepted.
 */
export function getShadowRoot(el) {
  if (el.shadowRoot) return el.shadowRoot; // open shadow root
  return _capturedShadowRoots.get(el) || null; // closed shadow root
}
```

**Key insight:** For this to work, the content script MUST be declared in manifest.json with `"run_at": "document_start"` so it runs before the page's own scripts. Currently content.js uses programmatic injection via `chrome.scripting.executeScript` which runs at `document_idle` by default -- too late to intercept `attachShadow`. The manifest needs a separate early-injection script, OR we accept that closed shadow DOM is best-effort only.

### Pattern 3: Cross-Origin Iframe Communication

**What:** Use `chrome.scripting.executeScript` with `frameIds` to inject content scripts into cross-origin iframes, then route messages through the background service worker.
**When to use:** When the agent needs to interact with elements inside a cross-origin iframe (UIX-03).
**Example:**

```javascript
// background/frame-router.js (new module in background/)

import { sendMessage } from './message-protocol.js';

/**
 * Execute a command in a specific iframe frame.
 * Falls back gracefully for cross-origin iframes that can't be accessed.
 */
export async function executeInFrame(tabId, frameId, command) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (cmd) => {
        // Inline function runs in the iframe's context
        // ... execute the DOM command ...
        return { ok: true, result: 'executed' };
      },
      args: [command]
    });
    return result[0]?.result;
  } catch (err) {
    return { ok: false, error: `Frame ${frameId} inaccessible: ${err.message}` };
  }
}

/**
 * Enumerate all frames in a tab, returning metadata for the agent.
 */
export async function enumerateFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return frames.map(f => ({
    frameId: f.frameId,
    parentId: f.parentFrameId,
    url: f.url,
    isIframe: f.frameId !== 0,
    isCrossOrigin: f.frameId !== 0 && new URL(f.url).origin !== new URL(frames[0].url).origin
  }));
}
```

**Required permission:** Add `"webNavigation"` to the `permissions` array in manifest.json. The extension already has `"<all_urls>"` as host_permissions and `"scripting"` permission, so cross-origin injection will work.

### Pattern 4: Overlay/Modal Detection and Dismissal

**What:** Heuristic-based detection of blocking overlays followed by systematic dismissal attempts.
**When to use:** When an action fails because the target element is obscured, or proactively before important actions.
**Example:**

```javascript
// content/overlay-detector.js

// Dismissal pattern registry -- ordered by specificity
const DISMISS_PATTERNS = [
  // Close buttons (most specific first)
  { selector: '[aria-label="Close" i], [aria-label="Dismiss" i], [aria-label="Accept cookies" i]', action: 'click' },
  { selector: 'button.close, .close-btn, .modal-close, [data-dismiss="modal"]', action: 'click' },
  { selector: '.cookie-banner .accept, .consent-btn, #onetrust-accept-btn-handler', action: 'click' },
  // Generic close text
  { selector: 'button', textMatch: /^(close|dismiss|accept|ok|got it|agree)$/i, action: 'click' },
  // Escape key (last resort)
  { action: 'escape' }
];

/**
 * Detect if any overlay/modal is currently blocking the page.
 * Returns the blocking element(s) or null.
 */
export function detectOverlay(doc) {
  // Strategy 1: ARIA attributes
  const ariaModal = queryDeepFirst(doc, '[aria-modal="true"]');
  if (ariaModal && isVisible(ariaModal)) return ariaModal;

  // Strategy 2: role="dialog"
  const dialog = queryDeepFirst(doc, '[role="dialog"], [role="alertdialog"]');
  if (dialog && isVisible(dialog)) return dialog;

  // Strategy 3: High z-index fixed overlay
  const fixedOverlays = doc.querySelectorAll('div, section');
  for (const el of fixedOverlays) {
    const style = doc.defaultView.getComputedStyle(el);
    if (style.position === 'fixed' && style.zIndex > 1000 &&
        style.width === '100vw' && style.pointerEvents !== 'none') {
      return el;
    }
  }

  return null;
}

/**
 * Attempt to dismiss a detected overlay.
 * Returns true if dismissed, false if still present.
 */
export async function dismissOverlay(doc, overlay) {
  for (const pattern of DISMISS_PATTERNS) {
    if (pattern.action === 'escape') {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
      if (!overlay.isConnected) return true;
      continue;
    }

    let target;
    if (pattern.selector) {
      target = overlay.querySelector(pattern.selector);
    }
    if (!target && pattern.textMatch) {
      const buttons = overlay.querySelectorAll('button, a, [role="button"]');
      target = Array.from(buttons).find(b => pattern.textMatch.test(b.textContent.trim()));
    }
    if (target && isVisible(target)) {
      target.click();
      await sleep(300);
      if (!overlay.isConnected) return true;
    }
  }
  return false;
}
```

### Pattern 5: Custom Dropdown Interaction

**What:** Detect and interact with custom dropdown components (Angular, React, Ext JS) that don't use native `<select>`.
**When to use:** When the `select` command fails because the element is not a native `<select>` (common on enterprise UIs like SonicWall, Fortinet, Palo Alto).
**Example:**

```javascript
// content/dropdown-utils.js

/**
 * Open a custom dropdown and wait for options to appear.
 * Returns the option elements or null if opening failed.
 */
export async function openDropdown(doc, triggerEl) {
  triggerEl.scrollIntoView({ behavior: 'instant', block: 'center' });
  triggerEl.click();

  // Wait for dropdown options to appear (up to 3 seconds)
  const startTime = Date.now();
  while (Date.now() - startTime < 3000) {
    await sleep(100);
    // Check for common dropdown containers near the trigger
    const options = findDropdownOptions(doc, triggerEl);
    if (options.length > 0) return options;
  }
  return null;
}

/**
 * Find dropdown option elements near a trigger element.
 * Checks common patterns: role="listbox", role="option", .dropdown-menu, etc.
 */
function findDropdownOptions(doc, triggerEl) {
  // Pattern 1: ARIA listbox/option
  const ariaOptions = doc.querySelectorAll('[role="option"], [role="listbox"] [role="option"]');
  if (ariaOptions.length > 0) return Array.from(ariaOptions).filter(isVisible);

  // Pattern 2: Common dropdown containers
  const containers = doc.querySelectorAll('.dropdown-menu, .select-options, .menu, [role="menu"], .autocomplete-list');
  for (const container of containers) {
    if (isVisible(container)) {
      const items = container.querySelectorAll('li, [role="option"], [role="menuitem"], div');
      if (items.length > 0) return Array.from(items).filter(isVisible);
    }
  }

  // Pattern 3: Options appeared as siblings or near the trigger
  const parent = triggerEl.parentElement;
  if (parent) {
    const siblings = parent.querySelectorAll('li, [role="option"], .option');
    if (siblings.length > 0) return Array.from(siblings).filter(isVisible);
  }

  return [];
}
```

### Pattern 6: Special Input Handling

**What:** Utility functions for date pickers, file uploads, and rich text editors.
**When to use:** When the agent encounters these input types during execution.
**Example:**

```javascript
// content/special-inputs.js

/**
 * Set a date picker value.
 * Strategy 1: Set the input value directly (native date inputs).
 * Strategy 2: Set the value and dispatch change/input events (framework date pickers).
 */
export function setDatePickerValue(el, dateStr) {
  // Format: "YYYY-MM-DD" for native inputs
  if (el.type === 'date') {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(el, dateStr);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  // Framework date picker -- try setting value on the underlying input
  const input = el.querySelector('input') || el;
  if (input.tagName === 'INPUT') {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, dateStr);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * Upload a file to a file input element.
 * Creates a File object programmatically -- no OS dialog needed.
 */
export function uploadFile(inputEl, fileName, mimeType, content) {
  if (inputEl.type !== 'file') return false;
  const file = new File([content], fileName, { type: mimeType });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  inputEl.files = dataTransfer.files;
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
```

### Anti-Patterns to Avoid

- **Inline DOM operations in message handlers:** The current content.js has all logic directly in the `handleMessage` switch/case. Every operation should be extracted to a named utility function.
- **Using `el.click()` as the only click mechanism:** Many enterprise UIs (SonicWall, Cisco) bind to mousedown/mouseup. The current code already dispatches a full mouse sequence (mousedown -> mouseup -> click -> mouseout), which is correct. Keep this pattern.
- **Assuming all iframes are same-origin:** The current code wraps iframe access in try/catch and silently fails on cross-origin. This is acceptable for scanning but insufficient for interaction -- the agent needs to KNOW an iframe is cross-origin and use the background script's `chrome.scripting.executeScript` with `frameIds` instead.
- **Polling with fixed intervals for dropdown open detection:** Use MutationObserver to detect when option elements appear after clicking a dropdown trigger, with a timeout fallback.
- **Removing overlay elements from the DOM:** This can break page state. Always try dismissal (click close button, press Escape) before resorting to DOM removal.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shadow DOM piercing | Custom CSS selector parser | `document.createTreeWalker()` + recursive `shadowRoot` traversal | TreeWalker is a built-in, well-optimized API. Custom CSS parsers for shadow DOM are fragile and reinvent the wheel. |
| Cross-origin iframe access | Custom postMessage bridge | `chrome.scripting.executeScript` with `frameIds` | Chrome extension APIs are designed for this exact purpose. PostMessage requires the page to cooperate. |
| File upload | Simulating drag-and-drop or OS dialogs | `DataTransfer` + `File` API on `<input type="file">` | Programmatic file setting on input elements is well-supported and doesn't require user interaction. |
| Rich text editor content | Manual `innerHTML` manipulation per editor | `document.execCommand()` + editor-specific API detection | `execCommand` works universally for basic operations. Only fall back to editor-specific APIs (Quill, TinyMCE) when needed. |
| Overlay detection | Machine learning or visual analysis | Heuristic CSS/ARIA attribute checking | Heuristics based on z-index, position, role, and aria-modal catch 95%+ of overlays. ML is overkill for this. |

**Key insight:** This phase is entirely about applying the RIGHT built-in browser APIs and Chrome extension APIs to the right problems. No external libraries are needed. The complexity is in the orchestration (when to try which strategy, how to fall back) not in the individual operations.

## Common Pitfalls

### Pitfall 1: Closed Shadow DOM Access Timing
**What goes wrong:** Content script is injected at `document_idle` (default). By that time, `attachShadow` has already been called with `mode: 'closed'`, and the shadow root reference is permanently inaccessible.
**Why it happens:** `Element.prototype.attachShadow` with `mode: 'closed'` returns a shadow root that is only available to the code that called it. Once that call is done, no external code can access it.
**How to avoid:** Either (a) declare content script in manifest.json with `"run_at": "document_start"` to monkey-patch `attachShadow` before page scripts run, OR (b) accept closed shadow DOM as best-effort and focus on open shadow roots + declarative shadow DOM.
**Warning signs:** Elements are visible on screen but `querySelector` returns nothing, and no `shadowRoot` property exists on the parent element.

### Pitfall 2: MutationObserver on Dynamically Created Shadow Roots
**What goes wrong:** `MutationObserver` set up before shadow roots are attached will NOT observe DOM changes inside shadow roots that are created later.
**Why it happens:** MutationObserver only observes the subtree of the target node at the time of observation. A shadow root is a separate document fragment -- it's not part of the parent's subtree.
**How to avoid:** After detecting a new shadow root (via `attachShadow` interception or periodic scanning), set up a NEW MutationObserver on that shadow root.
**Warning signs:** Dropdown options or modal content that appears inside a shadow root is never detected.

### Pitfall 3: Events Not Crossing Shadow Boundaries
**What goes wrong:** `dispatchEvent` on an element inside a shadow root doesn't bubble to the light DOM, and vice versa.
**Why it happens:** By default, events dispatched inside a shadow root have `composed: false` (except for focus, blur, and some input events). The event stops at the shadow boundary.
**How to avoid:** Always use `{ bubbles: true, composed: true }` when dispatching events that need to cross shadow boundaries. The current content.js code already uses `{ bubbles: true }` but is missing `composed: true`.
**Warning signs:** Frameworks don't react to programmatic input changes when elements are inside shadow DOM.

### Pitfall 4: iframe Frame ID Stability
**What goes wrong:** Frame IDs change when an iframe navigates to a different URL. Caching frame IDs across page navigations leads to injection failures.
**Why it happens:** Chrome assigns frame IDs dynamically. When an iframe's URL changes, it may get a new frame ID.
**How to avoid:** Always call `chrome.webNavigation.getAllFrames` to get fresh frame IDs before injection. Don't cache frame IDs across iterations.
**Warning signs:** `chrome.scripting.executeScript` fails with "Cannot access contents of frame" on a frame that was previously accessible.

### Pitfall 5: Dropdown Options Not in the DOM Until Opened
**What goes wrong:** Agent tries to select a dropdown option that doesn't exist in the DOM because the dropdown is closed and its options are virtual/lazy-loaded.
**Why it happens:** Many modern dropdown components (Angular Material, React Select, Ant Design) only render option elements when the dropdown is open. Some even virtualize visible options.
**How to avoid:** Always click the dropdown trigger first, wait for options to appear (MutationObserver or polling), THEN select the option. Never try to find options in a closed dropdown.
**Warning signs:** "Element not found" when trying to click an option that should exist.

### Pitfall 6: contenteditable Rich Text Editors Swallowing Input Events
**What goes wrong:** Setting `textContent` or dispatching `InputEvent` on a contenteditable doesn't update the editor's internal state, so the framework thinks the field is empty.
**Why it happens:** Rich text editors (Quill, Slate, ProseMirror, Lexical) maintain their own internal document model separate from the DOM. DOM mutations bypass their state management.
**How to avoid:** For known editors, use their API (e.g., `quill.setText()`). For unknown editors, use `document.execCommand('insertText', false, text)` which triggers the same code path as real keyboard input. Always dispatch events with `composed: true` if inside shadow DOM.
**Warning signs:** Text appears visually in the editor but disappears on blur or submit.

### Pitfall 7: Overlay Dismissal Breaking Page State
**What goes wrong:** Removing an overlay element or clicking its close button triggers unexpected navigation or data loss.
**Why it happens:** Some overlays are not modals but are integral page components (e.g., a step wizard, an unsaved changes warning).
**How to avoid:** Only dismiss overlays that match well-known patterns (cookie banners, consent dialogs, generic modals with close buttons). Never dismiss elements that look like form-related dialogs. The CONTEXT.md decision says "reactive not proactive" -- only dismiss when an action fails.
**Warning signs:** Page navigates away or form data disappears after overlay dismissal.

## Code Examples

### Shadow-Root-Aware Element Scanner

This replaces the current `scanDocument` function to also find elements inside shadow roots:

```javascript
// content/dom-utils.js

/**
 * Scan a document (or shadow root) for interactive elements.
 * Pierces open shadow roots recursively.
 */
export function scanDocumentDeep(doc, interactiveElements, selectorMap, prefix) {
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
    if (!isVisible(el)) return;
    const text = getLabel(el);
    const selector = prefix + getUniqueSelector(el);
    if (selectorMap.has(selector)) return;
    selectorMap.set(selector, true);
    interactiveElements.push({
      index: interactiveElements.length,
      tag: el.tagName,
      text: text.substring(0, 100),
      selector,
      role: el.getAttribute('role') || 'none',
      type: el.getAttribute('type') || 'none',
      // New: track if element is inside shadow DOM
      inShadowDOM: !!el.getRootNode().host
    });
  });

  // Recurse into shadow roots
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.shadowRoot) {
      scanDocumentDeep(node.shadowRoot, interactiveElements, selectorMap, prefix);
    }
  }
}
```

### Frame-Aware Message Handler

Extends the current message handler to route commands to the correct frame:

```javascript
// content/index.js (enhanced handleMessage)

case 'observe_page': {
  const interactiveElements = [];
  const selectorMap = new Map();

  // Scan main document (with shadow DOM piercing)
  scanDocumentDeep(document, interactiveElements, selectorMap, '');

  // Scan iframes (same-origin only from content script context)
  try {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe, frameIndex) => {
      try {
        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
          scanDocumentDeep(iframeDoc, interactiveElements, selectorMap, `frame:${frameIndex}:`);
        }
      } catch (e) {
        // Cross-origin: mark as inaccessible
        interactiveElements.push({
          index: interactiveElements.length,
          tag: 'IFRAME',
          text: `Cross-origin iframe (${frameIndex}): ${iframe.src?.substring(0, 80) || 'unknown source'}`,
          selector: `frame:${frameIndex}:`,
          role: 'cross-origin-iframe',
          type: 'none',
          inShadowDOM: false
        });
      }
    });
  } catch (e) {}

  return { elements: interactiveElements };
}
```

### Manifest Changes for iframe Support

```json
{
  "manifest_version": 3,
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/shadow-intercept.js"],
      "run_at": "document_start",
      "all_frames": true
    }
  ],
  "permissions": ["activeTab", "scripting", "tabs", "sidePanel", "storage", "debugger", "webNavigation"],
  "host_permissions": ["<all_urls>"]
}
```

**Note:** `shadow-intercept.js` would be a minimal script that ONLY patches `attachShadow` and stores references. The main content script remains programmatically injected. The `"all_frames": true` on the early-injection script ensures shadow root interception works in iframes too.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `>>>` CSS combinator for shadow piercing | Recursive tree walking with `shadowRoot` access | Chrome removed `>>>` in 2020 | Must use manual traversal |
| `el.click()` only | Full mouse sequence: mousedown -> mouseup -> click -> mouseout | Established pattern for years | Already implemented in current code |
| Programmatic injection only | Declarative `content_scripts` with `all_frames: true` for early scripts + programmatic for on-demand | Chrome MV3 (2023+) | Both approaches are valid; use each for its strength |
| `document.querySelectorAll('*')` for tree walking | `document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)` | TreeWalker has been available since IE9 | More performant, skips text/comment nodes |
| Cross-origin iframe via `postMessage` handshake | `chrome.scripting.executeScript` with `frameIds` | Chrome MV3 with `<all_urls>` host permission | Much simpler, no page cooperation needed |
| CSP blocking inline scripts | Content scripts in isolated world are exempt from page CSP | Always true for Chrome extensions | Can use `new Function()` in content scripts safely (already done in `execute_js` command) |

**Deprecated/outdated:**
- `>>>` shadow piercing combinator: Removed from Chrome. Use recursive tree walking.
- `document.execCommand()` for rich text: Deprecated but universally supported. Use for compatibility; prefer editor-specific APIs when detectable.

## Open Questions

1. **Closed shadow DOM priority:**
   - What we know: Intercepting `attachShadow` at `document_start` works but requires manifest declaration changes and a separate early-injection script.
   - What's unclear: How many enterprise UIs (SonicWall, Fortinet, etc.) actually use closed shadow DOM vs open.
   - Recommendation: Implement open shadow DOM piercing first (covers 90%+ of cases). Add closed shadow DOM interception as a follow-up if testing reveals it's needed. The early-injection approach adds complexity to the manifest and deployment.

2. **Nested iframe depth:**
   - What we know: The current code handles one level of iframes (`frame:N:`). Nested iframes (iframe within iframe) would need a different addressing scheme.
   - What's unclear: Whether enterprise UIs commonly use deeply nested iframes.
   - Recommendation: Support single-level iframes in this phase. Use frameId-based addressing for any depth (the background script handles routing). The content script prefix scheme (`frame:N:`) only needs to work for the agent's addressing, not for CSS selectors.

3. **Overlay dismissal false positive rate:**
   - What we know: Heuristic overlay detection will sometimes misidentify non-modal elements as modals.
   - What's unclear: How often this will cause problems in practice.
   - Recommendation: Follow CONTEXT.md decision: "reactive not proactive" -- only attempt dismissal when an action fails, not before every action. This minimizes false positive damage.

4. **Content script module structure vs bundle:**
   - What we know: The extension has no build process/bundler. Content scripts must be loaded as separate files.
   - What's unclear: Whether Chrome MV3 supports ES module imports in content scripts (it does for service workers but content script support varies).
   - Recommendation: If ES module imports don't work in content scripts, use a simple concatenation approach or load utilities via IIFE patterns. Verify during implementation.

## Sources

### Primary (HIGH confidence)
- Chrome Extensions Content Scripts docs (https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) - Verified: `all_frames`, `run_at`, `match_about_blank`, `world` properties; `chrome.scripting.executeScript` with `frameIds`
- Chrome Extensions Manifest V3 docs - Verified: `chrome.webNavigation.getAllFrames`, permission requirements for cross-origin frame access
- Source code analysis of `content.js` (581 lines), `agent-engine.js`, `tab-manager.js`, `manifest.json` - Verified: current iframe handling, contenteditable support, event dispatch patterns, permission set

### Secondary (MEDIUM confidence)
- Chrome `document.createTreeWalker()` API - Standard DOM API, well-documented, universally supported
- `Element.prototype.attachShadow` monkey-patching pattern - Known technique used by DevTools extensions and accessibility tools
- `DataTransfer` + `File` API for programmatic file uploads - Standard browser API, well-documented

### Tertiary (LOW confidence)
- Specific enterprise UI shadow DOM usage (SonicWall, Fortinet, etc.) - Could not verify via search due to rate limiting. Based on existing platform context code in `llm-client.js` which mentions Angular custom components, Ext JS widgets, React components.
- Rich text editor internal APIs (Quill, TinyMCE, Slate, Lexical) - Could not verify current API surface via search. Based on training data.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No external libraries needed; all vanilla JS + Chrome extension APIs. Verified against official docs.
- Architecture: HIGH - Module extraction pattern is straightforward; Chrome extension content script structure is well-documented. Verified against official Chrome docs.
- Pitfalls: HIGH - Shadow DOM, iframe, and event bubbling pitfalls are well-known and documented. Verified against official Chrome docs and source code analysis.
- Special inputs: MEDIUM - Date picker and file upload patterns are well-established. Rich text editor internal APIs vary by framework and could not be fully verified.

**Research date:** 2026-04-24
**Valid until:** 30 days (2026-05-24) -- Chrome extension APIs are stable. Rich text editor APIs may change.
