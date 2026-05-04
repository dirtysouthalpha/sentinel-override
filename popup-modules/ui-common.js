// popup-modules/ui-common.js
// Shared popup utilities: HTML sanitization, URL validation, toasts, markdown config.
// Loaded first (before settings.js and chat.js) so these utilities are available globally.

// ========== HTML Sanitization ==========
function sanitizeHtml(dirtyHtml) {
  const doc = new DOMParser().parseFromString(dirtyHtml, 'text/html');
  // Remove dangerous elements and attributes
  const dangerous = doc.querySelectorAll('script, iframe, object, embed, form, link[rel="import"], base, meta');
  dangerous.forEach(el => el.remove());
  // Remove event handler attributes from all remaining elements
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

// ========== Utility Functions ==========
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

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
