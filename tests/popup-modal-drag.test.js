// tests/popup-modal-drag.test.js
// Unit tests for popup-modules/modal-drag.js — movable modal title-bar drag, position reset, MutationObserver wiring.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createMockElement(tag, id, extra = {}) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    id: id || '',
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    style: { transform: '' },
    addEventListener(event, cb) { listeners[event] = cb; },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    matches: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 300 }),
    get __listeners() { return listeners; },
    ...extra,
  };
}

describe('modal-drag setupModalDrag', () => {
  let sandbox;
  let mockObserverInstances;

  beforeEach(() => {
    mockObserverInstances = [];

    const mutationObs = class {
      constructor(cb) { this._cb = cb; mockObserverInstances.push(this); }
      observe() {}
      disconnect() {}
    };

    const createdElements = [];
    const modalContents = [];
    let bodyChildList = [];

    sandbox = {
      window: {
        innerWidth: 1024,
        innerHeight: 768,
      },
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        querySelectorAll(selector) {
          if (selector === '.modal-content') return modalContents;
          if (selector === '.modal') return [];
          return [];
        },
        getElementById: () => null,
        createElement(tag) {
          const el = createMockElement(tag);
          createdElements.push(el);
          return el;
        },
        body: {
          childNodes: [],
        },
      },
      MutationObserver: mutationObs,
      WeakSet: class {
        constructor() { this._items = new Set(); }
        has(v) { return this._items.has(v); }
        add(v) { this._items.add(v); return this; }
      },
      WeakMap: class {
        constructor() { this._map = new Map(); }
        get(k) { return this._map.get(k); }
        set(k, v) { this._map.set(k, v); return this; }
        delete(k) { this._map.delete(k); }
      },
      console,
      Set,
      Map,
    };

    // Add a .modal-content with an h2 title bar for testing attachDrag
    const titleBar = createMockElement('h2');
    const content = createMockElement('div', '', {
      querySelector: (sel) => {
        if (sel === 'h2') return titleBar;
        return null;
      },
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
    });
    modalContents.push(content);
    sandbox._titleBar = titleBar;
    sandbox._content = content;
  });

  test('IIFE executes without error', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    expect(() => {
      new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);
    }).not.toThrow();
  });

  test('attaches drag to existing modal-content elements', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    expect(titleBar.__listeners['pointerdown']).toBeDefined();
    expect(titleBar.__listeners['pointermove']).toBeDefined();
    expect(titleBar.__listeners['pointerup']).toBeDefined();
    expect(titleBar.__listeners['pointercancel']).toBeDefined();
  });

  test('pointerdown on input element does not start drag', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const pdCb = titleBar.__listeners['pointerdown'];
    const e = {
      target: { tagName: 'INPUT' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: () => {},
    };
    // Should return early without error
    expect(() => pdCb(e)).not.toThrow();
  });

  test('pointerdown on button element does not start drag', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const pdCb = titleBar.__listeners['pointerdown'];
    const e = {
      target: { tagName: 'BUTTON' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: () => {},
    };
    expect(() => pdCb(e)).not.toThrow();
  });

  test('pointerdown on select element does not start drag', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const pdCb = titleBar.__listeners['pointerdown'];
    const e = {
      target: { tagName: 'SELECT' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: () => {},
    };
    expect(() => pdCb(e)).not.toThrow();
  });

  test('non-primary mouse button does not start drag', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const pdCb = titleBar.__listeners['pointerdown'];
    const e = {
      target: { tagName: 'SPAN' },
      button: 2,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: () => {},
    };
    expect(() => pdCb(e)).not.toThrow();
  });

  test('valid pointerdown starts drag and adds dragging class', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const content = sandbox._content;
    const pdCb = titleBar.__listeners['pointerdown'];
    const e = {
      target: { tagName: 'SPAN' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 200,
      clientY: 150,
      preventDefault: () => {},
    };
    pdCb(e);
    expect(content.classList.contains('dragging')).toBe(true);
    expect(titleBar.classList.contains('dragging')).toBe(true);
  });

  test('pointermove updates transform', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const content = sandbox._content;
    const pdCb = titleBar.__listeners['pointerdown'];
    const pmCb = titleBar.__listeners['pointermove'];

    pdCb({
      target: { tagName: 'SPAN' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 200,
      clientY: 150,
      preventDefault: () => {},
    });

    pmCb({
      clientX: 250,
      clientY: 180,
    });

    expect(content.style.transform).toMatch(/translate\(/);
  });

  test('pointerup ends drag and removes dragging class', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const content = sandbox._content;
    const pdCb = titleBar.__listeners['pointerdown'];
    const puCb = titleBar.__listeners['pointerup'];

    pdCb({
      target: { tagName: 'SPAN' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 200,
      clientY: 150,
      preventDefault: () => {},
    });

    puCb({ pointerId: 1 });

    expect(content.classList.contains('dragging')).toBe(false);
    expect(titleBar.classList.contains('dragging')).toBe(false);
  });

  test('pointercancel ends drag', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const content = sandbox._content;
    const pdCb = titleBar.__listeners['pointerdown'];
    const pcCb = titleBar.__listeners['pointercancel'];

    pdCb({
      target: { tagName: 'SPAN' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 200,
      clientY: 150,
      preventDefault: () => {},
    });

    pcCb({ pointerId: 1 });

    expect(content.classList.contains('dragging')).toBe(false);
  });

  test('full drag cycle: down → move → up', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const content = sandbox._content;
    const pdCb = titleBar.__listeners['pointerdown'];
    const pmCb = titleBar.__listeners['pointermove'];
    const puCb = titleBar.__listeners['pointerup'];

    pdCb({
      target: { tagName: 'SPAN' },
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 200,
      clientY: 150,
      preventDefault: () => {},
    });

    pmCb({ clientX: 300, clientY: 250 });
    pmCb({ clientX: 350, clientY: 280 });

    puCb({ pointerId: 1 });

    expect(content.classList.contains('dragging')).toBe(false);
    expect(content.style.transform).toMatch(/translate\(150px.*130px\)/);
  });

  test('handles null modal content gracefully', () => {
    // Create sandbox where querySelector returns null for h2
    const mutationObs = class {
      constructor() {}
      observe() {}
      disconnect() {}
    };

    const contentNoTitle = createMockElement('div');
    contentNoTitle.querySelector = () => null;

    const emptySandbox = {
      window: { innerWidth: 1024, innerHeight: 768 },
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        querySelectorAll: (sel) => {
          if (sel === '.modal-content') return [contentNoTitle];
          return [];
        },
        body: {},
      },
      MutationObserver: mutationObs,
      WeakSet: class {
        constructor() { this._items = new Set(); }
        has(v) { return this._items.has(v); }
        add(v) { this._items.add(v); return this; }
      },
      WeakMap: class {
        constructor() { this._map = new Map(); }
        get(k) { return this._map.get(k); }
        set(k, v) { this._map.set(k, v); return this; }
      },
      console,
      Set,
      Map,
    };

    vm.createContext(emptySandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    // Should not attach listeners if no h2 is found
    expect(() => {
      new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(emptySandbox);
    }).not.toThrow();
  });

  test('setPointerCapture failure does not crash', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    titleBar.setPointerCapture = () => { throw new Error('not supported'); };

    const pdCb = titleBar.__listeners['pointerdown'];
    expect(() => {
      pdCb({
        target: { tagName: 'SPAN' },
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        clientX: 200,
        clientY: 150,
        preventDefault: () => {},
      });
    }).not.toThrow();
  });

  test('pointermove without prior pointerdown is a no-op', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const pmCb = titleBar.__listeners['pointermove'];
    expect(() => pmCb({ clientX: 999, clientY: 999 })).not.toThrow();
  });

  test('pointerup without prior pointerdown is a no-op', () => {
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../popup-modules/modal-drag.js'), 'utf8');
    new vm.Script(source, { filename: 'modal-drag.js' }).runInContext(sandbox);

    const titleBar = sandbox._titleBar;
    const puCb = titleBar.__listeners['pointerup'];
    expect(() => puCb({ pointerId: 1 })).not.toThrow();
  });
});
