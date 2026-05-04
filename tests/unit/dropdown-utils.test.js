// Sentinel Override v3 -- Unit tests for content/dropdown-utils.js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createEl, createTestPage, cleanupTestPage, patchBoundingClientRect } from '../helpers/dom-fixture.js';

describe('dropdown-utils', () => {
  let dropdown;

  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    await import('../../content/dom-utils.js');
    await import('../../content/shadow-dom.js');
    await import('../../content/wait-utils.js');
    const mod = await import('../../content/dropdown-utils.js');
    dropdown = mod.dropdown;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('exports dropdown from window.__sentinelUtils.dropdown', () => {
    expect(dropdown).toBeDefined();
    expect(dropdown.openDropdown).toBeInstanceOf(Function);
    expect(dropdown.findDropdownOptions).toBeInstanceOf(Function);
    expect(dropdown.selectDropdownOption).toBeInstanceOf(Function);
    expect(dropdown.isCustomDropdown).toBeInstanceOf(Function);
    expect(dropdown.dismissDropdown).toBeInstanceOf(Function);
  });

  describe('findDropdownOptions', () => {
    it('finds elements with role="option"', () => {
      document.body.innerHTML = `
        <div role="listbox">
          <div role="option">Option 1</div>
          <div role="option">Option 2</div>
        </div>
      `;
      patchBoundingClientRect(document);
      const options = dropdown.findDropdownOptions(document, null);
      expect(options.length).toBe(2);
    });

    it('finds elements with role="menuitem"', () => {
      document.body.innerHTML = `
        <div role="menu">
          <div role="menuitem">Menu Item 1</div>
          <div role="menuitem">Menu Item 2</div>
        </div>
      `;
      patchBoundingClientRect(document);
      const options = dropdown.findDropdownOptions(document, null);
      expect(options.length).toBe(2);
    });

    it('finds elements inside common dropdown containers', () => {
      document.body.innerHTML = `
        <div class="dropdown-menu">
          <div class="dropdown-item">Item 1</div>
          <div class="dropdown-item">Item 2</div>
        </div>
      `;
      patchBoundingClientRect(document);
      const options = dropdown.findDropdownOptions(document, null);
      expect(options.length).toBe(2);
    });

    it('filters out invisible options', () => {
      document.body.innerHTML = `
        <div role="listbox">
          <div role="option" style="display:none">Hidden</div>
          <div role="option">Visible</div>
        </div>
      `;
      patchBoundingClientRect(document);
      const options = dropdown.findDropdownOptions(document, null);
      expect(options.length).toBe(1);
      expect(options[0].textContent).toBe('Visible');
    });
  });

  describe('isCustomDropdown', () => {
    it('returns false for native select elements', () => {
      const select = document.createElement('select');
      expect(dropdown.isCustomDropdown(select)).toBe(false);
    });

    it('returns false for null', () => {
      expect(dropdown.isCustomDropdown(null)).toBe(false);
    });

    it('returns true for ARIA combobox', () => {
      const el = createEl('div', { role: 'combobox' });
      expect(dropdown.isCustomDropdown(el)).toBe(true);
    });

    it('returns true for ARIA button with haspopup', () => {
      const el = createEl('div', { role: 'button', 'aria-haspopup': 'true' });
      expect(dropdown.isCustomDropdown(el)).toBe(true);
    });

    it('returns true for elements with dropdown class', () => {
      const el = createEl('div', { class: 'my-dropdown-trigger' });
      expect(dropdown.isCustomDropdown(el)).toBe(true);
    });
  });

  describe('selectDropdownOption', () => {
    it('returns null for empty options array', async () => {
      const result = await dropdown.selectDropdownOption(document, [], 'Option 1');
      expect(result).toBeNull();
    });

    it('returns null for null value', async () => {
      const options = [createEl('div', { role: 'option' }, 'Option 1')];
      document.body.appendChild(options[0]);
      const result = await dropdown.selectDropdownOption(document, options, null);
      expect(result).toBeNull();
    });

    it('matches option by exact text', async () => {
      const opt = createEl('div', { role: 'option' }, 'Target Option');
      document.body.appendChild(opt);
      const result = await dropdown.selectDropdownOption(document, [opt], 'Target Option');
      expect(result).toBe(opt);
    });

    it('matches option by partial text', async () => {
      const opt = createEl('div', { role: 'option' }, 'Target Option Long Name');
      document.body.appendChild(opt);
      const result = await dropdown.selectDropdownOption(document, [opt], 'Target');
      expect(result).toBe(opt);
    });

    it('returns null when no match found', async () => {
      const opt = createEl('div', { role: 'option' }, 'Option A');
      document.body.appendChild(opt);
      const result = await dropdown.selectDropdownOption(document, [opt], 'Nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('dismissDropdown', () => {
    it('returns false when no open dropdowns', () => {
      const result = dropdown.dismissDropdown(document);
      expect(result).toBe(false);
    });

    it('dispatches Escape keydown event', () => {
      const escapeSpy = vi.fn();
      document.addEventListener('keydown', escapeSpy);
      dropdown.dismissDropdown(document);
      const called = escapeSpy.mock.calls.some(
        call => call[0].key === 'Escape'
      );
      expect(called).toBe(true);
      document.removeEventListener('keydown', escapeSpy);
    });
  });
});
