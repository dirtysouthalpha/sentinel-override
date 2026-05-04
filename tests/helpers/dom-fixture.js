// Sentinel Override v3 -- DOM Test Fixtures
// Helper functions to build test DOM trees for unit tests.

/**
 * Creates a DOM element with optional attributes and text content.
 * @param {string} tag - HTML tag name
 * @param {object} [attrs] - Attributes to set on the element
 * @param {string} [textContent] - Text content for the element
 * @returns {HTMLElement}
 */
export function createEl(tag, attrs = {}, textContent = '') {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'class') {
      el.className = value;
    } else {
      el.setAttribute(key, value);
    }
  });
  if (textContent) el.textContent = textContent;
  return el;
}

/**
 * Creates a form with input elements.
 * @param {Array<{type: string, name: string, id?: string, placeholder?: string, value?: string}>} inputs
 * @returns {HTMLFormElement}
 */
export function createForm(inputs = []) {
  const form = document.createElement('form');
  inputs.forEach(input => {
    const el = document.createElement('input');
    el.type = input.type || 'text';
    el.name = input.name || '';
    if (input.id) el.id = input.id;
    if (input.placeholder) el.placeholder = input.placeholder;
    if (input.value) el.value = input.value;
    form.appendChild(el);
  });
  return form;
}

/**
 * Creates a select element with option elements.
 * @param {Array<{value: string, text: string}>} items
 * @returns {HTMLSelectElement}
 */
export function createDropdown(items = []) {
  const select = document.createElement('select');
  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item.value || '';
    option.textContent = item.text || '';
    select.appendChild(option);
  });
  return select;
}

/**
 * Creates a div with an open shadow root containing the given children.
 * @param {Array<HTMLElement>} children
 * @returns {HTMLElement} The shadow host element
 */
export function createShadowHost(children = []) {
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  children.forEach(child => shadowRoot.appendChild(child));
  return host;
}

/**
 * Creates a complete test page with common interactive elements.
 * Useful for testing scanDocument and similar functions.
 * @returns {{ container: HTMLElement, button: HTMLButtonElement, input: HTMLInputElement, link: HTMLAnchorElement, select: HTMLSelectElement }}
 */
export function createTestPage() {
  const container = document.createElement('div');
  container.id = 'test-container';

  const button = createEl('button', { id: 'submit-btn' }, 'Submit Form');
  container.appendChild(button);

  const input = createEl('input', { type: 'text', name: 'email', placeholder: 'Enter email' });
  container.appendChild(input);

  const link = createEl('a', { href: 'https://example.com' }, 'Click here');
  container.appendChild(link);

  const select = createDropdown([
    { value: 'opt1', text: 'Option 1' },
    { value: 'opt2', text: 'Option 2' },
  ]);
  select.id = 'my-select';
  container.appendChild(select);

  const hidden = createEl('button', { id: 'hidden-btn' }, 'Hidden');
  hidden.style.display = 'none';
  container.appendChild(hidden);

  document.body.appendChild(container);
  return { container, button, input, link, select, hidden };
}

/**
 * Cleans up test DOM elements.
 * @param {HTMLElement} container
 */
export function cleanupTestPage(container) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
}
