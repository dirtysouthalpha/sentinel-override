// Sentinel Override v3 -- Unit tests for background/provider-registry.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';
import {
  PROVIDERS, resolveProvider, detectProviderFromEndpoint,
  getActiveProvider, migrateLegacySettings,
} from '../../background/provider-registry.js';

describe('provider-registry', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
  });

  describe('PROVIDERS', () => {
    it('has anthropic provider defined', () => {
      expect(PROVIDERS.anthropic).toBeDefined();
      expect(PROVIDERS.anthropic.id).toBe('anthropic');
      expect(PROVIDERS.anthropic.name).toBe('Anthropic Claude');
      expect(PROVIDERS.anthropic.buildHeaders).toBeInstanceOf(Function);
      expect(PROVIDERS.anthropic.buildBody).toBeInstanceOf(Function);
      expect(PROVIDERS.anthropic.parseResponse).toBeInstanceOf(Function);
    });

    it('has openai provider defined', () => {
      expect(PROVIDERS.openai).toBeDefined();
      expect(PROVIDERS.openai.id).toBe('openai');
      expect(PROVIDERS.openai.name).toBe('OpenAI');
      expect(PROVIDERS.openai.buildHeaders).toBeInstanceOf(Function);
      expect(PROVIDERS.openai.buildBody).toBeInstanceOf(Function);
      expect(PROVIDERS.openai.parseResponse).toBeInstanceOf(Function);
    });
  });

  describe('resolveProvider', () => {
    it('returns anthropic provider for api.anthropic.com endpoint', () => {
      const provider = resolveProvider('https://api.anthropic.com/v1/messages');
      expect(provider.id).toBe('anthropic');
    });

    it('returns openai provider for other endpoints', () => {
      const provider = resolveProvider('https://api.openai.com/v1/chat/completions');
      expect(provider.id).toBe('openai');
    });

    it('returns openai provider for OpenRouter', () => {
      const provider = resolveProvider('https://openrouter.ai/api/v1/chat/completions');
      expect(provider.id).toBe('openai');
    });
  });

  describe('detectProviderFromEndpoint', () => {
    it('returns "anthropic" for api.anthropic.com', () => {
      expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages')).toBe('anthropic');
    });

    it('returns "openai" for other endpoints', () => {
      expect(detectProviderFromEndpoint('https://api.openai.com/v1/chat/completions')).toBe('openai');
    });
  });

  describe('buildHeaders', () => {
    it('builds Anthropic headers with x-api-key', () => {
      const headers = PROVIDERS.anthropic.buildHeaders('sk-ant-123');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-api-key']).toBe('sk-ant-123');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('builds OpenAI headers with Bearer token', () => {
      const headers = PROVIDERS.openai.buildHeaders('sk-openai-456');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer sk-openai-456');
    });
  });

  describe('buildBody', () => {
    it('builds Anthropic body with system as top-level field', () => {
      const body = PROVIDERS.anthropic.buildBody('claude-haiku-4-5-20251001', 'System prompt', 'User content');
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.system).toBe('System prompt');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toBe('User content');
      expect(body.max_tokens).toBe(8000);
    });

    it('builds OpenAI body with system in messages array', () => {
      const body = PROVIDERS.openai.buildBody('gpt-4o', 'System prompt', 'User content');
      expect(body.model).toBe('gpt-4o');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('System prompt');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('User content');
    });

    it('respects custom maxTokens and temperature', () => {
      const body = PROVIDERS.openai.buildBody('gpt-4o', 'Sys', 'User', { maxTokens: 4000, temperature: 0.5 });
      expect(body.max_tokens).toBe(4000);
      expect(body.temperature).toBe(0.5);
    });
  });

  describe('parseResponse', () => {
    it('parses Anthropic response with text block', () => {
      const data = { content: [{ type: 'text', text: 'Hello from Claude' }] };
      expect(PROVIDERS.anthropic.parseResponse(data)).toBe('Hello from Claude');
    });

    it('throws for Anthropic response with no text block', () => {
      const data = { content: [{ type: 'image' }] };
      expect(() => PROVIDERS.anthropic.parseResponse(data)).toThrow('no text block');
    });

    it('parses OpenAI response with choices', () => {
      const data = { choices: [{ message: { content: 'Hello from GPT' } }] };
      expect(PROVIDERS.openai.parseResponse(data)).toBe('Hello from GPT');
    });

    it('throws for OpenAI response with no choices', () => {
      const data = { choices: [] };
      expect(() => PROVIDERS.openai.parseResponse(data)).toThrow('no valid response');
    });
  });

  describe('getActiveProvider', () => {
    it('reads from new per-provider structure', async () => {
      await chromeMock.storage.local.set({
        active_provider: 'anthropic',
        providers: {
          anthropic: { api_key: 'sk-ant-test', model: 'claude-haiku-4-5-20251001', endpoint: 'https://api.anthropic.com/v1/messages' },
        },
      });

      const config = await getActiveProvider();
      expect(config.id).toBe('anthropic');
      expect(config.apiKey).toBe('sk-ant-test');
      expect(config.model).toBe('claude-haiku-4-5-20251001');
    });

    it('falls back to legacy single-provider keys', async () => {
      await chromeMock.storage.local.set({
        api_endpoint: 'https://api.openai.com/v1/chat/completions',
        api_key: 'sk-openai-test',
        model: 'gpt-4o',
      });

      const config = await getActiveProvider();
      expect(config.id).toBe('openai');
      expect(config.apiKey).toBe('sk-openai-test');
    });
  });

  describe('migrateLegacySettings', () => {
    it('does nothing when providers already exist', async () => {
      await chromeMock.storage.local.set({
        providers: { anthropic: { api_key: 'existing' } },
        api_endpoint: 'https://old-endpoint.com',
      });

      await migrateLegacySettings();

      const stored = await chromeMock.storage.local.get(['api_endpoint', 'api_key', 'model']);
      // Old keys should NOT have been removed since migration was skipped
      expect(stored.api_endpoint).toBe('https://old-endpoint.com');
    });

    it('migrates legacy keys to per-provider structure', async () => {
      await chromeMock.storage.local.set({
        api_endpoint: 'https://api.openai.com/v1/chat/completions',
        api_key: 'sk-openai-legacy',
        model: 'gpt-4o-mini',
      });

      await migrateLegacySettings();

      const stored = await chromeMock.storage.local.get(['active_provider', 'providers', 'api_endpoint', 'api_key']);
      expect(stored.active_provider).toBe('openai');
      expect(stored.providers.openai.api_key).toBe('sk-openai-legacy');
      expect(stored.providers.openai.model).toBe('gpt-4o-mini');
      // Old keys should be removed
      expect(stored.api_endpoint).toBeUndefined();
      expect(stored.api_key).toBeUndefined();
    });

    it('creates both provider entries during migration', async () => {
      await chromeMock.storage.local.set({
        api_endpoint: 'https://api.anthropic.com/v1/messages',
        api_key: 'sk-ant-test',
      });

      await migrateLegacySettings();

      const stored = await chromeMock.storage.local.get(['providers']);
      expect(stored.providers.anthropic).toBeDefined();
      expect(stored.providers.openai).toBeDefined();
    });
  });

  describe('buildVisionContent', () => {
    it('builds Anthropic vision content with image source', () => {
      const content = PROVIDERS.anthropic.buildVisionContent('Describe this', 'base64data');
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe('text');
      expect(content[1].type).toBe('image');
      expect(content[1].source.type).toBe('base64');
      expect(content[1].source.data).toBe('base64data');
    });

    it('builds OpenAI vision content with image_url', () => {
      const content = PROVIDERS.openai.buildVisionContent('Describe this', 'base64data');
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe('text');
      expect(content[1].type).toBe('image_url');
      expect(content[1].image_url.url).toContain('base64,base64data');
    });
  });
});
