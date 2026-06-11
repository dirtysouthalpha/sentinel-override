// Covers: stores failure result when agent start fails
// Uses dynamic imports (after jest.unstable_mockModule) because Jest ESM does
// not hoist unstable_mockModule calls — static imports would load the real module first.

import { jest } from '@jest/globals';

let storageData = {};
let _msgListeners = [];
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const key = Array.isArray(keys) ? (keys.length > 0 ? keys[0] : undefined) : keys;
        const defaultVal = keys && typeof keys === 'object' && !Array.isArray(keys) && key ? keys[key] : undefined;
        return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
    },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: { create: jest.fn(), clear: jest.fn(), get: jest.fn(async (name, cb) => { if (cb) cb(null); }) },
  notifications: { create: jest.fn() },
  runtime: {
    getURL: jest.fn((path) => 'chrome-extension://xxx/' + path),
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: {
      addListener: jest.fn((fn) => { _msgListeners.push(fn); }),
      removeListener: jest.fn(),
    },
  },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
  tabs: { query: jest.fn(), create: jest.fn(), get: jest.fn() },
};

const agentEngineMock = { startAgent: jest.fn(async () => {}), agentRunning: false };
const tabManagerMock = {
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  waitForPageLoad: jest.fn(async () => {}),
};
const templateManagerMock = {
  resolveTemplateGoal: jest.fn(async () => ({ goal: 'Test', steps: [] })),
  getTemplate: jest.fn(), listTemplates: jest.fn(async () => []), saveTemplate: jest.fn(),
  updateTemplate: jest.fn(), deleteTemplate: jest.fn(), clearTemplateCache: jest.fn()
};

// Mocks must be registered BEFORE dynamic import — not hoisted like jest.mock()
jest.unstable_mockModule('../background/agent-engine.js', () => ({
  __esModule: true,
  get startAgent() { return agentEngineMock.startAgent; },
  get agentRunning() { return agentEngineMock.agentRunning; },
}));
jest.unstable_mockModule('../background/template-manager.js', () => ({ __esModule: true, ...templateManagerMock }));
jest.unstable_mockModule('../background/tab-manager.js', () => ({
  __esModule: true,
  get getTabInfo() { return tabManagerMock.getTabInfo; },
  get waitForPageLoad() { return tabManagerMock.waitForPageLoad; },
}));

// Dynamic imports run AFTER the mock registry is populated
const { createSchedule, executeScheduledTask } = await import('../background/scheduler.js');

function restoreMocks() {
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const key = Array.isArray(keys) ? (keys.length > 0 ? keys[0] : undefined) : keys;
    const defaultVal = keys && typeof keys === 'object' && !Array.isArray(keys) && key ? keys[key] : undefined;
    return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.alarms.get.mockImplementation(async (name, cb) => { if (cb) cb(null); });
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { _msgListeners.push(fn); });
  chrome.tabs.query.mockImplementation((opts, cb) => {
    if (cb) cb([{ id: 42 }]);
    return Promise.resolve([{ id: 42 }]);
  });
  chrome.tabs.create.mockResolvedValue({ id: 1, url: 'about:blank' });
  chrome.tabs.get.mockResolvedValue({ id: 1, url: 'about:blank' });
  agentEngineMock.startAgent.mockResolvedValue(undefined);
  tabManagerMock.getTabInfo.mockResolvedValue({ url: 'https://example.com', title: 'Test' });
}

beforeEach(() => {
  storageData = {};
  _msgListeners = [];
  agentEngineMock.agentRunning = false;
  jest.clearAllMocks();
  restoreMocks();
});

describe('agent start failure path', () => {
  test('stores failure result when agent start fails', async () => {
    agentEngineMock.startAgent.mockRejectedValueOnce(new Error('Agent crashed'));

    const schedule = await createSchedule({
      name: 'Test Schedule',
      goal: 'Check the dashboard',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    await executeScheduledTask('schedule-' + schedule.id);

    const results = storageData['sentinel_schedule_results'] || {};
    const resultEntries = Object.values(results);
    expect(resultEntries.length).toBe(1);
    expect(resultEntries[0].status).toBe('failure');
    expect(resultEntries[0].error).toMatch(/Agent crashed/);
  });
});
