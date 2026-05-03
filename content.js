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
      const body = document.body.innerText;
      const title = document.title;
      const url = window.location.href;
      sendResponse({ content: `Page Title: ${title}\nURL: ${url}\n\n${body}` });
      return false;
    } else if (request.action === 'extract_data') {
      const data = {
        tables: extractTables(),
        metadata: extractMetadata(),
        forms: extractForms(),
        url: window.location.href,
        title: document.title
      };
      sendResponse(data);
      return false;
    } else if (request.action === 'execute_command') {
      const cmd = request.command;
      let result = "Command not implemented: " + (cmd.type || 'unknown');

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
        } else if (cmd.type === 'select') {
          const el = document.querySelector(cmd.selector);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.focus();
            if (el.tagName === 'SELECT') {
              el.value = cmd.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              result = 'Selected value ' + cmd.value + ' in ' + cmd.selector;
            } else {
              result = 'Element is not a select element: ' + cmd.selector;
            }
          } else {
            result = 'Element not found: ' + cmd.selector;
          }
        } else if (cmd.type === 'hover') {
          const el = document.querySelector(cmd.selector);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            const mouseoverEvent = new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window });
            el.dispatchEvent(mouseoverEvent);
            const mouseenterEvent = new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window });
            el.dispatchEvent(mouseenterEvent);
            result = 'Hovered over ' + cmd.selector;
          } else {
            result = 'Element not found: ' + cmd.selector;
          }
        } else if (cmd.type === 'press_key') {
          const el = document.querySelector(cmd.selector);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.focus();
            const keyCode = cmd.value;
            const keydownEvent = new KeyboardEvent('keydown', { key: keyCode, code: keyCode, bubbles: true, cancelable: true });
            const keypressEvent = new KeyboardEvent('keypress', { key: keyCode, code: keyCode, bubbles: true, cancelable: true });
            const keyupEvent = new KeyboardEvent('keyup', { key: keyCode, code: keyCode, bubbles: true, cancelable: true });
            el.dispatchEvent(keydownEvent);
            el.dispatchEvent(keypressEvent);
            el.dispatchEvent(keyupEvent);
            result = 'Pressed key ' + keyCode + ' on ' + cmd.selector;
          } else {
            result = 'Element not found: ' + cmd.selector;
          }
        } else if (cmd.type === 'extract') {
          const el = document.querySelector(cmd.selector);
          if (el) {
            const extractedText = el.innerText || el.textContent || el.value || '';
            result = extractedText.trim();
          } else {
            result = 'Element not found: ' + cmd.selector;
          }
        } else if (cmd.type === 'wait_for_text') {
          const checkForText = () => {
            const bodyText = document.body.innerText;
            if (bodyText.includes(cmd.text)) {
              return true;
            }
            return false;
          };

          const startTime = Date.now();
          const timeout = cmd.timeout || 10000;
          const pollInterval = 100;

          const waitPromise = new Promise((resolve) => {
            const interval = setInterval(() => {
              if (checkForText()) {
                clearInterval(interval);
                resolve(true);
              } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                resolve(false);
              }
            }, pollInterval);
          });

          waitPromise.then((found) => {
            if (found) {
              result = 'Found text: ' + cmd.text;
            } else {
              result = 'Text not found after ' + timeout + 'ms: ' + cmd.text;
            }
            sendResponse({ result: result });
          });
          return true;
        } else if (cmd.type === 'wait_for_element') {
          const checkForElement = () => {
            return document.querySelector(cmd.selector) !== null;
          };

          const startTime = Date.now();
          const timeout = cmd.timeout || 10000;
          const pollInterval = 100;

          const waitPromise = new Promise((resolve) => {
            const interval = setInterval(() => {
              if (checkForElement()) {
                clearInterval(interval);
                resolve(true);
              } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                resolve(false);
              }
            }, pollInterval);
          });

          waitPromise.then((found) => {
            if (found) {
              result = 'Element found: ' + cmd.selector;
            } else {
              result = 'Element not found after ' + timeout + 'ms: ' + cmd.selector;
            }
            sendResponse({ result: result });
          });
          return true;
        } else if (cmd.type === 'wait_for_navigation') {
          const startUrl = window.location.href;
          const startTime = Date.now();
          const timeout = cmd.timeout || 10000;
          const pollInterval = 500;

          const waitPromise = new Promise((resolve) => {
            const interval = setInterval(() => {
              if (window.location.href !== startUrl) {
                clearInterval(interval);
                resolve(true);
              } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                resolve(false);
              }
            }, pollInterval);
          });

          waitPromise.then((navigated) => {
            if (navigated) {
              result = 'Page navigated from ' + startUrl + ' to ' + window.location.href;
            } else {
              result = 'Navigation timeout after ' + timeout + 'ms (page did not change from ' + startUrl + ')';
            }
            sendResponse({ result: result });
          });
          return true;
        } else if (cmd.type === 'execute_js') {
          try {
            const jsResult = eval(cmd.code);
            result = 'JavaScript executed: ' + (typeof jsResult === 'string' ? jsResult : JSON.stringify(jsResult));
          } catch (jsError) {
            result = 'JavaScript error: ' + jsError.message;
          }
        } else {
          result = 'Unknown command type: ' + cmd.type;
        }
      } catch (e) {
        result = 'Error executing command type "' + (cmd.type || 'unknown') + '": ' + e.message;
      }

      if (cmd.type !== 'wait_for_text' && cmd.type !== 'wait_for_element') {
        sendResponse({ result: result });
      }
      return false;
    } else if (request.action === 'capture_screenshot') {
      (async () => {
        try {
          if (typeof html2canvas === 'undefined') {
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
              script.onload = resolve;
              script.onerror = reject;
              document.head.appendChild(script);
            });
          }

          const canvas = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            scale: 0.5
          });

          const imageData = canvas.toDataURL('image/png');
          sendResponse({ success: true, imageData, prompt: request.prompt });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  } catch (err) {
    console.error('Content script error:', err);
    sendResponse({ error: err.message });
    return false;
  }
});

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

// v2.4: Structured Data Extraction
function extractTables() {
  const tables = [];
  document.querySelectorAll('table').forEach(table => {
    const rows = [];
    table.querySelectorAll('tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach(td => cells.push(td.innerText.trim()));
      rows.push(cells);
    });
    tables.push({ headers: rows[0], data: rows.slice(1) });
  });
  return tables;
}

function extractMetadata() {
  const metadata = {};
  document.querySelectorAll('meta').forEach(meta => {
    const name = meta.getAttribute('name') || meta.getAttribute('property');
    const content = meta.getAttribute('content');
    if (name && content) metadata[name] = content;
  });
  return metadata;
}

function extractForms() {
  const forms = [];
  document.querySelectorAll('form').forEach(form => {
    const fields = [];
    form.querySelectorAll('input, select, textarea').forEach(field => {
      fields.push({
        name: field.name,
        type: field.type,
        value: field.value,
        selector: getUniqueSelector(field)
      });
    });
    forms.push({ selector: getUniqueSelector(form), fields });
  });
  return forms;
}

// ========== Screenshot Analysis (consolidated into main listener above) ==========
