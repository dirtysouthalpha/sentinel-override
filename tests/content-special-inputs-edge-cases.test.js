// tests/content-special-inputs-edge-cases.test.js
// Edge case tests for content/special-inputs.js.
// Tests handling of various input types, edge cases, and malformed DOM structures.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createMockDom() {
  return {
    isVisible: (el) => el && el._visible !== false,
  };
}

function createSandbox() {
  const mockDom = createMockDom();
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Math,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    document: {
      activeElement: null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  };
  sandbox.window = sandbox;
  sandbox.window.__sentinelUtils = {
    dom: mockDom,
    specialInputs: {},
  };
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../content/special-inputs.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'special-inputs.js' });
  script.runInContext(sandbox);
  return sandbox;
}

function getSpecialInputs(sandbox) {
  return sandbox.window.__sentinelUtils.specialInputs;
}

describe('special-inputs — edge cases and malformed DOM', () => {
  describe('isDateInput with null/undefined', () => {
    test('handles null element', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      expect(si.isDateInput(null)).toBe(false);
    });

    test('handles undefined element', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      expect(si.isDateInput(undefined)).toBe(false);
    });

    test('handles element with no type attribute', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      expect(si.isDateInput({ getAttribute: () => null })).toBe(false);
    });
  });

  describe('isDateInput with various input types', () => {
    test('recognizes date type', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'date', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('recognizes datetime-local type', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'datetime-local', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('recognizes month type', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'month', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('returns false for text type', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(false);
    });
  });

  describe('isDateInput with ARIA indicators', () => {
    test('recognizes datepicker role', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', getAttribute: (attr) => attr === 'role' ? 'datepicker' : null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('recognizes haspopup dialog', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', getAttribute: (attr) => attr === 'aria-haspopup' ? 'dialog' : null };
      expect(si.isDateInput(input)).toBe(true);
    });
  });

  describe('isDateInput with class name heuristics', () => {
    test('recognizes datepicker class', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', className: 'my-datepicker', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('recognizes date-picker class', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', className: 'custom-date-picker', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('recognizes calendar class', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', className: 'calendar-widget', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('handles case-insensitive matching', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const input = { type: 'text', className: 'DATE-PICKER', getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });
  });

  describe('isDateInput with parent container detection', () => {
    test('detects datepicker in parent container', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const parent = { className: 'datepicker-container', getAttribute: () => null };
      const input = { type: 'text', className: 'input', parentElement: parent, getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('limits parent search depth to 3 levels', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const level3 = { className: 'datepicker', parentElement: null, getAttribute: () => null };
      const level2 = { className: 'wrapper', parentElement: level3, getAttribute: () => null };
      const level1 = { className: 'container', parentElement: level2, getAttribute: () => null };
      const input = { type: 'text', className: 'input', parentElement: level1, getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(true);
    });

    test('returns false when no datepicker found in parent chain', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const parent = { className: 'regular-container', parentElement: null, getAttribute: () => null };
      const input = { type: 'text', className: 'input', parentElement: parent, getAttribute: () => null };
      expect(si.isDateInput(input)).toBe(false);
    });
  });

  describe('isRichTextEditor with null/undefined', () => {
    test('handles null element', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      expect(si.isRichTextEditor(null)).toBe(false);
    });

    test('handles undefined element', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      expect(si.isRichTextEditor(undefined)).toBe(false);
    });

    test('handles element with no properties', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      expect(si.isRichTextEditor({})).toBe(false);
    });
  });

  describe('isRichTextEditor with contentEditable', () => {
    test('recognizes contentEditable true with rich children', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, querySelectorAll: () => [{tagName: 'B'}], getAttribute: () => null };
      expect(si.isRichTextEditor(div)).toBe(true);
    });

    test('returns false for contentEditable true without rich indicators', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, querySelectorAll: () => [], getAttribute: () => null, children: [] };
      expect(si.isRichTextEditor(div)).toBe(false);
    });

    test('returns false for contentEditable false', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: false };
      expect(si.isRichTextEditor(div)).toBe(false);
    });
  });

  describe('isRichTextEditor with role indicators', () => {
    test('recognizes textbox role with multiline when contentEditable', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = {
        isContentEditable: true,
        querySelectorAll: () => [],
        getAttribute: (attr) => {
          if (attr === 'role') return 'textbox';
          if (attr === 'aria-multiline') return 'true';
          return null;
        },
        children: []
      };
      expect(si.isRichTextEditor(div)).toBe(true);
    });

    test('returns false for textbox role without contentEditable', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = {
        querySelectorAll: () => [],
        getAttribute: (attr) => {
          if (attr === 'role') return 'textbox';
          if (attr === 'aria-multiline') return 'true';
          return null;
        },
        children: []
      };
      expect(si.isRichTextEditor(div)).toBe(false);
    });
  });

  describe('isRichTextEditor with class heuristics', () => {
    test('recognizes ql-editor class (Quill)', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, className: 'ql-editor', querySelectorAll: () => [], getAttribute: () => null, children: [] };
      expect(si.isRichTextEditor(div)).toBe(true);
    });

    test('recognizes tox-edit-area class (TinyMCE)', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, className: 'tox-edit-area', querySelectorAll: () => [], getAttribute: () => null, children: [] };
      expect(si.isRichTextEditor(div)).toBe(true);
    });

    test('recognizes ck-editor class (CKEditor)', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, className: 'ck-editor', querySelectorAll: () => [], getAttribute: () => null, children: [] };
      expect(si.isRichTextEditor(div)).toBe(true);
    });

    test('recognizes wysiwyg class', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, className: 'wysiwyg-editor', querySelectorAll: () => [], getAttribute: () => null, children: [] };
      expect(si.isRichTextEditor(div)).toBe(true);
    });

    test('returns false for non-editor class', () => {
      const sandbox = createSandbox();
      const si = getSpecialInputs(loadModule(sandbox));
      const div = { isContentEditable: true, className: 'regular-div', querySelectorAll: () => [], getAttribute: () => null, children: [] };
      expect(si.isRichTextEditor(div)).toBe(false);
    });
  });
});
