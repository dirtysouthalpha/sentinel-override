// tests/dropdown-utils-branch-coverage.test.js
// Branch coverage for content/dropdown-utils.js.
//
// This file intentionally does NOT pre-set window.__sentinelUtils (or its dom/
// wait/shadow sub-objects) so that the module-load || {} fallbacks fire:
//   b0[1] L5 : window.__sentinelUtils       = undefined → || {} fires
//   b1[1] L6 : window.__sentinelUtils.dropdown = undefined → || {} fires
//   b5[1] L15: dom    = undefined → || {} fires
//   b6[1] L16: wait   = undefined → || {} fires
//   b7[1] L17: shadow = undefined → || {} fires
// Since wait = {}, wait.sleep is undefined for the whole file → b9[1] fires in
// every openDropdown call.

// ── DOM environment (must precede module import) ─────────────────────────────
globalThis.window = globalThis;

globalThis.CSS = { escape: (s) => s.replace(/([[\]\\])/g, '\\$1') };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.HTMLElement = class HTMLElement {};
globalThis.Element = class Element {};
globalThis.MouseEvent = class MouseEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? true;
    this.cancelable = opts.cancelable ?? true;
    this.composed = opts.composed ?? true;
  }
};
globalThis.KeyboardEvent = class KeyboardEvent {
  constructor(type, opts = {}) {
    this.type = type; this.key = opts.key || ''; this.code = opts.code || '';
    this.keyCode = opts.keyCode || 0; this.which = opts.which || 0;
    this.bubbles = opts.bubbles ?? true; this.cancelable = opts.cancelable ?? true;
  }
};
globalThis.Event = class Event {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? true;
    this.cancelable = opts.cancelable ?? true;
    this.composed = opts.composed ?? true;
  }
};
globalThis.InputEvent = class InputEvent extends globalThis.Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.inputType = opts.inputType || '';
    this.data = opts.data || '';
  }
};

function createElement(tag, attrs = {}) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    getAttribute: (name) => attrs[name] || null,
    setAttribute: (name, val) => { attrs[name] = val; },
    hasAttribute: (name) => attrs[name] !== undefined,
    id: attrs.id || '',
    className: attrs.className || '',
    classList: {
      add: () => {}, remove: () => {},
      contains: (cls) => (attrs.className || '').includes(cls),
    },
    type: attrs.type || '',
    name: attrs.name || '',
    value: attrs.value || '',
    innerText: attrs.innerText || '',
    textContent: attrs.textContent || '',
    placeholder: attrs.placeholder || '',
    disabled: attrs.disabled || false,
    checked: attrs.checked || false,
    role: attrs.role || '',
    style: attrs.style || { display: 'block', visibility: 'visible', opacity: '1' },
    offsetWidth: attrs.offsetWidth || 100,
    offsetHeight: attrs.offsetHeight || 30,
    isConnected: true,
    ownerDocument: { defaultView: globalThis },
    parentElement: attrs.parentElement || null,
    children: attrs.children || [],
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || []; listeners[evt].push(cb);
    },
    removeEventListener: (evt, cb) => {
      if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== cb);
    },
    dispatchEvent: (evt) => {
      evt.target = el;
      (listeners[evt.type] || []).forEach(cb => cb(evt));
      return true;
    },
    click: () => {
      el.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    scrollIntoView: () => {},
    querySelector: () => null,
    querySelectorAll: () => ({ forEach: () => {}, length: 0 }),
    closest: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 }),
  };
  return el;
}

function makeDoc(overrides = {}) {
  return {
    defaultView: globalThis,
    querySelectorAll: () => ({ forEach: () => {}, length: 0 }),
    querySelector: () => null,
    getElementById: () => null,
    body: { innerText: '', appendChild: () => {}, removeChild: () => {}, dispatchEvent: () => true },
    activeElement: null,
    documentElement: { children: [] },
    ...overrides,
  };
}

// ── Module load ───────────────────────────────────────────────────────────────
let dd;
beforeAll(async () => {
  // window.__sentinelUtils is undefined here → b0[1], b1[1], b5[1], b6[1], b7[1]
  await import('../content/dropdown-utils.js');
  dd = globalThis.window.__sentinelUtils.dropdown;
});

// ─── b0[1]+b1[1]+b5[1]+b6[1]+b7[1]: module-load || {} fallbacks ──────────────

describe('dropdown-utils — module-load || {} fallbacks (b0/b1/b5/b6/b7)', () => {
  test('dd exists after loading without pre-set sentinelUtils (b0[1]+b1[1] fired)', () => {
    expect(dd).toBeDefined();
    expect(typeof dd.findDropdownOptions).toBe('function');
    expect(typeof dd.openDropdown).toBe('function');
    expect(typeof dd.selectDropdownOption).toBe('function');
    expect(typeof dd.isCustomDropdown).toBe('function');
    expect(typeof dd.dismissDropdown).toBe('function');
    expect(typeof dd.traverseNestedMenu).toBe('function');
  });
});

// ─── b2[1]+b4[0]: getErrorMessage — non-object truthy throw ──────────────────

describe('dropdown-utils — getErrorMessage non-object truthy (b2[1]+b4[0])', () => {
  test('string throw in getElementById fires getErrorMessage else path with truthy e', () => {
    const trigger = createElement('div', { 'aria-controls': 'some-id' });
    // getElementById throws a string → getErrorMessage('string-error')
    // typeof 'string-error' !== 'object' → b2[1]; truthy → b4[0]
    const doc = makeDoc({ getElementById: () => { throw 'string-error'; } });
    expect(() => dd.findDropdownOptions(doc, trigger)).not.toThrow();
  });

  test('number throw fires getErrorMessage with truthy value', () => {
    const trigger = createElement('div', { 'aria-owns': 'menu-id' });
    // 42 is not an object → b2[1]; 42 truthy → b4[0]
    const doc = makeDoc({ getElementById: () => { throw 42; } });
    expect(() => dd.findDropdownOptions(doc, trigger)).not.toThrow();
  });
});

// ─── b4[1]: getErrorMessage — falsy throw (e||'' path) ───────────────────────

describe('dropdown-utils — getErrorMessage falsy throw (b4[1])', () => {
  test('null throw fires b4[1]: null||"" returns String("")', () => {
    const trigger = createElement('div', { 'aria-controls': 'some-id' });
    // null: typeof null === 'object' && null !== null → false → b2[1]
    // String(null || '') = '' → b4[1]
    const doc = makeDoc({ getElementById: () => { throw null; } });
    expect(() => dd.findDropdownOptions(doc, trigger)).not.toThrow();
  });

  test('undefined throw fires b4[1]: undefined||"" returns String("")', () => {
    const trigger = createElement('div', { 'aria-controls': 'some-id' });
    // typeof undefined !== 'object' → b2[1]; undefined falsy → b4[1]
    const doc = makeDoc({ getElementById: () => { throw undefined; } });
    expect(() => dd.findDropdownOptions(doc, trigger)).not.toThrow();
  });
});

// ─── b9[1]: openDropdown — no wait.sleep (wait={} at module load) ─────────────

describe('dropdown-utils — openDropdown without wait.sleep (b9[1])', () => {
  test('b9[1] L48: skips sleep when wait.sleep is undefined, returns options immediately', async () => {
    const trigger = createElement('button');
    const opt = createElement('li', { role: 'option' });
    // Mock findDropdownOptions so the loop exits on first iteration (avoids spin-loop)
    const orig = dd.findDropdownOptions;
    dd.findDropdownOptions = () => [opt];
    const result = await dd.openDropdown(makeDoc(), trigger);
    dd.findDropdownOptions = orig;
    // wait.sleep = undefined → if(wait.sleep) is false → b9[1] fires; options found → return
    expect(result).not.toBeNull();
    expect(result[0]).toBe(opt);
  }, 2000);
});

// ─── b14[0]: addAllFromContainer — element without querySelectorAll ───────────

describe('dropdown-utils — addAllFromContainer null/no-qsa container (b14[0])', () => {
  test('b14[0] L79: returns early when container.querySelectorAll is not a function', () => {
    const badContainer = createElement('div');
    badContainer.querySelectorAll = null; // not a function → b14[0] fires
    const doc = makeDoc({
      querySelectorAll: (sel) => {
        if (sel && sel.includes('dropdown-menu')) {
          return { forEach: (fn) => fn(badContainer), length: 1 };
        }
        return { forEach: () => {}, length: 0 };
      },
    });
    const result = dd.findDropdownOptions(doc, null);
    expect(Array.isArray(result)).toBe(true);
  });

  test('b14[0] L79: returns early when null is passed as container', () => {
    const doc = makeDoc({
      querySelectorAll: (sel) => {
        if (sel && sel.includes('dropdown-menu')) {
          return { forEach: (fn) => fn(null), length: 1 };
        }
        return { forEach: () => {}, length: 0 };
      },
    });
    // addAllFromContainer(null): !null → b14[0] → return
    const result = dd.findDropdownOptions(doc, null);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── b16[1]: addAllFromContainer — items.forEach not a function ───────────────

describe('dropdown-utils — addAllFromContainer items without forEach (b16[1])', () => {
  test('b16[1] L85: skips items when querySelectorAll returns object without forEach', () => {
    const containerEl = createElement('div');
    containerEl.querySelectorAll = () => ({ length: 2 }); // no forEach → b16[1]
    const doc = makeDoc({
      querySelectorAll: (sel) => {
        if (sel && sel.includes('dropdown-menu')) {
          return { forEach: (fn) => fn(containerEl), length: 1 };
        }
        return { forEach: () => {}, length: 0 };
      },
    });
    const result = dd.findDropdownOptions(doc, null);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── isCustomDropdown — className branches ────────────────────────────────────

describe('dropdown-utils — isCustomDropdown className branches', () => {
  test('b91[0]: string className with dropdown pattern → returns true', () => {
    // typeof el.className === 'string' → b91[0] fires
    const el = createElement('div', { className: 'my-dropdown-container' });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('b91[1]+b92[0]: SVGAnimatedString with truthy baseVal → returns true', () => {
    // typeof {baseVal:…} !== 'string' → b91[1]; el.className && baseVal truthy → b92[0]
    const el = createElement('div');
    el.className = { baseVal: 'svg-dropdown-icon' };
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('b92[1]: SVGAnimatedString with null baseVal fires || "" fallback → returns false', () => {
    // typeof {} !== 'string' → b91[1]; baseVal=null → ({} && null)=null falsy → b92[1]→''
    const el = createElement('div');
    el.className = { baseVal: null };
    expect(dd.isCustomDropdown(el)).toBe(false);
  });

  test('className getter that throws is caught → does not throw', () => {
    const el = createElement('div');
    Object.defineProperty(el, 'className', {
      get() { throw new Error('className access error'); },
      configurable: true,
    });
    expect(() => dd.isCustomDropdown(el)).not.toThrow();
  });

  test('null el → returns false', () => {
    expect(dd.isCustomDropdown(null)).toBe(false);
  });

  test('SELECT element → returns false', () => {
    expect(dd.isCustomDropdown(createElement('select'))).toBe(false);
  });

  test('role=combobox → returns true', () => {
    expect(dd.isCustomDropdown(createElement('div', { role: 'combobox' }))).toBe(true);
  });

  test('role=button + aria-haspopup → returns true', () => {
    const el = createElement('div', { role: 'button', 'aria-haspopup': 'true' });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('aria-haspopup=listbox → returns true', () => {
    expect(dd.isCustomDropdown(createElement('div', { 'aria-haspopup': 'listbox' }))).toBe(true);
  });

  test('aria-haspopup=menu → returns true', () => {
    expect(dd.isCustomDropdown(createElement('div', { 'aria-haspopup': 'menu' }))).toBe(true);
  });

  test('plain div with no class/role → returns false', () => {
    expect(dd.isCustomDropdown(createElement('div'))).toBe(false);
  });
});

// ─── selectDropdownOption — input guards and text-extraction fallbacks ─────────

describe('dropdown-utils — selectDropdownOption branches', () => {
  test('returns null for null optionEls', async () => {
    expect(await dd.selectDropdownOption(makeDoc(), null, 'hello')).toBeNull();
  });

  test('returns null for empty optionEls array', async () => {
    expect(await dd.selectDropdownOption(makeDoc(), [], 'hello')).toBeNull();
  });

  test('returns null when value is undefined (not "")', async () => {
    const opt = createElement('li');
    expect(await dd.selectDropdownOption(makeDoc(), [opt], undefined)).toBeNull();
  });

  test('null value returns null', async () => {
    const opt = createElement('li');
    expect(await dd.selectDropdownOption(makeDoc(), [opt], null)).toBeNull();
  });

  test('empty-string value matches an option with empty text', async () => {
    const opt = createElement('li', { innerText: '' });
    const result = await dd.selectDropdownOption(makeDoc(), [opt], '');
    expect(result).toBe(opt);
  });

  test('uses textContent when innerText is undefined (fallback branch)', async () => {
    const opt = createElement('li');
    opt.innerText = undefined; // force fallback to textContent
    opt.textContent = 'hello world';
    const result = await dd.selectDropdownOption(makeDoc(), [opt], 'hello world');
    expect(result).toBe(opt);
  });

  test('exact match via value attribute when innerText does not match', async () => {
    const opt = createElement('li', { value: 'opt-val' });
    opt.innerText = 'Display Label';
    const result = await dd.selectDropdownOption(makeDoc(), [opt], 'opt-val');
    expect(result).toBe(opt);
  });

  test('starts-with match when no exact match', async () => {
    const opt = createElement('li', { innerText: 'hello world extra' });
    const result = await dd.selectDropdownOption(makeDoc(), [opt], 'hello');
    expect(result).toBe(opt);
  });

  test('word-boundary match when no exact/starts-with match', async () => {
    const opt = createElement('li', { innerText: 'the quick brown fox' });
    const result = await dd.selectDropdownOption(makeDoc(), [opt], 'brown');
    expect(result).toBe(opt);
  });

  test('partial match fallback fires last', async () => {
    const opt = createElement('li', { innerText: 'aaa-hello-bbb' });
    const result = await dd.selectDropdownOption(makeDoc(), [opt], 'hello');
    expect(result).toBe(opt);
  });

  test('returns null when no match at all', async () => {
    const opt = createElement('li', { innerText: 'completely unrelated' });
    const result = await dd.selectDropdownOption(makeDoc(), [opt], 'xyzzy-nomatch');
    expect(result).toBeNull();
  });
});

// ─── traverseNestedMenu — guard branches ─────────────────────────────────────

describe('dropdown-utils — traverseNestedMenu branches', () => {
  test('returns null for null menuPath', async () => {
    expect(await dd.traverseNestedMenu(makeDoc(), null)).toBeNull();
  });

  test('returns null for empty menuPath', async () => {
    expect(await dd.traverseNestedMenu(makeDoc(), [])).toBeNull();
  });

  test('returns null when no item matches first label (dom.isVisible undefined → no options)', async () => {
    // findDropdownOptions filters by dom.isVisible; with dom={} all options are dropped
    const result = await dd.traverseNestedMenu(makeDoc(), ['Settings']);
    expect(result).toBeNull();
  });
});

// ─── dismissDropdown — guard branches ────────────────────────────────────────

describe('dropdown-utils — dismissDropdown branches', () => {
  test('returns false for null doc', () => {
    expect(dd.dismissDropdown(null)).toBe(false);
  });

  test('returns false for undefined doc', () => {
    expect(dd.dismissDropdown(undefined)).toBe(false);
  });

  test('returns false when querySelectorAll throws (catch fires, returns false)', () => {
    const doc = makeDoc({ querySelectorAll: () => { throw new Error('DOM error'); } });
    expect(dd.dismissDropdown(doc)).toBe(false);
  });

  test('returns false when no visible open dropdowns found', () => {
    // querySelectorAll returns empty result → wasOpen stays false
    const doc = makeDoc({
      querySelectorAll: () => ({ forEach: () => {}, length: 0 }),
    });
    expect(dd.dismissDropdown(doc)).toBe(false);
  });
});
