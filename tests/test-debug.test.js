import { jest } from '@jest/globals';

let storageData = {};
let _agentRunning = false;
let _msgListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (typeof keys === 'object' && !Array.isArray(keys)) {
          const result = {};
          for (const k of Object.keys(keys)) {
            result[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
          }
          return result;
        }
        const key = Array.isArray(keys) ? keys[0] : keys;
        return { [key]: storageData[key] !== undefined ? storageData[key] : undefined };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
      remove: jest.fn(async () => {}),
    },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: { create: jest.fn(), clear: jest.fn(), get: jest.fn(async (name, cb) => { if (cb) cb(null); }) },
  notifications: { create: jest.fn() },
  runtime: {
    getURL: jest.fn((path) => 'chrome-extension://xxx/' + path),
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: { addListener: jest.fn((fn) => { _msgListeners.push(fn); }), removeListener: jest.fn() },
  },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
  tabs: { query: jest.fn(), create: jest.fn() },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
}));

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  get agentRunning() { console.log('[MOCK] agentRunning getter called, returning:', _agentRunning); return _agentRunning; },
  startAgent: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (id, params) => 'Resolved: ' + id),
}));

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => null),
  registerInitialTab: jest.fn(),
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  waitForPageLoad: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  notifyIfEnabled: jest.fn(),
}));

const { createSchedule, executeScheduledTask } = await import('../background/scheduler.js');

test('debug agent busy', async () => {
  _agentRunning = true;
  const schedule = await createSchedule({ name: 'Test', goal: 'Check dash', type: 'once', runAt: Date.now() + 3600000 });
  console.log('[TEST] Schedule created:', schedule.id);
  console.log('[TEST] storageData keys:', Object.keys(storageData));
  
  jest.clearAllMocks();
  
  // Re-setup mocks
  chrome.storage.local.get.mockImplementation(async (keys) => {
    if (typeof keys === 'object' && !Array.isArray(keys)) {
      const result = {};
      for (const k of Object.keys(keys)) { result[k] = storageData[k] !== undefined ? storageData[k] : keys[k]; }
      return result;
    }
    const key = Array.isArray(keys) ? keys[0] : keys;
    return { [key]: storageData[key] !== undefined ? storageData[key] : undefined };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.storage.local.remove.mockImplementation(async () => {});
  chrome.alarms.get.mockImplementation(async (name, cb) => { if (cb) cb(null); });
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { _msgListeners.push(fn); });
  
  console.log('[TEST] About to call executeScheduledTask');
  await executeScheduledTask('schedule-' + schedule.id);
  console.log('[TEST] executeScheduledTask completed');
  
  const schedules = storageData['sentinel_schedules'] || {};
  console.log('[TEST] Schedule status:', schedules[schedule.id]?.lastRunStatus);
}, 10000);
