// Sentinel Override v3 -- Dropdown & Menu Utilities
// Custom dropdown detection, opening, option selection, and nested menu traversal.
// Works with Angular Material, React Select, Ant Design, Ext JS, and other custom components.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.dropdown = window.__sentinelUtils.dropdown || {};

(function() {
  const dd = window.__sentinelUtils.dropdown;
  const dom = window.__sentinelUtils.dom;
  const wait = window.__sentinelUtils.wait;
  const shadow = window.__sentinelUtils.shadow;

  // ========== Open Dropdown ==========
  // Opens a custom dropdown by clicking the trigger, then polls for option elements.
  // Returns array of option elements, or null if opening failed.
  dd.openDropdown = async function(doc, triggerEl) {
    if (!triggerEl) return null;

    // Scroll trigger into view before clicking
    triggerEl.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Dispatch full mouse sequence consistent with existing click pattern
    const view = doc.defaultView;
    const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: view };
    triggerEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    triggerEl.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    triggerEl.click();
    triggerEl.dispatchEvent(new MouseEvent('mouseout', mouseOpts));

    // Poll for option elements to appear (100ms interval, 3s timeout)
    const POLL_INTERVAL = 100;
    const TIMEOUT = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < TIMEOUT) {
      await wait.sleep(POLL_INTERVAL);
      const options = dd.findDropdownOptions(doc, triggerEl);
      if (options && options.length > 0) {
        return options;
      }
    }

    return null; // Failed to open
  };

  // ========== Find Dropdown Options ==========
  // Finds dropdown option elements after a dropdown is opened.
  // Checks multiple patterns: ARIA, common containers, shadow roots.
  dd.findDropdownOptions = function(doc, triggerEl) {
    const options = [];
    const seen = new Set();

    function addUnique(el) {
      if (el && !seen.has(el)) {
        seen.add(el);
        options.push(el);
      }
    }

    function addAllFromContainer(container) {
      if (!container || typeof container.querySelectorAll !== 'function') return;
      // The container itself may be a listbox/menu — also count its direct option children
      try {
        const items = container.querySelectorAll(
          '[role="option"], [role="menuitem"], li, .option, .dropdown-item, .menu-item, .select-option'
        );
        items.forEach(addUnique);
      } catch (e) { /* invalid selector */ }
    }

    // ===== Scoped lookup (#22) =====
    // Try to scope to the trigger first so two open dropdowns don't bleed options.
    if (triggerEl && triggerEl.getAttribute) {
      // 1a. aria-controls / aria-owns reference an explicit listbox/menu by id.
      const controlsId = triggerEl.getAttribute('aria-controls');
      if (controlsId) {
        try {
          const controlled = doc.getElementById(controlsId);
          if (controlled) addAllFromContainer(controlled);
        } catch (e) {}
      }
      const ownsId = triggerEl.getAttribute('aria-owns');
      if (ownsId) {
        try {
          const owned = doc.getElementById(ownsId);
          if (owned) addAllFromContainer(owned);
        } catch (e) {}
      }

      // 1b. If we got nothing yet, climb the DOM looking for a parent that contains
      // a [role="listbox"] / [role="menu"] / [role="combobox"] descendant.
      if (options.length === 0) {
        try {
          let cursor = triggerEl.parentElement;
          let depth = 0;
          while (cursor && depth < 8) {
            const localContainers = cursor.querySelectorAll(
              '[role="listbox"], [role="menu"], [role="combobox"]'
            );
            if (localContainers.length > 0) {
              localContainers.forEach(addAllFromContainer);
              if (options.length > 0) break;
            }
            cursor = cursor.parentElement;
            depth++;
          }
        } catch (e) {}
      }
    }

    // If scoped lookup found options, return them now (skip doc-wide).
    if (options.length > 0) {
      return options.filter(function(el) { return dom.isVisible(el); });
    }

    // ===== Fallback: doc-wide lookup =====
    // 2. ARIA pattern: role="option"
    let found = doc.querySelectorAll('[role="option"]');
    found.forEach(addUnique);

    // Also check role="listbox" > role="option" (more specific)
    found = doc.querySelectorAll('[role="listbox"] [role="option"]');
    found.forEach(addUnique);

    // 3. Common dropdown containers
    const containerSelectors = [
      '.dropdown-menu', '.select-options', '.menu',
      '[role="menu"]', '.autocomplete-list',
      '[role="listbox"]', '.dropdown-list', '.options-list',
      '.combo-box-list', '.select-list'
    ];
    for (const sel of containerSelectors) {
      try {
        found = doc.querySelectorAll(sel);
        found.forEach(addAllFromContainer);
      } catch (e) { /* invalid selector */ }
    }

    // 4. Siblings/children of trigger
    if (triggerEl) {
      const parent = triggerEl.parentElement;
      if (parent) {
        const siblingItems = parent.querySelectorAll(
          'li, [role="option"], .option, .dropdown-item, .menu-item'
        );
        siblingItems.forEach(addUnique);
      }
    }

    // 5. Search inside shadow roots via queryDeep
    if (shadow && shadow.queryDeep) {
      const shadowOptions = shadow.queryDeep(doc, '[role="option"]');
      shadowOptions.forEach(addUnique);

      const shadowMenuItems = shadow.queryDeep(doc, '[role="menuitem"]');
      shadowMenuItems.forEach(addUnique);
    }

    // Filter by visibility
    return options.filter(function(el) {
      return dom.isVisible(el);
    });
  };

  // ========== Select Dropdown Option ==========
  // Selects a specific option from an open dropdown by value text.
  // Returns the clicked element or null if selection failed.
  dd.selectDropdownOption = async function(doc, optionEls, value) {
    if (!optionEls || optionEls.length === 0) return null;
    if (!value && value !== '') return null;

    const valueLower = value.toLowerCase().trim();

    // Priority matching: exact > starts-with > word boundary > partial (most specific first)
    let matchedEl = null;
    // 1. Exact match (highest priority)
    for (const opt of optionEls) {
      const optText = (opt.innerText || opt.textContent || '').trim().toLowerCase();
      if (optText === valueLower) { matchedEl = opt; break; }
    }
    // 2. Exact match against option value attribute
    if (!matchedEl) {
      for (const opt of optionEls) {
        if (opt.value && opt.value.toLowerCase().trim() === valueLower) { matchedEl = opt; break; }
      }
    }
    // 3. Starts with (word boundary)
    if (!matchedEl) {
      for (const opt of optionEls) {
        const optText = (opt.innerText || opt.textContent || '').trim().toLowerCase();
        if (optText.startsWith(valueLower + ' ') || optText.startsWith(valueLower) && (optText.length === valueLower.length || optText[valueLower.length] === ' ')) {
          matchedEl = opt; break;
        }
      }
    }
    // 4. Contains as whole word
    if (!matchedEl) {
      const wordRegex = new RegExp('\\b' + valueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      for (const opt of optionEls) {
        const optText = (opt.innerText || opt.textContent || '').trim();
        if (wordRegex.test(optText)) { matchedEl = opt; break; }
      }
    }
    // 5. Partial contains (fallback — least specific)
    if (!matchedEl) {
      for (const opt of optionEls) {
        const optText = (opt.innerText || opt.textContent || '').trim().toLowerCase();
        if (optText.includes(valueLower)) { matchedEl = opt; break; }
      }
    }

    // If no match and large list, try search input strategy
    if (!matchedEl && optionEls.length >= 50) {
      const searchInput = dd._findSearchInput(doc, optionEls);
      if (searchInput) {
        searchInput.focus();
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        for (const char of value) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            searchInput.tagName === 'TEXTAREA'
              ? doc.defaultView.HTMLTextAreaElement.prototype
              : doc.defaultView.HTMLInputElement.prototype,
            'value'
          ).set;
          nativeSetter.call(searchInput, searchInput.value + char);
          searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: char }));
        }
        // Wait for filtered results
        await wait.sleep(300);
        const filteredOptions = dd.findDropdownOptions(doc, null);
        for (const opt of filteredOptions) {
          const optText = (opt.innerText || opt.textContent || '').trim().toLowerCase();
          if (optText === valueLower || optText.includes(valueLower)) {
            matchedEl = opt;
            break;
          }
        }
      }
    }

    if (!matchedEl) return null;

    // Scroll option into view and click
    matchedEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    const view = doc.defaultView;
    const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: view };
    matchedEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    matchedEl.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    matchedEl.click();
    matchedEl.dispatchEvent(new MouseEvent('mouseout', mouseOpts));

    return matchedEl;
  };

  // ========== Traverse Nested Menu ==========
  // Traverses a nested hover/click menu structure.
  // menuPath is an array of strings like ["Settings", "Security", "Firewall Rules"].
  // Returns the clicked element or null if any level failed.
  dd.traverseNestedMenu = async function(doc, menuPath) {
    if (!menuPath || menuPath.length === 0) return null;

    const view = doc.defaultView;
    let currentEl = null;

    for (let level = 0; level < menuPath.length; level++) {
      const targetText = menuPath[level].toLowerCase().trim();
      const isLastLevel = level === menuPath.length - 1;

      // Find menu item matching the text at this level
      const menuItems = dd.findDropdownOptions(doc, currentEl);
      let matchedItem = null;
      for (const item of menuItems) {
        const itemText = (item.innerText || item.textContent || '').trim().toLowerCase();
        if (itemText === targetText || itemText.includes(targetText)) {
          matchedItem = item;
          break;
        }
      }

      if (!matchedItem) return null;

      currentEl = matchedItem;

      if (isLastLevel) {
        // Final item: click it
        matchedItem.scrollIntoView({ behavior: 'instant', block: 'center' });
        const mouseOpts = { bubbles: true, cancelable: true, composed: true, view: view };
        matchedItem.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        matchedItem.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        matchedItem.click();
        matchedItem.dispatchEvent(new MouseEvent('mouseout', mouseOpts));
        return matchedItem;
      }

      // Not the last level: hover to reveal submenu
      matchedItem.scrollIntoView({ behavior: 'instant', block: 'center' });
      matchedItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, composed: true, view: view }));
      matchedItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }));

      // Wait for submenu to appear (300ms hover delay, up to 500ms total)
      await wait.sleep(300);

      // Check if submenu appeared
      const subItems = dd.findDropdownOptions(doc, matchedItem);
      if (subItems.length === 0) {
        // Fallback: try clicking instead of hovering
        matchedItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: view }));
        matchedItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: view }));
        matchedItem.click();
        await wait.sleep(200);

        // Check again after click
        const clickSubItems = dd.findDropdownOptions(doc, matchedItem);
        if (clickSubItems.length === 0) return null; // Submenu never appeared
      }
    }

    return currentEl;
  };

  // ========== Is Custom Dropdown ==========
  // Heuristic to detect if an element is a custom dropdown trigger (not a native <select>).
  dd.isCustomDropdown = function(el) {
    if (!el) return false;
    // Skip native select elements
    if (el.tagName === 'SELECT') return false;

    // ARIA combobox
    if (el.getAttribute('role') === 'combobox') return true;
    // ARIA button with haspopup
    if (el.getAttribute('role') === 'button' && el.getAttribute('aria-haspopup')) return true;
    if (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-haspopup') === 'menu') return true;

    // Check class names for common dropdown patterns
    const className = (el.className || '').toLowerCase();
    if (className.includes('dropdown') || className.includes('combobox') ||
        className.includes('select') || className.includes('picker')) {
      return true;
    }

    // Check for nearby dropdown containers
    const parent = el.parentElement;
    if (parent) {
      // Check siblings for dropdown menu containers
      const siblingContainers = parent.querySelectorAll(
        '[role="listbox"], [role="option"], .dropdown-menu, .select-options, .menu'
      );
      if (siblingContainers.length > 0) return true;

      // Check children
      const childContainers = el.querySelectorAll(
        '.dropdown-menu, .select-options'
      );
      if (childContainers.length > 0) return true;
    }

    return false;
  };

  // ========== Dismiss Dropdown ==========
  // Closes any open dropdown by pressing Escape or clicking outside.
  dd.dismissDropdown = function(doc) {
    // Check if a dropdown is visibly open
    const openDropdowns = doc.querySelectorAll(
      '.dropdown-menu:not([style*="display: none"]), .select-options:not([style*="display: none"]), ' +
      '[role="listbox"]:not([style*="display: none"]), [role="menu"]:not([style*="display: none"])'
    );

    let wasOpen = false;
    openDropdowns.forEach(function(dropdown) {
      if (dom.isVisible(dropdown)) {
        wasOpen = true;
      }
    });

    // Press Escape to dismiss — full keydown + keypress + keyup sequence (#23)
    const activeEl = doc.activeElement || doc.body;
    const escOpts = {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true, composed: true
    };
    activeEl.dispatchEvent(new KeyboardEvent('keydown', escOpts));
    activeEl.dispatchEvent(new KeyboardEvent('keypress', escOpts));
    activeEl.dispatchEvent(new KeyboardEvent('keyup', escOpts));

    return wasOpen;
  };

  // ========== Internal: Find Search Input ==========
  // Looks for a search/filter input within the dropdown container.
  dd._findSearchInput = function(doc, optionEls) {
    // Look for an input near the first option
    if (optionEls && optionEls.length > 0) {
      const firstOption = optionEls[0];
      const container = firstOption.closest('[role="listbox"], .dropdown-menu, .select-options, .menu, .autocomplete-list');
      if (container) {
        const searchInput = container.querySelector('input[type="text"], input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]');
        if (searchInput) return searchInput;
      }
    }

    // Look for any visible search input that appeared recently
    const searchInputs = doc.querySelectorAll(
      'input[type="text"], input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]'
    );
    for (const input of searchInputs) {
      if (dom.isVisible(input)) return input;
    }

    return null;
  };
})();

