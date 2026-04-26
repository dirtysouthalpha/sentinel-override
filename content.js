chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'observe_page') {
      const interactiveElements = [];
      const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="textbox"], [tabindex]');

      elements.forEach((el, index) => {
        const text = (el.innerText || el.placeholder || el.getAttribute('aria-label') || el.title || "No label").trim();
        interactiveElements.push({
          index,
          tag: el.tagName,
          text: text,
          selector: getUniqueSelector(el),
          role: el.getAttribute('role') || "none",
          type: el.getAttribute('type') || "none"
        });
      });

      sendResponse({ elements: interactiveElements });
      return false;
    } else if (request.action === 'read_page') {
      // Extract content and convert to a simple Markdown-like structure
      const body = document.body.innerText;
      const title = document.title;
      const url = window.location.href;
      sendResponse({ content: `Page Title: ${title}\nURL: ${url}\n\n${body}` });
      return false;
    } else if (request.action === 'execute_command') {
      const cmd = request.command;
      let result = "Command failed";

      try {
        if (cmd.type === 'click') {
          const el = document.querySelector(cmd.selector);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.click();
            result = 'Clicked ' + cmd.selector;
          } else {
            result = 'Element not found: ' + cmd.selector;
          }
        } else if (cmd.type === 'type') {
          const el = document.querySelector(cmd.selector);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.focus();
            // Use native setter to trigger React/Angular/Vue internal state
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              const nativeSetter = Object.getOwnPropertyDescriptor(
                el.tagName === 'TEXTAREA'
                  ? window.HTMLTextAreaElement.prototype
                  : window.HTMLInputElement.prototype,
                'value'
              ).set;
              nativeSetter.call(el, cmd.text);
            } else {
              el.value = cmd.text;
            }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: cmd.text }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            result = 'Typed into ' + cmd.selector;
          } else {
            result = 'Element not found: ' + cmd.selector;
          }
        } else if (cmd.type === 'scroll') {
          window.scrollBy(0, cmd.amount);
          result = 'Scrolled ' + cmd.amount;
        }
      } catch (e) {
        result = 'Error executing ' + cmd.type + ': ' + e.message;
      }
      sendResponse({ result: result });
      return false;
    }
  } catch (err) {
    console.error('Content script error:', err);
    sendResponse({ error: err.message });
    return false;
  }
});

// Signal that content script is ready to receive messages
chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});

function getUniqueSelector(el) {
  if (el.id) return '#' + el.id;

  const path = [];
  while (el.parentElement) {
    let index = 0;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    path.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + (index + 1) + ')');
    el = el.parentElement;
  }
  return path.join(' > ');
}
