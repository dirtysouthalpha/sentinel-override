// tests/report-generator.test.js
// Unit tests for background/report-generator.js pure functions and report flow.
// Mocks chrome.* APIs and provider-registry imports.

// ---------- chrome mock ----------
const storageLocal = {};
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { sendMessage: async () => {} },
};

// ---------- mocks for ESM imports ----------
const mockProvider = {
  buildBody: (model, system, prompt, opts) => ({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: opts.maxTokens }),
  buildHeaders: (key) => ({ 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }),
  parseResponse: (data) => data.choices?.[0]?.message?.content || '',
};

let mockGetActiveProviderResolve = { endpoint: 'https://api.test.com/v1/chat/completions', apiKey: 'test-key', model: 'test-model' };
let mockFetchResponse = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '## Report\n\nTest report content.' } }] }), text: async () => '' };

// We need to mock the modules before importing. Use dynamic imports with a helper.
// Since jest doesn't easily mock ESM, we'll test by re-importing with captured refs.

import { jest } from '@jest/globals';

// Mock provider-registry
jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(() => Promise.resolve(mockGetActiveProviderResolve)),
  resolveProvider: jest.fn(() => mockProvider),
}));

// Mock message-protocol
jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(),
}));

// Mock global fetch
globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));

const { generateReport } = await import('../background/report-generator.js');

// ---------- Helpers ----------
function makeExecutionData(overrides = {}) {
  return {
    goal: 'Investigate firewall settings on SonicWall',
    history: [
      { step: 1, action: { type: 'navigate', url: 'https://192.168.1.1' }, result: 'Page loaded', url: 'https://192.168.1.1' },
      { step: 2, action: { type: 'click', selector: '#login-btn' }, result: 'Clicked login' },
      { step: 3, action: { type: 'extract', selector: '.config-table' }, result: 'Extracted config data' },
    ],
    agentMemory: { firewall_rules: ['Rule 1: Allow HTTP', 'Rule 2: Deny Telnet'], firmware_version: '7.1.2' },
    agentPlan: ['Navigate to firewall', 'Extract rules', 'Summarize findings'],
    stepCount: 3,
    apiCallCount: 4,
    tabContexts: [{ label: 'SonicWall', url: 'https://192.168.1.1', hasScreenshot: true }],
    ...overrides,
  };
}

const CONFIG = { fetchTimeout: 10000 };

// ---------- Tests ----------
describe('report-generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveProviderResolve = { endpoint: 'https://api.test.com/v1/chat/completions', apiKey: 'test-key', model: 'test-model' };
    mockFetchResponse = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '## Report\n\nTest report content.' } }] }), text: async () => '' };
  });

  describe('generateReport', () => {
    test('returns summary, fullReport, structuredData, goal, timestamp', async () => {
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('fullReport');
      expect(result).toHaveProperty('structuredData');
      expect(result).toHaveProperty('goal', 'Investigate firewall settings on SonicWall');
      expect(result).toHaveProperty('timestamp');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('fullReport is a trimmed string', async () => {
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(typeof result.fullReport).toBe('string');
      expect(result.fullReport).toBe(result.fullReport.trim());
    });

    test('summary is capped at ~300 chars', async () => {
      const longReport = 'A'.repeat(500);
      mockFetchResponse = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: longReport } }] }), text: async () => '' };
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.summary.length).toBeLessThanOrEqual(303); // 300 + '...'
    });

    test('structuredData has meta with correct fields', async () => {
      const result = await generateReport(makeExecutionData(), CONFIG);
      const meta = result.structuredData.meta;
      expect(meta).toHaveProperty('version', '4.0');
      expect(meta).toHaveProperty('goal');
      expect(meta).toHaveProperty('taskType');
      expect(meta).toHaveProperty('totalSteps', 3);
      expect(meta).toHaveProperty('apiCallCount', 4);
      expect(meta).toHaveProperty('successRate');
      expect(meta).toHaveProperty('urlsVisited');
    });

    test('structuredData taskType detection works for investigation goals', async () => {
      const data = makeExecutionData({ goal: 'Investigate the firewall configuration' });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.taskType).toBe('investigation');
    });

    test('structuredData taskType detection works for briefing goals', async () => {
      const data = makeExecutionData({ goal: 'Get top 5 latest articles on cybersecurity' });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.taskType).toBe('briefing');
    });

    test('structuredData taskType detection works for comparison goals', async () => {
      const data = makeExecutionData({ goal: 'Compare Fortinet vs Palo Alto firewalls' });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.taskType).toBe('comparison');
    });

    test('structuredData taskType detection works for extraction goals', async () => {
      const data = makeExecutionData({ goal: 'Extract all DNS records from the configuration' });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.taskType).toBe('extraction');
    });

    test('structuredData taskType defaults to general', async () => {
      const data = makeExecutionData({ goal: 'Do something random' });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.taskType).toBe('general');
    });

    test('structuredData.actionBreakdown counts action types', async () => {
      const result = await generateReport(makeExecutionData(), CONFIG);
      const ab = result.structuredData.actionBreakdown;
      expect(ab.navigate).toBe(1);
      expect(ab.click).toBe(1);
      expect(ab.extract).toBe(1);
    });

    test('structuredData.findings includes agent memory entries', async () => {
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.structuredData.findings).toHaveProperty('firewall_rules');
      expect(result.structuredData.findings).toHaveProperty('firmware_version');
    });

    test('structuredData.findings truncates large values', async () => {
      const longVal = 'x'.repeat(3000);
      const data = makeExecutionData({ agentMemory: { bigKey: longVal } });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.findings.bigKey).toContain('... [truncated]');
    });

    test('structuredData.tabs maps tabContexts', async () => {
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.structuredData.tabs).toHaveLength(1);
      expect(result.structuredData.tabs[0]).toEqual({ label: 'SonicWall', url: 'https://192.168.1.1', hasScreenshot: true });
    });

    test('falls back to buildFallbackReport on LLM error', async () => {
      mockGetActiveProviderResolve = { endpoint: '', apiKey: '', model: '' };
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result.fullReport).toContain('Steps Taken');
      expect(result.goal).toBe('Investigate firewall settings on SonicWall');
    });

    test('falls back on fetch failure', async () => {
      globalThis.fetch = jest.fn(() => { throw new Error('Network error'); });
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result).toHaveProperty('structuredData');
      globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));
    });

    test('handles empty history gracefully', async () => {
      const data = makeExecutionData({ history: [], stepCount: 0, apiCallCount: 0 });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.totalSteps).toBe(0);
      expect(result.structuredData.meta.successRate).toBe(0);
    });

    test('handles empty agentMemory gracefully', async () => {
      const data = makeExecutionData({ agentMemory: {} });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.findings).toEqual({});
    });

    test('handles null agentPlan gracefully', async () => {
      const data = makeExecutionData({ agentPlan: null });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.planSteps).toBe(0);
    });

    test('handles empty tabContexts gracefully', async () => {
      const data = makeExecutionData({ tabContexts: [] });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.tabs).toEqual([]);
      expect(result.structuredData.meta.tabsUsed).toBe(0);
    });

    test('strips code fences from LLM response', async () => {
      mockFetchResponse = {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '```markdown\n## Report\n\nContent here.\n```' } }] }),
        text: async () => '',
      };
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).not.toContain('```');
      expect(result.fullReport).toContain('## Report');
    });

    test('calculates successRate with failed actions', async () => {
      const data = makeExecutionData({
        history: [
          { step: 1, action: { type: 'click' }, result: 'Element not found' },
          { step: 2, action: { type: 'navigate' }, result: 'Page loaded' },
          { step: 3, action: { type: 'extract' }, result: 'Error: timeout' },
        ],
        stepCount: 3,
      });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.failedActions).toBe(2);
      expect(result.structuredData.meta.successRate).toBe(33);
    });
  });
});
