/**
 * Sentinel Override — Quick Assist Handler Tests
 * Tests for single-shot LLM completion requests
 */

import { jest } from '@jest/globals';

// Mock chrome.storage
let storageData = {
  active_provider: 'openai',
  api_key: 'test-key',
  api_endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4',
};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === 'string'
            ? [keys]
            : Object.keys(keys || {});
        const result = {};
        for (const k of keyList) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async (key) => { delete storageData[key]; }),
    },
  },
};

// Mock fetch
global.fetch = jest.fn();

import { handleQuickAssist } from '../background/quick-assist-handler.js';

describe('quick-assist-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset storage to default config
    storageData = {
      active_provider: 'openai',
      api_key: 'test-key',
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4',
    };
  });

  describe('handleQuickAssist', () => {
    it('should throw error when no API key is configured', async () => {
      storageData.api_key = '';

      await expect(handleQuickAssist('test prompt')).rejects.toThrow(
        'No API key configured'
      );
    });

    it('should not crash with anthropic provider when prompt has no separator', async () => {
      storageData = {
        active_provider: 'anthropic',
        api_key: 'test-key',
        api_endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-opus-20240229',
      };
      const mockResponse = {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      };
      global.fetch.mockResolvedValue(mockResponse);
      // prompt has no '\n---\n' separator — must not crash with null guard
      const result = await handleQuickAssist('plain prompt without separator');
      expect(result).toBe('ok');
    });

    it('should build Anthropic request correctly', async () => {
      storageData = {
        active_provider: 'anthropic',
        api_key: 'test-key',
        api_endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-opus-20240229',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Anthropic response' }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('Test prompt\\n---\\nContent');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.any(Object),
        })
      );

      const fetchCall = global.fetch.mock.calls[0] || [];
      const body = JSON.parse(fetchCall[1]?.body);

      expect(body).toMatchObject({
        model: 'claude-3-opus-20240229',
        max_tokens: 2000,
        temperature: 0.3,
      });

      expect(body.system).toEqual([
        { type: 'text', text: 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Be concise, actionable, and professional.' }
      ]);

      expect(result).toBe('Anthropic response');
    });

    it('should build OpenAI-compatible request correctly', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('Test prompt');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
        })
      );

      const fetchCall = global.fetch.mock.calls[0] || [];
      const body = JSON.parse(fetchCall[1]?.body);

      expect(body).toMatchObject({
        model: 'gpt-4',
        max_tokens: 2000,
        temperature: 0.3,
      });

      expect(body.messages).toEqual([
        { role: 'system', content: 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Be concise, actionable, and professional.' },
        { role: 'user', content: 'Test prompt' }
      ]);

      expect(result).toBe('OpenAI response');
    });

    it('should split prompt on --- for Anthropic', async () => {
      storageData = {
        active_provider: 'anthropic',
        api_key: 'test-key',
        api_endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-opus-20240229',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      await handleQuickAssist('System instructions\n---\nUser content');

      const fetchCall = global.fetch.mock.calls[0] || [];
      const body = JSON.parse(fetchCall[1]?.body);

      // The handler splits on --- and sends only the part after as user content
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe('User content');
    });

    it('should send full prompt if no --- separator for Anthropic', async () => {
      storageData = {
        active_provider: 'anthropic',
        api_key: 'test-key',
        api_endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-opus-20240229',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      await handleQuickAssist('Full prompt without separator');

      const fetchCall = global.fetch.mock.calls[0] || [];
      const body = JSON.parse(fetchCall[1]?.body);

      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe('Full prompt without separator');
    });

    it('should handle API error response', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      };
      global.fetch.mockResolvedValue(mockResponse);

      await expect(handleQuickAssist('test')).rejects.toThrow(
        'API error 401: Unauthorized'
      );
    });

    it('should handle API error with long error text', async () => {
      const longError = 'x'.repeat(300);
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => longError,
      };
      global.fetch.mockResolvedValue(mockResponse);

      await expect(handleQuickAssist('test')).rejects.toThrow();
      try {
        await handleQuickAssist('test');
      } catch (e) {
        expect(typeof e === 'object' && e !== null && typeof e.message === 'string' && e.message.length).toBeLessThanOrEqual(200 + 'API error 500: '.length);
      }
    });

    it('should handle API error with empty text', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => { throw new Error('text() failed'); },
      };
      global.fetch.mockResolvedValue(mockResponse);

      await expect(handleQuickAssist('test')).rejects.toThrow(
        'API error 500: '
      );
    });

    it('should parse Anthropic response correctly', async () => {
      storageData = {
        active_provider: 'anthropic',
        api_key: 'test-key',
        api_endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-opus-20240229',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Anthropic result' }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('test');

      expect(result).toBe('Anthropic result');
    });

    it('should parse OpenAI response correctly', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI result' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('test');

      expect(result).toBe('OpenAI result');
    });

    it('should include proper headers', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      await handleQuickAssist('test');

      expect(global.fetch.mock.calls.length).toBeGreaterThan(0);
      const fetchCall = global.fetch.mock.calls[0] || [];
      expect(fetchCall[1]?.headers).toMatchObject({
        'Content-Type': 'application/json',
      });
      expect(fetchCall[1]?.headers['Authorization'] || fetchCall[1]?.headers['x-api-key']).toBeDefined();
    });

    it('should handle empty prompt', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('');

      expect(result).toBe('Response');
    });

    it('should handle multi-line prompt', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const multiLinePrompt = 'Line 1\\nLine 2\\nLine 3';
      const result = await handleQuickAssist(multiLinePrompt);

      const fetchCall = global.fetch.mock.calls[0] || [];
      const body = JSON.parse(fetchCall[1]?.body);

      expect(body.messages).toHaveLength(2);
      expect(body.messages[1].content).toBe(multiLinePrompt);
      expect(result).toBe('Response');
    });

    it('should handle JSON parse error', async () => {
      const mockResponse = {
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      };
      global.fetch.mockResolvedValue(mockResponse);

      await expect(handleQuickAssist('test')).rejects.toThrow('Invalid JSON');
    });

    it('should handle streaming provider (Google)', async () => {
      storageData = {
        active_provider: 'google',
        api_key: 'test-key',
        api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        model: 'gemini-pro',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Google response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('test');

      expect(result).toBe('Google response');
    });

    it('should handle request timeout (30 seconds)', async () => {
      // Directly test the AbortError handling path
      // by mocking fetch to reject with an AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      global.fetch.mockRejectedValue(abortError);

      await expect(handleQuickAssist('test')).rejects.toThrow('Request timed out after 30 seconds');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network request failed');
      global.fetch.mockRejectedValue(networkError);

      await expect(handleQuickAssist('test')).rejects.toThrow('Network request failed');
    });

    it('should handle fetch returning non-OK status with no text method', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };
      delete mockResponse.text;
      global.fetch.mockResolvedValue(mockResponse);

      await expect(handleQuickAssist('test')).rejects.toThrow();
    });

    it('should handle DeepSeek provider (OpenAI-compatible)', async () => {
      storageData = {
        active_provider: 'deepseek',
        api_key: 'test-key',
        api_endpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'DeepSeek response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('test');

      expect(result).toBe('DeepSeek response');
    });

    it('should handle xAI provider (OpenAI-compatible)', async () => {
      storageData = {
        active_provider: 'xai',
        api_key: 'test-key',
        api_endpoint: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-beta',
      };

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'xAI response' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await handleQuickAssist('test');

      expect(result).toBe('xAI response');
    });

    it('should clear timeout on successful response', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Success' } }],
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      await handleQuickAssist('test');

      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error response', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      };
      global.fetch.mockResolvedValue(mockResponse);

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      try {
        await handleQuickAssist('test');
      } catch (e) {
        // Expected error
      }

      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });
  });
});
