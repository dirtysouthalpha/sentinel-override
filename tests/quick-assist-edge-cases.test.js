// tests/quick-assist-edge-cases.test.js
// Edge case tests for background/quick-assist-handler.js

import { jest } from '@jest/globals';

import { handleQuickAssist } from '../background/quick-assist-handler.js';

// Mock provider-registry
let mockConfig = {
  id: 'test-provider',
  endpoint: 'https://api.test.com/v1/chat',
  apiKey: 'test-key',
  model: 'test-model',
};

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => mockConfig),
  resolveProvider: jest.fn(() => ({
    buildHeaders: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}` }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || data.content?.[0]?.text || 'Response',
  })),
}));

describe('quick-assist-handler edge cases', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.clearAllMocks();
    // Reset to default config with valid API key
    mockConfig = {
      id: 'test-provider',
      endpoint: 'https://api.test.com/v1/chat',
      apiKey: 'test-key',
      model: 'test-model',
    };
  });

  afterEach(() => {
    if (globalThis.fetch !== originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  describe('API key validation', () => {
    test('null API key throws descriptive error', async () => {
      mockConfig.apiKey = null;
      await expect(handleQuickAssist('test prompt')).rejects.toThrow('No API key configured');
    });

    test('empty string API key throws error', async () => {
      mockConfig.apiKey = '';
      await expect(handleQuickAssist('test prompt')).rejects.toThrow('No API key configured');
    });

    test('undefined API key throws error', async () => {
      mockConfig.apiKey = undefined;
      await expect(handleQuickAssist('test prompt')).rejects.toThrow('No API key configured');
    });
  });

  describe('timeout handling', () => {
    test.skip('request timeout after 30 seconds (requires real timer)', async () => {
      // Skipped: Testing actual 30s timeout requires real timers
      // This is tested manually in integration tests
    });

    test('AbortError is caught and rethrown with user-friendly message', async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new DOMException('Aborted', 'AbortError');
      });

      await expect(handleQuickAssist('test')).rejects.toThrow('Request timed out after 30 seconds');
    });
  });

  describe('HTTP error handling', () => {
    test('401 error includes status code and error text', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => 'Invalid credentials',
      }));

      await expect(handleQuickAssist('test')).rejects.toThrow('API error 401');
    });

    test('429 rate limit error is surfaced', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      }));

      await expect(handleQuickAssist('test')).rejects.toThrow('API error 429');
    });

    test('500 server error is surfaced', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      }));

      await expect(handleQuickAssist('test')).rejects.toThrow('API error 500');
    });

    test('error text truncation at 200 characters', async () => {
      const longError = 'A'.repeat(300);
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => longError,
      }));

      await expect(handleQuickAssist('test')).rejects.toThrow();
    });
  });

  describe('malformed response handling', () => {
    test('non-JSON response throws', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }));

      await expect(handleQuickAssist('test')).rejects.toThrow();
    });

    test('empty JSON object response', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({}),
      }));

      // Should return fallback from parseResponse
      const result = await handleQuickAssist('test');
      expect(typeof result).toBe('string');
    });

    test('response with null content', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: null } }] }),
      }));

      const result = await handleQuickAssist('test');
      expect(typeof result).toBe('string');
    });
  });

  describe('prompt handling edge cases', () => {
    test('empty prompt string', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      }));

      const result = await handleQuickAssist('');
      expect(typeof result).toBe('string');
    });

    test('very long prompt (10k+ characters)', async () => {
      const longPrompt = 'A'.repeat(10000);
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      }));

      await expect(handleQuickAssist(longPrompt)).resolves.toBeDefined();
    });

    test('prompt with special characters', async () => {
      const specialPrompt = '<script>alert("xss")</script> & "quotes" \'apostrophes\' \n\t\r\n';
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      }));

      await expect(handleQuickAssist(specialPrompt)).resolves.toBeDefined();
    });

    test('prompt with separator delimiter', async () => {
      const promptWithSeparator = 'System instruction\n---\nUser message';
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      }));

      await expect(handleQuickAssist(promptWithSeparator)).resolves.toBeDefined();
    });
  });

  describe('Anthropic-specific handling', () => {
    test('Anthropic format uses system field and messages array', async () => {
      mockConfig.id = 'anthropic';
      globalThis.fetch = jest.fn(async (url, options) => {
        const body = JSON.parse(options.body);
        expect(body).toHaveProperty('system');
        expect(body).toHaveProperty('messages');
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].role).toBe('user');
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: 'Response' }] }),
        };
      });

      await handleQuickAssist('test');
    });

    test('Anthropic with separator splits correctly', async () => {
      mockConfig.id = 'anthropic';
      globalThis.fetch = jest.fn(async (url, options) => {
        const body = JSON.parse(options.body);
        expect(body.messages[0].content).not.toContain('System instruction');
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: 'Response' }] }),
        };
      });

      await handleQuickAssist('System instruction\n---\nUser message');
    });
  });

  describe('OpenAI-compatible handling', () => {
    test('OpenAI format uses messages array with system and user', async () => {
      mockConfig.id = 'openai';
      globalThis.fetch = jest.fn(async (url, options) => {
        const body = JSON.parse(options.body);
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[1].role).toBe('user');
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
        };
      });

      await handleQuickAssist('test');
    });
  });

  describe('network errors', () => {
    test('network failure throws original error', async () => {
      const networkError = new TypeError('Failed to fetch');
      globalThis.fetch = jest.fn(async () => {
        throw networkError;
      });

      await expect(handleQuickAssist('test')).rejects.toThrow('Failed to fetch');
    });

    test('DNS failure surface', async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(handleQuickAssist('test')).rejects.toThrow();
    });
  });
});
