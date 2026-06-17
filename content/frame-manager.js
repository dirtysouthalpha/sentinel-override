// Sentinel Override v3 -- Frame Manager (Content Script)
// Same-origin iframe traversal and element scanning inside iframes.
// Cross-origin iframes are reported as placeholders for background script routing.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.frame = window.__sentinelUtils.frame || {};

(function() {
  function getErrorMessage(e) {
    if (typeof e === 'object' && e !== null && typeof e.message === 'string') return e.message;
    return String(e || '');
  }

  // Accessing contentWindow.document on a cross-origin iframe always throws a
  // SecurityError ("Blocked a frame with origin ... from accessing a cross-origin
  // frame"). That's the EXPECTED signal that a frame is cross-origin (ads, embeds,
  // social widgets) — not a real fault. Detect it so callers can log it quietly
  // and fall back to placeholders instead of spamming the console with red errors.
  function isCrossOriginError(e) {
    if (!e) return false;
    if (e.name === 'SecurityError') return true;
    const msg = getErrorMessage(e).toLowerCase();
    return msg.includes('cross-origin') || msg.includes('blocked a frame');
  }

  const fm = window.__sentinelUtils.frame;
  const dom = window.__sentinelUtils && window.__sentinelUtils.dom;

  // ========== Scan Iframes ==========
  /**
   * Enumerate all iframes in the document. For same-origin iframes,
   * recursively scan their contents. Cross-origin iframes get placeholders.
   * @param {Document} doc - The document to scan for iframes.
   * @returns {{elements: Array, iframeCount: number, crossOriginCount: number}} Object containing scanned elements, iframe count, and cross-origin count.
   */
  fm.scanIframes = function(doc) {
    let elements = [];
    let iframeCount = 0;
    let crossOriginCount = 0;

    if (!doc) return { elements, iframeCount, crossOriginCount };

    let iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch (error) {
      console.error('Error selecting iframes:', getErrorMessage(error));
      return { elements, iframeCount: 0, crossOriginCount: 0 };
    }

    if (iframes && typeof iframes.forEach === 'function') {
      iframes.forEach(function(iframe, index) {
        if (!iframe) return;
        iframeCount++;
      const src = iframe.src || iframe.getAttribute('src') || 'about:blank';

      try {
        // Same-origin check: try to access contentWindow.document
        const iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
        if (iframeDoc && dom) {
          // Same-origin: scan the iframe's document
          const iframeElements = [];
          const selectorMap = new Map();
          dom.scanDocument(iframeDoc, iframeElements, selectorMap, `frame:${index}:`);
          // Add each scanned element to the main elements array
          iframeElements.forEach(function(el) {
            // Add frame metadata
            el.frameIndex = index;
            el.frameUrl = src;
            elements.push(el);
          });
        }
      } catch (error) {
        // Cross-origin: add placeholder so the background script can route to the
        // frame out-of-process. This is the normal path for ad/embed iframes.
        crossOriginCount++;
        elements.push({
          index: elements.length,
          tag: 'IFRAME',
          text: `Cross-origin iframe: ${src}`,
          selector: `frame:${index}:`,
          role: 'cross-origin-iframe',
          type: 'none',
          frameUrl: src,
          frameId: null
        });
        // Expected for cross-origin frames — log quietly so the console isn't
        // flooded with red errors on ad-heavy pages. Surface anything unexpected.
        if (isCrossOriginError(error)) {
          console.debug(`Sentinel: iframe ${index} is cross-origin (${src}) — placeholder added`);
        } else {
          console.error(`Error scanning iframe ${index}:`, getErrorMessage(error));
        }
      }
      });
    }

    return { elements, iframeCount, crossOriginCount };
  };

  // ========== Find In Iframe ==========
  /**
   * Given a selector starting with "frame:", resolve the iframe and find the element.
   * @param {Document} doc - The document containing the iframes.
   * @param {string} selector - A selector starting with "frame:" (e.g., "frame:0:#button").
   * @returns {{element: Element, frameDoc: Document, frameIndex: number, frameUrl: string} | {crossOrigin: true, frameIndex: number, frameUrl: string, remainingSelector: string} | null} Result object with element and frame info, or cross-origin info, or null if not found.
   */
  fm.findInIframe = function(doc, selector) {
    if (!selector || !selector.startsWith('frame:')) {
      return null;
    }

    const parts = selector.split(':');
    const frameIndex = parseInt(parts[1], 10);
    const remainingSelector = parts.slice(2).join(':');

    if (Number.isNaN(frameIndex)) return null;

    let iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch (error) {
      console.error('Error selecting iframes:', getErrorMessage(error));
      return null;
    }

    if (!iframes[frameIndex]) return null;

    const iframe = iframes[frameIndex];
    const src = iframe.src || iframe.getAttribute('src') || 'about:blank';

    try {
      // Same-origin
      const iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
      if (iframeDoc && dom) {
        const element = dom.findElementBySelector(iframeDoc, remainingSelector);
        if (element) {
          return { element, frameDoc: iframeDoc, frameIndex, frameUrl: src, remainingSelector };
        }
        return { element: null, frameDoc: iframeDoc, frameIndex, frameUrl: src, remainingSelector };
      }
    } catch (error) {
      // Cross-origin access is expected here — fall through to the cross-origin
      // result below. Only log genuinely unexpected failures.
      if (!isCrossOriginError(error)) {
        console.error(`Error accessing iframe ${frameIndex} content:`, getErrorMessage(error));
      }
    }

    // Cross-origin iframe
    return {
      crossOrigin: true,
      frameIndex,
      frameUrl: src,
      remainingSelector
    };
  };

  // ========== Get Iframe Info ==========
  /**
   * Return metadata about all iframes on the page.
   * @param {Document} doc - The document to analyze for iframes.
   * @returns {Array<{index: number, src: string, sameOrigin: boolean, width: number, height: number, visible: boolean}>} Array of iframe metadata objects.
   */
  fm.getIframeInfo = function(doc) {
    const info = [];

    if (!doc) return info;

    let iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch (error) {
      console.error('Error selecting iframes:', getErrorMessage(error));
      return info;
    }

    if (iframes && typeof iframes.forEach === 'function') {
      iframes.forEach(function(iframe, index) {
        const src = iframe.src || iframe.getAttribute('src') || 'about:blank';
        let sameOrigin = false;

        try {
          if (iframe.contentWindow && iframe.contentWindow.document) {
            sameOrigin = true;
          }
        } catch (error) {
          // Expected for cross-origin frames — sameOrigin correctly stays false,
          // so there's nothing to report. Surface only unexpected errors.
          if (!isCrossOriginError(error)) {
            console.error(`Error checking origin for iframe ${index}:`, getErrorMessage(error));
          }
        }

        let rect;
        try {
        rect = iframe.getBoundingClientRect();
      } catch (error) {
        console.error(`Error getting dimensions for iframe ${index}:`, getErrorMessage(error));
        rect = { width: 0, height: 0 };
      }

      let visible = false;
      try {
        visible = dom && dom.isVisible(iframe);
      } catch (error) {
        console.error(`Error checking visibility for iframe ${index}:`, getErrorMessage(error));
      }

      info.push({
        index,
        src,
        sameOrigin,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible,
      });
    });
  }

    return info;
  };
})();