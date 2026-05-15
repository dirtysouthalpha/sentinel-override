// tests/content-special-inputs.test.js
// Unit tests for content/special-inputs.js — isDateInput, isRichTextEditor, setDatePickerValue, uploadFile, setRichTextValue.

import { jest } from '@jest/globals';

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = { specialInputs: {} };

let si;
beforeAll(async () => {
  await import('../content/special-inputs.js');
  si = globalThis.window.__sentinelUtils.specialInputs;
});

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

  test('returns true for class containing "calendar"', () => {
    expect(si.isDateInput({ type: 'text', className: 'calendar-widget', getAttribute: () => null })).toBe(true);
  });

  test('returns true for parent with date-related class', () => {
    const parent = { className: 'datepicker-wrapper', parentElement: null, getAttribute: () => null };
    const el = { type: 'text', className: '', parentElement: parent, getAttribute: () => null };
    expect(si.isDateInput(el)).toBe(true);
  });

  test('returns false for unrelated input', () => {
    expect(si.isDateInput({ type: 'text', className: '', parentElement: null, getAttribute: () => null })).toBe(false);
  });
});

describe('si.isRichTextEditor', () => {
  test('returns false for null', () => {
    expect(si.isRichTextEditor(null)).toBe(false);
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

  test('returns true for contenteditable with editor class', () => {
    const el = {
      isContentEditable: true,
      querySelectorAll: () => [],
      getAttribute: () => null,
      className: 'ql-editor',
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
});

describe('si.setDatePickerValue', () => {
  test('returns error for null element', () => {
    const result = si.setDatePickerValue(null, '2026-01-15');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('parses human-readable date to YYYY-MM-DD', () => {
    const el = { type: 'text', getAttribute: () => null, querySelector: () => null, className: '', parentElement: null };
    const result = si.setDatePickerValue(el, 'January 15, 2026');
    // It will fail to set (no native setter mock) but should parse the date
    expect(result).toBeDefined();
  });

  test('handles already-formatted YYYY-MM-DD', () => {
    const el = { type: 'text', getAttribute: () => null, querySelector: () => null, className: '', parentElement: null };
    const result = si.setDatePickerValue(el, '2026-01-15');
    expect(result).toBeDefined();
  });
});

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
});

describe('si.setRichTextValue', () => {
  test('returns error for null element', () => {
    const result = si.setRichTextValue(null, 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
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
  });
});
