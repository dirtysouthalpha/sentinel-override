// Sentinel Override v3 -- Content Script Entry Point
// Wave 2: ref_id + bbox + scroll_to support added.
// Verified 2026-05-06.
// Handles DOM observation, element scanning, action execution, and dynamic tools.
// Orchestrates utility modules loaded on window.__sentinelUtils.
//
// (3.26.0) Content-side telemetry helper — fires `content_telemetry_event`
// messages to the background, which re-emits via tel.emit() (telemetry.js).
// Defined at module top so every handler below has access. Fire-and-forget;
// never blocks the agent or throws.

// (3.26.0) Content-script telemetry emit helper. Bound to window so it
// survives the re-injection guard (re-injection skips the else-branch but
// the helper is defined unconditionally above it).
if (!window.__sentinelContentTel) {
  window.__sentinelContentTel = function _ctel(category, level, message, payload) {
    try {
      chrome.runtime.sendMessage({
        action: 'content_telemetry_event',
        category: String(category || 'content'),
        level: String(level || 'info'),
        message: String(message || '').substring(0, 500),
        payload: payload || null
      }).catch(() => {});
    } catch (e) { /* chrome.runtime gone during shutdown */ }
  };
  // Per-level shorthands so call sites stay terse.
  window.__sentinelContentTel.error = (c, m, p) => window.__sentinelContentTel(c, 'error', m, p);
  window.__sentinelContentTel.warn  = (c, m, p) => window.__sentinelContentTel(c, 'warn',  m, p);
  window.__sentinelContentTel.info  = (c, m, p) => window.__sentinelContentTel(c, 'info',  m, p);
  window.__sentinelContentTel.debug = (c, m, p) => window.__sentinelContentTel(c, 'debug', m, p);
  window.__sentinelContentTel.trace = (c, m, p) => window.__sentinelContentTel(c, 'trace', m, p);
}
const ctel = window.__sentinelContentTel;

// Re-injection guard: if already initialized, just signal ready and return early.
// This prevents duplicate message listeners and duplicate MutationObservers
// when content/index.js is injected multiple times (e.g., on page navigation).
if (window.__sentinelInitialized) {
  try { chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {}); } catch (e) {}
} else {
  window.__sentinelInitialized = true;

  // ====== execute_js Sandbox Configuration ======
  // Sandbox is disabled by default — the Proxy-based sandbox was blocking
  // legitimate agent operations (document.documentElement.outerHTML, etc.)
  // Re-enable after tuning the allowlist/blocklist for real-world usage.
  const EXECUTE_JS_SANDBOX_ENABLED = false;

  // Shorthand references to utility modules
  const dom = window.__sentinelUtils.dom;
  const hl = window.__sentinelUtils.highlight;
  const wait = window.__sentinelUtils.wait;
  const dd = window.__sentinelUtils.dropdown;
  const si = window.__sentinelUtils.specialInputs;
  const ov = window.__sentinelUtils.overlay;
  const fm = window.__sentinelUtils.frame;

  // ========== Overlay / Popup Dismissal ==========
  // Detects and auto-closes common overlays. (#14) Conservative behavior:
  //   - Never auto-clicks cookie "accept" buttons (privacy-preserving default).
  //   - Only hides elements that show positive modal/dialog signals AND were
  //     inserted recently (last 5s).
  //   - Skips structural elements (HTML/BODY/MAIN/elements containing <main>).
  //   - Caps total dismissals per page-load to 3.

  // Track recent DOM insertions so we only consider freshly-added overlays.
  const __sentinelRecentInsertions = new WeakMap();
  let __sentinelDismissalCount = 0;
  let __sentinelLastDismissRoute = '';
  const SENTINEL_MAX_DISMISSALS = 3;
  const SENTINEL_RECENT_MS = 5000;

  try {
    const insertionObserver = new MutationObserver((muts) => {
      const now = Date.now();
      for (const m of muts) {
        if (!m.addedNodes) continue;
        for (const n of m.addedNodes) {
          if (n && n.nodeType === 1) {
            __sentinelRecentInsertions.set(n, now);
          }
        }
      }
    });
    // Wait until body exists, then start observing.
    const startObserving = () => {
      if (document.body) {
        try { insertionObserver.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
      } else {
        setTimeout(startObserving, 50);
      }
    };
    startObserving();
  } catch (e) { /* observer unavailable, fall back to time-of-check only */ }

  function __sentinelHasPositiveModalSignal(el) {
    try {
      const role = el.getAttribute && el.getAttribute('role');
      if (role === 'dialog' || role === 'alertdialog') return true;
      if (el.getAttribute && el.getAttribute('aria-modal') === 'true') return true;
      const text = (el.innerText || el.textContent || '').toLowerCase().slice(0, 200);
      if (/\b(modal|dialog|sign in|subscribe)\b/.test(text)) return true;
    } catch (e) {}
    return false;
  }

  function __sentinelWasInsertedRecently(el) {
    const t = __sentinelRecentInsertions.get(el);
    if (typeof t !== 'number') return false;
    return (Date.now() - t) <= SENTINEL_RECENT_MS;
  }

  function dismissOverlays() {
    const dismissed = [];

    // Reset the dismissal cap when the SPA route changes (pathname+hash) so
    // new modals on the next "page" are still dismissed even without a full reload.
    try {
      const _route = location.pathname + location.hash;
      if (_route !== __sentinelLastDismissRoute) {
        __sentinelDismissalCount = 0;
        __sentinelLastDismissRoute = _route;
      }
    } catch (e) {}

    if (__sentinelDismissalCount >= SENTINEL_MAX_DISMISSALS) {
      return { dismissed: [], count: 0, capped: true };
    }

    // Close/dismiss button selectors. NOTE (#14): the auto-click on
    // [class*="cookie"] button[class*="accept" i] has been removed. Cookie
    // consent is a user decision; default global posture is decline.
    const closeBtnSelectors = [
      // Cookie consent — REJECT/DECLINE/DISMISS only, not accept
      '[class*="cookie"] [class*="reject" i]', '[class*="cookie"] [class*="decline" i]',
      '[class*="cookie"] [class*="dismiss" i]', '[class*="cookie"] button[class*="close" i]',
      '[id*="cookie"] button[class*="close" i]',
      '[class*="consent"] [class*="reject" i]', '[class*="consent"] [class*="dismiss" i]',
      '[class*="gdpr"] [class*="dismiss" i]', '[class*="gdpr"] [class*="reject" i]',
      // Generic close buttons inside modals/overlays
      '[class*="modal"] [class*="close" i]', '[class*="popup"] [class*="close" i]',
      '[class*="overlay"] [class*="close" i]', '[class*="dialog"] [class*="close" i]',
      '[aria-label="Close"]', '[aria-label="Dismiss"]', '[aria-label="Close banner"]',
      // Newsletter / subscribe
      '[class*="newsletter"] [class*="close" i]', '[class*="newsletter"] [class*="dismiss" i]',
      '[class*="subscribe"] [class*="close" i]', '[class*="signup"] [class*="close" i]',
      // Ad-blocker / paywall warnings
      '[class*="adblock"] [class*="close" i]', '[class*="adblock"] [class*="dismiss" i]',
      '[class*="paywall"] [class*="close" i]', '[class*="paywall"] [class*="dismiss" i]',
      // Generic × buttons (SVG or text)
      'button[class*="close" i]', '[class*="dismiss-btn" i]',
    ];

    for (const sel of closeBtnSelectors) {
      if (__sentinelDismissalCount >= SENTINEL_MAX_DISMISSALS) break;
      try {
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
          if (__sentinelDismissalCount >= SENTINEL_MAX_DISMISSALS) break;
          if (btn.offsetParent !== null && btn.getBoundingClientRect().width > 0) {
            btn.click();
            __sentinelDismissalCount++;
            dismissed.push(btn.textContent.trim().substring(0, 40) || sel);
          }
        }
      } catch (e) { /* invalid selector, skip */ }
    }

    // Remove blocking overlays that cover the viewport — but only with strong
    // positive signals AND only if recently inserted. Skip structural roots.
    const SKIP_TAGS = new Set(['HTML', 'BODY', 'MAIN']);
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (__sentinelDismissalCount >= SENTINEL_MAX_DISMISSALS) break;
      try {
        if (!el || !el.tagName) continue;
        if (SKIP_TAGS.has(el.tagName)) continue;
        // Don't kill page shells that contain <main>
        if (el.querySelector && el.querySelector('main')) continue;

        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' || (parseInt(style.zIndex) || 0) <= 9000) continue;

        const rect = el.getBoundingClientRect();
        const viewportArea = window.innerWidth * window.innerHeight;
        const elArea = rect.width * rect.height;
        if (elArea <= viewportArea * 0.5) continue;
        const cls = typeof el.className === 'string' ? el.className : '';
        if (cls.includes('sentinel')) continue;

        // Require positive modal/dialog signal AND recent insertion.
        if (!__sentinelHasPositiveModalSignal(el)) continue;
        if (!__sentinelWasInsertedRecently(el)) continue;

        // Prefer clicking a close button if available; otherwise hide.
        const closeBtn = el.querySelector('button, [role="button"], [class*="close" i], [aria-label="Close"]');
        if (closeBtn) {
          closeBtn.click();
          __sentinelDismissalCount++;
          dismissed.push('overlay-close: ' + (closeBtn.textContent.trim().substring(0, 30) || 'unnamed'));
        } else {
          el.style.display = 'none';
          __sentinelDismissalCount++;
          dismissed.push('hidden-overlay');
          const backdrop = document.querySelector('[class*="backdrop" i], [class*="scrim" i]');
          if (backdrop) backdrop.style.display = 'none';
        }
      } catch (e) { /* skip */ }
    }

    return { dismissed, count: dismissed.length };
  }

  // ========== Sensitive Field Detection (3.7.0) ==========
  // Hard-block typing into fields that look like passwords, pre-shared keys,
  // API secrets, recovery codes, or PII. Runs in BOTH the synthetic 'type'
  // path AND the CDP 'focus_element' path so neither input route can bypass.
  // Goes beyond `el.type === 'password'` because most real-world sensitive
  // fields (PSK, API key, client secret) are plain `type="text"`.

  const __SENTINEL_SENSITIVE_LABEL_RE = /\b(password|passphrase|passcode|pre.?shared.?key|psk|shared.?secret|secret.?key|api.?key|client.?secret|encryption.?key|private.?key|recovery.?code|reset.?code|verification.?code|temporary.?password|tenant.?key|cvv|cvc|ssn|social.?security|credit.?card|card.?number|account.?number|routing.?number|tax.?id|passport)\b/i;

  function __sentinelGetFieldSensitivityContext(el) {
    if (!el) return '';
    const parts = [];
    try {
      if (el.type === 'password') parts.push('password');
      const ac = el.getAttribute && el.getAttribute('autocomplete');
      if (ac) parts.push(ac);
      if (el.name) parts.push(el.name);
      if (el.id) parts.push(el.id);
      if (el.placeholder) parts.push(el.placeholder);
      const al = el.getAttribute && el.getAttribute('aria-label');
      if (al) parts.push(al);
      const tt = el.getAttribute && el.getAttribute('title');
      if (tt) parts.push(tt);
      // Associated <label for="id">
      if (el.id) {
        try {
          const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (lbl) parts.push((lbl.innerText || lbl.textContent || '').substring(0, 100));
        } catch (e) {}
      }
      // Walk up to 3 ancestors and collect any nearby label-ish text. Many
      // SPA forms render the label as a sibling div with class containing
      // "label" rather than a real <label> element.
      let p = el.parentElement;
      let depth = 0;
      while (p && depth < 3) {
        try {
          const lbl = p.querySelector('label, .label, .form-label, [class*="label" i]');
          if (lbl && lbl !== el) {
            parts.push((lbl.innerText || lbl.textContent || '').substring(0, 100));
          }
          // Also previous sibling text — e.g. "Pre-shared Key" rendered as a <span>
          const prev = p.previousElementSibling;
          if (prev) parts.push((prev.innerText || prev.textContent || '').substring(0, 100));
        } catch (e) {}
        p = p.parentElement;
        depth++;
      }
    } catch (e) {}
    return parts.join(' ').toLowerCase();
  }

  // Returns the matched sensitive keyword if `el` should be blocked, or null.
  function __sentinelCheckSensitiveField(el) {
    if (!el) return null;
    if (el.type === 'password') return 'password';
    const ctx = __sentinelGetFieldSensitivityContext(el);
    const m = ctx.match(__SENTINEL_SENSITIVE_LABEL_RE);
    return m ? m[0] : null;
  }

  // ========== MFA Challenge Detection (3.7.0) ==========
  // Detects 2FA / MFA / step-up auth pages so the agent-engine can pause
  // instead of looping uselessly. Caller (agent-engine via observe_page-side
  // metadata) gets back { mfaDetected: true, hint: <matched phrase> } when
  // the page text matches one of the MFA patterns.

  const __SENTINEL_MFA_PATTERNS = [
    /verify\s+your\s+identity/i,
    /enter\s+(?:the\s+)?(?:verification\s+)?code/i,
    /approve\s+(?:the\s+)?sign.?in\s+request/i,
    /we'?ve\s+sent.*?code/i,
    /6.?digit\s+(?:code|number|verification)/i,
    /two.?factor\s+(?:authentication|verification)/i,
    /multi.?factor\s+authentication/i,
    /authenticator\s+app/i,
    /one.?time\s+(?:passcode|password|code)/i,
    /\bOTP\b/,
    /enter\s+your\s+code/i,
    /check\s+your\s+phone/i
  ];

  function __sentinelDetectMFA(text) {
    if (!text || typeof text !== 'string') return null;
    const sample = text.substring(0, 4000);
    for (const re of __SENTINEL_MFA_PATTERNS) {
      const m = sample.match(re);
      if (m) return m[0];
    }
    return null;
  }

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
          throw new Error('Cross-origin iframe -- use background routing');
        }
      }

      case 'dismiss_overlays': {
        return dismissOverlays();
      }

      case 'get_viewport_info': {
        // (#11) DPR-aware screenshots: report viewport in CSS pixels plus DPR
        // and scroll offsets so the background can attach metadata to each capture.
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        };
      }

      case 'get_bbox': {
        // (#9) CDP trusted-input support. Resolve ref or selector to the
        // element's bounding-rect center in CSS pixels. The background uses
        // these coordinates with chrome.debugger Input.dispatchMouseEvent.
        const fakeCmd = { ref: request.ref, selector: request.selector };
        const resolved = resolveCommandTarget(fakeCmd, document);
        const el = resolved.el;
        if (!el) throw new Error('Element not found for bbox: ' + (request.ref || request.selector || ''));
        const rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          throw new Error('Element has zero size');
        }
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          w: rect.width,
          h: rect.height,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      }

      case 'detect_tenant': {
        // (3.7.0) Best-effort tenant detection for Microsoft admin centers.
        // Pulls signals from (in order of confidence):
        //   1. tid= query param on the current URL
        //   2. *.onmicrosoft.com strings in the visible page text
        //   3. Top-right tenant chip text (admin.microsoft.com, entra)
        try {
          let tid = null;
          let onmicrosoft = null;
          let chipText = null;

          try {
            const u = new URL(window.location.href);
            tid = u.searchParams.get('tid') || null;
          } catch (e) {}

          try {
            const bodyText = (document.body && document.body.innerText) || '';
            const m = bodyText.match(/[a-z0-9-]+\.onmicrosoft\.com/i);
            if (m) onmicrosoft = m[0];
          } catch (e) {}

          // Common chip selectors across admin.microsoft.com / entra.microsoft.com / portal.azure.com
          const chipSelectors = [
            '[data-automation-id="header-tenant-name"]',
            '[data-automationid="header-tenant-name"]',
            '[id="tenant-name"]',
            '[id="tenantNameText"]',
            'header [class*="tenant" i]',
            '[class*="MeControl" i] [class*="tenant" i]'
          ];
          for (const sel of chipSelectors) {
            try {
              const el = document.querySelector(sel);
              if (el) {
                const t = (el.innerText || el.textContent || '').trim();
                if (t && t.length < 120) { chipText = t; break; }
              }
            } catch (e) {}
          }

          return {
            tid,
            onmicrosoft,
            chipText,
            url: window.location.href,
            hostname: window.location.hostname
          };
        } catch (e) {
          return { tid: null, onmicrosoft: null, chipText: null };
        }
      }

      case 'cdp_pre_click_visual': {
        // (G1) Visual feedback for the CDP trusted-input click path.
        // Animates the virtual cursor to (x, y), highlights the element under
        // that point, and shows the click pulse + banner — matching the
        // synthetic path's experience. Called by tab-manager.cdpDispatchClick
        // ~220ms before the actual CDP click fires.
        try {
          const x = Number(request.x) || 0;
          const y = Number(request.y) || 0;
          const desc = request.description || ('Clicking at (' + Math.round(x) + ', ' + Math.round(y) + ')');

          // Animate cursor first (awaits ~380ms internally; tab-manager only
          // pauses 220ms before firing the click, so the cursor often arrives
          // mid-click — that's fine, the pulse will draw on top).
          if (window.__sentinelCursor && window.__sentinelCursor.moveTo) {
            // Fire-and-forget: don't block the click on the full travel time.
            try { window.__sentinelCursor.moveTo(x, y); } catch (e) {}
          }

          // Highlight whatever's at (x, y). Use elementFromPoint with a tiny
          // offset retry in case the cursor halo is briefly capturing input.
          let highlighted = null;
          try {
            highlighted = document.elementFromPoint(x, y);
            if (highlighted && window.__sentinelUtils && window.__sentinelUtils.highlight) {
              window.__sentinelUtils.highlight.highlightElement(highlighted);
              // Auto-clear after 1.5s so the visual doesn't linger forever.
              setTimeout(() => {
                try { window.__sentinelUtils.highlight.removeHighlight(highlighted); } catch (e) {}
              }, 1500);
            }
          } catch (e) {}

          // Banner + pulse + cursor press
          if (window.__sentinelOverlay) {
            try { window.__sentinelOverlay.showActionBanner('click', desc); } catch (e) {}
            try { window.__sentinelOverlay.showClickIndicator(x, y); } catch (e) {}
          }
          if (window.__sentinelCursor && window.__sentinelCursor.press) {
            try { window.__sentinelCursor.press(); } catch (e) {}
          }

          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }

      case 'cdp_typing_progress': {
        // (G2) Streamed banner update during CDP per-char typing.
        // tab-manager.cdpDispatchType posts these every Nth character so the
        // user sees real-time typing progress — same UX as synthetic typing.
        try {
          const text = String(request.text || '');
          const position = Number(request.position) || 0;
          if (typeof showTypingBanner === 'function') {
            showTypingBanner(text, position, text.length);
          } else if (window.__sentinelOverlay && window.__sentinelOverlay.showActionBanner) {
            const preview = text.substring(0, 40) + (text.length > 40 ? '...' : '');
            window.__sentinelOverlay.showActionBanner(
              'type',
              'Typing: "' + preview + '" (' + position + '/' + text.length + ')'
            );
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }

      case 'cdp_pre_action_announce': {
        // (G5) Pre-action announcement banner. Called by background paths that
        // don't otherwise reach the content script for visuals (extra hook
        // point for future CDP-driven actions).
        try {
          if (window.__sentinelOverlay && window.__sentinelOverlay.showActionBanner) {
            window.__sentinelOverlay.showActionBanner(
              request.actionType || 'action',
              request.description || ''
            );
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }

      case 'focus_element': {
        // (#9) Used before CDP Input.insertText so trusted text lands on the
        // intended element. We focus via the page's own .focus() API; the
        // subsequent CDP insertText then dispatches trusted input events.
        const fakeCmd = { ref: request.ref, selector: request.selector };
        const resolved = resolveCommandTarget(fakeCmd, document);
        const el = resolved.el;
        if (!el) throw new Error('Element not found for focus: ' + (request.ref || request.selector || ''));

        // (3.7.0) Same sensitive-field block as case 'type' — applied here
        // because the CDP trusted-input path goes focus_element -> insertText
        // and would otherwise sidestep the synthetic-path guard above.
        const __sensitiveMatch = __sentinelCheckSensitiveField(el);
        if (__sensitiveMatch) {
          throw new Error('BLOCKED: cannot focus sensitive field (matched "' + __sensitiveMatch + '"). Sensitive fields require manual entry.');
        }
        try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
        try { el.focus({ preventScroll: false }); } catch (e) {}
        // Clear existing value so CDP insertText replaces rather than appends,
        // matching the synthetic-path behavior. Only for inputs/textareas.
        try {
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea') {
            const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) setter.set.call(el, '');
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = '';
          }
        } catch (e) { /* non-fatal */ }
        return { focused: true };
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

  // ========== Human-like Interaction Helpers ==========
  // Makes agent actions visible and feel natural — watching the agent work
  // should feel like watching a skilled human operator.

  function humanDelay(minMs = 30, maxMs = 80) {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, delay));
  }

  // Layout-stability wait (#19): poll getBoundingClientRect across rAF ticks,
  // resolve when two consecutive frames produce the same top/left/width/height
  // (within 1px tolerance) or when maxMs elapses.
  function waitForStableRect(el, frames = 2, maxMs = 600) {
    return new Promise((resolve) => {
      if (!el || !el.getBoundingClientRect) { resolve(false); return; }
      const start = performance.now();
      let prev = null;
      let stableCount = 0;
      const tick = () => {
        try {
          const r = el.getBoundingClientRect();
          const cur = { t: r.top, l: r.left, w: r.width, h: r.height };
          if (prev &&
              Math.abs(cur.t - prev.t) <= 1 &&
              Math.abs(cur.l - prev.l) <= 1 &&
              Math.abs(cur.w - prev.w) <= 1 &&
              Math.abs(cur.h - prev.h) <= 1) {
            stableCount++;
          } else {
            stableCount = 0;
          }
          prev = cur;
          if (stableCount >= (frames - 1)) { resolve(true); return; }
          if (performance.now() - start >= maxMs) { resolve(false); return; }
          requestAnimationFrame(tick);
        } catch (e) {
          resolve(false);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // Per-character key event dispatch helpers (#8). Resolves keyCode/which from
  // the character so React/Lexical/Slate/ProseMirror autocomplete reacts.
  function __sentinelKeyEventForChar(type, char) {
    const code = char === ' ' ? 'Space' : ('Key' + (char.toUpperCase().match(/[A-Z]/) ? char.toUpperCase() : ''));
    const keyCode = char.length === 1 ? char.charCodeAt(0) : 0;
    return new KeyboardEvent(type, {
      key: char,
      code: code,
      keyCode: keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true
    });
  }

  function typingDelay(charIndex, totalChars) {
    // Adaptive speed: fast for long strings, natural variation for short ones
    if (totalChars > 150) return humanDelay(8, 20);   // Very fast for long strings (URLs, etc.)
    if (totalChars > 80) return humanDelay(15, 35);    // Fast for medium strings
    // Natural human-like typing with occasional brief pauses
    if (charIndex > 0 && charIndex % 7 === 0) return humanDelay(80, 200); // Thinking pause every ~7 chars
    return humanDelay(35, 110); // Normal typing speed (9-28 chars/sec)
  }

  // Enhanced action banner with typing preview — shows the user what's being typed
  function showTypingBanner(text, position, total) {
    try {
      const overlay = getOrCreateOverlay();
      if (!overlay) return;
      const preview = text.substring(0, 40) + (text.length > 40 ? '...' : '');
      const progress = position !== undefined ? ` (${position}/${total})` : '';
      overlay.innerHTML = `<span class="sentinel-action">⌨ Typing:</span> <span class="sentinel-target">"${preview}"</span>${progress}`;
      overlay.style.opacity = '1';
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async responses
  });

  // ========== execute_js Sandbox Helpers ==========
  // API allowlist for execute_js sandboxing
  const EXECUTE_JS_ALLOWED_GLOBALS = new Set([
    'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName',
    'getElementsByTagName', 'getElementsByName', 'createElement', 'createTextNode',
    'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'classList', 'style', 'dataset', 'textContent', 'innerHTML',
    'value', 'checked', 'selected', 'disabled', 'hidden',
    'focus', 'blur', 'click', 'scrollIntoView', 'scrollTo',
    'appendChild', 'removeChild', 'insertBefore', 'replaceChild',
    'parentElement', 'children', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling',
    'offsetHeight', 'offsetWidth', 'offsetTop', 'offsetLeft',
    'getBoundingClientRect', 'getComputedStyle',
    'innerText', 'outerHTML', 'tagName', 'nodeType',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise', 'JSON', 'console', 'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean',
    'Map', 'Set', 'RegExp', 'Error', 'TypeError', 'RangeError',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'alert', 'confirm', 'prompt'
  ]);

  const EXECUTE_JS_BLOCKED_APIS = new Set([
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'localStorage', 'sessionStorage', 'indexedDB',
    'open', 'close', 'stop', 'print',
    'eval', 'Function',
    'importScripts', 'Worker', 'SharedWorker', 'ServiceWorker',
    'postMessage',
    'navigator', 'location',
    'chrome',
    'crypto'
  ]);

  // Document-level properties to block (beyond what EXECUTE_JS_BLOCKED_APIS covers for window)
  const EXECUTE_JS_BLOCKED_DOC_PROPS = new Set([
    'cookie', 'domain', 'referrer', 'location', 'write', 'writeln'
  ]);

  // Creates a Proxy wrapping the document that blocks sensitive properties
  // but allows all normal DOM read/write operations.
  // sandboxedWin is the already-proxied window, returned when code accesses document.defaultView.
  function createSandboxedDocument(doc, sandboxedWin) {
    return new Proxy(doc, {
      get(target, prop, receiver) {
        // Block sensitive document properties (cookie, domain, referrer, location, write, writeln)
        if (EXECUTE_JS_BLOCKED_DOC_PROPS.has(prop)) {
          console.warn(`[Sentinel Sandbox] Blocked access to document.${String(prop)} in execute_js`);
          return undefined;
        }
        // When code asks for document.defaultView, return the sandboxed window proxy
        if (prop === 'defaultView') {
          return sandboxedWin;
        }
        // Pass through everything else, binding methods to the real document
        const value = target[prop];
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
      set(target, prop, value) {
        if (EXECUTE_JS_BLOCKED_DOC_PROPS.has(prop)) {
          console.warn(`[Sentinel Sandbox] Blocked write to document.${String(prop)} in execute_js`);
          return true; // silently swallow the write
        }
        target[prop] = value;
        return true;
      },
      has(target, prop) {
        if (EXECUTE_JS_BLOCKED_DOC_PROPS.has(prop)) return false;
        return prop in target;
      }
    });
  }

  // Creates a Proxy wrapping the window that blocks dangerous APIs
  // while allowing safe properties (console, Math, setTimeout, etc.) through.
  function createSandboxedWindow(win) {
    return new Proxy(win, {
      get(target, prop, receiver) {
        // Block all dangerous window APIs
        if (EXECUTE_JS_BLOCKED_APIS.has(prop)) {
          console.warn(`[Sentinel Sandbox] Blocked access to window.${String(prop)} in execute_js`);
          return undefined;
        }
        // Pass through safe properties, binding methods to the real window
        const value = target[prop];
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
      set(target, prop, value) {
        if (EXECUTE_JS_BLOCKED_APIS.has(prop)) {
          console.warn(`[Sentinel Sandbox] Blocked write to window.${String(prop)} in execute_js`);
          return true; // silently swallow the write
        }
        target[prop] = value;
        return true;
      },
      has(target, prop) {
        if (EXECUTE_JS_BLOCKED_APIS.has(prop)) return false;
        return prop in target;
      }
    });
  }

  // ========== Ref / Selector Element Resolution (#10) ==========
  // Single entry point for resolving a command's target element. Prefers
  // cmd.ref (stable per-scan id from dom-utils) and falls back to selector
  // when the ref is stale (element removed from DOM, or scan rotated).
  // Returns { el, viaRef, staleRef } so callers can log appropriately.
  function resolveCommandTarget(cmd, targetDoc) {
    // Try ref first when provided
    if (cmd && cmd.ref) {
      const el = dom.findElementByRef && dom.findElementByRef(cmd.ref);
      if (el) {
        return { el, viaRef: true, staleRef: false };
      }
      // Ref stale — try semantic identity matches before falling back to the
      // brittle nth-of-type selector chain, which breaks on SPA re-renders.
      try {
        console.warn('[Sentinel Override] ' + cmd.ref + ' stale, attempting semantic fallback');
      } catch (e) {}
      // 1. aria-label match (most reliable stable identifier)
      if (cmd.ariaLabel) {
        try {
          const byAria = targetDoc.querySelector('[aria-label="' + cmd.ariaLabel.replace(/"/g, '\\"') + '"]');
          if (byAria) return { el: byAria, viaRef: false, staleRef: true };
        } catch (e) {}
      }
      // 2. id match
      if (cmd.elementId) {
        try {
          const byId = targetDoc.getElementById(cmd.elementId);
          if (byId) return { el: byId, viaRef: false, staleRef: true };
        } catch (e) {}
      }
      // 3. visible text + tag match (e.g. a button that always says "Save")
      if (cmd.elementText && cmd.tag) {
        try {
          const tag = String(cmd.tag).toLowerCase();
          const needle = String(cmd.elementText).trim();
          const byText = Array.from(targetDoc.querySelectorAll(tag))
            .find(el => (el.innerText || el.textContent || '').trim() === needle);
          if (byText) return { el: byText, viaRef: false, staleRef: true };
        } catch (e) {}
      }
      // 4. nth-of-type selector as last resort
      if (cmd.selector) {
        const fallback = dom.findElementBySelector(targetDoc, cmd.selector);
        return { el: fallback, viaRef: false, staleRef: true };
      }
      return { el: null, viaRef: false, staleRef: true };
    }
    // No ref — pure selector path (legacy)
    if (cmd && cmd.selector) {
      const el = dom.findElementBySelector(targetDoc, cmd.selector);
      return { el, viaRef: false, staleRef: false };
    }
    return { el: null, viaRef: false, staleRef: false };
  }

  // Build a short human-readable reference for log/error messages so the
  // dispatcher's existing error strings ("Element not found: SELECTOR") still
  // make sense when the LLM only supplied a ref.
  function describeTarget(cmd) {
    if (!cmd) return '';
    if (cmd.ref && cmd.selector) return cmd.ref + ' (' + cmd.selector + ')';
    if (cmd.ref) return cmd.ref;
    return cmd.selector || '';
  }

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
        const resolved = resolveCommandTarget(cmd, targetDoc);
        const el = resolved.el;
        if (!el) {
          // (3.26.0) Content-side telemetry: click target unresolved. This is
          // the single most common content-side failure mode (selector hallucination,
          // SPA late mount, or shadow DOM hit). Surface in panel so operators
          // see exactly which selector missed.
          try {
            ctel.warn('page', 'Click target not found', {
              selector: cmd.selector || null,
              ref: cmd.ref || null,
              label: cmd.label || null,
              staleRef: !!resolved.staleRef,
              url: location.href.substring(0, 200)
            });
          } catch (e) {}
          return 'Element not found: ' + describeTarget(cmd);
        }

        // (#20) Reject disabled / pointer-events:none / aria-disabled targets
        // before doing any visual work, so the agent can react.
        if (dom.checkInteractable) {
          const reason = dom.checkInteractable(el, 'click');
          if (reason) {
            try {
              ctel.warn('page', 'Click rejected: ' + reason, {
                selector: cmd.selector || null,
                ref: cmd.ref || null,
                reason: reason,
                tag: (el.tagName || '').toLowerCase(),
                url: location.href.substring(0, 200)
              });
            } catch (e) {}
            return 'Cannot click ' + describeTarget(cmd) + ': ' + reason;
          }
        }

        // Visual feedback: show banner and highlight
        const ov = window.__sentinelOverlay;
        if (ov) ov.showActionBanner('click', `Clicking: ${(el.innerText || el.tagName || '').substring(0, 60)}`);

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + describeTarget(cmd);
            }
            await wait.sleep(300);
          }
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // (#19) Layout-stability wait — replaces the fixed 500ms sleep so we
        // don't dispatch into a still-shifting target (lazy-loaded images, etc.).
        await waitForStableRect(el, 2, 600);

        // (G3) Virtual cursor travels to the target before the click. Awaits
        // ~380ms — that travel IS the "operator decides" pause, replacing the
        // explicit humanDelay(200, 450) below with a visible movement.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.moveToElement) {
            await window.__sentinelCursor.moveToElement(el);
          }
        } catch (e) {}

        // Get element center for click indicator
        try {
          const rect = el.getBoundingClientRect();
          if (window.__sentinelOverlay) window.__sentinelOverlay.showClickIndicator(rect.left + rect.width / 2, rect.top + rect.height / 2);
        } catch (e) {}

        // (G3) Cursor press animation, fired at the same moment as the pulse.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.press) {
            window.__sentinelCursor.press();
          }
        } catch (e) {}

        // Short settle pause — the cursor.moveToElement above already provided
        // the visible "operator looking" travel time, so this is just a brief
        // settle before dispatching mouse events.
        await humanDelay(80, 160);
        const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: targetDoc.defaultView };
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        // Keep highlight visible for 2 seconds so user can see what was clicked
        setTimeout(() => hl.removeHighlight(el), 2000);

        return 'Clicked ' + describeTarget(cmd) + (resolved.staleRef ? ' (selector fallback after stale ref)' : '');
      }

      case 'click_at': {
        const x = cmd.x;
        const y = cmd.y;
        if (typeof x !== 'number' || typeof y !== 'number') return 'click_at requires numeric x and y coordinates';

        // (#11) DPR sanity check. Coordinates from the agent are expected to be
        // in CSS pixels (the same coordinate system as elementFromPoint and bbox).
        // If the caller supplies a dpr that disagrees with the live one, log a
        // warning but DO NOT auto-divide — the agent-engine should be sending
        // CSS pixels already.
        try {
          const liveDpr = window.devicePixelRatio || 1;
          if (typeof cmd.dpr === 'number' && Math.abs(cmd.dpr - liveDpr) > 0.01) {
            console.warn('[sentinel] click_at dpr mismatch: cmd.dpr=' + cmd.dpr + ' live=' + liveDpr + ' (still treating x,y as CSS pixels)');
          }
        } catch (e) { /* non-fatal */ }

        // (#11) Defensive viewport clamp. If coordinates land outside the
        // visible viewport, refuse rather than silently clicking on nothing.
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (x < 0 || y < 0 || x > vw || y > vh) {
          return 'click_at coordinates out of viewport (x=' + x + ', y=' + y + ', viewport=' + vw + 'x' + vh + ')';
        }

        if (window.__sentinelOverlay) window.__sentinelOverlay.showActionBanner('click_at', `Clicking at (${x}, ${y})`);

        const el = targetDoc.elementFromPoint(x, y);
        if (!el) return 'No element found at coordinates (' + x + ', ' + y + ')';

        // (#20) Reject disabled / pointer-events:none / aria-disabled targets.
        if (dom.checkInteractable) {
          const reason = dom.checkInteractable(el, 'click');
          if (reason) return 'Cannot click_at (' + x + ', ' + y + '): ' + reason;
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // (#19) Layout-stability wait instead of fixed 400ms.
        await waitForStableRect(el, 2, 600);

        // (G3) Virtual cursor travels to the click coordinates first, so the
        // user sees where the click is going before the pulse fires.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.moveTo) {
            await window.__sentinelCursor.moveTo(x, y);
          }
        } catch (e) {}

        if (window.__sentinelOverlay) window.__sentinelOverlay.showClickIndicator(x, y);
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.press) {
            window.__sentinelCursor.press();
          }
        } catch (e) {}

        // Short settle (cursor travel already provided the visible pause)
        await humanDelay(60, 140);
        const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: targetDoc.defaultView, clientX: x, clientY: y };
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.click();
        el.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        setTimeout(() => hl.removeHighlight(el), 2000);
        return 'Clicked at (' + x + ', ' + y + ') on element: ' + el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : '');
      }

      case 'type': {
        const resolved = resolveCommandTarget(cmd, targetDoc);
        const el = resolved.el;
        if (!el) {
          // (3.26.0) Content-side telemetry: type target unresolved.
          try {
            ctel.warn('page', 'Type target not found', {
              selector: cmd.selector || null,
              ref: cmd.ref || null,
              label: cmd.label || null,
              staleRef: !!resolved.staleRef,
              textLen: (cmd.text || '').length,
              url: location.href.substring(0, 200)
            });
          } catch (e) {}
          return 'Element not found: ' + describeTarget(cmd);
        }

        // (3.7.0) Sensitive-field block. Hard-stops typing into password,
        // pre-shared-key, API-secret, recovery-code, and PII fields no matter
        // what the LLM was instructed. Goes beyond el.type==='password'
        // because most enterprise UIs use plain text inputs for these.
        const __sensitiveMatch = __sentinelCheckSensitiveField(el);
        if (__sensitiveMatch) {
          // (3.26.0) Sensitive-field block is a SECURITY event. Surface at
          // warn level (always visible) so operators audit what was blocked.
          try {
            ctel.warn('page', 'Type BLOCKED: sensitive field (matched "' + __sensitiveMatch + '")', {
              match: __sensitiveMatch,
              tag: (el.tagName || '').toLowerCase(),
              type: el.type || null,
              name: (el.name || '').substring(0, 60),
              id: (el.id || '').substring(0, 60),
              url: location.href.substring(0, 200)
            });
          } catch (e) {}
          return 'BLOCKED: target field appears sensitive (matched "' + __sensitiveMatch + '"). Sentinel does not auto-fill credentials, secrets, recovery codes, or PII. Have the user enter this value manually.';
        }

        // (#20) Reject disabled targets up front.
        if (dom.checkInteractable) {
          const reason = dom.checkInteractable(el, 'type');
          if (reason) {
            try {
              ctel.warn('page', 'Type rejected: ' + reason, {
                selector: cmd.selector || null,
                ref: cmd.ref || null,
                reason: reason,
                tag: (el.tagName || '').toLowerCase(),
                url: location.href.substring(0, 200)
              });
            } catch (e) {}
            return 'Cannot type into ' + describeTarget(cmd) + ': ' + reason;
          }
        }

        if (window.__sentinelOverlay) window.__sentinelOverlay.showActionBanner('type', `Typing "${(cmd.text || '').substring(0, 50)}" into ${(el.innerText || el.tagName || '').substring(0, 40)}`);

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + describeTarget(cmd);
            }
            await wait.sleep(300);
          }
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 400)); // Wait for smooth scroll before typing

        // (G3) Cursor travels to the input field before typing starts.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.moveToElement) {
            await window.__sentinelCursor.moveToElement(el);
          }
        } catch (e) {}

        el.focus();
        const text = cmd.text || '';

        // Rich text editor (Quill, TinyMCE, CKEditor, contenteditable with rich content)
        if (si && si.isRichTextEditor && si.isRichTextEditor(el)) {
          const result = si.setRichTextValue(el, text);
          hl.removeHighlight(el);
          return 'Typed into rich text editor ' + describeTarget(cmd) + ' (' + result.method + ')';
        }

        // Date input
        if (si && si.isDateInput && si.isDateInput(el)) {
          const result = si.setDatePickerValue(el, text);
          hl.removeHighlight(el);
          if (result.success) return 'Set date to ' + text + ' (' + result.method + ')';
          return 'Failed to set date: ' + (result.error || 'unknown error');
        }

        // contenteditable div/span — Lexical / Slate / ProseMirror compat path (#8).
        // Per-char: keydown -> keypress -> beforeinput(insertText) -> input -> keyup.
        if (el.isContentEditable) {
          el.textContent = '';
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          // Use execCommand for broadest compatibility with SPA frameworks
          try { targetDoc.execCommand('selectAll', false, null); } catch (e) {}
          try { targetDoc.execCommand('delete', false, null); } catch (e) {}
          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            el.dispatchEvent(__sentinelKeyEventForChar('keydown', char));
            el.dispatchEvent(__sentinelKeyEventForChar('keypress', char));
            // Lexical/ProseMirror listen to beforeinput to map IME / composition.
            el.dispatchEvent(new InputEvent('beforeinput', {
              inputType: 'insertText', data: char,
              bubbles: true, cancelable: true, composed: true
            }));
            // Insert the character. Frameworks that intercept beforeinput may
            // already have updated content, but we still call execCommand for
            // editors that don't.
            try { targetDoc.execCommand('insertText', false, char); } catch (e) {}
            el.dispatchEvent(new InputEvent('input', {
              inputType: 'insertText', data: char,
              bubbles: true, cancelable: true, composed: true
            }));
            el.dispatchEvent(__sentinelKeyEventForChar('keyup', char));
            await typingDelay(i, text.length);
          }
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
          hl.removeHighlight(el);
          return 'Typed into contenteditable ' + describeTarget(cmd);
        }

        // Standard INPUT / TEXTAREA — full key sequence per character with native
        // setter so React/Vue/MUI controlled inputs sync (#8).
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const proto = el.tagName === 'TEXTAREA'
            ? targetDoc.defaultView.HTMLTextAreaElement.prototype
            : targetDoc.defaultView.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;

          nativeSetter.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            // keydown + keypress let suggestion popups (Google, GitHub, Linear) react.
            el.dispatchEvent(__sentinelKeyEventForChar('keydown', char));
            el.dispatchEvent(__sentinelKeyEventForChar('keypress', char));

            const currentVal = el.value;
            nativeSetter.call(el, currentVal + char);
            el.dispatchEvent(new InputEvent('input', {
              inputType: 'insertText', data: char,
              bubbles: true, cancelable: true, composed: true
            }));

            el.dispatchEvent(__sentinelKeyEventForChar('keyup', char));

            // Update typing banner every 10 chars for visual feedback
            if (i % 10 === 0 || i === text.length - 1) showTypingBanner(text, i + 1, text.length);
            await typingDelay(i, text.length);
          }
          // Final change event after the full string is typed.
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          hl.removeHighlight(el);
          return 'Typed into ' + describeTarget(cmd);
        }

        // Fallback for any other focusable element
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        hl.removeHighlight(el);
        return 'Typed into ' + describeTarget(cmd);
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
        targetDoc.defaultView.scrollBy({ top: cmd.amount || 0, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 400)); // Wait for smooth scroll animation
        return 'Scrolled ' + (cmd.amount || 0);
      }

      case 'select': {
        const resolvedSel = resolveCommandTarget(cmd, targetDoc);
        const el = resolvedSel.el;
        if (!el) return 'Element not found: ' + describeTarget(cmd);

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + describeTarget(cmd);
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
              return 'Failed to open dropdown: ' + describeTarget(cmd);
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
            return 'Selected "' + cmd.value + '" in dropdown ' + describeTarget(cmd);
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
          return 'Selected "' + cmd.value + '" in dropdown ' + describeTarget(cmd);
        }

        // Native <select> element — support select by value, visible text, and multi-select
        if (el.tagName !== 'SELECT') return 'Element is not a <select>: ' + describeTarget(cmd);
        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 300));

        if (el.multiple && Array.isArray(cmd.value)) {
          // Multi-select: select multiple options by value or text
          const options = Array.from(el.options);
          for (const val of cmd.value) {
            const opt = options.find(o => o.value === val || o.textContent.trim().toLowerCase() === val.toLowerCase());
            if (opt) opt.selected = true;
          }
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          hl.removeHighlight(el);
          return 'Multi-selected [' + cmd.value.join(', ') + '] in ' + describeTarget(cmd);
        }

        // Single select: try exact value match, then visible text match
        const options = Array.from(el.options);
        let targetOpt = options.find(o => o.value === cmd.value);
        if (!targetOpt) {
          targetOpt = options.find(o => o.textContent.trim().toLowerCase() === String(cmd.value).toLowerCase());
        }
        if (!targetOpt) {
          // Partial text match as fallback
          targetOpt = options.find(o => o.textContent.trim().toLowerCase().includes(String(cmd.value).toLowerCase()));
        }
        if (!targetOpt) {
          const availableOpts = options.map(o => `"${o.value}" (${o.textContent.trim()})`).join(', ');
          hl.removeHighlight(el);
          return 'Error: No matching option "' + cmd.value + '". Available: ' + availableOpts;
        }
        // (#24) Use the native HTMLSelectElement value setter so React-controlled
        // selects don't revert to their previous value on the synthetic change.
        try {
          const selectSetter = Object.getOwnPropertyDescriptor(
            targetDoc.defaultView.HTMLSelectElement.prototype, 'value'
          ).set;
          selectSetter.call(el, targetOpt.value);
        } catch (e) {
          // Fallback for any environment where the setter isn't accessible.
          el.value = targetOpt.value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        hl.removeHighlight(el);
        return 'Selected "' + targetOpt.textContent.trim() + '" (value: ' + targetOpt.value + ') in ' + describeTarget(cmd);
      }

      case 'check': {
        // Checkbox and radio button support — set to explicit checked state
        const resolvedCheck = resolveCommandTarget(cmd, targetDoc);
        const checkEl = resolvedCheck.el;
        if (!checkEl) return 'Element not found: ' + describeTarget(cmd);
        hl.highlightElement(checkEl);
        checkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 300));

        const desiredState = cmd.checked !== undefined ? cmd.checked : true;
        if (checkEl.type === 'checkbox' || checkEl.type === 'radio') {
          // (#25) Use el.click() to toggle so React Hook Form / Formik / native
          // form handlers see a real click + change pair. Only click if state
          // actually needs to change.
          if (checkEl.checked !== desiredState) {
            // (G3) Cursor travels to the checkbox before the click + press.
            try {
              if (window.__sentinelCursor && window.__sentinelCursor.moveToElement) {
                await window.__sentinelCursor.moveToElement(checkEl);
              }
            } catch (e) {}
            checkEl.focus();
            try {
              if (window.__sentinelCursor && window.__sentinelCursor.press) {
                window.__sentinelCursor.press();
              }
            } catch (e) {}
            await humanDelay(80, 180);
            checkEl.click();
            hl.removeHighlight(checkEl);
            return (desiredState ? 'Checked' : 'Unchecked') + ' ' + describeTarget(cmd);
          }
          hl.removeHighlight(checkEl);
          return describeTarget(cmd) + ' was already ' + (desiredState ? 'checked' : 'unchecked');
        }
        // Handle ARIA checkbox roles (common in SPA frameworks)
        if (checkEl.getAttribute('role') === 'checkbox' || checkEl.getAttribute('role') === 'switch') {
          const currentAria = checkEl.getAttribute('aria-checked') === 'true';
          if (currentAria !== desiredState) {
            checkEl.click();
            await humanDelay(100, 200);
            hl.removeHighlight(checkEl);
            return (desiredState ? 'Checked' : 'Unchecked') + ' ARIA ' + describeTarget(cmd);
          }
          hl.removeHighlight(checkEl);
          return describeTarget(cmd) + ' was already ' + (desiredState ? 'checked' : 'unchecked');
        }
        hl.removeHighlight(checkEl);
        return 'Element is not a checkbox or radio: ' + describeTarget(cmd);
      }

      case 'check_all': {
        // Check all matching checkboxes — bulk MSP operations (select multiple policies, devices, etc.)
        const checkSelector = cmd.selector || 'input[type="checkbox"]';
        const checkboxes = targetDoc.querySelectorAll(checkSelector);
        if (checkboxes.length === 0) return 'No checkboxes found matching: ' + checkSelector;
        const desiredState = cmd.checked !== undefined ? cmd.checked : true;
        let count = 0;
        for (const cb of checkboxes) {
          if (cb.type === 'checkbox' && cb.checked !== desiredState) {
            hl.highlightElement(cb);
            await humanDelay(50, 150);
            cb.checked = desiredState;
            cb.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            cb.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            hl.removeHighlight(cb);
            count++;
          }
        }
        return (desiredState ? 'Checked' : 'Unchecked') + ' ' + count + '/' + checkboxes.length + ' matching checkboxes';
      }

      case 'hover': {
        const resolvedHover = resolveCommandTarget(cmd, targetDoc);
        const el = resolvedHover.el;
        if (!el) return 'Element not found: ' + describeTarget(cmd);

        // Reactive overlay check: is the target element blocked?
        if (ov && ov.isOverlayBlocking) {
          const blocking = ov.isOverlayBlocking(targetDoc, el);
          if (blocking) {
            const dismissed = ov.dismissOverlay(targetDoc, blocking);
            if (!dismissed) {
              return 'Element blocked by overlay that could not be dismissed: ' + describeTarget(cmd);
            }
            await wait.sleep(300);
          }
        }

        hl.highlightElement(el);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });

        // (G3) Move the cursor to the hover target so menu reveals look like
        // an operator hovering, not teleporting.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.moveToElement) {
            await window.__sentinelCursor.moveToElement(el);
          }
        } catch (e) {}

        // (#21) Full pointer + mouse hover sequence so Radix / Headless UI /
        // Tailwind UI menus react. Use PointerEvent where available.
        const view = targetDoc.defaultView;
        const baseOpts = { bubbles: true, cancelable: true, composed: true, view: view };
        const pointerOpts = Object.assign({ pointerType: 'mouse', isPrimary: true }, baseOpts);

        const PE = view && view.PointerEvent ? view.PointerEvent : (typeof PointerEvent !== 'undefined' ? PointerEvent : null);

        if (PE) {
          el.dispatchEvent(new PE('pointerover', pointerOpts));
          el.dispatchEvent(new PE('pointerenter', pointerOpts));
        }
        el.dispatchEvent(new MouseEvent('mouseover', baseOpts));
        el.dispatchEvent(new MouseEvent('mouseenter', baseOpts));
        if (PE) {
          el.dispatchEvent(new PE('pointermove', pointerOpts));
        }
        el.dispatchEvent(new MouseEvent('mousemove', baseOpts));
        hl.removeHighlight(el);

        // Check if a submenu appeared after hovering
        let result = 'Hovered over ' + describeTarget(cmd);
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
          'Delete': 'Delete', 'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
          'ArrowDown': 'ArrowDown', 'ArrowUp': 'ArrowUp', 'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
          ' ': ' ', 'Space': ' ', 'F5': 'F5', 'F12': 'F12'
        };
        const keyVal = keyMap[key] || key;
        const activeEl = targetDoc.activeElement || targetDoc.body;
        const modifiers = cmd.modifiers || {};
        const keyOpts = {
          key: keyVal, bubbles: true, composed: true,
          ctrlKey: !!modifiers.ctrl || !!modifiers.control,
          shiftKey: !!modifiers.shift,
          altKey: !!modifiers.alt,
          metaKey: !!modifiers.meta || !!modifiers.cmd
        };
        activeEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        activeEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
        activeEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        const modStr = [modifiers.ctrl && 'Ctrl', modifiers.shift && 'Shift', modifiers.alt && 'Alt', modifiers.meta && 'Meta'].filter(Boolean).join('+');
        return 'Pressed key: ' + (modStr ? modStr + '+' : '') + key;
      }

      case 'execute_js': {
        // SECURITY REVIEW (DEB-05):
        // Uses <script> tag injection to run code in the page's MAIN world.
        // This bypasses MV3 extension CSP (which blocks new Function/eval in
        // content scripts). The injected script runs under the PAGE's CSP,
        // which almost always allows inline scripts (needed for ads/analytics).
        //
        // SAFETY (#3): The Proxy-based sandbox at createSandboxedWindow/Document
        // is currently disabled (EXECUTE_JS_SANDBOX_ENABLED = false), so this
        // path runs with full page privileges. We log a console warning on every
        // invocation so the user can see what's running, and shorten the default
        // timeout to 3s. Approval-gating MUST be enforced at the agent-engine
        // level (Agent A's existing approval gate handles this when approvalMode
        // is on).
        // TODO: route through approval gate — do not rely solely on agent-engine
        // for safety; have the content script send chrome.runtime.sendMessage
        // ({ action: 'execute_js_approval_request', code }) and await an
        // { approved: true } response with a 60s timeout (default reject) before
        // running. Implementation deferred — round-trip from content script is
        // risky if the background SW terminates mid-await.
        const code = cmd.code || '';
        if (!code) return 'No code provided';

        // Static guard: block code that accesses privileged browser APIs unless
        // the caller has been explicitly approved (cmd.approvalGranted === true).
        // This is a defence-in-depth layer; the agent-engine approval gate is the
        // primary control, but this fires even if the gate is bypassed or disabled.
        if (!cmd.approvalGranted) {
          const _PRIV_RE = /\bdocument\.cookie\b|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\beval\s*\(|\bFunction\s*\(|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bnavigator\.sendBeacon\b/;
          if (_PRIV_RE.test(code)) {
            return 'BLOCKED: execute_js code accesses a privileged API (cookie / fetch / XHR / WebSocket / eval / storage). Enable approval mode and re-run — the approval card will show the full code before it executes.';
          }
        }

        try {
          console.warn('[Sentinel Override] execute_js running with full page privileges:', code.slice(0, 200));
        } catch (e) {}

        // (#26) Honor cmd.timeout: default 8000ms, max 30000ms; clamp.
        // Hotfix 2026-05-06: bumped default from 3000 -> 8000. The 3s
        // safety-shortened default was firing on legitimate long extracts
        // before the page could respond (e.g., drudgereport.com). The real
        // safety win comes from routing execute_js through CDP Runtime.evaluate
        // at the agent-engine layer (which bypasses page CSP); a longer
        // timeout in the fallback path is fine.
        let execTimeout;
        if (typeof cmd.timeout === 'number' && isFinite(cmd.timeout)) {
          execTimeout = Math.max(100, Math.min(30000, cmd.timeout));
        } else {
          execTimeout = 8000;
        }

        if (window.__sentinelOverlay) window.__sentinelOverlay.showActionBanner('execute_js', `Running JS${cmd.key ? ' → "' + cmd.key + '"' : ''}: ${code.substring(0, 60)}...`);
        try {
          const eventId = '__sentinel_' + Date.now() + '_' + Math.random().toString(36).slice(2);

          // (3.21.1) CSP-violation detector. Pages with strict Content-Security-
          // Policy (SentinelOne, GitHub, etc.) block inline <script> injection.
          // The script appendChild() silently succeeds, the script never runs,
          // and we'd otherwise hit the timeout with a generic "Code execution
          // timed out" error that masks the real cause. Listen for CSP violation
          // events during the injection window so we can return a clear error.
          let __cspBlocked = false;
          const __cspListener = (e) => {
            try {
              const dir = (e && e.violatedDirective) || '';
              const blocked = (e && e.blockedURI) || '';
              if (dir.indexOf('script-src') === 0 && (blocked === 'inline' || blocked === '')) {
                __cspBlocked = true;
                // (3.26.0) Content-side telemetry: capture the FIRST CSP
                // violation so operators see the exact directive that's
                // blocking inline scripts. Useful for distinguishing strict
                // SentinelOne-style policies from looser CDN-only policies.
                try {
                  ctel.warn('page', 'CSP violation: ' + dir, {
                    directive: dir,
                    blockedURI: blocked,
                    effectiveDirective: (e && e.effectiveDirective) || '',
                    sample: (e && e.sample) ? String(e.sample).substring(0, 120) : '',
                    sourceFile: (e && e.sourceFile) ? String(e.sourceFile).substring(0, 200) : '',
                    url: location.href.substring(0, 200)
                  });
                } catch (te) {}
              }
            } catch (err) {}
          };
          try { document.addEventListener('securitypolicyviolation', __cspListener); } catch (e) {}

          const execResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              window.removeEventListener('message', handler);
              try { scriptEl.remove(); } catch (e) {}
              // (3.21.1) Distinguish CSP block from a true timeout. If a CSP
              // violation fired in this window, the script never executed.
              if (__cspBlocked) {
                resolve({ __cspBlocked: true });
              } else {
                resolve({ __timeout: true });
              }
            }, execTimeout);

            const handler = (event) => {
              if (event.source !== window || !event.data || event.data.__sentinelEventId !== eventId) return;
              clearTimeout(timeout);
              window.removeEventListener('message', handler);
              try { scriptEl.remove(); } catch (e) {}
              resolve(event.data);
            };

            window.addEventListener('message', handler);

            // (3.7.0) Hardened wrapper. Two guards:
            // 1. String concatenation (not template-literal interpolation) so
            //    backticks or `${...}` sequences in `code` cannot break out of
            //    the wrapper string at content-script eval time.
            // 2. `</script>` escape — defensive even though we use textContent
            //    (which doesn't HTML-reparse), in case some other path ever
            //    serializes this script element.
            const __safeCode = String(code).replace(/<\/script>/gi, '<\\/script>');
            const __eventIdJson = JSON.stringify(eventId);
            const scriptEl = document.createElement('script');
            scriptEl.textContent =
              '(async () => {' +
                'try {' +
                  'const __r = await (async () => { ' + __safeCode + '\n })();' +
                  'const __s = typeof __r === "object" && __r !== null' +
                    ' ? JSON.stringify(__r).substring(0, 3000)' +
                    ' : String(__r || "").substring(0, 3000);' +
                  'window.postMessage({ __sentinelEventId: ' + __eventIdJson + ', __value: __s }, "*");' +
                '} catch(e) {' +
                  'window.postMessage({ __sentinelEventId: ' + __eventIdJson + ', __error: (e && e.message) ? e.message : String(e) }, "*");' +
                '}' +
              '})();';
            document.documentElement.appendChild(scriptEl);
          });

          // (3.21.1) Clean up CSP listener regardless of which path we returned through.
          try { document.removeEventListener('securitypolicyviolation', __cspListener); } catch (e) {}

          if (execResult.__cspBlocked) {
            // Clear, actionable error that the agent-engine's recovery skills
            // can pattern-match and route to alternative strategies.
            return 'CSP_BLOCKED: page denies inline scripts (Content-Security-Policy script-src). The content-script execute_js path cannot run here. Use read_page, read_network_requests, or extract / extract_list against the live DOM instead.';
          }
          if (execResult.__timeout) {
            // (3.26.0) Telemetry: execute_js timeout. Different cause profile
            // from CSP — usually a long-running script, infinite loop in the
            // LLM-generated code, or a page that's not responding.
            try {
              ctel.warn('page', 'execute_js timed out (' + execTimeout + 'ms)', {
                timeoutMs: execTimeout,
                key: cmd.key || null,
                codeLen: code.length,
                url: location.href.substring(0, 200)
              });
            } catch (e) {}
            return 'Code execution timed out (' + execTimeout + 'ms)';
          }
          if (execResult.__error) {
            try {
              ctel.warn('page', 'execute_js threw: ' + String(execResult.__error).slice(0, 80), {
                error: execResult.__error,
                key: cmd.key || null,
                codeLen: code.length,
                url: location.href.substring(0, 200)
              });
            } catch (e) {}
            return 'Execution error: ' + execResult.__error;
          }
          return 'JS Result: ' + (execResult.__value || '');
        } catch (err) {
          try { ctel.error('page', 'execute_js outer failure', { error: err.message || String(err), url: location.href.substring(0, 200) }); } catch (e) {}
          return 'JS Error: ' + err.message;
        }
      }

      case 'extract': {
        const resolvedEx = resolveCommandTarget(cmd, targetDoc);
        const el = resolvedEx.el;
        if (!el) {
          // (3.26.0) Telemetry: extract target unresolved. Same shape as
          // click/type misses — helps operators spot stale selectors fast.
          try {
            ctel.warn('page', 'Extract target not found', {
              selector: cmd.selector || null,
              ref: cmd.ref || null,
              key: cmd.key || null,
              attribute: cmd.attribute || 'text',
              staleRef: !!resolvedEx.staleRef,
              url: location.href.substring(0, 200)
            });
          } catch (e) {}
          return 'Element not found: ' + describeTarget(cmd);
        }
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
        // (#10) If cmd.ref is supplied, treat it as a single root container —
        // useful for "extract the items inside this specific list" where the
        // LLM picked a known ref instead of writing a fragile CSS selector.
        let containers = [];
        if (cmd.ref) {
          const root = dom.findElementByRef && dom.findElementByRef(cmd.ref);
          if (root) {
            containers = [root];
          } else if (cmd.selector) {
            try {
              console.warn('[Sentinel Override] ' + cmd.ref + ' stale, falling back to selector');
            } catch (e) {}
            try {
              containers = Array.from(targetDoc.querySelectorAll(cmd.selector));
              // (3.8.0) Auto-fall-through to shadow.queryDeep on empty results.
              if (containers.length === 0 && window.__sentinelUtils && window.__sentinelUtils.shadow && window.__sentinelUtils.shadow.queryDeep) {
                try {
                  containers = window.__sentinelUtils.shadow.queryDeep(targetDoc, cmd.selector) || [];
                } catch (e) { /* non-fatal */ }
              }
            } catch (e) {
              return 'Element not found: ' + describeTarget(cmd);
            }
          } else {
            return 'Element not found: ' + describeTarget(cmd);
          }
        } else {
          if (!cmd.selector) return JSON.stringify({ key: cmd.key, value: [] });
          try {
            containers = Array.from(targetDoc.querySelectorAll(cmd.selector));
            // (3.8.0) Auto-fall-through to shadow.queryDeep on empty results so
            // extract_list works on Lit/Stencil/Shadow-DOM apps (VirusTotal, etc.).
            if (containers.length === 0 && window.__sentinelUtils && window.__sentinelUtils.shadow && window.__sentinelUtils.shadow.queryDeep) {
              try {
                containers = window.__sentinelUtils.shadow.queryDeep(targetDoc, cmd.selector) || [];
              } catch (e) { /* non-fatal */ }
            }
          } catch (e) {
            return 'Element not found: ' + cmd.selector;
          }
        }
        if (!containers.length) return 'Element not found: ' + describeTarget(cmd);
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
        // (G3) Cursor travels to the dropdown trigger before opening.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.moveToElement) {
            await window.__sentinelCursor.moveToElement(el);
          }
        } catch (e) {}
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

      case 'scroll_to': {
        // (#10) Scroll a specific element into view. Accepts ref or selector.
        // Awaits layout stability so the next action in the loop is operating
        // on a settled rect (matters for lazy-loaded images / virtualized lists).
        const resolvedScroll = resolveCommandTarget(cmd, targetDoc);
        const el = resolvedScroll.el;
        if (!el) return 'Element not found: ' + describeTarget(cmd);
        if (window.__sentinelOverlay) {
          window.__sentinelOverlay.showActionBanner('scroll_to', `Scrolling to: ${(el.innerText || el.tagName || '').substring(0, 60)}`);
        }
        hl.highlightElement(el);
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
          try { el.scrollIntoView(); } catch (ee) {}
        }
        await waitForStableRect(el, 2, 800);

        // (G3) After the scroll settles, glide the cursor to the element so
        // the user sees what's now in focus.
        try {
          if (window.__sentinelCursor && window.__sentinelCursor.moveToElement) {
            await window.__sentinelCursor.moveToElement(el, { duration: 250 });
          }
        } catch (e) {}

        try {
          const r = el.getBoundingClientRect();
          if (window.__sentinelOverlay) window.__sentinelOverlay.showClickIndicator(r.left + r.width / 2, r.top + r.height / 2);
        } catch (e) {}
        setTimeout(() => hl.removeHighlight(el), 1500);
        const note = resolvedScroll.staleRef ? ' (selector fallback after stale ref)' : '';
        return 'Scrolled to ' + describeTarget(cmd) + note;
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

  function safeSendMessage(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) {}
  }

  function setupSPAObservers() {
    let spaDebounce = null;

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
        }, 500);
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

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

  try { chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {}); } catch (e) {}
}
// (3.26.0) End-of-file marker — sync flush. (v3.36.3 dedupe applied)
