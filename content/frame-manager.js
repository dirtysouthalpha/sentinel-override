// Sentinel Override v3 -- Frame Manager (Content Script)
// Same-origin iframe traversal and element scanning inside iframes.
// Cross-origin iframes are reported as placeholders for background script routing.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.frame = window.__sentinelUtils.frame || {};

(function() {
  const fm = window.__sentinelUtils.frame;
  const dom = window.__sentinelUtils && window.__sentinelUtils.dom;

  // ========== Scan Iframes ==========
  // Enumerate all iframes in the document. For same-origin iframes,
  // recursively scan their contents. Cross-origin iframes get placeholders.
  fm.scanIframes = function(doc) {
    let elements = [];
    let iframeCount = 0;
    let crossOriginCount = 0;

    if (!doc) return { elements, iframeCount, crossOriginCount };

    let iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch {
      return { elements, iframeCount: 0, crossOriginCount: 0 };
    }

    iframes.forEach(function(iframe, index) {
      iframeCount++;
      const src = iframe.src || iframe.getAttribute('src') || 'about:blank';

      try {
        // Same-origin check: try to access contentWindow.document
        const iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
        if (iframeDoc) {
          // Same-origin: scan the iframe's document
          const iframeElements = [];
          const selectorMap = new Map();
          dom.scanDocument(iframeDoc, iframeElements, selectorMap, 'frame:' + index + ':');
          // Add each scanned element to the main elements array
          iframeElements.forEach(function(el) {
            // Add frame metadata
            el.frameIndex = index;
            el.frameUrl = src;
            elements.push(el);
          });
        }
      } catch {
        // Cross-origin: add placeholder
        crossOriginCount++;
        elements.push({
          index: elements.length,
          tag: 'IFRAME',
          text: 'Cross-origin iframe: ' + src,
          selector: 'frame:' + index + ':',
          role: 'cross-origin-iframe',
          type: 'none',
          frameUrl: src,
          frameId: null
        });
      }
    });

    return { elements, iframeCount, crossOriginCount };
  };

  // ========== Find In Iframe ==========
  // Given a selector starting with "frame:", resolve the iframe and find the element.
  // Returns { element, frameDoc } for same-origin or { crossOrigin: true, frameIndex, frameUrl, remainingSelector } for cross-origin.
  fm.findInIframe = function(doc, selector) {
    if (!selector || !selector.startsWith('frame:')) {
      return null;
    }

    const parts = selector.split(':');
    const frameIndex = parseInt(parts[1]);
    const remainingSelector = parts.slice(2).join(':');

    if (isNaN(frameIndex)) return null;

    let iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch {
      return null;
    }

    if (!iframes[frameIndex]) return null;

    const iframe = iframes[frameIndex];
    const src = iframe.src || iframe.getAttribute('src') || 'about:blank';

    try {
      // Same-origin
      const iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
      if (iframeDoc) {
        const element = dom.findElementBySelector(iframeDoc, remainingSelector);
        if (element) {
          return { element, frameDoc: iframeDoc, frameIndex, frameUrl: src };
        }
        return { element: null, frameDoc: iframeDoc, frameIndex, frameUrl: src };
      }
    } catch {
      // Cross-origin
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
  // Return metadata about all iframes on the page.
  fm.getIframeInfo = function(doc) {
    const info = [];

    if (!doc) return info;

    let iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch {
      return info;
    }

    iframes.forEach(function(iframe, index) {
      const src = iframe.src || iframe.getAttribute('src') || 'about:blank';
      let sameOrigin = false;

      try {
        if (iframe.contentWindow && iframe.contentWindow.document) {
          sameOrigin = true;
        }
      } catch {
        sameOrigin = false;
      }

      let rect;
      try {
        rect = iframe.getBoundingClientRect();
      } catch {
        rect = { width: 0, height: 0 };
      }

      info.push({
        index,
        src,
        sameOrigin,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: dom && dom.isVisible(iframe)
      });
    });

    return info;
  };
})();
