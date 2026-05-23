// tests/adaptive-prompts-edge-cases.test.js
// Edge case tests for background/adaptive-prompts.js error paths

import { jest } from '@jest/globals';

globalThis.chrome = {
  runtime: {
    getManifest: jest.fn(() => ({ version: '3.46.0' })),
  },
};

// Mock fetch globally
global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve({
    choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }],
  }),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  emit: jest.fn(),
  tel: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLM: jest.fn(async () => ({
    content: '{"adapted_goal": "test goal", "summary": "test summary"}',
  })),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(() => ({
    apiKey: 'test-key',
    endpoint: 'https://test.example.com/v1',
    model: 'test-model',
    supportsToolUse: false,
    buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
    buildBody: jest.fn((model, system, user, opts) => ({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      ...opts
    })),
    parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
  })),
}));

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => ({
    id: 'test',
    label: 'Test Platform',
    memoryKeyPrefix: 'test-',
    liveDataCaveats: 'Data may be delayed',
    knownGotchas: 'Login required',
    needsTargetSelection: false,
    preflightInstructions: 'Select a device first',
    rewriteInstructions: 'Use cloud paths',
    waitStrings: { loading: ['Loading...', 'Please wait'] },
    pageTypes: [{ name: 'Dashboard', hint: 'Main overview' }],
    workflowHints: [{ match: /test/i, hint: 'Test workflow' }],
  })),
  findMismatchHints: jest.fn(() => []),
}));

describe('adaptive-prompts edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rewriteGoalForPlatform validation', () => {
    test('should handle short goal', async () => {
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      const result = await rewriteGoalForPlatform('short', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('goal too short for rewrite');
    });

    test('should handle empty goal', async () => {
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      const result = await rewriteGoalForPlatform('', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('goal too short for rewrite');
    });

    test('should handle null goal', async () => {
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      const result = await rewriteGoalForPlatform(null, 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('goal too short for rewrite');
    });

    test('should handle non-string goal', async () => {
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      const result = await rewriteGoalForPlatform(12345, 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('goal too short for rewrite');
    });

    test('should handle no matching platform profile', async () => {
      const { getPlatformProfile } = await import('../background/platforms/index.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getPlatformProfile.mockReturnValueOnce(null);

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://unknown.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('no matching platform profile');
    });

    test('should handle expansion mode off with no mismatches', async () => {
      const { findMismatchHints } = await import('../background/platforms/index.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      findMismatchHints.mockReturnValueOnce([]);

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'off');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('adaptation disabled (expansionMode=off, no mismatches, no Phase 0)');
    });
  });

  describe('rewriteGoalForPlatform LLM response handling', () => {
    test('should handle LLM call returning null content', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: null } }],
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('rewriter returned empty content');
    });

    test('should handle LLM call returning undefined content', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: undefined } }],
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('rewriter returned empty content');
    });

    test('should handle empty LLM response', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn(() => ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '' } }],
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('rewriter returned empty content');
    });

    test('should handle no_adaptation_needed response', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"no_adaptation_needed": true, "reason": "Goal already correct"}' } }],
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('rewriter judged no adaptation needed: Goal already correct');
    });

    test('should handle missing adapted_goal', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"summary": "test summary"}' } }],
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('rewriter returned no adapted_goal');
    });

    test('should handle short adapted_goal', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "short"}' } }],
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('rewriter returned no adapted_goal');
    });

    test('should handle LLM call throwing error', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockRejectedValueOnce(new Error('LLM service unavailable'));

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(false);
      expect(result.error).toBe('LLM service unavailable');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('should handle successful adaptation', async () => {
      const { callLLM } = await import('../background/llm-client.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      callLLM.mockResolvedValueOnce({
        content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}',
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(true);
      expect(result.adaptedGoal).toBe('This is a properly adapted goal that is long enough');
      expect(result.summary).toBe('Test summary');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('should handle adaptation with mismatch hints', async () => {
      const { callLLM } = await import('../background/llm-client.js');
      const { findMismatchHints } = await import('../background/platforms/index.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      findMismatchHints.mockReturnValueOnce([
        { onbox: 'Settings > Network', target: 'Network > Settings' },
      ]);

      callLLM.mockResolvedValueOnce({
        content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}',
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(true);
      expect(result.mismatchHints).toEqual([{ onbox: 'Settings > Network', target: 'Network > Settings' }]);
    });
  });

  describe('rewriteGoalForPlatform technician info handling', () => {
    test('should handle technician info with name', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }],
        }),
      });

      const technicianInfo = {
        name: 'Test Tech',
        company: 'Test Company',
        phone: '555-1234',
        email: 'test@example.com',
      };

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', technicianInfo, 'light');

      expect(result.adapted).toBe(true);
    });

    test('should handle technician info with minimal data', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }],
        }),
      });

      const technicianInfo = {
        name: 'Test Tech',
      };

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', technicianInfo, 'light');

      expect(result.adapted).toBe(true);
    });

    test('should handle missing technician info', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }]
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(true);
    });
  });

  describe('rewriteGoalForPlatform expansion modes', () => {
    test('should handle full expansion mode', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }]
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'full');

      expect(result.adapted).toBe(true);
    });

    test('should handle light expansion mode', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }]
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'light');

      expect(result.adapted).toBe(true);
    });

    test('should handle off expansion mode with mismatches', async () => {
      const { getActiveProvider } = await import('../background/provider-registry.js');
      const { findMismatchHints } = await import('../background/platforms/index.js');
      const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

      findMismatchHints.mockReturnValueOnce([
        { onbox: 'Settings > Network', target: 'Network > Settings' },
      ]);

      getActiveProvider.mockResolvedValueOnce({
        apiKey: 'test-key',
        endpoint: 'https://test.example.com/v1',
        model: 'test-model',
        supportsToolUse: false,
        buildHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
        buildBody: jest.fn((model, system, user, opts) => ({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          ...opts
        })),
        parseResponse: jest.fn((data) => data?.choices?.[0]?.message?.content || data?.content || ''),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"adapted_goal": "This is a properly adapted goal that is long enough", "summary": "Test summary"}' } }]
        }),
      });

      const result = await rewriteGoalForPlatform('test goal for rewrite', 'https://example.com', null, 'off');

      // Should proceed because there are mismatches to fix
      expect(result.adapted).toBe(true);
    });
  });
});
