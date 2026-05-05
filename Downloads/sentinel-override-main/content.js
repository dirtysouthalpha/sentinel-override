(() => {
  'use strict';

  if (window.__sentinelContentReady) {
    chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
    return;
  }
  window.__sentinelContentReady = true;

  const SENTINEL_ATTR = 'data-sentinel-id';
  const OVERLAY_ID = 'sentinel-soM-overlay';
  const REGISTRY = new Map();
  const REGISTRY_BY_EL = new WeakMap();
  let nextId = 1;

  // ---------- DOM walking (shadow-DOM aware) ----------
  function* walkAll(root) {
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        stack.push(child);
        if (child.shadowRoot) stack.push(child.shadowRoot);
      }
      if (node.nodeType === 1) yield node;
    }
  }

  const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS', 'OPTION']);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'switch', 'tab', 'textbox', 'combobox',
    'searchbox', 'slider', 'spinbutton'
  ]);

  function isInteractive(el) {
    if (!el || el.nodeType !== 1) return false;
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;
    const role = el.getAttribute && el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.hasAttribute && el.hasAttribute('onclick')) return true;
    const editable = el.getAttribute && el.getAttribute('contenteditable');
    if (editable && editable !== 'false') return true;
    if (typeof el.tabIndex === 'number' && el.tabIndex >= 0 && el.tagName !== 'BODY') {
      try {
        const cs = window.getComputedStyle(el);
        if (cs && cs.cursor === 'pointer') return true;
      } catch (e) {}
    }
    return false;
  }

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const cs = window.getComputedStyle(el);
      if (!cs) return false;
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function inViewport(rect) {
    return rect.bottom > 0 && rect.top < window.innerHeight &&
           rect.right > 0 && rect.left < window.innerWidth;
  }

  // ---------- Accessible name ----------
  function getAccessibleName(el) {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(n => (n.innerText || n.textContent || '').trim())
        .join(' ');
      if (text) return text;
    }

    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (el.id) {
        try {
          const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (lbl) return (lbl.innerText || '').trim();
        } catch (e) {}
      }
      const wrap = el.closest && el.closest('label');
      if (wrap) return (wrap.innerText || '').trim();
      if (el.placeholder) return el.placeholder;
      if (el.name) return el.name;
      if (el.value && tag === 'INPUT' && el.type === 'submit') return el.value;
    }

    if (tag === 'IMG' && el.alt) return el.alt;

    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text.substring(0, 140);

    return el.title || el.alt || '';
  }

  function getRole(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.href) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button') return 'button';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    return tag;
  }

  // ---------- Registry ----------
  function clearRegistry() {
    REGISTRY.clear();
    nextId = 1;
    try {
      document.querySelectorAll('[' + SENTINEL_ATTR + ']').forEach(el => {
        el.removeAttribute(SENTINEL_ATTR);
      });
    } catch (e) {}
  }

  function registerElement(el) {
    if (REGISTRY_BY_EL.has(el)) return REGISTRY_BY_EL.get(el);
    const id = nextId++;
    REGISTRY.set(id, el);
    REGISTRY_BY_EL.set(el, id);
    try { el.setAttribute(SENTINEL_ATTR, String(id)); } catch (e) {}
    return id;
  }

  function getElementById(id) {
    const el = REGISTRY.get(Number(id));
    if (el && (document.contains(el) || isInShadow(el))) return el;
    try {
      const fromAttr = document.querySelector('[' + SENTINEL_ATTR + '="' + Number(id) + '"]');
      if (fromAttr) {
        REGISTRY.set(Number(id), fromAttr);
        REGISTRY_BY_EL.set(fromAttr, Number(id));
        return fromAttr;
      }
    } catch (e) {}
    return null;
  }

  function isInShadow(target) {
    let n = target;
    while (n) {
      const root = n.getRootNode && n.getRootNode();
      if (root === document) return true;
      if (root instanceof ShadowRoot) { n = root.host; continue; }
      return false;
    }
    return false;
  }

  function findByRoleAndName(role, name) {
    if (!name) return null;
    const lname = name.toLowerCase();
    for (const el of walkAll(document.body)) {
      if (!isInteractive(el)) continue;
      if (role) {
        const r = getRole(el);
        if (r !== role && el.tagName.toLowerCase() !== role.toLowerCase()) continue;
      }
      const accName = getAccessibleName(el).toLowerCase();
      if (accName && (accName === lname || accName.includes(lname))) return el;
    }
    return null;
  }

  // ---------- Observation ----------
  function buildElementInfo(el, id) {
    const rect = el.getBoundingClientRect();
    const tag = el.tagName;
    const info = {
      id,
      tag,
      role: getRole(el),
      name: getAccessibleName(el),
      bbox: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      inViewport: inViewport(rect),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true'
    };
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      info.type = (el.type || 'text').toLowerCase();
      info.value = String(el.value || '').substring(0, 80);
      if (el.placeholder) info.placeholder = el.placeholder;
      if (info.type === 'checkbox' || info.type === 'radio') info.checked = !!el.checked;
    } else if (tag === 'SELECT') {
      info.value = String(el.value || '');
      info.options = Array.from(el.options || []).slice(0, 20).map(o => ({ value: o.value, text: o.text }));
    } else if (tag === 'A') {
      try { info.href = el.href ? String(el.href).substring(0, 200) : ''; } catch (e) {}
    }
    return info;
  }

  function observePage(opts = {}) {
    clearRegistry();
    const elements = [];
    for (const el of walkAll(document.body)) {
      if (!isInteractive(el)) continue;
      if (!isVisible(el)) continue;
      const id = registerElement(el);
      const info = buildElementInfo(el, id);
      if (opts.viewportOnly && !info.inViewport) continue;
      elements.push(info);
    }
    return {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: {
        w: window.innerWidth,
        h: window.innerHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        scrollHeight: document.documentElement.scrollHeight,
        atBottom: (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 4)
      },
      elements
    };
  }

  // ---------- Set-of-marks overlay ----------
  const PALETTE = ['#ff3860', '#ffdd57', '#23d160', '#3273dc', '#b86bff', '#ff851b', '#00d1b2', '#f368e0'];

  function drawMarks(ids) {
    clearMarks();
    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('data-sentinel-overlay', '1');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';

    const targets = [];
    if (ids && ids.length) {
      for (const id of ids) {
        const el = getElementById(id);
        if (el) targets.push({ id: Number(id), el });
      }
    } else {
      for (const [id, el] of REGISTRY.entries()) {
        if (el && (document.contains(el) || isInShadow(el))) targets.push({ id, el });
      }
    }

    let drawn = 0;
    targets.forEach(({ id, el }, idx) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const color = PALETTE[idx % PALETTE.length];
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
        'width:' + rect.width + 'px;height:' + rect.height + 'px;' +
        'border:2px solid ' + color + ';box-sizing:border-box;pointer-events:none;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,0.4);';
      const label = document.createElement('div');
      label.textContent = String(id);
      const lblTop = Math.max(rect.top - 16, 0);
      label.style.cssText =
        'position:fixed;left:' + rect.left + 'px;top:' + lblTop + 'px;' +
        'background:' + color + ';color:#000;font:bold 12px/16px ui-monospace,monospace;' +
        'padding:0 4px;border-radius:2px;pointer-events:none;' +
        'text-shadow:0 0 2px rgba(255,255,255,0.6);';
      root.appendChild(box);
      root.appendChild(label);
      drawn++;
    });

    (document.body || document.documentElement).appendChild(root);
    return drawn;
  }

  function clearMarks() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  // ---------- Real input events ----------
  function nextFrame() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  async function realClick(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
    catch (e) { el.scrollIntoView(); }
    await nextFrame();
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, buttons: 1, clientX: cx, clientY: cy, screenX: cx, screenY: cy
    };
    const pointerInit = Object.assign({}, init, { pointerType: 'mouse', pointerId: 1, isPrimary: true });
    try { el.dispatchEvent(new PointerEvent('pointerover', pointerInit)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseover', init));
    try { el.dispatchEvent(new PointerEvent('pointermove', pointerInit)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousemove', init));
    try { el.dispatchEvent(new PointerEvent('pointerdown', pointerInit)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', init));
    try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', pointerInit)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
  }

  async function realType(el, text, opts = {}) {
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
    try { el.focus(); } catch (e) {}
    await nextFrame();
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    const str = String(text);
    if (opts.clear !== false) {
      if (isInput) {
        setNativeValue(el, '');
      } else if (el.isContentEditable) {
        el.textContent = '';
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    // Character-by-character input for short text to trigger autocomplete
    if (str.length <= 60 && isInput) {
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        setNativeValue(el, str.substring(0, i + 1));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: keyToCode(ch), bubbles: true }));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code: keyToCode(ch), bubbles: true }));
      }
    } else {
      if (isInput) {
        setNativeValue(el, str);
      } else if (el.isContentEditable) {
        el.textContent = str;
      } else if ('value' in el) {
        el.value = str;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: str }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function keyToCode(key) {
    if (!key) return '';
    if (key.length === 1) {
      if (/[a-zA-Z]/.test(key)) return 'Key' + key.toUpperCase();
      if (/[0-9]/.test(key)) return 'Digit' + key;
      if (key === ' ') return 'Space';
    }
    return key;
  }

  async function pressKey(target, key, modifiers = {}) {
    const t = target || document.activeElement || document.body;
    const init = {
      key,
      code: keyToCode(key),
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: !!modifiers.ctrl,
      shiftKey: !!modifiers.shift,
      altKey: !!modifiers.alt,
      metaKey: !!modifiers.meta
    };
    t.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key.length === 1) {
      t.dispatchEvent(new KeyboardEvent('keypress', init));
    }
    t.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  // ---------- Wait helpers ----------
  function waitFor(predicate, timeout) {
    return new Promise((resolve) => {
      try { if (predicate()) return resolve(true); } catch (e) {}
      const start = Date.now();
      const t = setInterval(() => {
        try {
          if (predicate()) { clearInterval(t); resolve(true); }
          else if (Date.now() - start > timeout) { clearInterval(t); resolve(false); }
        } catch (e) {}
      }, 100);
    });
  }

  function waitForReady(timeout = 8000) {
    return waitFor(() => document.readyState === 'complete', timeout);
  }

  function waitForDomStable(quietMs = 500, timeout = 5000) {
    return new Promise((resolve) => {
      let last = Date.now();
      let obs;
      try {
        obs = new MutationObserver(() => { last = Date.now(); });
        obs.observe(document.body || document.documentElement, {
          subtree: true, childList: true, attributes: true, characterData: true
        });
      } catch (e) {
        return resolve(true);
      }
      const start = Date.now();
      const t = setInterval(() => {
        if (Date.now() - last >= quietMs) {
          obs.disconnect(); clearInterval(t); resolve(true);
        } else if (Date.now() - start > timeout) {
          obs.disconnect(); clearInterval(t); resolve(false);
        }
      }, 100);
    });
  }

  // ---------- Resolution: id > selector > role+name ----------
  function resolveElement(cmd) {
    if (cmd.id != null) {
      const byId = getElementById(cmd.id);
      if (byId) return byId;
    }
    if (cmd.selector) {
      try {
        const direct = document.querySelector(cmd.selector);
        if (direct) return direct;
      } catch (e) {}
      for (const el of walkAll(document.body)) {
        try {
          if (el.matches && el.matches(cmd.selector)) return el;
        } catch (e) {}
      }
    }
    if (cmd.role || cmd.name) {
      return findByRoleAndName(cmd.role, cmd.name);
    }
    return null;
  }

  // ---------- Command dispatcher ----------
  async function runCommand(cmd) {
    switch (cmd.type) {
      case 'click': {
        const el = resolveElement(cmd);
        if (!el) return { ok: false, error: 'Element not found', stale: cmd.id != null };
        await realClick(el);
        return { ok: true, result: 'Clicked ' + describe(cmd, el) };
      }
      case 'type': {
        const el = resolveElement(cmd);
        if (!el) return { ok: false, error: 'Element not found', stale: cmd.id != null };
        await realType(el, cmd.text, { clear: cmd.clear });
        if (cmd.submit) await pressKey(el, 'Enter');
        return { ok: true, result: 'Typed into ' + describe(cmd, el) };
      }
      case 'select': {
        const el = resolveElement(cmd);
        if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'Not a <select> element' };
        el.value = cmd.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, result: 'Selected ' + cmd.value };
      }
      case 'hover': {
        const el = resolveElement(cmd);
        if (!el) return { ok: false, error: 'Element not found' };
        try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
        const rect = el.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
        try { el.dispatchEvent(new PointerEvent('pointerover', Object.assign({}, init, { pointerType: 'mouse' }))); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mouseover', init));
        el.dispatchEvent(new MouseEvent('mouseenter', init));
        return { ok: true, result: 'Hovered ' + describe(cmd, el) };
      }
      case 'press_key': {
        const el = (cmd.id != null || cmd.selector) ? resolveElement(cmd) : null;
        await pressKey(el, cmd.key || cmd.value, cmd.modifiers || {});
        return { ok: true, result: 'Pressed ' + (cmd.key || cmd.value) };
      }
      case 'scroll': {
        if (cmd.id != null || cmd.selector) {
          const el = resolveElement(cmd);
          if (el) {
            try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { el.scrollIntoView(); }
            return { ok: true, result: 'Scrolled to ' + describe(cmd, el) };
          }
          return { ok: false, error: 'Element not found' };
        }
        const amt = typeof cmd.amount === 'number' ? cmd.amount : 600;
        window.scrollBy({ top: amt, left: 0, behavior: 'instant' });
        return { ok: true, result: 'Scrolled by ' + amt };
      }
      case 'extract': {
        const el = resolveElement(cmd);
        if (!el) return { ok: false, error: 'Element not found' };
        const raw = (el.innerText || el.textContent || el.value || '').toString().trim();
        const text = raw.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n');
        return { ok: true, result: text };
      }
      case 'extract_list': {
        const items = [];
        for (const el of walkAll(document.body)) {
          if (!isInteractive(el) || !isVisible(el)) continue;
          const name = getAccessibleName(el);
          if (name) items.push({ tag: el.tagName, role: getRole(el), name });
        }
        return { ok: true, result: items.slice(0, 50) };
      }
      case 'wait_for_text': {
        const ok = await waitFor(() => (document.body.innerText || '').includes(cmd.text), cmd.timeout || 10000);
        return { ok, result: ok ? 'Text appeared: ' + cmd.text : 'Timeout waiting for text' };
      }
      case 'wait_for_element': {
        const ok = await waitFor(() => !!resolveElement(cmd), cmd.timeout || 10000);
        return { ok, result: ok ? 'Element appeared' : 'Timeout waiting for element' };
      }
      case 'wait_stable': {
        await waitForReady(cmd.timeout || 8000);
        await waitForDomStable(cmd.quietMs || 500, cmd.timeout || 5000);
        return { ok: true, result: 'DOM stable' };
      }
      case 'wait_for_navigation': {
        const currentUrl = window.location.href;
        const ok = await waitFor(() => window.location.href !== currentUrl, cmd.timeout || 10000);
        return { ok, result: ok ? 'Navigated to ' + window.location.href : 'Timeout waiting for navigation' };
      }
      case 'go_back': {
        history.back();
        return { ok: true, result: 'Navigated back' };
      }
      case 'go_forward': {
        history.forward();
        return { ok: true, result: 'Navigated forward' };
      }
      case 'execute_js': {
        if (!cmd.code) return { ok: false, error: 'No code provided' };
        try {
          const fn = new Function(cmd.code);
          const result = fn();
          return { ok: true, result: result != null ? String(result) : 'executed' };
        } catch (e) {
          return { ok: false, error: 'JS execution error: ' + e.message };
        }
      }
      default:
        return { ok: false, error: 'Unknown command: ' + cmd.type };
    }
  }

  function describe(cmd, el) {
    if (cmd.id != null) return '#' + cmd.id + ' ' + (el.tagName || '');
    if (cmd.selector) return cmd.selector;
    if (cmd.name) return '"' + cmd.name + '"';
    return el.tagName || 'element';
  }

  // ---------- Page reading ----------
  function readPage() {
    const body = (document.body && document.body.innerText) || '';
    return {
      content: 'Page Title: ' + document.title + '\nURL: ' + window.location.href + '\n\n' + body.substring(0, 12000)
    };
  }

  function extractData() {
    const tables = [];
    document.querySelectorAll('table').forEach(t => {
      const rows = [];
      t.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(c => cells.push((c.innerText || '').trim()));
        rows.push(cells);
      });
      if (rows.length) tables.push({ headers: rows[0], data: rows.slice(1) });
    });
    const metadata = {};
    document.querySelectorAll('meta').forEach(m => {
      const k = m.getAttribute('name') || m.getAttribute('property');
      const v = m.getAttribute('content');
      if (k && v) metadata[k] = v;
    });
    const forms = [];
    document.querySelectorAll('form').forEach(f => {
      const fields = [];
      f.querySelectorAll('input, select, textarea').forEach(field => {
        fields.push({
          name: field.name,
          type: field.type,
          value: String(field.value || '').substring(0, 80)
        });
      });
      forms.push({ action: f.action, method: f.method, fields });
    });
    return { tables, metadata, forms, url: window.location.href, title: document.title };
  }

  // ---------- Message bridge ----------
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    (async () => {
      try {
        switch (req.action) {
          case 'observe_page':
            return sendResponse(observePage(req.opts || {}));
          case 'read_page':
            return sendResponse(readPage());
          case 'extract_data':
            return sendResponse(extractData());
          case 'draw_marks':
            return sendResponse({ count: drawMarks(req.ids) });
          case 'clear_marks':
            clearMarks();
            return sendResponse({ ok: true });
          case 'wait_stable': {
            await waitForReady(req.timeout || 8000);
            await waitForDomStable(req.quietMs || 500, req.timeout || 5000);
            return sendResponse({ ok: true });
          }
          case 'execute_command': {
            clearMarks();
            const r = await runCommand(req.command || {});
            if (r.ok) return sendResponse({ ok: true, result: r.result });
            return sendResponse({ ok: false, result: r.error, stale: !!r.stale });
          }
          default:
            return sendResponse({ error: 'Unknown action: ' + req.action });
        }
      } catch (e) {
        try { sendResponse({ error: (e && e.message) || String(e) }); } catch (_) {}
      }
    })();
    return true; // async
  });

  chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
})();
