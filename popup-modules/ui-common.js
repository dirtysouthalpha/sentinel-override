// popup-modules/ui-common.js
// Shared popup utilities: HTML sanitization, URL validation, toasts, markdown config.
// Loaded first (before settings.js and chat.js) so these utilities are available globally.

// ========== Shared Helpers ==========
// getState is defined in popup-state.js (loaded before this file).

// eslint-disable-next-line no-unused-vars
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ========== HTML Sanitization ==========
// eslint-disable-next-line no-unused-vars
function sanitizeHtml(dirtyHtml) {
  const doc = new DOMParser().parseFromString(dirtyHtml, 'text/html');
  // Remove dangerous elements (includes SVG/MathML foreign content vectors)
  const dangerous = doc.querySelectorAll('script, iframe, object, embed, form, link[rel="import"], base, meta, svg, math');
  dangerous.forEach(el => el.remove());
  // Remove event handler attributes and dangerous URLs from all remaining elements
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase().trim();
      // Remove on* event handlers
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      // Remove javascript:, data:, vbscript: URLs in href/src/action/formaction/xlink:href
      if (/^(href|src|action|formaction|xlink:href)$/.test(name)
          && /^\s*(javascript\s*:|data\s*:|vbscript\s*:)/i.test(val)) {
        el.removeAttribute(attr.name);
        continue;
      }
      // Remove style attributes that could contain expression() or url(javascript:)
      if (name === 'style' && /expression\s*\(|url\s*\(\s*['"]?\s*javascript/i.test(val)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

// ========== Utility Functions ==========
// eslint-disable-next-line no-unused-vars
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line no-unused-vars
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ========== Markdown Configuration ==========
marked.setOptions({
  breaks: true,
  gfm: true,
});
