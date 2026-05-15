// tests/popup-full.test.js
// Unit tests for popup-full.js — bootstrap wiring, modal close handlers, keydown/click outside.
// popup-full.js runs bare (no exports), so we eval in a VM sandbox with a mocked DOM.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// All element IDs that popup-full.js references
const ALL_ELEMENT_IDS = [
  'schedules-panel', 'chat-container', 'input-area', 'templates-panel',
  'templatesBtn', 'schedulerBtn', 'closeScheduleModalBtn', 'closeHistoryModalBtn',
  'createScheduleBtn', 'saveScheduleBtn', 'importTemplatesBtn', 'exportAllTemplatesBtn',
  'settings-modal', 'theme-modal', 'report-modal', 'template-modal',
  'template-run-modal', 'schedule-modal', 'schedule-history-modal', 'import-modal',
];

// Helper: create a minimal DOM environment with the elements popup-full.js references.
function createSandbox() {
  const elements = {};
  const docListeners = {};
  const winListeners = {};

  const fakeDoc = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = {
          style: { display: '' },
          classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); },
          },
          _listeners: {},
          addEventListener(event, cb) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(cb);
          },
          removeEventListener() {},
          dataset: {},
          value: '',
          textContent: '',
          innerHTML: '',
          querySelectorAll() { return []; },
          querySelector() { return null; },
          dispatchEvent() {},
        };
      }
      return elements[id];
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(event, cb) {
      if (!docListeners[event]) docListeners[event] = [];
      docListeners[event].push(cb);
    },
    removeEventListener() {},
  };

  const chrome = {
    runtime: {
      sendMessage: jest.fn(),
      lastError: null,
    },
  };

  const fakeWindow = {
    document: fakeDoc,
    chrome,
    _listeners: {},
    addEventListener(event, cb) {
      if (!winListeners[event]) winListeners[event] = [];
      winListeners[event].push(cb);
    },
    removeEventListener() {},
  };

  // Pre-populate all elements so tests can access them
  ALL_ELEMENT_IDS.forEach(id => fakeDoc.getElementById(id));

  return { fakeDoc, fakeWindow, chrome, elements, docListeners, winListeners };
}

// Helper: run popup-full.js in a VM sandbox
function runPopupFull(sandbox) {
  const globals = {
    initPopupState: jest.fn(),
    loadThemePreference: jest.fn(),
    loadSettings: jest.fn(),
    loadApprovalMode: jest.fn(),
    loadChatHistory: jest.fn(),
    setupVoiceInput: jest.fn(),
    setupApprovalModeToggle: jest.fn(),
    showTemplatesPanel: jest.fn(),
    hideTemplatesPanel: jest.fn(),
    closeCommandPalette: jest.fn(),
    closeReportModal: jest.fn(),
    document: sandbox.fakeDoc,
    window: sandbox.fakeWindow,
    chrome: sandbox.chrome,
    console,
    setTimeout,
    Map: globalThis.Map,
    Set: globalThis.Set,
    WeakMap: globalThis.WeakMap,
    Error: globalThis.Error,
    Date: globalThis.Date,
    parseInt: globalThis.parseInt,
    encodeURIComponent: globalThis.encodeURIComponent,
    decodeURIComponent: globalThis.decodeURIComponent,
  };

  const ctx = vm.createContext(globals);
  const source = readFileSync(join(__dirname, '../popup-full.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'popup-full.js' });
  script.runInContext(ctx);

  return { ctx, globals };
}

describe('popup-full.js bootstrap', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runPopupFull(sandbox);
  });

  test('calls initPopupState on load', () => {
    expect(result.globals.initPopupState).toHaveBeenCalledTimes(1);
  });

  test('registers DOMContentLoaded listener on window', () => {
    expect(sandbox.winListeners['DOMContentLoaded']).toBeDefined();
    expect(sandbox.winListeners['DOMContentLoaded'].length).toBeGreaterThan(0);
  });

  test('DOMContentLoaded fires all init functions', () => {
    sandbox.winListeners['DOMContentLoaded'].forEach(cb => cb());

    expect(result.globals.loadThemePreference).toHaveBeenCalled();
    expect(result.globals.loadSettings).toHaveBeenCalled();
    expect(result.globals.loadApprovalMode).toHaveBeenCalled();
    expect(result.globals.loadChatHistory).toHaveBeenCalled();
    expect(result.globals.setupVoiceInput).toHaveBeenCalled();
    expect(result.globals.setupApprovalModeToggle).toHaveBeenCalled();
  });
});

describe('popup-full.js Escape key closes modals', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runPopupFull(sandbox);
  });

  test('registers keydown listener on document', () => {
    expect(sandbox.docListeners['keydown']).toBeDefined();
    expect(sandbox.docListeners['keydown'].length).toBeGreaterThan(0);
  });

  test('Escape key removes "show" class from all modals', () => {
    const modalIds = [
      'settings-modal', 'theme-modal', 'report-modal',
      'template-modal', 'template-run-modal', 'schedule-modal',
      'schedule-history-modal', 'import-modal',
    ];

    modalIds.forEach(id => {
      sandbox.elements[id].classList._classes.add('show');
    });

    sandbox.docListeners['keydown'].forEach(cb => cb({ key: 'Escape' }));

    modalIds.forEach(id => {
      expect(sandbox.elements[id].classList.contains('show')).toBe(false);
    });
  });

  test('Escape key calls closeCommandPalette', () => {
    sandbox.docListeners['keydown'].forEach(cb => cb({ key: 'Escape' }));
    expect(result.globals.closeCommandPalette).toHaveBeenCalled();
  });

  test('non-Escape key does nothing to modals', () => {
    sandbox.elements['settings-modal'].classList._classes.add('show');

    sandbox.docListeners['keydown'].forEach(cb => cb({ key: 'Enter' }));
    expect(sandbox.elements['settings-modal'].classList.contains('show')).toBe(true);
  });
});

describe('popup-full.js click outside modal closes it', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runPopupFull(sandbox);
  });

  test('registers click listener on window', () => {
    expect(sandbox.winListeners['click']).toBeDefined();
    expect(sandbox.winListeners['click'].length).toBeGreaterThan(0);
  });

  test('clicking on settings-modal backdrop removes show class', () => {
    sandbox.elements['settings-modal'].classList._classes.add('show');

    sandbox.winListeners['click'].forEach(cb => cb({ target: sandbox.elements['settings-modal'] }));
    expect(sandbox.elements['settings-modal'].classList.contains('show')).toBe(false);
  });

  test('clicking on theme-modal backdrop removes show class', () => {
    sandbox.elements['theme-modal'].classList._classes.add('show');

    sandbox.winListeners['click'].forEach(cb => cb({ target: sandbox.elements['theme-modal'] }));
    expect(sandbox.elements['theme-modal'].classList.contains('show')).toBe(false);
  });

  test('clicking on report-modal backdrop calls closeReportModal', () => {
    sandbox.winListeners['click'].forEach(cb => cb({ target: sandbox.elements['report-modal'] }));
    expect(result.globals.closeReportModal).toHaveBeenCalled();
  });

  test('clicking on schedule-modal backdrop removes show class', () => {
    sandbox.elements['schedule-modal'].classList._classes.add('show');

    sandbox.winListeners['click'].forEach(cb => cb({ target: sandbox.elements['schedule-modal'] }));
    expect(sandbox.elements['schedule-modal'].classList.contains('show')).toBe(false);
  });

  test('clicking on schedule-history-modal backdrop removes show class', () => {
    sandbox.elements['schedule-history-modal'].classList._classes.add('show');

    sandbox.winListeners['click'].forEach(cb => cb({ target: sandbox.elements['schedule-history-modal'] }));
    expect(sandbox.elements['schedule-history-modal'].classList.contains('show')).toBe(false);
  });

  test('clicking on import-modal backdrop removes show class', () => {
    sandbox.elements['import-modal'].classList._classes.add('show');

    sandbox.winListeners['click'].forEach(cb => cb({ target: sandbox.elements['import-modal'] }));
    expect(sandbox.elements['import-modal'].classList.contains('show')).toBe(false);
  });

  test('clicking a non-modal target does not close modals', () => {
    sandbox.elements['settings-modal'].classList._classes.add('show');

    sandbox.winListeners['click'].forEach(cb => cb({ target: {} }));
    expect(sandbox.elements['settings-modal'].classList.contains('show')).toBe(true);
  });
});

describe('popup-full.js templates button toggle', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runPopupFull(sandbox);

    sandbox.winListeners['DOMContentLoaded'].forEach(cb => cb());
  });

  test('templatesBtn click with panel hidden calls showTemplatesPanel', () => {
    const btn = sandbox.elements['templatesBtn'];
    sandbox.elements['templates-panel'].style.display = 'none';

    btn._listeners['click'].forEach(cb => cb());
    expect(result.globals.showTemplatesPanel).toHaveBeenCalled();
  });

  test('templatesBtn click with panel visible calls hideTemplatesPanel', () => {
    const btn = sandbox.elements['templatesBtn'];
    sandbox.elements['templates-panel'].style.display = 'flex';

    btn._listeners['click'].forEach(cb => cb());
    expect(result.globals.hideTemplatesPanel).toHaveBeenCalled();
  });
});

describe('popup-full.js schedule buttons', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    sandbox.fakeWindow.showSchedulesPanel = jest.fn();
    sandbox.fakeWindow.hideSchedulesPanel = jest.fn();
    sandbox.fakeWindow.openCreateScheduleModal = jest.fn();
    sandbox.fakeWindow._handleSaveSchedule = jest.fn();
    sandbox.fakeWindow.openImportDialog = jest.fn();
    sandbox.fakeWindow.exportAllTemplatesFile = jest.fn();

    result = runPopupFull(sandbox);
    sandbox.winListeners['DOMContentLoaded'].forEach(cb => cb());
  });

  test('createScheduleBtn click calls window.openCreateScheduleModal', () => {
    const btn = sandbox.elements['createScheduleBtn'];
    btn._listeners['click'].forEach(cb => cb());
    expect(sandbox.fakeWindow.openCreateScheduleModal).toHaveBeenCalled();
  });

  test('saveScheduleBtn click calls window._handleSaveSchedule', () => {
    const btn = sandbox.elements['saveScheduleBtn'];
    btn._listeners['click'].forEach(cb => cb());
    expect(sandbox.fakeWindow._handleSaveSchedule).toHaveBeenCalled();
  });

  test('importTemplatesBtn click calls window.openImportDialog', () => {
    const btn = sandbox.elements['importTemplatesBtn'];
    btn._listeners['click'].forEach(cb => cb());
    expect(sandbox.fakeWindow.openImportDialog).toHaveBeenCalled();
  });

  test('exportAllTemplatesBtn click calls window.exportAllTemplatesFile', () => {
    const btn = sandbox.elements['exportAllTemplatesBtn'];
    btn._listeners['click'].forEach(cb => cb());
    expect(sandbox.fakeWindow.exportAllTemplatesFile).toHaveBeenCalled();
  });

  test('closeScheduleModalBtn click removes show from schedule-modal', () => {
    const btn = sandbox.elements['closeScheduleModalBtn'];
    sandbox.elements['schedule-modal'].classList._classes.add('show');

    btn._listeners['click'].forEach(cb => cb());
    expect(sandbox.elements['schedule-modal'].classList.contains('show')).toBe(false);
  });

  test('closeHistoryModalBtn click removes show from schedule-history-modal', () => {
    const btn = sandbox.elements['closeHistoryModalBtn'];
    sandbox.elements['schedule-history-modal'].classList._classes.add('show');

    btn._listeners['click'].forEach(cb => cb());
    expect(sandbox.elements['schedule-history-modal'].classList.contains('show')).toBe(false);
  });
});
