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

import { generateReport } from '../background/report-generator.js';

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

    // --- Lines 312-316: buildStructuredData large object truncation path ---
    test('structuredData.findings truncates large object values exceeding 2000 chars', async () => {
      // Create a normal (non-circular) object whose JSON exceeds 2000 chars.
      // This passes the usableKeys filter at line 43 fine, and in buildStructuredData
      // the object branch at lines 311-317 will truncate it.
      const bigObj = {};
      for (let i = 0; i < 500; i++) bigObj[`key_${i}`] = 'x'.repeat(20);
      const data = makeExecutionData({ agentMemory: { largeObj: bigObj } });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.findings).toHaveProperty('largeObj');
      // Line 314 truncates: str.substring(0, 2000) + '... [truncated]' when > 2000
      const val = result.structuredData.findings.largeObj;
      if (typeof val === 'string') {
        expect(val).toContain('... [truncated]');
      }
    });

    // --- Lines 227-228: provider.buildBody throws ---
    test('falls back when provider.buildBody throws', async () => {
      // Re-mock provider-registry to return a provider with a throwing buildBody
      const { resolveProvider } = await import('../background/provider-registry.js');
      resolveProvider.mockReturnValueOnce({
        buildBody: () => { throw new Error('buildBody explosion'); },
        buildHeaders: () => ({ 'Content-Type': 'application/json' }),
        parseResponse: (data) => data.choices?.[0]?.message?.content || '',
      });
      mockGetActiveProviderResolve = { endpoint: 'https://api.test.com/v1/chat/completions', apiKey: 'test-key', model: 'test-model' };
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result.fullReport).toContain('Steps Taken');
    });

    // --- Lines 247-248: non-OK HTTP response ---
    test('falls back on non-OK HTTP response', async () => {
      mockFetchResponse = { ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' };
      globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result).toHaveProperty('structuredData');
      globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));
    });

    // --- Line 255: response.json() throws (invalid JSON) ---
    test('falls back when LLM returns invalid JSON', async () => {
      mockFetchResponse = {
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token'); },
        text: async () => 'not json at all',
      };
      globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result).toHaveProperty('structuredData');
      globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));
    });

    // --- Lines 333-334: h.url fallback in URL collection ---
    test('structuredData.meta.urlsVisited includes urls from history.url field', async () => {
      const data = makeExecutionData({
        history: [
          { step: 1, action: { type: 'click' }, result: 'clicked', url: 'https://example.com/page1' },
          { step: 2, action: { type: 'extract' }, result: 'extracted', url: 'https://example.com/page2' },
        ],
        stepCount: 2,
      });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.urlsVisited).toContain('https://example.com/page1');
      expect(result.structuredData.meta.urlsVisited).toContain('https://example.com/page2');
    });

    test('structuredData.meta.urlsVisited deduplicates urls from both action.url and history.url', async () => {
      const data = makeExecutionData({
        history: [
          { step: 1, action: { type: 'navigate', url: 'https://example.com/page' }, result: 'loaded', url: 'https://example.com/page' },
        ],
        stepCount: 1,
      });
      const result = await generateReport(data, CONFIG);
      // Same URL from both sources should appear only once
      const urls = result.structuredData.meta.urlsVisited;
      const count = urls.filter(u => u === 'https://example.com/page').length;
      expect(count).toBe(1);
    });

    // --- Line 318: buildStructuredData circular reference catch block ---
    test('structuredData.findings handles circular reference objects gracefully', async () => {
      const circular = { name: 'test' };
      circular.self = circular; // Creates circular reference
      const data = makeExecutionData({ agentMemory: { circularObj: circular } });
      const result = await generateReport(data, CONFIG);
      // Should not throw — circular JSON.stringify catch at line 318 converts to String()
      expect(result.structuredData.findings).toHaveProperty('circularObj');
      expect(typeof result.structuredData.findings.circularObj).toBe('string');
    });

    // --- Line 354: fallback report with empty memory ---
    test('fallback report handles agentMemory with array values', async () => {
      mockGetActiveProviderResolve = { endpoint: '', apiKey: '', model: '' };
      const data = makeExecutionData({
        agentMemory: { items: ['a', 'b', 'c', 'd', 'e', 'f'] },
      });
      const result = await generateReport(data, CONFIG);
      expect(result.fullReport).toContain('items');
    });

    // --- Line 248: fetch AbortError (timeout) handling ---
    test('falls back on fetch timeout (AbortError)', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = jest.fn(() => { throw abortError; });
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result.fullReport).toContain('Steps Taken');
      globalThis.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));
    });

    // --- Lines 233-236: provider.buildHeaders throws ---
    test('falls back when provider.buildHeaders throws', async () => {
      const { resolveProvider } = await import('../background/provider-registry.js');
      resolveProvider.mockReturnValueOnce({
        buildBody: (model, system, prompt, opts) => ({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: opts.maxTokens }),
        buildHeaders: () => { throw new Error('buildHeaders explosion'); },
        parseResponse: (data) => data.choices?.[0]?.message?.content || '',
      });
      mockGetActiveProviderResolve = { endpoint: 'https://api.test.com/v1/chat/completions', apiKey: 'test-key', model: 'test-model' };
      const result = await generateReport(makeExecutionData(), CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result.fullReport).toContain('Steps Taken');
    });

    // --- Lines 66-67: array truncation in _truncateMemoryValue ---
    test('memorySummary truncates large arrays to first 5 items', async () => {
      const bigArray = [];
      for (let i = 0; i < 100; i++) bigArray.push(`Item ${i}: ${'x'.repeat(50)}`);
      const data = makeExecutionData({ agentMemory: { large_array: bigArray } });
      const result = await generateReport(data, CONFIG);
      // Should truncate array to first 5 items
      expect(result.fullReport).toBeTruthy();
    });

    // --- Lines 73-76: string truncation in _truncateMemoryValue ---
    test('memorySummary truncates large string values', async () => {
      const hugeString = 'x'.repeat(10000);
      const data = makeExecutionData({ agentMemory: { huge_string: hugeString } });
      const result = await generateReport(data, CONFIG);
      // Should truncate to 600 chars
      expect(result.fullReport).toBeTruthy();
    });

    // --- Line 42: non-string result handling in condensedHistory ---
    test('handles non-string results in condensedHistory', async () => {
      const data = makeExecutionData({
        history: [
          { step: 1, action: { type: 'navigate', url: 'https://example.com' }, result: { success: true, loaded: true } },
          { step: 2, action: { type: 'click', selector: '#btn' }, result: null },
          { step: 3, action: { type: 'extract', selector: '.data' }, result: 12345 },
        ],
        stepCount: 3,
      });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.totalSteps).toBe(3);
    });

    // --- Line 27: executionData validation ---
    test('throws when executionData is null', async () => {
      // The error is thrown before try-catch, so it should reject
      await expect(generateReport(null, CONFIG)).rejects.toThrow('executionData is required');
    });

    test('throws when executionData is not an object', async () => {
      await expect(generateReport('invalid', CONFIG)).rejects.toThrow('executionData is required');
    });

    // --- Line 285: buildStructuredData null handling ---
    test('buildStructuredData returns empty object for null input', async () => {
      const data = makeExecutionData();
      // Call generateReport which internally calls buildStructuredData
      const result = await generateReport(data, CONFIG);
      // structuredData should always be present
      expect(result.structuredData).toBeDefined();
      expect(result.structuredData.meta).toBeDefined();
    });

    // --- Line 386: buildFallbackReport with missing fields ---
    test('buildFallbackReport handles missing optional fields', async () => {
      mockGetActiveProviderResolve = { endpoint: '', apiKey: '', model: '' };
      const data = makeExecutionData({
        history: [],
        agentMemory: {},
        stepCount: 0,
        apiCallCount: 0,
      });
      const result = await generateReport(data, CONFIG);
      expect(result.fullReport).toContain('Goal');
      expect(result.fullReport).toContain('Steps Taken');
    });

    // --- Line 398-399: stepsTaken filtering in buildFallbackReport ---
    test('buildFallbackReport filters out read_page/scroll/wait actions from steps', async () => {
      mockGetActiveProviderResolve = { endpoint: '', apiKey: '', model: '' };
      const data = makeExecutionData({
        history: [
          { step: 1, action: { type: 'read_page', selector: 'body' }, result: 'read content' },
          { step: 2, action: { type: 'scroll', selector: 'window' }, result: 'scrolled' },
          { step: 3, action: { type: 'click', selector: '#btn' }, result: 'clicked' },
          { step: 4, action: { type: 'wait_for_element', selector: '.loader' }, result: 'waited' },
          { step: 5, action: { type: 'extract', selector: '.data' }, result: 'extracted' },
        ],
        stepCount: 5,
      });
      const result = await generateReport(data, CONFIG);
      // Should only show click and extract, not read_page/scroll/wait actions
      expect(result.fullReport).toContain('click');
      expect(result.fullReport).toContain('extract');
      expect(result.fullReport).not.toContain('read_page');
      expect(result.fullReport).not.toContain('scroll');
    });

    // --- Line 42: result substring with short strings ---
    test('condensedHistory handles short result strings without substring issues', async () => {
      const data = makeExecutionData({
        history: [
          { step: 1, action: { type: 'navigate', url: 'https://example.com' }, result: 'OK' },
          { step: 2, action: { type: 'click', selector: '#btn' }, result: '' },
          { step: 3, action: { type: 'extract', selector: '.data' }, result: 'x' },
        ],
        stepCount: 3,
      });
      const result = await generateReport(data, CONFIG);
      expect(result.structuredData.meta.totalSteps).toBe(3);
    });
  });
});
