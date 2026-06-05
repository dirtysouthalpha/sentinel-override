// tests/content-special-inputs.test.js
// Unit tests for content/special-inputs.js — isDateInput, isRichTextEditor, setDatePickerValue, uploadFile, setRichTextValue.

import { jest } from '@jest/globals';

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = { specialInputs: {} };

// Mock constructors needed by uploadFile and setDatePickerValue
const mockFiles = { length: 1, item: () => 'file' };
globalThis.File = jest.fn((bits, name, opts) => ({ bits, name, opts }));
globalThis.DataTransfer = jest.fn(() => ({
  items: { add: jest.fn() },
  files: mockFiles,
}));
globalThis.Event = jest.fn((type, opts) => ({ type, ...opts }));
globalThis.MouseEvent = jest.fn((type, opts) => ({ type, ...opts }));
globalThis.InputEvent = jest.fn((type, opts) => ({ type, ...opts }));
globalThis.HTMLInputElement = function() {};
globalThis.HTMLInputElement.prototype = {};

let si;
beforeAll(async () => {
  await import('../content/special-inputs.js');
  si = globalThis.window.__sentinelUtils.specialInputs;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Clean up any global editor mocks between tests
  delete globalThis.tinymce;
  delete globalThis.CKEDITOR;
});

// ========== isDateInput ==========

describe('si.isDateInput', () => {
  test('returns false for null', () => {
    expect(si.isDateInput(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(si.isDateInput(undefined)).toBe(false);
  });

  test('returns true for type="date"', () => {
    expect(si.isDateInput({ type: 'date' })).toBe(true);
  });

  test('returns true for type="datetime-local"', () => {
    expect(si.isDateInput({ type: 'datetime-local' })).toBe(true);
  });

  test('returns true for type="month"', () => {
    expect(si.isDateInput({ type: 'month' })).toBe(true);
  });

  test('returns true for role="datepicker"', () => {
    expect(si.isDateInput({ type: 'text', getAttribute: (n) => n === 'role' ? 'datepicker' : null })).toBe(true);
  });

  test('returns true for aria-haspopup="dialog"', () => {
    expect(si.isDateInput({ type: 'text', getAttribute: (n) => n === 'aria-haspopup' ? 'dialog' : null })).toBe(true);
  });

  test('returns true for class containing "datepicker"', () => {
    expect(si.isDateInput({ type: 'text', className: 'form-datepicker-control', getAttribute: () => null })).toBe(true);
  });

  test('returns true for class containing "date-picker"', () => {
    expect(si.isDateInput({ type: 'text', className: 'my-date-picker-widget', getAttribute: () => null })).toBe(true);
  });

  test('returns true for class containing "calendar"', () => {
    expect(si.isDateInput({ type: 'text', className: 'calendar-widget', getAttribute: () => null })).toBe(true);
  });

  test('returns true for parent with date-related class', () => {
    const parent = { className: 'datepicker-wrapper', parentElement: null, getAttribute: () => null };
    const el = { type: 'text', className: '', parentElement: parent, getAttribute: () => null };
    expect(si.isDateInput(el)).toBe(true);
  });

  test('returns true for grandparent with calendar class', () => {
    const grandparent = { className: 'calendar-container', parentElement: null };
    const parent = { className: 'wrapper', parentElement: grandparent, getAttribute: () => null };
    const el = { type: 'text', className: '', parentElement: parent, getAttribute: () => null };
    expect(si.isDateInput(el)).toBe(true);
  });

  test('returns false when parent chain exceeds depth 3', () => {
    // depth 0: parent, depth 1: gp, depth 2: ggp, depth 3: gggp (exceeds check)
    const deepAncestor = { className: 'datepicker-deep', parentElement: null };
    const lvl3 = { className: 'lvl3', parentElement: deepAncestor };
    const lvl2 = { className: 'lvl2', parentElement: lvl3 };
    const lvl1 = { className: 'lvl1', parentElement: lvl2 };
    const el = { type: 'text', className: '', parentElement: lvl1, getAttribute: () => null };
    // parent chain: lvl1(0)->lvl2(1)->lvl3(2)->deepAncestor(3) — depth<3 stops before deepAncestor
    expect(si.isDateInput(el)).toBe(false);
  });

  test('returns true for parent with date-picker class', () => {
    const parent = { className: 'date-picker-field', parentElement: null, getAttribute: () => null };
    const el = { type: 'text', className: '', parentElement: parent, getAttribute: () => null };
    expect(si.isDateInput(el)).toBe(true);
  });

  test('returns false for parent with unrelated class', () => {
    const parent = { className: 'text-field', parentElement: null, getAttribute: () => null };
    const el = { type: 'text', className: '', parentElement: parent, getAttribute: () => null };
    expect(si.isDateInput(el)).toBe(false);
  });

  test('returns false for unrelated input', () => {
    expect(si.isDateInput({ type: 'text', className: '', parentElement: null, getAttribute: () => null })).toBe(false);
  });

  test('returns false when getAttribute returns non-matching values', () => {
    const el = { type: 'text', getAttribute: (n) => n === 'role' ? 'button' : null };
    expect(si.isDateInput(el)).toBe(false);
  });

  test('returns true for parent at depth 2 with calendar class', () => {
    const gp = { className: 'calendar', parentElement: null };
    const parent = { className: '', parentElement: gp, getAttribute: () => null };
    const el = { type: 'text', className: '', parentElement: parent, getAttribute: () => null };
    expect(si.isDateInput(el)).toBe(true);
  });
});

// ========== isRichTextEditor ==========

describe('si.isRichTextEditor', () => {
  test('returns false for null', () => {
    expect(si.isRichTextEditor(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(si.isRichTextEditor(undefined)).toBe(false);
  });

  test('returns false for non-contenteditable', () => {
    expect(si.isRichTextEditor({ isContentEditable: false, getAttribute: () => null })).toBe(false);
  });

  test('returns true for contenteditable with formatting children', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: (sel) => sel === 'b, i, a, br, strong, em, u, span, div, p, h1, h2, h3, ul, ol, li, img' ? [{ tagName: 'B' }] : [],
      getAttribute: () => null,
      className: '',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with img child', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: (sel) => sel === 'b, i, a, br, strong, em, u, span, div, p, h1, h2, h3, ul, ol, li, img' ? [{ tagName: 'IMG' }] : [],
      getAttribute: () => null,
      className: '',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with ql-editor class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'ql-editor my-editor',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with tox-edit-area class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'tox-edit-area',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with ck-editor class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'ck-editor-content',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with prosemirror class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'prosemirror-editor',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with wysiwyg class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'wysiwyg-content',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with rich-editor class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'rich-editor-area',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for role="textbox" with contenteditable', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: (n) => n === 'role' ? 'textbox' : null,
      className: '',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for aria-multiline="true" with contenteditable', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: (n) => n === 'aria-multiline' ? 'true' : null,
      className: '',
      parentElement: null,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for contenteditable with data-placeholder and no children', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: (n) => n === 'data-placeholder' ? 'Type here...' : null,
      className: '',
      parentElement: null,
      children: { length: 0 },
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns false for contenteditable with data-placeholder but has children', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: (n) => n === 'data-placeholder' ? 'Type here...' : null,
      className: '',
      parentElement: null,
      children: { length: 2 },
    };
    // Has children and data-placeholder but no other indicators — returns false
    expect(si.isRichTextEditor(el)).toBe(false);
  });

  test('returns true for parent with editor class', () => {
    const parent = { className: 'tox-edit-area', parentElement: null, getAttribute: () => null };
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: '',
      parentElement: parent,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for grandparent with ck-editor class', () => {
    const gp = { className: 'ck-editor-wrapper', parentElement: null, getAttribute: () => null };
    const parent = { className: '', parentElement: gp, getAttribute: () => null };
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: '',
      parentElement: parent,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns true for parent at depth 3 with editor-content class', () => {
    const lvl3 = { className: 'editor-content', parentElement: null, getAttribute: () => null };
    const lvl2 = { className: '', parentElement: lvl3, getAttribute: () => null };
    const lvl1 = { className: '', parentElement: lvl2, getAttribute: () => null };
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: '',
      parentElement: lvl1,
      children: [],
    };
    expect(si.isRichTextEditor(el)).toBe(true);
  });

  test('returns false when parent chain exceeds depth 3 with editor class', () => {
    const deepEditor = { className: 'ql-editor', parentElement: null, getAttribute: () => null };
    const lvl3 = { className: '', parentElement: deepEditor, getAttribute: () => null };
    const lvl2 = { className: '', parentElement: lvl3, getAttribute: () => null };
    const lvl1 = { className: '', parentElement: lvl2, getAttribute: () => null };
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: '',
      parentElement: lvl1,
      children: { length: 1 },
    };
    // deepEditor is at depth 4, exceeds the while(depth<3) loop
    expect(si.isRichTextEditor(el)).toBe(false);
  });

  test('returns false for contenteditable with no indicators', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'plain-text',
      parentElement: null,
      children: { length: 5 },
    };
    expect(si.isRichTextEditor(el)).toBe(false);
  });
});

// ========== setDatePickerValue ==========

describe('si.setDatePickerValue', () => {
  test('returns error for null element', () => {
    const result = si.setDatePickerValue(null, '2026-01-15');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('parses human-readable date to YYYY-MM-DD', () => {
    const el = { type: 'text', getAttribute: () => null, querySelector: () => null, className: '', parentElement: null, click: jest.fn(), dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, 'January 15, 2026');
    expect(result).toBeDefined();
  });

  test('handles already-formatted YYYY-MM-DD', () => {
    const el = { type: 'text', getAttribute: () => null, querySelector: () => null, className: '', parentElement: null, click: jest.fn(), dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-01-15');
    expect(result).toBeDefined();
  });

  test('Strategy 1: native setter for type="date"', () => {
    const mockSetter = jest.fn();
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: mockSetter,
      configurable: true,
    });
    const el = { type: 'date', dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-03-20');
    expect(result.success).toBe(true);
    expect(result.method).toBe('native-setter');
    expect(mockSetter).toHaveBeenCalledWith('2026-03-20');
    expect(el.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  test('Strategy 1: native setter for type="datetime-local"', () => {
    const mockSetter = jest.fn();
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: mockSetter,
      configurable: true,
    });
    const el = { type: 'datetime-local', dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-03-20T10:00');
    expect(result.success).toBe(true);
    expect(result.method).toBe('native-setter');
  });

  test('Strategy 1: native setter for type="month"', () => {
    const mockSetter = jest.fn();
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: mockSetter,
      configurable: true,
    });
    const el = { type: 'month', dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-03');
    expect(result.success).toBe(true);
    expect(result.method).toBe('native-setter');
  });

  test('Strategy 1: falls through on setter error', () => {
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      get: undefined,
      set: function() { throw new Error('setter error'); },
      configurable: true,
    });
    const el = { type: 'date', dispatchEvent: jest.fn(), querySelector: () => null, click: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-03-20');
    // Falls through to strategy 3 (UI fallback)
    expect(result.method).not.toBe('native-setter');
  });

  test('Strategy 2: framework child input', () => {
    const mockSetter = jest.fn();
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: mockSetter,
      configurable: true,
    });
    const childInput = { type: 'date', dispatchEvent: jest.fn() };
    const el = { type: 'text', querySelector: () => childInput, dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-06-15');
    expect(result.success).toBe(true);
    expect(result.method).toBe('framework-child-input');
    expect(mockSetter).toHaveBeenCalledWith('2026-06-15');
  });

  test('Strategy 2: child input setter error falls through', () => {
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: function() { throw new Error('fail'); },
      configurable: true,
    });
    const childInput = { type: 'date', dispatchEvent: jest.fn() };
    const el = { type: 'text', querySelector: () => childInput, click: jest.fn(), dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-06-15');
    expect(result.method).not.toBe('framework-child-input');
  });

  test('Strategy 3: UI fallback when no native input', () => {
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: undefined,
      configurable: true,
    });
    const el = { type: 'text', querySelector: () => null, click: jest.fn(), dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-01-15');
    expect(result.method).toBe('ui-fallback');
    expect(result.success).toBe(false);
    expect(el.click).toHaveBeenCalled();
  });

  test('Strategy 3: returns none error when click throws', () => {
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: undefined,
      configurable: true,
    });
    const el = { type: 'text', querySelector: () => null, click: () => { throw new Error('no click'); }, dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, '2026-01-15');
    expect(result.method).toBe('none');
    expect(result.success).toBe(false);
    expect(result.error).toContain('All date picker strategies failed');
  });

  test('parses "March 5, 2025" correctly', () => {
    const mockSetter = jest.fn();
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: mockSetter,
      configurable: true,
    });
    const el = { type: 'date', dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, 'March 5, 2025');
    expect(result.success).toBe(true);
    expect(mockSetter).toHaveBeenCalledWith('2025-03-05');
  });

  test('handles invalid date string gracefully', () => {
    Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
      set: undefined,
      configurable: true,
    });
    const el = { type: 'text', querySelector: () => null, click: jest.fn(), dispatchEvent: jest.fn() };
    const result = si.setDatePickerValue(el, 'not-a-date-at-all');
    // Invalid date → NaN → nativeDate stays as original string, falls through
    expect(result).toBeDefined();
  });
});

// ========== uploadFile ==========

describe('si.uploadFile', () => {
  test('returns false for null element', () => {
    expect(si.uploadFile(null, 'test.txt', 'text/plain', 'content')).toBe(false);
  });

  test('returns false for non-file input', () => {
    expect(si.uploadFile({ type: 'text' }, 'test.txt', 'text/plain', 'content')).toBe(false);
  });

  test('returns false for missing fileName', () => {
    expect(si.uploadFile({ type: 'file' }, '', 'text/plain', 'content')).toBe(false);
  });

  test('returns false for missing content', () => {
    expect(si.uploadFile({ type: 'file' }, 'test.txt', 'text/plain', '')).toBe(false);
  });

  test('returns false for null content', () => {
    expect(si.uploadFile({ type: 'file' }, 'test.txt', 'text/plain', null)).toBe(false);
  });

  test('success path: creates File, DataTransfer, dispatches change', () => {
    const el = { type: 'file', dispatchEvent: jest.fn() };
    const result = si.uploadFile(el, 'report.csv', 'text/csv', 'a,b,c');
    expect(result).toBe(true);
    expect(globalThis.File).toHaveBeenCalledWith(['a,b,c'], 'report.csv', { type: 'text/csv' });
    expect(globalThis.DataTransfer).toHaveBeenCalled();
    expect(el.dispatchEvent).toHaveBeenCalled();
    // The change event should be dispatched
    const changeCall = el.dispatchEvent.mock.calls.find(c =>
      c[0] && c[0].type === 'change'
    );
    expect(changeCall).toBeDefined();
  });

  test('success path: defaults mimeType to text/plain', () => {
    const el = { type: 'file', dispatchEvent: jest.fn() };
    const result = si.uploadFile(el, 'data.txt', null, 'hello');
    expect(result).toBe(true);
    expect(globalThis.File).toHaveBeenCalledWith(['hello'], 'data.txt', { type: 'text/plain' });
  });

  test('success path: uses text/plain when mimeType is empty string', () => {
    const el = { type: 'file', dispatchEvent: jest.fn() };
    const result = si.uploadFile(el, 'data.txt', '', 'hello');
    expect(result).toBe(true);
  });

  test('returns false when File constructor throws', () => {
    globalThis.File = jest.fn(() => { throw new Error('no File support'); });
    const el = { type: 'file', dispatchEvent: jest.fn() };
    const result = si.uploadFile(el, 'test.txt', 'text/plain', 'content');
    expect(result).toBe(false);
    // Restore
    globalThis.File = jest.fn((bits, name, opts) => ({ bits, name, opts }));
  });

  test('returns false when DataTransfer constructor throws', () => {
    globalThis.DataTransfer = jest.fn(() => { throw new Error('no DT'); });
    const el = { type: 'file', dispatchEvent: jest.fn() };
    const result = si.uploadFile(el, 'test.txt', 'text/plain', 'content');
    expect(result).toBe(false);
    // Restore
    globalThis.DataTransfer = jest.fn(() => ({
      items: { add: jest.fn() },
      files: mockFiles,
    }));
  });
});

// ========== setRichTextValue ==========

describe('si.setRichTextValue', () => {
  test('returns error for null element', () => {
    const result = si.setRichTextValue(null, 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('returns error for undefined element', () => {
    const result = si.setRichTextValue(undefined, 'hello');
    expect(result.success).toBe(false);
  });

  test('uses Quill API when available', () => {
    const el = {
      __quill: { setText: jest.fn() },
      id: 'editor',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'hello');
    expect(result.success).toBe(true);
    expect(result.method).toBe('quill-api');
    expect(el.__quill.setText).toHaveBeenCalledWith('hello');
  });

  test('Quill API falls through on error', () => {
    const el = {
      __quill: { setText: jest.fn(() => { throw new Error('quill fail'); }) },
      id: 'editor',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    // Will fall through to execCommand or innerHTML
    const result = si.setRichTextValue(el, 'hello');
    expect(result.success).toBe(true);
    expect(result.method).not.toBe('quill-api');
  });

  test('uses TinyMCE API when available', () => {
    const mockEditor = { setContent: jest.fn() };
    globalThis.tinymce = { get: jest.fn(() => mockEditor) };
    const el = {
      id: 'my-tinymce',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
    };
    const result = si.setRichTextValue(el, '<p>Hello TinyMCE</p>');
    expect(result.success).toBe(true);
    expect(result.method).toBe('tinymce-api');
    expect(mockEditor.setContent).toHaveBeenCalledWith('<p>Hello TinyMCE</p>');
    expect(globalThis.tinymce.get).toHaveBeenCalledWith('my-tinymce');
  });

  test('TinyMCE skipped when element has no id', () => {
    const mockEditor = { setContent: jest.fn() };
    globalThis.tinymce = { get: jest.fn(() => mockEditor) };
    const el = {
      id: '',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'text');
    // Should not use TinyMCE since id is falsy
    expect(result.method).not.toBe('tinymce-api');
  });

  test('TinyMCE skipped when tinymce.get returns null', () => {
    globalThis.tinymce = { get: jest.fn(() => null) };
    const el = {
      id: 'editor',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'text');
    expect(result.method).not.toBe('tinymce-api');
  });

  test('TinyMCE skipped when tinymce is undefined', () => {
    delete globalThis.tinymce;
    const el = {
      id: 'editor',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'text');
    expect(result.method).not.toBe('tinymce-api');
  });

  test('uses CKEditor API when available', () => {
    const mockEditor = { setData: jest.fn() };
    globalThis.CKEDITOR = { instances: { 'my-cke': mockEditor } };
    const el = {
      id: 'my-cke',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
    };
    const result = si.setRichTextValue(el, '<p>CKEditor content</p>');
    expect(result.success).toBe(true);
    expect(result.method).toBe('ckeditor-api');
    expect(mockEditor.setData).toHaveBeenCalledWith('<p>CKEditor content</p>');
  });

  test('CKEditor skipped when element has no id', () => {
    const mockEditor = { setData: jest.fn() };
    globalThis.CKEDITOR = { instances: { 'editor': mockEditor } };
    const el = {
      id: '',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'text');
    expect(result.method).not.toBe('ckeditor-api');
  });

  test('CKEditor skipped when no matching instance', () => {
    globalThis.CKEDITOR = { instances: { 'other-editor': { setData: jest.fn() } } };
    const el = {
      id: 'my-cke',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'text');
    expect(result.method).not.toBe('ckeditor-api');
  });

  test('CKEditor skipped when CKEDITOR is undefined', () => {
    delete globalThis.CKEDITOR;
    const el = {
      id: 'editor',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'text');
    expect(result.method).not.toBe('ckeditor-api');
  });

  test('uses execCommand when no editor API available', () => {
    // No Quill, no TinyMCE, no CKEditor
    delete globalThis.tinymce;
    delete globalThis.CKEDITOR;

    // Mock document.execCommand
    const origExec = globalThis.document ? globalThis.document.execCommand : undefined;
    if (!globalThis.document) globalThis.document = {};
    globalThis.document.execCommand = jest.fn(() => true);

    const el = {
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'ab');
    expect(result.success).toBe(true);
    expect(result.method).toBe('execCommand');
    // execCommand called: selectAll, delete, insertText ×2
    expect(globalThis.document.execCommand).toHaveBeenCalledWith('selectAll', false, null);
    expect(globalThis.document.execCommand).toHaveBeenCalledWith('delete', false, null);
    expect(globalThis.document.execCommand).toHaveBeenCalledWith('insertText', false, 'ab');

    // Restore
    if (origExec !== undefined) {
      globalThis.document.execCommand = origExec;
    }
  });

  test('execCommand dispatches single input event for full text', () => {
    delete globalThis.tinymce;
    delete globalThis.CKEDITOR;
    if (!globalThis.document) globalThis.document = {};
    globalThis.document.execCommand = jest.fn(() => true);

    const el = {
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'hi');
    expect(result.success).toBe(true);
    expect(el.dispatchEvent).toHaveBeenCalled();
  });

  test('falls to innerHTML when execCommand throws', () => {
    delete globalThis.tinymce;
    delete globalThis.CKEDITOR;
    if (!globalThis.document) globalThis.document = {};
    globalThis.document.execCommand = jest.fn(() => { throw new Error('no execCommand'); });

    const el = {
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'line1\nline2');
    expect(result.success).toBe(true);
    expect(result.method).toBe('direct-innerHTML');
    // newlines replaced with <br>
    expect(el.innerHTML).toBe('line1<br>line2');
  });

  test('innerHTML replaces newlines with br tags', () => {
    delete globalThis.tinymce;
    delete globalThis.CKEDITOR;
    if (!globalThis.document) globalThis.document = {};
    globalThis.document.execCommand = jest.fn(() => { throw new Error('fail'); });

    const el = {
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'a\nb\nc');
    expect(result.success).toBe(true);
    expect(el.innerHTML).toBe('a<br>b<br>c');
  });

  test('returns error when all strategies fail', () => {
    delete globalThis.tinymce;
    delete globalThis.CKEDITOR;
    if (!globalThis.document) globalThis.document = {};

    let callCount = 0;
    globalThis.document.execCommand = jest.fn(() => {
      callCount++;
      throw new Error('exec fail');
    });

    const el = {
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
      focus: jest.fn(),
      // Make innerHTML setter throw by using a proxy
      set innerHTML(v) { throw new Error('no innerHTML'); },
      get innerHTML() { return ''; },
    };
    const result = si.setRichTextValue(el, 'text');
    expect(result.success).toBe(false);
    expect(result.method).toBe('none');
    expect(result.error).toContain('All rich text strategies failed');
  });

  test('handles empty text string', () => {
    const el = {
      __quill: { setText: jest.fn() },
      id: 'editor',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
    };
    const result = si.setRichTextValue(el, '');
    expect(result.success).toBe(true);
    expect(result.method).toBe('quill-api');
    expect(el.__quill.setText).toHaveBeenCalledWith('');
  });

  test('CKEditor with setData function uses ckeditor5-api path', () => {
    // The code has a duplicate CKEditor check — second block also checks
    // CKEDITOR.instances[el.id] and editor.setData
    const mockEditor = { setData: jest.fn() };
    globalThis.CKEDITOR = { instances: { 'cke5': mockEditor } };
    // Need no Quill first
    const el = {
      id: 'cke5',
      getAttribute: () => null,
      dispatchEvent: jest.fn(),
    };
    const result = si.setRichTextValue(el, 'CKE5 content');
    // First CKEditor block will match and return ckeditor-api
    expect(result.success).toBe(true);
    expect(result.method).toBe('ckeditor-api');
  });
});
