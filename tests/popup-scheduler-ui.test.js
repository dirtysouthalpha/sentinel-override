// tests/popup-scheduler-ui.test.js
// Unit tests for popup-modules/scheduler-ui.js — schedule panel UI, card rendering,
// create/toggle/delete/history handlers.
// scheduler-ui.js runs bare (no exports), so we eval in a VM sandbox with mocked DOM + chrome.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// All element IDs referenced by scheduler-ui.js
const ALL_ELEMENT_IDS = [
  'schedules-panel', 'chat-container', 'input-area', 'templates-panel',
  'templatesBtn', 'schedulerBtn', 'schedule-list', 'schedule-modal',
  'schedule-modal-title', 'sch-name', 'sch-source-type', 'sch-goal',
  'sch-type', 'sch-run-at', 'sch-interval', 'sch-time', 'sch-period',
  'sch-template-params', 'sch-template-field', 'sch-goal-field',
  'sch-once-fields', 'sch-recurring-fields', 'sch-weekly-days',
  'sch-custom-interval', 'sch-template-id', 'schedule-history-list',
  'schedule-history-modal', 'createScheduleBtn', 'saveScheduleBtn',
];

function makeElement(id) {
  const el = {
    id,
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
    checked: false,
    querySelectorAll(sel) {
      if (sel === '.sch-day-check') return { forEach: () => {} };
      return { forEach: () => {} };
    },
    querySelector(sel) {
      if (sel === 'h2') return { textContent: '' };
      return null;
    },
    dispatchEvent() {},
    appendChild() {},
    setAttribute() {},
    classListObj: {
      add(c) { el.classList._classes.add(c); },
      remove(c) { el.classList._classes.delete(c); },
    },
  };
  return el;
}

function createSandbox() {
  const elements = {};
  const docListeners = {};

  const fakeDoc = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = makeElement(id);
      }
      return elements[id];
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(event, cb) {
      if (!docListeners[event]) docListeners[event] = [];
      docListeners[event].push(cb);
    },
    removeEventListener() {},
    createElement(tag) {
      return makeElement(tag + '-' + Math.random().toString(36).slice(2, 8));
    },
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
    addEventListener() {},
    removeEventListener() {},
    openReportModal: jest.fn(),
    clearInterval: jest.fn(),
    setInterval: jest.fn(() => 12345),
  };

  // Pre-populate all elements
  ALL_ELEMENT_IDS.forEach(id => fakeDoc.getElementById(id));

  return { fakeDoc, fakeWindow, chrome, elements, docListeners };
}

function runSchedulerUI(sandbox) {
  const globals = {
    getErrorMessage: (err) => typeof err === 'string' ? err : (typeof err === 'object' && err !== null && typeof err.message === 'string' ? err.message : String(err || '')),
    escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    formatCountdown: (ts) => ts ? '5m away' : 'Not scheduled',
    relativeTime: (ts) => ts ? '2 min ago' : 'Never',
    formatDuration: (start, end) => start && end ? '30s' : '',
    showToast: jest.fn(),
    closeCommandPalette: jest.fn(),
    document: sandbox.fakeDoc,
    window: sandbox.fakeWindow,
    chrome: sandbox.chrome,
    console,
    setTimeout,
    setInterval: sandbox.fakeWindow.setInterval,
    clearInterval: sandbox.fakeWindow.clearInterval,
    Date: globalThis.Date,
    Math: globalThis.Math,
    parseInt: globalThis.parseInt,
    encodeURIComponent: globalThis.encodeURIComponent,
    decodeURIComponent: globalThis.decodeURIComponent,
    Map: globalThis.Map,
    Set: globalThis.Set,
    Error: globalThis.Error,
    JSON: globalThis.JSON,
    Promise: globalThis.Promise,
    Array: globalThis.Array,
    Object: globalThis.Object,
    String: globalThis.String,
    confirm: jest.fn(() => true),
    Event: class Event { constructor(type) { this.type = type; } },
  };

  const ctx = vm.createContext(globals);
  const source = readFileSync(join(__dirname, '../popup-modules/scheduler-ui.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'scheduler-ui.js' });
  script.runInContext(ctx);

  return { ctx, globals };
}

describe('scheduler-ui.js showSchedulesPanel', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('shows schedules panel and hides chat container', () => {
    const fn = result.globals.window.showSchedulesPanel;
    fn();

    expect(sandbox.elements['schedules-panel'].style.display).toBe('flex');
    expect(sandbox.elements['chat-container'].style.display).toBe('none');
    expect(sandbox.elements['input-area'].style.display).toBe('none');
  });

  test('adds active class to schedulerBtn', () => {
    result.globals.window.showSchedulesPanel();
    expect(sandbox.elements['schedulerBtn'].classList.contains('active')).toBe(true);
  });

  test('sends schedule_clear_badge message', () => {
    result.globals.window.showSchedulesPanel();
    expect(sandbox.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'schedule_clear_badge' }
    );
  });

  test('starts refresh interval', () => {
    result.globals.window.showSchedulesPanel();
    expect(sandbox.fakeWindow.setInterval).toHaveBeenCalled();
  });
});

describe('scheduler-ui.js hideSchedulesPanel', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('hides schedules panel and shows chat container', () => {
    result.globals.window.hideSchedulesPanel();

    expect(sandbox.elements['schedules-panel'].style.display).toBe('none');
    expect(sandbox.elements['chat-container'].style.display).toBe('flex');
  });

  test('removes active class from schedulerBtn', () => {
    sandbox.elements['schedulerBtn'].classList._classes.add('active');
    result.globals.window.hideSchedulesPanel();
    expect(sandbox.elements['schedulerBtn'].classList.contains('active')).toBe(false);
  });
});

describe('scheduler-ui.js renderScheduleCard', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('renders a once schedule with goal preview', () => {
    const schedule = {
      id: 's1', name: 'Test Schedule', enabled: true,
      type: 'once', goal: 'Check firewall status',
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Test Schedule');
    expect(html).toContain('Once');
  });

  test('renders a disabled schedule', () => {
    const schedule = {
      id: 's2', name: 'Disabled Schedule', enabled: false,
      type: 'once', goal: 'Test',
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Disabled');
  });

  test('renders weekly recurrence with days', () => {
    const schedule = {
      id: 's3', name: 'Weekly', enabled: true,
      type: 'recurring', recurrence: { interval: 'weekly', daysOfWeek: [1, 3, 5], time: '10:00' },
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Mon');
    expect(html).toContain('Wed');
    expect(html).toContain('Fri');
  });

  test('renders daily recurrence', () => {
    const schedule = {
      id: 's4', name: 'Daily', enabled: true,
      type: 'recurring', recurrence: { interval: 'daily', time: '09:30' },
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Daily at 09:30');
  });

  test('renders custom interval recurrence', () => {
    const schedule = {
      id: 's5', name: 'Custom', enabled: true,
      type: 'recurring', recurrence: { interval: 'custom', periodInMinutes: 120 },
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Every 120 minutes');
  });

  test('renders last run status badge', () => {
    const schedule = {
      id: 's6', name: 'With Status', enabled: true,
      type: 'once', goal: 'Test', lastRunStatus: 'success',
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Success');
    expect(html).toContain('schedule-status-badge success');
  });

  test('truncates long goal text', () => {
    const longGoal = 'A'.repeat(100);
    const schedule = {
      id: 's7', name: 'Long Goal', enabled: true,
      type: 'once', goal: longGoal,
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('...');
  });

  test('shows template task label when templateId set and no goal', () => {
    const schedule = {
      id: 's8', name: 'Template Task', enabled: true,
      type: 'once', templateId: 't1',
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Template task');
  });

  test('includes toggle checkbox with correct data attributes', () => {
    const schedule = {
      id: 's9', name: 'Toggle', enabled: true,
      type: 'once', goal: 'Test',
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('data-action="toggle"');
    expect(html).toContain('data-id="s9"');
    expect(html).toContain('checked');
  });

  test('includes history and delete buttons with data attributes', () => {
    const schedule = {
      id: 's10', name: 'Actions', enabled: true,
      type: 'once', goal: 'Test',
    };

    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('data-action="history"');
    expect(html).toContain('data-action="delete"');
  });
});

describe('scheduler-ui.js openCreateScheduleModal', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('sets modal title to New Schedule', () => {
    result.globals.window.openCreateScheduleModal();
    expect(sandbox.elements['schedule-modal-title'].textContent).toBe('New Schedule');
  });

  test('adds show class to schedule-modal', () => {
    result.globals.window.openCreateScheduleModal();
    expect(sandbox.elements['schedule-modal'].classList.contains('show')).toBe(true);
  });

  test('resets form fields', () => {
    result.globals.window.openCreateScheduleModal();
    expect(sandbox.elements['sch-name'].value).toBe('');
    expect(sandbox.elements['sch-type'].value).toBe('once');
    expect(sandbox.elements['sch-interval'].value).toBe('daily');
    expect(sandbox.elements['sch-time'].value).toBe('09:00');
  });
});

describe('scheduler-ui.js openCreateScheduleModalForTemplate', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('pre-selects template in dropdown after async template list loads', () => {
    // Mock sendMessage to synchronously invoke the callback with a template list
    // that includes the target template — simulates populateTemplateDropdown completing.
    sandbox.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.action === 'template_list' && cb) {
        cb({ ok: true, data: [{ id: 't1', name: 'My Template' }] });
      }
    });
    result.globals.window.openCreateScheduleModalForTemplate('t1', 'My Template');
    expect(sandbox.elements['sch-template-id'].value).toBe('t1');
  });

  test('pre-fills schedule name', () => {
    result.globals.window.openCreateScheduleModalForTemplate('t1', 'My Template');
    expect(sandbox.elements['sch-name'].value).toBe('My Template Schedule');
  });
});

describe('scheduler-ui.js renderTemplateParams', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('renders parameter rows with labels and inputs', () => {
    const params = [
      { key: 'host', label: 'Host IP', defaultValue: '192.168.1.1' },
      { key: 'port', label: 'Port', defaultValue: '443' },
    ];

    // Track appendChild calls
    const appended = [];
    const container = sandbox.elements['sch-template-params'];
    container.appendChild = (child) => { appended.push(child); };
    container.innerHTML = '';

    result.ctx.renderTemplateParams(params);

    // renderTemplateParams creates child divs and appends them
    expect(appended.length).toBe(2);
    expect(appended[0].innerHTML).toContain('Host IP');
    expect(appended[1].innerHTML).toContain('Port');
  });

  test('clears container for empty params', () => {
    result.ctx.renderTemplateParams([]);
    expect(sandbox.elements['sch-template-params'].innerHTML).toBe('');
  });
});

describe('scheduler-ui.js handleSaveSchedule validation', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('shows error when name is empty', async () => {
    sandbox.elements['sch-name'].value = '   ';

    await result.globals.window._handleSaveSchedule();

    expect(result.globals.showToast).toHaveBeenCalledWith('Schedule name is required', 'error');
  });

  test('shows error when template not selected (template source)', async () => {
    sandbox.elements['sch-name'].value = 'Test';
    sandbox.elements['sch-source-type'].value = 'template';
    sandbox.elements['sch-template-id'].value = '';

    await result.globals.window._handleSaveSchedule();

    expect(result.globals.showToast).toHaveBeenCalledWith('Please select a template', 'error');
  });

  test('shows error when goal is empty (goal source)', async () => {
    sandbox.elements['sch-name'].value = 'Test';
    sandbox.elements['sch-source-type'].value = 'goal';
    sandbox.elements['sch-goal'].value = '   ';

    await result.globals.window._handleSaveSchedule();

    expect(result.globals.showToast).toHaveBeenCalledWith('Goal is required', 'error');
  });

  test('shows error when run-at is empty (once type)', async () => {
    sandbox.elements['sch-name'].value = 'Test';
    sandbox.elements['sch-source-type'].value = 'goal';
    sandbox.elements['sch-goal'].value = 'Check VPN';
    sandbox.elements['sch-type'].value = 'once';
    sandbox.elements['sch-run-at'].value = '';

    await result.globals.window._handleSaveSchedule();

    expect(result.globals.showToast).toHaveBeenCalledWith('Please select a date and time', 'error');
  });

  test('shows error when run-at is in the past (once type)', async () => {
    sandbox.elements['sch-name'].value = 'Test';
    sandbox.elements['sch-source-type'].value = 'goal';
    sandbox.elements['sch-goal'].value = 'Check VPN';
    sandbox.elements['sch-type'].value = 'once';
    // Set to a date in the past
    sandbox.elements['sch-run-at'].value = '2020-01-01T00:00';

    await result.globals.window._handleSaveSchedule();

    expect(result.globals.showToast).toHaveBeenCalledWith('Date and time must be in the future', 'error');
  });
});

describe('scheduler-ui.js event delegation', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('schedules-panel registers click listener', () => {
    const el = sandbox.elements['schedules-panel'];
    expect(el._listeners['click']).toBeDefined();
    expect(el._listeners['click'].length).toBeGreaterThan(0);
  });

  test('schedules-panel registers change listener', () => {
    const el = sandbox.elements['schedules-panel'];
    expect(el._listeners['change']).toBeDefined();
    expect(el._listeners['change'].length).toBeGreaterThan(0);
  });

  test('does not throw when schedules-panel element is absent from DOM', () => {
    // Simulate a DOM where schedules-panel doesn't exist (getElementById returns null)
    const sandboxNullPanel = createSandbox();
    sandboxNullPanel.fakeDoc.getElementById = (id) => {
      if (id === 'schedules-panel') return null;
      return sandboxNullPanel.elements[id] || null;
    };
    expect(() => runSchedulerUI(sandboxNullPanel)).not.toThrow();
  });
});

describe('scheduler-ui.js showRunHistory', () => {
  let sandbox, result;

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('returns early without error when schedule-history-list is absent', async () => {
    // Remove schedule-history-list from the DOM so getElementById returns null
    delete sandbox.elements['schedule-history-list'];
    sandbox.fakeDoc.getElementById = (id) => {
      if (id === 'schedule-history-list') return null;
      return sandbox.elements[id] || makeElement(id);
    };

    // Re-run in a sandbox where history-list is absent
    const sb2 = createSandbox();
    const originalGetById = sb2.fakeDoc.getElementById.bind(sb2.fakeDoc);
    sb2.fakeDoc.getElementById = (id) => {
      if (id === 'schedule-history-list') return null;
      return originalGetById(id);
    };
    const r2 = runSchedulerUI(sb2);

    // showRunHistory should return early (no sendMessage, no crash)
    await expect(r2.ctx.showRunHistory('sched-1', 'My Schedule')).resolves.toBeUndefined();
    expect(sb2.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('shows run history results when modal and list are present', async () => {
    const results = [
      {
        id: 'r1', status: 'success',
        startedAt: Date.now() - 5000, completedAt: Date.now(),
        report: 'All checks passed',
      },
    ];

    sandbox.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.action === 'schedule_results') {
        cb({ ok: true, data: results });
      }
    });

    // Track what gets appended to the history list
    const appended = [];
    sandbox.elements['schedule-history-list'].appendChild = (child) => { appended.push(child); };
    sandbox.elements['schedule-history-list'].querySelectorAll = () => [];

    await result.ctx.showRunHistory('sched-1', 'My Schedule');

    // Modal should have 'show' class added
    expect(sandbox.elements['schedule-history-modal'].classList.contains('show')).toBe(true);
    // One result item was appended
    expect(appended.length).toBe(1);
  });

  test('shows empty state message when no results returned', async () => {
    sandbox.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.action === 'schedule_results') {
        cb({ ok: true, data: [] });
      }
    });

    await result.ctx.showRunHistory('sched-1', 'Empty History');

    expect(sandbox.elements['schedule-history-list'].innerHTML).toContain('No run history yet');
    expect(sandbox.elements['schedule-history-modal'].classList.contains('show')).toBe(true);
  });

  test('does not throw when schedule-history-modal is absent but list is present', async () => {
    // Sandbox where modal is absent but history list exists
    const sb3 = createSandbox();
    const origGetById3 = sb3.fakeDoc.getElementById.bind(sb3.fakeDoc);
    sb3.fakeDoc.getElementById = (id) => {
      if (id === 'schedule-history-modal') return null;
      return origGetById3(id);
    };
    const r3 = runSchedulerUI(sb3);

    sb3.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.action === 'schedule_results') {
        cb({ ok: true, data: [] });
      }
    });

    // Should complete without throwing even though the modal element is absent
    await expect(r3.ctx.showRunHistory('sched-1', 'No Modal')).resolves.toBeUndefined();
  });

  test('catch block: does not throw when sendMessage fails and schedule-history-modal is absent', async () => {
    // Sandbox where modal is absent — exercises the catch block's null guard
    const sb4 = createSandbox();
    const origGetById4 = sb4.fakeDoc.getElementById.bind(sb4.fakeDoc);
    sb4.fakeDoc.getElementById = (id) => {
      if (id === 'schedule-history-modal') return null;
      return origGetById4(id);
    };
    const r4 = runSchedulerUI(sb4);

    // Make sendMessage invoke the callback with a runtime error
    sb4.chrome.runtime.lastError = { message: 'Extension context invalidated' };
    sb4.chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      // Do not call cb — simulates a rejected promise path
      // Instead, force lastError so the reject branch fires
      cb && cb(undefined);
    });

    // Should not throw
    await expect(r4.ctx.showRunHistory('sched-fail', 'Crash Test')).resolves.toBeUndefined();
    // history list should show an error message
    expect(sb4.elements['schedule-history-list'].innerHTML).toMatch(/Error|error/);
  });

  test('catch block: shows error in list and opens modal when modal is present but sendMessage errors', async () => {
    sandbox.chrome.runtime.lastError = { message: 'Context invalidated' };
    sandbox.chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
      cb && cb(undefined);
    });

    await result.ctx.showRunHistory('sched-err', 'Error Schedule');

    // Error message written to history list
    expect(sandbox.elements['schedule-history-list'].innerHTML).toMatch(/Error|error/);
    // Modal still opens
    expect(sandbox.elements['schedule-history-modal'].classList.contains('show')).toBe(true);
  });
});

// ── Sink hardening (2026-08-23): adversarial schedule fields stay escaped ─────
// renderScheduleCard output goes straight into card.innerHTML. Schedule fields
// are user- or import-supplied, so every one of them must survive a markup
// payload without producing a tag. (Escaped text may still CONTAIN the words
// of the payload — the assertion that matters is that no raw '<img' remains.)
describe('renderScheduleCard — adversarial fields stay escaped', () => {
  let sandbox, result;
  const PAYLOAD = '"><img src=x onerror=alert(1)>';

  beforeEach(() => {
    sandbox = createSandbox();
    result = runSchedulerUI(sandbox);
  });

  test('markup in name/goal/id/time/lastRunStatus never survives raw', () => {
    const schedule = {
      id: PAYLOAD, name: PAYLOAD, enabled: true, type: 'recurring',
      goal: PAYLOAD,
      recurrence: { interval: 'daily', time: PAYLOAD },
      nextRunAt: Date.now(), lastRunAt: Date.now(), lastRunStatus: PAYLOAD,
    };
    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    // The data-id attribute value itself must open with the ESCAPED quote,
    // proving the payload could not break out of the attribute.
    expect(html).toContain('data-id="&quot;&gt;&lt;img');
  });

  test('periodInMinutes is numerically coerced, not interpolated', () => {
    const schedule = {
      id: 's', name: 'n', enabled: true, type: 'recurring',
      recurrence: { interval: 'custom', periodInMinutes: PAYLOAD },
    };
    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Every 60 minutes'); // Number(payload) || 60
    expect(html).not.toContain('<img');
  });

  test('lastRunStatus outside the whitelist maps to the unknown badge class', () => {
    const schedule = {
      id: 's', name: 'n', enabled: true, type: 'once',
      lastRunStatus: PAYLOAD,
    };
    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('schedule-status-badge unknown');
    expect(html).not.toContain('<img');
  });

  test('benign schedules still render all their fields', () => {
    const schedule = {
      id: 's9', name: 'Nightly backup check', enabled: true, type: 'recurring',
      goal: 'Verify backups completed',
      recurrence: { interval: 'daily', time: '03:30' },
      nextRunAt: Date.now(), lastRunAt: Date.now(), lastRunStatus: 'success',
    };
    const html = result.ctx.renderScheduleCard(schedule);
    expect(html).toContain('Nightly backup check');
    expect(html).toContain('Verify backups completed');
    expect(html).toContain('Daily at 03:30');
    expect(html).toContain('schedule-status-badge success');
  });
});
