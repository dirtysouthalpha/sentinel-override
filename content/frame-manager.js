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
    var elements = [];
    var iframeCount = 0;
    var crossOriginCount = 0;

    if (!doc) return { elements: elements, iframeCount: iframeCount, crossOriginCount: crossOriginCount };

    var iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch (e) {
      return { elements: elements, iframeCount: 0, crossOriginCount: 0 };
    }

    iframes.forEach(function(iframe, index) {
      iframeCount++;
      var src = iframe.src || iframe.getAttribute('src') || 'about:blank';

      try {
        // Same-origin check: try to access contentWindow.document
        var iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
        if (iframeDoc) {
          // Same-origin: scan the iframe's document
          var iframeElements = [];
          var selectorMap = new Map();
          dom.scanDocument(iframeDoc, iframeElements, selectorMap, 'frame:' + index + ':');
          // Add each scanned element to the main elements array
          iframeElements.forEach(function(el) {
            // Add frame metadata
            el.frameIndex = index;
            el.frameUrl = src;
            elements.push(el);
          });
        }
      } catch (e) {
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

    return { elements: elements, iframeCount: iframeCount, crossOriginCount: crossOriginCount };
  };

  // ========== Find In Iframe ==========
  // Given a selector starting with "frame:", resolve the iframe and find the element.
  // Returns { element, frameDoc } for same-origin or { crossOrigin: true, frameIndex, frameUrl, remainingSelector } for cross-origin.
  fm.findInIframe = function(doc, selector) {
    if (!selector || !selector.startsWith('frame:')) {
      return null;
    }

    var parts = selector.split(':');
    var frameIndex = parseInt(parts[1]);
    var remainingSelector = parts.slice(2).join(':');

    if (isNaN(frameIndex)) return null;

    var iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch (e) {
      return null;
    }

    if (!iframes[frameIndex]) return null;

    var iframe = iframes[frameIndex];
    var src = iframe.src || iframe.getAttribute('src') || 'about:blank';

    try {
      // Same-origin
      var iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
      if (iframeDoc) {
        var element = dom.findElementBySelector(iframeDoc, remainingSelector);
        if (element) {
          return { element: element, frameDoc: iframeDoc, frameIndex: frameIndex, frameUrl: src };
        }
        return { element: null, frameDoc: iframeDoc, frameIndex: frameIndex, frameUrl: src };
      }
    } catch (e) {
      // Cross-origin
    }

    // Cross-origin iframe
    return {
      crossOrigin: true,
      frameIndex: frameIndex,
      frameUrl: src,
      remainingSelector: remainingSelector
    };
  };

  // ========== Get Iframe Info ==========
  // Return metadata about all iframes on the page.
  fm.getIframeInfo = function(doc) {
    var info = [];

    if (!doc) return info;

    var iframes;
    try {
      iframes = doc.querySelectorAll('iframe');
    } catch (e) {
      return info;
    }

    iframes.forEach(function(iframe, index) {
      var src = iframe.src || iframe.getAttribute('src') || 'about:blank';
      var sameOrigin = false;

      try {
        if (iframe.contentWindow && iframe.contentWindow.document) {
          sameOrigin = true;
        }
      } catch (e) {
        sameOrigin = false;
      }

      var rect;
      try {
        rect = iframe.getBoundingClientRect();
      } catch (e) {
        rect = { width: 0, height: 0 };
      }

      info.push({
        index: index,
        src: src,
        sameOrigin: sameOrigin,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: dom && dom.isVisible(iframe)
      });
    });

    return info;
  };
})();

export const frame = window.__sentinelUtils.frame;
