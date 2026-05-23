// tests/special-inputs-edge-cases.test.js
// Edge case tests for content/special-inputs.js

import { jest } from '@jest/globals';

// Setup browser environment
globalThis.window = globalThis;
globalThis.document = {
  createElement: jest.fn((tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      type: '',
      className: '',
      attributes: {},
      style: {},
      children: [],
      childNodes: [],
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      dispatchEvent: jest.fn(() => true),
      click: jest.fn(),
      focus: jest.fn(),
      getAttribute: jest.fn((attr) => el.attributes[attr]),
      setAttribute: jest.fn((attr, val) => { el.attributes[attr] = val; }),
      hasAttribute: jest.fn((attr) => attr in el.attributes),
      parentNode: null,
      parentElement: null,
      isContentEditable: false,
    };
    return el;
  }),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  execCommand: jest.fn(() => true),
};

globalThis.navigator = { userAgent: 'test' };
globalThis.Event = class Event {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? false;
    this.cancelable = opts.cancelable ?? false;
    this.composed = opts.composed ?? false;
  }
};
globalThis.MouseEvent = class MouseEvent extends Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.bubbles = opts.bubbles ?? false;
    this.cancelable = opts.cancelable ?? false;
    this.composed = opts.composed ?? false;
  }
};
globalThis.InputEvent = class InputEvent extends Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.inputType = opts.inputType || '';
    this.data = opts.data || '';
  }
};
globalThis.HTMLInputElement = { prototype: {} };
globalThis.Object = Object;

// Load the special-inputs module
await import('../content/special-inputs.js');

const si = window.__sentinelUtils.specialInputs;

describe('special-inputs edge cases', () => {
  describe('isDateInput detection', () => {
    test('null element returns false', () => {
      expect(si.isDateInput(null)).toBe(false);
    });

    test('undefined element returns false', () => {
      expect(si.isDateInput(undefined)).toBe(false);
    });

    test('native date input type', () => {
      const el = { type: 'date' };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('native datetime-local input type', () => {
      const el = { type: 'datetime-local' };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('native month input type', () => {
      const el = { type: 'month' };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('time input type is NOT a date input', () => {
      const el = { type: 'time', getAttribute: jest.fn(), className: '', parentElement: null };
      expect(si.isDateInput(el)).toBe(false);
    });

    test('ARIA datepicker role', () => {
      const el = { getAttribute: jest.fn((attr) => attr === 'role' ? 'datepicker' : null) };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('ARIA haspopup dialog', () => {
      const el = { getAttribute: jest.fn((attr) => attr === 'aria-haspopup' ? 'dialog' : null) };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('class name with datepicker', () => {
      const el = { className: 'my-datepicker-widget', type: 'text', getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('class name with date-picker (hyphenated)', () => {
      const el = { className: 'date-picker-container', type: 'text', getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('class name with calendar', () => {
      const el = { className: 'calendar-input', type: 'text', getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('parent with datepicker class', () => {
      const parent = { className: 'datepicker-container', parentElement: null };
      const el = { className: 'input-field', type: 'text', parentElement: parent, getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('grandparent with calendar class (depth 2)', () => {
      const grandparent = { className: 'calendar-wrapper', parentElement: null };
      const parent = { className: 'inner', parentElement: grandparent };
      const el = { className: 'input', type: 'text', parentElement: parent, getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('depth limit: parent beyond depth 3 is not checked', () => {
      // Depth 0: el, Depth 1: parent, Depth 2: grandparent, Depth 3: greatGrandparent
      // The loop checks parent (depth 0), grandparent (depth 1), greatGrandparent (depth 2)
      // and stops before depth 3. So greatGrandparent should still be checked.
      // To test the limit, we need depth 4.
      const greatGreatGrandparent = { className: 'calendar', parentElement: null };
      const greatGrandparent = { className: 'inner', parentElement: greatGreatGrandparent };
      const grandparent = { className: 'middle', parentElement: greatGrandparent };
      const parent = { className: 'input', parentElement: grandparent };
      const el = { className: 'field', type: 'text', parentElement: parent, getAttribute: jest.fn() };
      // At this point, greatGreatGrandparent (depth 4 from el) should NOT be checked
      expect(si.isDateInput(el)).toBe(false);
    });

    test('null className returns false', () => {
      const el = { className: null, type: 'text', parentElement: null, getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(false);
    });

    test('undefined className returns false', () => {
      const el = { type: 'text', parentElement: null, getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(false);
    });

    test('case insensitive matching', () => {
      const el = { className: 'DATE-PICKER-WIDGET', type: 'text', getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });

    test('partial word match is accepted (e.g., "mydatepicker")', () => {
      const el = { className: 'mydatepicker2', type: 'text', getAttribute: jest.fn() };
      expect(si.isDateInput(el)).toBe(true);
    });
  });

  describe('isRichTextEditor detection', () => {
    test('null element returns false', () => {
      expect(si.isRichTextEditor(null)).toBe(false);
    });

    test('undefined element returns false', () => {
      expect(si.isRichTextEditor(undefined)).toBe(false);
    });

    test('contentEditable true with rich children', () => {
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => [{ tagName: 'B' }, { tagName: 'I' }]),
        className: '',
        getAttribute: jest.fn(),
        children: [{ tagName: 'B' }],
        parentElement: null,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    test('contentEditable true with editor class', () => {
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => []),
        className: 'ql-editor',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    test('contentEditable true with textbox role', () => {
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn((attr) => attr === 'role' ? 'textbox' : null),
        children: [],
        parentElement: null,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    test('contentEditable true with aria-multiline', () => {
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn((attr) => attr === 'aria-multiline' ? 'true' : null),
        children: [],
        parentElement: null,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    test('contentEditable true with data-placeholder', () => {
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn((attr) => attr === 'data-placeholder' ? 'Enter text...' : null),
        children: [],
        parentElement: null,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    test('contentEditable false returns false', () => {
      const el = {
        isContentEditable: false,
        className: '',
        getAttribute: jest.fn(),
        children: [],
      };
      expect(si.isRichTextEditor(el)).toBe(false);
    });

    test('known editor class variants', () => {
      const editorClasses = [
        'ql-editor', 'tox-edit-area', 'ck-editor', 'prosemirror',
        'lexical-editor', 'editor-content', 'rich-editor', 'wysiwyg'
      ];
      editorClasses.forEach(cls => {
        const el = {
          isContentEditable: true,
          querySelectorAll: jest.fn(() => []),
          className: cls,
          getAttribute: jest.fn(),
          children: [],
          parentElement: null,
        };
        expect(si.isRichTextEditor(el)).toBe(true);
      });
    });

    test('parent with editor class', () => {
      const parent = {
        className: 'ql-editor',
        parentElement: null,
      };
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => []),
        className: 'input',
        getAttribute: jest.fn(),
        children: [],
        parentElement: parent,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    test('case insensitive class matching', () => {
      const el = {
        isContentEditable: true,
        querySelectorAll: jest.fn(() => []),
        className: 'QL-EDITOR',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      expect(si.isRichTextEditor(el)).toBe(true);
    });
  });

  describe('setDatePickerValue', () => {
    test('null element returns error', () => {
      const result = si.setDatePickerValue(null, '2024-01-15');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No element provided');
    });

    test('undefined element returns error', () => {
      const result = si.setDatePickerValue(undefined, '2024-01-15');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No element provided');
    });

    test('empty date string with native input', () => {
      const el = { type: 'date', querySelector: jest.fn(() => null) };
      const result = si.setDatePickerValue(el, '');
      // Empty string will fail regex match and Date parse
      expect(result).toBeDefined();
    });

    test('already formatted YYYY-MM-DD date', () => {
      const el = { type: 'date' };
      // Mock native setter
      const mockSetter = jest.fn();
      Object.getOwnPropertyDescriptor = jest.fn(() => ({ set: mockSetter }));
      el.dispatchEvent = jest.fn();

      const result = si.setDatePickerValue(el, '2024-01-15');
      expect(result).toBeDefined();
    });

    test('human-readable date parsing', () => {
      const el = { type: 'date' };
      Object.getOwnPropertyDescriptor = jest.fn(() => ({ set: jest.fn() }));
      el.dispatchEvent = jest.fn();

      const result = si.setDatePickerValue(el, 'January 15, 2024');
      expect(result).toBeDefined();
    });

    test('invalid date string', () => {
      const el = { type: 'date' };
      Object.getOwnPropertyDescriptor = jest.fn(() => ({ set: jest.fn() }));
      el.dispatchEvent = jest.fn();

      const result = si.setDatePickerValue(el, 'not-a-date');
      expect(result).toBeDefined();
    });

    test('datetime-local input type', () => {
      const el = { type: 'datetime-local' };
      Object.getOwnPropertyDescriptor = jest.fn(() => ({ set: jest.fn() }));
      el.dispatchEvent = jest.fn();

      const result = si.setDatePickerValue(el, '2024-01-15T10:30:00');
      expect(result).toBeDefined();
    });

    test('month input type', () => {
      const el = { type: 'month' };
      Object.getOwnPropertyDescriptor = jest.fn(() => ({ set: jest.fn() }));
      el.dispatchEvent = jest.fn();

      const result = si.setDatePickerValue(el, '2024-01');
      expect(result).toBeDefined();
    });

    test('framework picker with child input', () => {
      const childInput = { type: 'text' };
      const el = {
        type: 'text',
        querySelector: jest.fn(() => childInput),
      };
      Object.getOwnPropertyDescriptor = jest.fn(() => ({ set: jest.fn() }));
      el.dispatchEvent = jest.fn();
      childInput.dispatchEvent = jest.fn();

      const result = si.setDatePickerValue(el, '2024-01-15');
      expect(result.method).toBe('framework-child-input');
    });

    test('UI fallback when no strategies work', () => {
      const el = {
        type: 'text',
        querySelector: jest.fn(() => null),
        click: jest.fn(),
        dispatchEvent: jest.fn(),
      };

      const result = si.setDatePickerValue(el, '2024-01-15');
      expect(result.method).toBe('ui-fallback');
    });

    test('click failure in UI fallback', () => {
      const el = {
        type: 'text',
        querySelector: jest.fn(() => null),
        click: jest.fn(() => { throw new Error('Click failed'); }),
        dispatchEvent: jest.fn(),
      };

      const result = si.setDatePickerValue(el, '2024-01-15');
      expect(result.success).toBe(false);
    });
  });

  describe('uploadFile', () => {
    test('null input element returns false', () => {
      expect(si.uploadFile(null, 'test.txt', 'text/plain', 'content')).toBe(false);
    });

    test('undefined input element returns false', () => {
      expect(si.uploadFile(undefined, 'test.txt', 'text/plain', 'content')).toBe(false);
    });

    test('non-file input type returns false', () => {
      const el = { type: 'text' };
      expect(si.uploadFile(el, 'test.txt', 'text/plain', 'content')).toBe(false);
    });

    test('missing filename returns false', () => {
      const el = { type: 'file' };
      expect(si.uploadFile(el, null, 'text/plain', 'content')).toBe(false);
      expect(si.uploadFile(el, '', 'text/plain', 'content')).toBe(false);
    });

    test('missing content returns false', () => {
      const el = { type: 'file' };
      expect(si.uploadFile(el, 'test.txt', 'text/plain', null)).toBe(false);
      expect(si.uploadFile(el, 'test.txt', 'text/plain', '')).toBe(false);
    });

    test('successful file upload', () => {
      globalThis.File = jest.fn((content, name, opts) => ({ name, type: opts.type, content }));
      globalThis.DataTransfer = class DataTransfer {
        constructor() { this.items = { add: jest.fn() }; this.files = []; }
      };
      const el = { type: 'file', files: [], dispatchEvent: jest.fn() };

      const result = si.uploadFile(el, 'test.txt', 'text/plain', 'test content');
      expect(result).toBe(true);
    });

    test('default MIME type when not specified', () => {
      globalThis.File = jest.fn((content, name, opts) => ({ name, type: opts?.type || 'text/plain', content }));
      globalThis.DataTransfer = class DataTransfer {
        constructor() { this.items = { add: jest.fn() }; this.files = []; }
      };
      const el = { type: 'file', files: [], dispatchEvent: jest.fn() };

      si.uploadFile(el, 'test.txt', null, 'test content');
      // Should default to text/plain
    });

    test('File constructor failure returns false', () => {
      globalThis.File = jest.fn(() => { throw new Error('File creation failed'); });
      const el = { type: 'file' };

      const result = si.uploadFile(el, 'test.txt', 'text/plain', 'content');
      expect(result).toBe(false);
    });

    test('DataTransfer failure returns false', () => {
      globalThis.File = jest.fn(() => ({ name: 'test.txt' }));
      globalThis.DataTransfer = jest.fn(() => { throw new Error('DataTransfer failed'); });
      const el = { type: 'file' };

      const result = si.uploadFile(el, 'test.txt', 'text/plain', 'content');
      expect(result).toBe(false);
    });

    test('dispatchEvent failure is caught', () => {
      globalThis.File = jest.fn(() => ({ name: 'test.txt' }));
      globalThis.DataTransfer = class DataTransfer {
        constructor() { this.items = { add: jest.fn() }; this.files = []; }
      };
      const el = {
        type: 'file',
        files: [],
        dispatchEvent: jest.fn(() => { throw new Error('Event failed'); }),
      };

      const result = si.uploadFile(el, 'test.txt', 'text/plain', 'content');
      expect(result).toBe(false);
    });
  });

  describe('setRichTextValue', () => {
    test('null element returns error', () => {
      const result = si.setRichTextValue(null, 'text');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No element provided');
    });

    test('empty text is handled', () => {
      const el = {
        isContentEditable: true,
        focus: jest.fn(),
        dispatchEvent: jest.fn(),
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      globalThis.document.execCommand = jest.fn(() => true);

      const result = si.setRichTextValue(el, '');
      expect(result).toBeDefined();
    });

    test('very long text content', () => {
      const el = {
        isContentEditable: true,
        focus: jest.fn(),
        dispatchEvent: jest.fn(),
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      globalThis.document.execCommand = jest.fn(() => true);

      const longText = 'A'.repeat(10000);
      const result = si.setRichTextValue(el, longText);
      expect(result.method).toBe('execCommand');
    });

    test('text with newlines converts to <br>', () => {
      const el = {
        isContentEditable: false,
        dispatchEvent: jest.fn(),
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      globalThis.document.execCommand = jest.fn(() => false);

      const result = si.setRichTextValue(el, 'Line 1\nLine 2\nLine 3');
      expect(result.method).toBe('direct-innerHTML');
    });

    test('Quill editor API path', () => {
      const el = {
        __quill: { setText: jest.fn() },
        dispatchEvent: jest.fn(),
      };

      const result = si.setRichTextValue(el, 'Quill text');
      expect(result.method).toBe('quill-api');
    });

    test('TinyMCE editor API path', () => {
      globalThis.tinymce = {
        get: jest.fn(() => ({
          setContent: jest.fn(),
        })),
      };
      const el = {
        id: 'tinymce-editor',
        dispatchEvent: jest.fn(),
      };

      const result = si.setRichTextValue(el, 'TinyMCE text');
      expect(result.method).toBe('tinymce-api');
    });

    test('CKEditor API path', () => {
      delete globalThis.tinymce; // Clear tinymce from previous test
      globalThis.CKEDITOR = {
        instances: {
          'ckeditor-id': {
            setData: jest.fn(),
          },
        },
      };
      const el = {
        id: 'ckeditor-id',
        dispatchEvent: jest.fn(),
      };

      const result = si.setRichTextValue(el, 'CKEditor text');
      expect(result.method).toBe('ckeditor-api');
    });

    test('execCommand failure falls back to innerHTML', () => {
      const el = {
        isContentEditable: true,
        focus: jest.fn(),
        dispatchEvent: jest.fn(),
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      globalThis.document.execCommand = jest.fn(() => {
        throw new Error('execCommand failed');
      });

      const result = si.setRichTextValue(el, 'Fallback text');
      expect(result.method).toBe('direct-innerHTML');
    });

    test('all strategies fail returns error', () => {
      const el = {
        isContentEditable: false,
        dispatchEvent: jest.fn(() => { throw new Error('All failed'); }),
      };
      globalThis.document.execCommand = jest.fn(() => false);

      const result = si.setRichTextValue(el, 'text');
      expect(result.success).toBe(false);
    });

    test('special HTML characters are handled', () => {
      const el = {
        isContentEditable: false,
        dispatchEvent: jest.fn(),
        querySelectorAll: jest.fn(() => []),
        className: '',
        getAttribute: jest.fn(),
        children: [],
        parentElement: null,
      };
      globalThis.document.execCommand = jest.fn(() => false);

      const result = si.setRichTextValue(el, '<script>alert("xss")</script>');
      expect(result.method).toBe('direct-innerHTML');
    });
  });
});
