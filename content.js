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
