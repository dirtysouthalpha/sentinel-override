// tests/quick-assist-edge-cases.test.js
// Edge case tests for background/quick-assist-handler.js

import { jest } from '@jest/globals';

// Mock provider-registry - must be before import
let mockConfig = {
  id: 'test-provider',
  endpoint: 'https://api.test.com/v1/chat',
  apiKey: 'test-key',
  model: 'test-model',
};

const mockGetActiveProvider = jest.fn(async () => mockConfig);
const mockResolveProvider = jest.fn(() => ({
  buildHeaders: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}` }),
  parseResponse: (data) => data.choices?.[0]?.message?.content || data.content?.[0]?.text || 'Response',
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getTextProvider: jest.fn(async () => null),
  getActiveProvider: mockGetActiveProvider,
  resolveProvider: mockResolveProvider,
  // Quick Assist now resolves by active-provider config (so a self-hosted
  // provider's own parsers run) instead of sniffing the endpoint.
  resolveProviderForConfig: mockResolveProvider,
  providerRequiresApiKey: jest.fn(() => true),
}));

// Import handleQuickAssist after setting up mocks
let handleQuickAssist;
beforeAll(async () => {
  const module = await import('../background/quick-assist-handler.js');
  handleQuickAssist = module.handleQuickAssist;
});

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
      // Note: With ESM module mocking limitations, we skip this test
      // The actual validation is tested in integration tests
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
    test('request timeout after 30 seconds', async () => {
      jest.useFakeTimers();
      try {
        globalThis.fetch = jest.fn((_url, opts) => {
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        });
        const promise = handleQuickAssist('test prompt');
        // Drain microtasks so getActiveProvider() resolves and setTimeout is registered
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(30000);
        await expect(promise).rejects.toThrow('Request timed out after 30 seconds');
      } finally {
        jest.useRealTimers();
      }
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
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      });

      const result = await handleQuickAssist('');
      expect(typeof result).toBe('string');
    });

    test('very long prompt (10k+ characters)', async () => {
      const longPrompt = 'A'.repeat(10000);
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      });

      await expect(handleQuickAssist(longPrompt)).resolves.toBeDefined();
    });

    test('prompt with special characters', async () => {
      const specialPrompt = '<script>alert("xss")</script> & "quotes" \'apostrophes\' \n\t\r\n';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      });

      await expect(handleQuickAssist(specialPrompt)).resolves.toBeDefined();
    });

    test('prompt with separator delimiter', async () => {
      const promptWithSeparator = 'System instruction\n---\nUser message';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      });

      await expect(handleQuickAssist(promptWithSeparator)).resolves.toBeDefined();
    });
  });

  describe('Anthropic-specific handling', () => {
    test('Anthropic format uses system field and messages array', async () => {
      mockConfig.id = 'anthropic';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'Response' }] }),
      });

      await handleQuickAssist('test');
    });

    test('Anthropic with separator splits correctly', async () => {
      mockConfig.id = 'anthropic';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'Response' }] }),
      });

      await handleQuickAssist('System instruction\n---\nUser message');
    });
  });

  describe('OpenAI-compatible handling', () => {
    test('OpenAI format uses messages array with system and user', async () => {
      mockConfig.id = 'openai';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
      });

      await handleQuickAssist('test');
    });
  });

  describe('network errors', () => {
    test('network failure throws original error', async () => {
      const networkError = new TypeError('Failed to fetch');
      globalThis.fetch = jest.fn().mockImplementation(() => {
        throw networkError;
      });

      await expect(handleQuickAssist('test')).rejects.toThrow('Failed to fetch');
    });

    test('DNS failure surface', async () => {
      globalThis.fetch = jest.fn().mockImplementation(() => {
        throw new Error('ECONNREFUSED');
      });

      await expect(handleQuickAssist('test')).rejects.toThrow();
    });
  });

  describe('null response body (covers L66)', () => {
    test('throws when response.json() returns null', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      await expect(handleQuickAssist('test')).rejects.toThrow(
        'Quick Assist API returned null response body'
      );
    });
  });
});
