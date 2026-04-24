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
  var COOKIE_SELECTORS = [
    '.cookie-banner', '.cookie-notice', '.cookie-consent', '.cookie-popup',
    '.consent-popup', '.consent-banner', '.consent-bar',
    '#onetrust-banner', '#onetrust-pc-sdk', '#cookie-notice', '#cookie-banner',
    '#cookie-consent', '#cc-banner', '#CybotCookiebotDialog',
    '[class*="cookie" i]', '[id*="cookie" i]',
    '[class*="consent" i]', '[id*="consent" i]'
  ];

  // ========== Detect Overlay ==========
  // Checks for modals, dialogs, cookie banners blocking the page.
  // Returns the blocking element or null.
  ov.detectOverlay = function(doc) {
    if (!doc) return null;

    // 1. ARIA modal
    var ariaModals = doc.querySelectorAll('[aria-modal="true"]');
    for (var i = 0; i < ariaModals.length; i++) {
      if (dom && dom.isVisible(ariaModals[i])) return ariaModals[i];
    }

    // Also search in shadow DOM
    if (shadow && shadow.queryDeep) {
      var shadowModals = shadow.queryDeep(doc, '[aria-modal="true"]');
      for (var i = 0; i < shadowModals.length; i++) {
        if (dom && dom.isVisible(shadowModals[i])) return shadowModals[i];
      }
    }

    // 2. Role dialog / alertdialog
    var dialogSelectors = '[role="dialog"], [role="alertdialog"]';
    var dialogs = doc.querySelectorAll(dialogSelectors);
    for (var i = 0; i < dialogs.length; i++) {
      if (dom && dom.isVisible(dialogs[i])) return dialogs[i];
    }

    // Shadow DOM dialogs
    if (shadow && shadow.queryDeep) {
      var shadowDialogs = shadow.queryDeep(doc, dialogSelectors);
      for (var i = 0; i < shadowDialogs.length; i++) {
        if (dom && dom.isVisible(shadowDialogs[i])) return shadowDialogs[i];
      }
    }

    // 3. High z-index fixed/absolute overlays
    var candidates = doc.querySelectorAll('div, section');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      try {
        var style = doc.defaultView.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'absolute') continue;
        var zIndex = parseInt(style.zIndex) || 0;
        if (zIndex <= 1000) continue;
        if (style.pointerEvents === 'none') continue;
        var rect = el.getBoundingClientRect();
        var viewportW = doc.defaultView.innerWidth || doc.documentElement.clientWidth;
        var viewportH = doc.defaultView.innerHeight || doc.documentElement.clientHeight;
        // Check if overlay covers most of the viewport
        if (rect.width >= viewportW * 0.8 && rect.height >= viewportH * 0.8) {
          if (dom && dom.isVisible(el)) return el;
        }
      } catch (e) {
        continue;
      }
    }

    // 4. Cookie banners
    for (var i = 0; i < COOKIE_SELECTORS.length; i++) {
      try {
        var cookieEls = doc.querySelectorAll(COOKIE_SELECTORS[i]);
        for (var j = 0; j < cookieEls.length; j++) {
          if (dom && dom.isVisible(cookieEls[j])) return cookieEls[j];
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }

    // Cookie banners in shadow DOM
    if (shadow && shadow.queryDeep) {
      var cookieShadowSels = ['.cookie-banner', '#onetrust-banner', '#cookie-notice', '.consent-popup'];
      for (var i = 0; i < cookieShadowSels.length; i++) {
        var shadowCookies = shadow.queryDeep(doc, cookieShadowSels[i]);
        for (var j = 0; j < shadowCookies.length; j++) {
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

    var eventOpts = { bubbles: true, composed: true };

    // 1. Close buttons (ARIA labels)
    var closeSelectors = [
      '[aria-label="Close" i]', '[aria-label="Dismiss" i]',
      'button.close', '.close-btn', '.modal-close', '.close-button',
      '[data-dismiss="modal"]', '[data-dismiss="dialog"]',
      '.btn-close', '[aria-label="Close dialog" i]',
      '[aria-label="Close this dialog" i]'
    ];

    for (var i = 0; i < closeSelectors.length; i++) {
      try {
        var closeBtns = overlay.querySelectorAll(closeSelectors[i]);
        for (var j = 0; j < closeBtns.length; j++) {
          if (dom && !dom.isVisible(closeBtns[j])) continue;
          closeBtns[j].click();
          closeBtns[j].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
          closeBtns[j].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
          closeBtns[j].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          if (!doc.body.contains(overlay) || !(dom && dom.isVisible(overlay))) {
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // 2. Cookie accept buttons
    var acceptSelectors = [
      '.cookie-banner .accept', '.cookie-banner .accept-btn',
      '.consent-btn', '.accept-all', '.btn-accept',
      '#onetrust-accept-btn-handler', '#accept-cookie',
      'button[class*="accept" i]', 'button[id*="accept" i]',
      'a[class*="accept" i]', 'a[id*="accept" i]'
    ];

    for (var i = 0; i < acceptSelectors.length; i++) {
      try {
        var acceptBtns = overlay.querySelectorAll(acceptSelectors[i]);
        for (var j = 0; j < acceptBtns.length; j++) {
          if (dom && !dom.isVisible(acceptBtns[j])) continue;
          acceptBtns[j].click();
          acceptBtns[j].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
          acceptBtns[j].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
          acceptBtns[j].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          if (!doc.body.contains(overlay) || !(dom && dom.isVisible(overlay))) {
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // 3. Text match: buttons/links with dismiss text
    var dismissTextPattern = /^(close|dismiss|accept|ok|got it|agree|yes|continue|understood)$/i;
    var clickableEls = overlay.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < clickableEls.length; i++) {
      var el = clickableEls[i];
      if (dom && !dom.isVisible(el)) continue;
      var text = (el.innerText || el.textContent || '').trim();
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

    // 4. Escape key
    var activeEl = doc.activeElement || doc.body;
    activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true, composed: true }));
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
      var rect = targetEl.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;

      // Check if target is even in the viewport
      if (centerX < 0 || centerY < 0 || centerX > doc.defaultView.innerWidth || centerY > doc.defaultView.innerHeight) {
        return null;
      }

      var topElement = doc.elementFromPoint(centerX, centerY);

      // If the topmost element IS the target (or a child of it), not blocked
      if (topElement === targetEl || targetEl.contains(topElement)) {
        return null;
      }

      // Something is on top -- check if it looks like an overlay
      if (topElement !== doc.body && topElement !== doc.documentElement) {
        return topElement;
      }

      return null;
    } catch (e) {
      return null;
    }
  };
})();
