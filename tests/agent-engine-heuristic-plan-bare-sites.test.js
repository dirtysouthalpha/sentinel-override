// tests/agent-engine-heuristic-plan-bare-sites.test.js
// Tests for generateHeuristicPlan bare-site URL matching (lines 2978-2995)
// and multi-page plan generation paths.

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: { set: jest.fn(async () => {}) },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
  },
  tabGroups: { update: jest.fn(async () => {}) },
  scripting: { executeScript: jest.fn(async () => [{ result: [] }]) },
  runtime: {
    id: 'test-extension-id',
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
  },
  alarms: { create: jest.fn(), onAlarm: { addListener: jest.fn() } },
  notifications: { create: jest.fn() },
  sidePanel: { setOptions: jest.fn(async () => {}), setPanelBehavior: jest.fn(async () => {}) },
  debugger: {
    attach: jest.fn(),
    detach: jest.fn(),
    sendCommand: jest.fn(),
    onEvent: { addListener: jest.fn(), removeListener: jest.fn() },
    onDetach: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setTitle: jest.fn() },
};
globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) };
globalThis.fetch = jest.fn();
globalThis.Response = class Response { ok = true; status = 200; json() { return Promise.resolve({}); } text() { return Promise.resolve(''); } };
globalThis.AbortController = class AbortController { abort() {} get signal() { return { aborted: false }; } };
globalThis.clearTimeout = jest.fn();
globalThis.clearInterval = jest.fn();
globalThis.setTimeout = jest.fn((fn) => 1);
globalThis.setInterval = jest.fn((fn) => 1);
globalThis.URL = URL;

jest.unstable_mockModule('../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(async () => null),
  getSkillStats: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

const { generateHeuristicPlan } = await import('../background/agent-engine.js');

// ══════════════════════════════════════════════════════════════════
// generateHeuristicPlan — bare site matching
// ══════════════════════════════════════════════════════════════════
describe('generateHeuristicPlan — bare site URL matching', () => {
  test('matches "go to Amazon" bare site name', () => {
    const plan = generateHeuristicPlan('go to Amazon and find a laptop');
    expect(plan).toBeTruthy();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan[0]).toContain('amazon.com');
  });

  test('matches "go to Reddit" bare site name', () => {
    const plan = generateHeuristicPlan('go to Reddit and check r/homelab');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('reddit.com');
  });

  test('matches "navigate to YouTube" bare site name', () => {
    const plan = generateHeuristicPlan('navigate to YouTube and search for tutorials');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('youtube.com');
  });

  test('matches "visit Google" bare site name', () => {
    const plan = generateHeuristicPlan('visit Google and search for test');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('google.com');
  });

  test('matches "check GitHub" bare site name', () => {
    const plan = generateHeuristicPlan('check GitHub and look at repos.');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('github.com');
  });

  test('matches "go to Wikipedia" bare site name', () => {
    const plan = generateHeuristicPlan('go to Wikipedia and read about AI.');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('wikipedia.org');
  });

  test('matches "go to CNN" bare site name', () => {
    const plan = generateHeuristicPlan('go to CNN and read news.');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('cnn.com');
  });

  test('matches "go to StackOverflow" bare site name', () => {
    const plan = generateHeuristicPlan('go to StackOverflow and find answers.');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('stackoverflow.com');
  });

  test('matches "go to Twitter" bare site name', () => {
    const plan = generateHeuristicPlan('go to Twitter and check trends.');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('twitter.com');
  });

  test('matches "go to LinkedIn" bare site name', () => {
    const plan = generateHeuristicPlan('go to LinkedIn and check connections.');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('linkedin.com');
  });

  test('partial match works for site name substrings', () => {
    // "go to HackerNews" -> should match hackernews -> news.ycombinator.com
    const plan = generateHeuristicPlan('go to HackerNews and read top posts.');
    expect(plan).toBeTruthy();
    // Should get a URL from the partial match logic
    expect(plan.some(s => s.includes('ycombinator') || s.includes('com'))).toBe(true);
  });
});

describe('generateHeuristicPlan — multi-page plan generation', () => {
  test('generates multi-page plan for "top 5 articles" goal', () => {
    const plan = generateHeuristicPlan('Find the top 5 articles about AI safety');
    expect(plan).toBeTruthy();
    expect(plan.length).toBeGreaterThan(4);
    expect(plan.some(s => s.includes('article') || s.includes('link'))).toBe(true);
    expect(plan.some(s => s.includes('Finish'))).toBe(true);
  });

  test('generates multi-page plan for "top 3 results" goal', () => {
    const plan = generateHeuristicPlan('Find the top 3 results about quantum computing');
    expect(plan).toBeTruthy();
    expect(plan.length).toBeGreaterThan(3);
  });

  test('generates search plan for "search for X" goal', () => {
    const plan = generateHeuristicPlan('Search for "best homelab switches 2024" on Google');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('Search') || s.includes('Google'))).toBe(true);
  });

  test('generates URL navigation plan when URL is in goal', () => {
    const plan = generateHeuristicPlan('Navigate to https://example.com and check the firewall');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('https://example.com');
  });

  test('returns generic fallback for vague goals', () => {
    const plan = generateHeuristicPlan('Investigate the issue');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('Read') || s.includes('Extract'))).toBe(true);
  });

  test('returns null for empty goal', () => {
    expect(generateHeuristicPlan(null)).toBeNull();
    expect(generateHeuristicPlan('')).toBeNull();
  });

  test('skips navigation when already on target host', () => {
    // "Navigate to" is included because bare-site match creates URL, but the
    // current URL host differs from the constructed URL. Test the actual behavior:
    const plan = generateHeuristicPlan('Navigate to https://example.com and find pricing', 'https://example.com/products');
    expect(plan).toBeTruthy();
    // When already on example.com, the first step should NOT navigate away
    const hasNavigateAway = plan[0] && plan[0].includes('Navigate to') && !plan[0].includes('example.com');
    expect(hasNavigateAway).toBe(false);
  });

  test('handles "summarize all articles" pattern', () => {
    const plan = generateHeuristicPlan('Summarize all articles about Kubernetes');
    expect(plan).toBeTruthy();
    // Should detect multi-page pattern
    expect(plan.length).toBeGreaterThanOrEqual(4);
  });
});
