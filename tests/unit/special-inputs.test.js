// Sentinel Override v3 -- Unit tests for content/special-inputs.js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createEl } from '../helpers/dom-fixture.js';

describe('special-inputs', () => {
  let si;

  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    await import('../../content/special-inputs.js');
    si = window.__sentinelUtils.specialInputs;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('exports specialInputs from window.__sentinelUtils.specialInputs', () => {
    expect(si).toBeDefined();
    expect(si.isDateInput).toBeInstanceOf(Function);
    expect(si.isRichTextEditor).toBeInstanceOf(Function);
    expect(si.setDatePickerValue).toBeInstanceOf(Function);
    expect(si.uploadFile).toBeInstanceOf(Function);
    expect(si.setRichTextValue).toBeInstanceOf(Function);
  });

  describe('isDateInput', () => {
    it('returns false for null', () => {
      expect(si.isDateInput(null)).toBe(false);
    });

    it('detects native date input', () => {
      const input = createEl('input', { type: 'date' });
      expect(si.isDateInput(input)).toBe(true);
    });

    it('detects native datetime-local input', () => {
      const input = createEl('input', { type: 'datetime-local' });
      expect(si.isDateInput(input)).toBe(true);
    });

    it('detects native month input', () => {
      const input = createEl('input', { type: 'month' });
      expect(si.isDateInput(input)).toBe(true);
    });

    it('detects ARIA datepicker role', () => {
      const el = createEl('div', { role: 'datepicker' });
      expect(si.isDateInput(el)).toBe(true);
    });

    it('detects datepicker by class name', () => {
      const el = createEl('div', { class: 'my-datepicker-container' });
      expect(si.isDateInput(el)).toBe(true);
    });

    it('detects date-picker by class name (hyphenated)', () => {
      const el = createEl('div', { class: 'custom-date-picker' });
      expect(si.isDateInput(el)).toBe(true);
    });

    it('detects calendar by parent class', () => {
      const parent = createEl('div', { class: 'calendar-wrapper' });
      const child = createEl('input', { type: 'text' });
      parent.appendChild(child);
      document.body.appendChild(parent);
      expect(si.isDateInput(child)).toBe(true);
    });

    it('returns false for regular text input', () => {
      const input = createEl('input', { type: 'text' });
      expect(si.isDateInput(input)).toBe(false);
    });
  });

  describe('isRichTextEditor', () => {
    it('returns false for null', () => {
      expect(si.isRichTextEditor(null)).toBe(false);
    });

    it('detects contenteditable with rich children', () => {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.innerHTML = '<b>Bold text</b> and <i>italic</i>';
      document.body.appendChild(el);
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    it('detects contenteditable with ql-editor class', () => {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.className = 'ql-editor';
      document.body.appendChild(el);
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    it('detects contenteditable with aria-multiline', () => {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.setAttribute('aria-multiline', 'true');
      document.body.appendChild(el);
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    it('detects contenteditable with data-placeholder', () => {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.setAttribute('data-placeholder', 'Type here...');
      document.body.appendChild(el);
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    it('detects CKEditor by parent class', () => {
      const parent = document.createElement('div');
      parent.className = 'ck-editor';
      const el = document.createElement('div');
      el.contentEditable = 'true';
      parent.appendChild(el);
      document.body.appendChild(parent);
      expect(si.isRichTextEditor(el)).toBe(true);
    });

    it('returns false for non-contenteditable element', () => {
      const el = createEl('div', {}, 'Regular div');
      expect(si.isRichTextEditor(el)).toBe(false);
    });
  });

  describe('setDatePickerValue', () => {
    it('returns error for null element', () => {
      const result = si.setDatePickerValue(null, '2024-01-01');
      expect(result.success).toBe(false);
      expect(result.method).toBe('none');
    });

    it('sets value on native date input', () => {
      const input = createEl('input', { type: 'date' });
      document.body.appendChild(input);
      const result = si.setDatePickerValue(input, '2024-06-15');
      expect(result.success).toBe(true);
      expect(result.method).toBe('native-setter');
      expect(input.value).toBe('2024-06-15');
    });

    it('parses human-readable date string', () => {
      const input = createEl('input', { type: 'date' });
      document.body.appendChild(input);
      const result = si.setDatePickerValue(input, 'January 15, 2024');
      expect(result.success).toBe(true);
      expect(input.value).toBe('2024-01-15');
    });
  });

  describe('uploadFile', () => {
    it('returns false for non-file input', () => {
      const input = createEl('input', { type: 'text' });
      expect(si.uploadFile(input, 'test.txt', 'text/plain', 'content')).toBe(false);
    });

    it('returns false for null element', () => {
      expect(si.uploadFile(null, 'test.txt', 'text/plain', 'content')).toBe(false);
    });

    it('returns false for missing filename', () => {
      const input = createEl('input', { type: 'file' });
      expect(si.uploadFile(input, null, 'text/plain', 'content')).toBe(false);
    });

    it('sets file on file input', () => {
      const input = createEl('input', { type: 'file' });
      document.body.appendChild(input);
      const result = si.uploadFile(input, 'test.txt', 'text/plain', 'file content');
      expect(result).toBe(true);
      expect(input.files.length).toBe(1);
      expect(input.files[0].name).toBe('test.txt');
    });
  });

  describe('setRichTextValue', () => {
    it('returns error for null element', () => {
      const result = si.setRichTextValue(null, 'Hello');
      expect(result.success).toBe(false);
      expect(result.method).toBe('none');
    });

    it('uses a fallback strategy for contenteditable element', () => {
      // happy-dom may not support execCommand, so accept either strategy
      const el = document.createElement('div');
      el.contentEditable = 'true';
      document.body.appendChild(el);
      const result = si.setRichTextValue(el, 'Hello World');
      expect(result.success).toBe(true);
      expect(['execCommand', 'direct-innerHTML']).toContain(result.method);
      expect(el.innerHTML).toContain('Hello World');
    });

    it('uses Quill API when __quill is available', () => {
      const el = document.createElement('div');
      el.__quill = { setText: vi.fn() };
      document.body.appendChild(el);
      const result = si.setRichTextValue(el, 'Quill content');
      expect(result.success).toBe(true);
      expect(result.method).toBe('quill-api');
      expect(el.__quill.setText).toHaveBeenCalledWith('Quill content');
    });
  });
});
