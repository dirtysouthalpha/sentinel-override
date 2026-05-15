// Sentinel Override v3 -- Overlay/Modal Detector
// Modal, dialog, cookie banner detection heuristics and systematic dismissal patterns.
// Reactive overlay checking: only checks when an action is about to be performed.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.overlay = window.__sentinelUtils.overlay || {};

(function() {
  const ov = window.__sentinelUtils.overlay;
  const dom = window.__sentinelUtils && window.__sentinelUtils.dom;
  const shadow = window.__sentinelUtils && window.__sentinelUtils.shadow;

  // ========== Cookie Banner Patterns ==========
  const COOKIE_SELECTORS = [
    '.cookie-banner', '.cookie-notice', '.cookie-consent', '.cookie-popup',
    '.consent-popup', '.consent-banner', '.consent-bar',
    '#onetrust-banner', '#onetrust-pc-sdk', '#cookie-notice', '#cookie-banner',
    '#cookie-consent', '#cc-banner', '#CybotCookiebotDialog',
    '[class*="cookie" i]', '[id*="cookie" i]',
    '[class*="consent" i]', '[id*="consent" i]'
  ];

  const MIN_BLOCKING_Z_INDEX = 1000;
  const VIEWPORT_COVERAGE_THRESHOLD = 0.8;

  // ========== Detect Overlay ==========
  // Checks for modals, dialogs, cookie banners blocking the page.
  // Returns the blocking element or null.
  ov.detectOverlay = function(doc) {
    if (!doc) return null;

    // 1. ARIA modal
    const ariaModals = doc.querySelectorAll('[aria-modal="true"]');
    for (let i = 0; i < ariaModals.length; i++) {
      if (dom && dom.isVisible(ariaModals[i])) return ariaModals[i];
    }

    // Also search in shadow DOM
    if (shadow && shadow.queryDeep) {
      const shadowModals = shadow.queryDeep(doc, '[aria-modal="true"]');
      for (let i = 0; i < shadowModals.length; i++) {
        if (dom && dom.isVisible(shadowModals[i])) return shadowModals[i];
      }
    }

    // 2. Role dialog / alertdialog
    const dialogSelectors = '[role="dialog"], [role="alertdialog"]';
    const dialogs = doc.querySelectorAll(dialogSelectors);
    for (let i = 0; i < dialogs.length; i++) {
      if (dom && dom.isVisible(dialogs[i])) return dialogs[i];
    }

    // Shadow DOM dialogs
    if (shadow && shadow.queryDeep) {
      const shadowDialogs = shadow.queryDeep(doc, dialogSelectors);
      for (let i = 0; i < shadowDialogs.length; i++) {
        if (dom && dom.isVisible(shadowDialogs[i])) return shadowDialogs[i];
      }
    }

    // 3. High z-index fixed/absolute overlays
    const candidates = doc.querySelectorAll('div, section');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      try {
        const style = doc.defaultView.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'absolute') continue;
        const zIndex = parseInt(style.zIndex) || 0;
        if (zIndex <= MIN_BLOCKING_Z_INDEX) continue;
        if (style.pointerEvents === 'none') continue;
        const rect = el.getBoundingClientRect();
        const viewportW = doc.defaultView.innerWidth || doc.documentElement.clientWidth;
        const viewportH = doc.defaultView.innerHeight || doc.documentElement.clientHeight;
        // Check if overlay covers most of the viewport
        if (rect.width >= viewportW * VIEWPORT_COVERAGE_THRESHOLD && rect.height >= viewportH * VIEWPORT_COVERAGE_THRESHOLD) {
          if (dom && dom.isVisible(el)) return el;
        }
      } catch {
        continue;
      }
    }

    // 4. Cookie banners
    for (let i = 0; i < COOKIE_SELECTORS.length; i++) {
      try {
        const cookieEls = doc.querySelectorAll(COOKIE_SELECTORS[i]);
        for (let j = 0; j < cookieEls.length; j++) {
          if (dom && dom.isVisible(cookieEls[j])) return cookieEls[j];
        }
      } catch {
        // Invalid selector, skip
      }
    }

    // Cookie banners in shadow DOM
    if (shadow && shadow.queryDeep) {
      const cookieShadowSels = ['.cookie-banner', '#onetrust-banner', '#cookie-notice', '.consent-popup'];
      for (let i = 0; i < cookieShadowSels.length; i++) {
        const shadowCookies = shadow.queryDeep(doc, cookieShadowSels[i]);
        for (let j = 0; j < shadowCookies.length; j++) {
          if (dom && dom.isVisible(shadowCookies[j])) return shadowCookies[j];
        }
      }
    }

    return null;
  };

  // ========== Dismiss Overlay ==========
  // Attempts to dismiss a detected overlay using systematic close patterns.
  // Returns true if the overlay was successfully dismissed.
  ov.dismissOverlay = function(doc, overlay) {
    if (!overlay) return false;

    // 1. Close buttons (ARIA labels)
    const closeSelectors = [
      '[aria-label="Close" i]', '[aria-label="Dismiss" i]',
      'button.close', '.close-btn', '.modal-close', '.close-button',
      '[data-dismiss="modal"]', '[data-dismiss="dialog"]',
      '.btn-close', '[aria-label="Close dialog" i]',
      '[aria-label="Close this dialog" i]'
    ];

    for (let i = 0; i < closeSelectors.length; i++) {
      try {
        const closeBtns = overlay.querySelectorAll(closeSelectors[i]);
        for (let j = 0; j < closeBtns.length; j++) {
          if (dom && !dom.isVisible(closeBtns[j])) continue;
          closeBtns[j].click();
          closeBtns[j].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
          closeBtns[j].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
          closeBtns[j].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          if (!doc.body.contains(overlay) || !(dom && dom.isVisible(overlay))) {
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    // 2. Cookie accept buttons
    const acceptSelectors = [
      '.cookie-banner .accept', '.cookie-banner .accept-btn',
      '.consent-btn', '.accept-all', '.btn-accept',
      '#onetrust-accept-btn-handler', '#accept-cookie',
      'button[class*="accept" i]', 'button[id*="accept" i]',
      'a[class*="accept" i]', 'a[id*="accept" i]'
    ];

    for (let i = 0; i < acceptSelectors.length; i++) {
      try {
        const acceptBtns = overlay.querySelectorAll(acceptSelectors[i]);
        for (let j = 0; j < acceptBtns.length; j++) {
          if (dom && !dom.isVisible(acceptBtns[j])) continue;
          acceptBtns[j].click();
          acceptBtns[j].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
          acceptBtns[j].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
          acceptBtns[j].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          if (!doc.body.contains(overlay) || !(dom && dom.isVisible(overlay))) {
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    // 3. Text match: buttons/links with dismiss text
    const dismissTextPattern = /^(close|dismiss|accept|ok|got it|agree|yes|continue|understood)$/i;
    const clickableEls = overlay.querySelectorAll('button, a, [role="button"]');
    for (let i = 0; i < clickableEls.length; i++) {
      const el = clickableEls[i];
      if (dom && !dom.isVisible(el)) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (dismissTextPattern.test(text)) {
        el.click();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        if (!doc.body.contains(overlay) || !(dom && dom.isVisible(overlay))) {
          return true;
        }
      }
    }

    // 4. Escape key — full keydown + keypress + keyup sequence (#23)
    const activeEl = doc.activeElement || doc.body;
    const escOpts = {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true, composed: true
    };
    activeEl.dispatchEvent(new KeyboardEvent('keydown', escOpts));
    activeEl.dispatchEvent(new KeyboardEvent('keypress', escOpts));
    activeEl.dispatchEvent(new KeyboardEvent('keyup', escOpts));
    if (!doc.body.contains(overlay) || !(dom && dom.isVisible(overlay))) {
      return true;
    }

    return false;
  };

  // ========== Is Overlay Blocking ==========
  // Check if a specific target element is obscured by an overlay.
  // Uses elementFromPoint with the target's center coordinates.
  ov.isOverlayBlocking = function(doc, targetEl) {
    if (!doc || !targetEl) return null;

    try {
      const rect = targetEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Check if target is even in the viewport
      if (centerX < 0 || centerY < 0 || centerX > doc.defaultView.innerWidth || centerY > doc.defaultView.innerHeight) {
        return null;
      }

      const topElement = doc.elementFromPoint(centerX, centerY);

      // If the topmost element IS the target (or a child of it), not blocked
      if (topElement === targetEl || targetEl.contains(topElement)) {
        return null;
      }

      // Something is on top -- check if it looks like an overlay
      if (topElement !== doc.body && topElement !== doc.documentElement) {
        return topElement;
      }

      return null;
    } catch {
      return null;
    }
  };
})();
