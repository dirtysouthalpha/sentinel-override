// tests/provider-registry.test.js
// Unit tests for background/provider-registry.js pure functions.

import { jest } from '@jest/globals';
import {
  PROVIDERS,
  resolveProvider,
  detectProviderFromEndpoint,
  getModelSupportsVision,
  getCatalogProvider,
  PROVIDER_CATALOG,
  VISION_MODELS,
  MODEL_VISION_OVERRIDES,
  getActiveProvider,
  migrateLegacySettings,
  fetchModelsList,
} from '../background/provider-registry.js';

// ========== resolveProvider ==========

describe('resolveProvider', () => {
  test('returns anthropic provider for api.anthropic.com endpoint', () => {
    const provider = resolveProvider('https://api.anthropic.com/v1/messages');
    expect(provider.id).toBe('anthropic');
  });

  test('returns openai provider for api.openai.com endpoint', () => {
    const provider = resolveProvider('https://api.openai.com/v1/chat/completions');
    expect(provider.id).toBe('openai');
  });

  test('returns openai for OpenRouter endpoint (not api.anthropic.com)', () => {
    const provider = resolveProvider('https://openrouter.ai/api/v1/chat/completions');
    expect(provider.id).toBe('openai');
  });

  test('returns openai for local Ollama endpoint', () => {
    const provider = resolveProvider('http://localhost:11434/v1/chat/completions');
    expect(provider.id).toBe('openai');
  });

  test('returns openai for null endpoint', () => {
    const provider = resolveProvider(null);
    expect(provider.id).toBe('openai');
  });

  test('returns openai for empty string endpoint', () => {
    const provider = resolveProvider('');
    expect(provider.id).toBe('openai');
  });

  test('returns anthropic for any URL containing api.anthropic.com', () => {
    const provider = resolveProvider('https://api.anthropic.com/some/other/path');
    expect(provider.id).toBe('anthropic');
  });
});

// ========== detectProviderFromEndpoint ==========

describe('detectProviderFromEndpoint', () => {
  test('detects anthropic', () => {
    expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages')).toBe('anthropic');
  });

  test('detects openai for non-anthropic endpoints', () => {
    expect(detectProviderFromEndpoint('https://api.openai.com/v1/chat/completions')).toBe('openai');
    expect(detectProviderFromEndpoint('https://openrouter.ai/api/v1/chat/completions')).toBe('openai');
    expect(detectProviderFromEndpoint('http://localhost:11434/v1/chat/completions')).toBe('openai');
  });

  test('detects openai for null', () => {
    expect(detectProviderFromEndpoint(null)).toBe('openai');
  });

  test('detects openai for empty string', () => {
    expect(detectProviderFromEndpoint('')).toBe('openai');
  });

  test('detects openai for undefined', () => {
    expect(detectProviderFromEndpoint(undefined)).toBe('openai');
  });
});

// ========== getModelSupportsVision ==========

describe('getModelSupportsVision', () => {
  test('returns true for known vision models (claude)', () => {
    expect(getModelSupportsVision('anthropic', 'claude-sonnet-4-6')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-3-5-sonnet')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-opus-4-6')).toBe(true);
  });

  test('returns true for known vision models (openai)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-4o-mini')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-4-turbo')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-5')).toBe(true);
  });

  test('returns true for known vision models (gemini)', () => {
    expect(getModelSupportsVision('google', 'gemini-2.5-flash')).toBe(true);
    expect(getModelSupportsVision('google', 'gemini-1.5-pro')).toBe(true);
  });

  test('returns false for known non-vision models', () => {
    expect(getModelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
    expect(getModelSupportsVision('anthropic', 'claude-2')).toBe(false);
    expect(getModelSupportsVision('anthropic', 'claude-instant')).toBe(false);
  });

  test('returns false for null model', () => {
    expect(getModelSupportsVision('anthropic', null)).toBe(false);
    expect(getModelSupportsVision('openai', null)).toBe(false);
  });

  test('returns false for empty model', () => {
    expect(getModelSupportsVision('anthropic', '')).toBe(false);
  });

  test('returns null for unknown provider with unknown model', () => {
    expect(getModelSupportsVision('unknown', 'some-model')).toBeNull();
  });

  test('is case-insensitive on model names', () => {
    expect(getModelSupportsVision('openai', 'GPT-4O')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'CLAUDE-SONNET-4-6')).toBe(true);
  });

  // Extended vision model coverage
  test('o-series models support vision', () => {
    expect(getModelSupportsVision('openai', 'o4-mini')).toBe(true);
    expect(getModelSupportsVision('openai', 'o4')).toBe(true);
    expect(getModelSupportsVision('openai', 'o3')).toBe(true);
    expect(getModelSupportsVision('openai', 'o3-mini')).toBe(true);
  });

  test('gpt-4.1 supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4.1')).toBe(true);
  });

  test('gemini models support vision', () => {
    expect(getModelSupportsVision('google', 'gemini-2.0-flash')).toBe(true);
    expect(getModelSupportsVision('google', 'gemini-2.5-pro')).toBe(true);
    expect(getModelSupportsVision('google', 'gemini-1.5-flash')).toBe(true);
  });

  test('Z.ai GLM vision variants support vision', () => {
    expect(getModelSupportsVision('zai', 'glm-4.5v')).toBe(true);
    expect(getModelSupportsVision('zai', 'glm-4.6v')).toBe(true);
    expect(getModelSupportsVision('zai', 'glm-5v')).toBe(true);
  });

  test('qwen and llava vision models', () => {
    expect(getModelSupportsVision('ollama', 'qwen2-vl')).toBe(true);
    expect(getModelSupportsVision('ollama', 'qwen2.5-vl')).toBe(true);
    expect(getModelSupportsVision('ollama', 'llava')).toBe(true);
  });

  test('claude haiku models support vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-haiku-4-5-20251001')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-haiku-4-5')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-3-5-haiku')).toBe(true);
  });

  test('claude-3-opus and claude-3-sonnet support vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-opus')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-3-sonnet')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-3-haiku')).toBe(true);
  });

  test('claude-sonnet-4-5 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-sonnet-4-5')).toBe(true);
  });

  test('claude-opus-4-5 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-opus-4-5')).toBe(true);
  });

  test('raw gpt-4 defaults to true (deny regex requires hyphen suffix)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4')).toBe(true);
  });

  test('gpt-4-0314 is denied (matches gpt-4- without vision/turbo/o)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4-0314')).toBe(false);
    expect(getModelSupportsVision('openai', 'gpt-4-0613')).toBe(false);
  });

  test('gpt-4-vision and gpt-4-turbo support vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4-vision')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-4-turbo')).toBe(true);
  });

  test('davinci and babbage denied', () => {
    expect(getModelSupportsVision('openai', 'davinci-002')).toBe(false);
    expect(getModelSupportsVision('openai', 'babbage-002')).toBe(false);
  });

  test('text- models denied', () => {
    expect(getModelSupportsVision('openai', 'text-davinci-003')).toBe(false);
  });

  test('claude-3-haiku-text matches claude-3-haiku override (returns true)', () => {
    // The substring match in MODEL_VISION_OVERRIDES catches this before deny list
    expect(getModelSupportsVision('anthropic', 'claude-3-haiku-text')).toBe(true);
  });

  test('unknown anthropic model defaults to true (Claude 3+)', () => {
    expect(getModelSupportsVision('anthropic', 'claude-future-model')).toBe(true);
  });

  test('unknown openai model defaults to true', () => {
    expect(getModelSupportsVision('openai', 'gpt-future')).toBe(true);
  });

  test('partial model name match works (includes)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o-2024-05-13')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-3-5-sonnet-20241022')).toBe(true);
  });
});

// ========== VISION_MODELS config ==========

describe('VISION_MODELS', () => {
  test('anthropic has default true and deny array', () => {
    expect(VISION_MODELS.anthropic.default).toBe(true);
    expect(Array.isArray(VISION_MODELS.anthropic.deny)).toBe(true);
  });

  test('openai has default true and deny array', () => {
    expect(VISION_MODELS.openai.default).toBe(true);
    expect(Array.isArray(VISION_MODELS.openai.deny)).toBe(true);
  });
});

// ========== MODEL_VISION_OVERRIDES ==========

describe('MODEL_VISION_OVERRIDES', () => {
  test('has entries for key models', () => {
    const keys = Object.keys(MODEL_VISION_OVERRIDES);
    expect(keys.length).toBeGreaterThan(20);
    expect(MODEL_VISION_OVERRIDES['gpt-4o']).toBe(true);
    expect(MODEL_VISION_OVERRIDES['gpt-3.5-turbo']).toBe(false);
    expect(MODEL_VISION_OVERRIDES['claude-2']).toBe(false);
  });
});

// ========== PROVIDERS object shape ==========

describe('PROVIDERS', () => {
  test('has anthropic and openai entries', () => {
    expect(PROVIDERS.anthropic).toBeDefined();
    expect(PROVIDERS.openai).toBeDefined();
  });

  test('each provider has required builder functions', () => {
    for (const [, provider] of Object.entries(PROVIDERS)) {
      expect(typeof provider.buildHeaders).toBe('function');
      expect(typeof provider.buildBody).toBe('function');
      expect(typeof provider.parseResponse).toBe('function');
      expect(typeof provider.buildVisionContent).toBe('function');
    }
  });

  test('anthropic provider supports tool use', () => {
    expect(PROVIDERS.anthropic.supportsToolUse).toBe(true);
    expect(typeof PROVIDERS.anthropic.buildBodyWithTools).toBe('function');
    expect(typeof PROVIDERS.anthropic.parseToolUseResponse).toBe('function');
  });

  test('anthropic has buildBodyWithThinking and buildBodyTextWithThinking', () => {
    expect(typeof PROVIDERS.anthropic.buildBodyWithThinking).toBe('function');
    expect(typeof PROVIDERS.anthropic.buildBodyTextWithThinking).toBe('function');
  });

  test('buildHeaders returns correct content type', () => {
    const anthHeaders = PROVIDERS.anthropic.buildHeaders('test-key');
    expect(anthHeaders['Content-Type']).toBe('application/json');
    expect(anthHeaders['x-api-key']).toBe('test-key');

    const oaiHeaders = PROVIDERS.openai.buildHeaders('test-key');
    expect(oaiHeaders['Content-Type']).toBe('application/json');
    expect(oaiHeaders['Authorization']).toBe('Bearer test-key');
  });

  // Anthropic buildHeaders with thinking option
  test('anthropic buildHeaders includes beta header when thinking enabled', () => {
    const headers = PROVIDERS.anthropic.buildHeaders('key', { thinking: true });
    expect(headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
  });

  test('anthropic buildHeaders omits beta header when thinking disabled', () => {
    const headers = PROVIDERS.anthropic.buildHeaders('key', {});
    expect(headers['anthropic-beta']).toBeUndefined();
  });

  test('anthropic buildHeaders omits beta header when no opts', () => {
    const headers = PROVIDERS.anthropic.buildHeaders('key');
    expect(headers['anthropic-beta']).toBeUndefined();
  });

  // Anthropic anthropic-version header
  test('anthropic buildHeaders includes anthropic-version', () => {
    const headers = PROVIDERS.anthropic.buildHeaders('key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});

// ========== Anthropic buildBody ==========

describe('Anthropic buildBody', () => {
  const provider = PROVIDERS.anthropic;

  test('builds basic body with defaults', () => {
    const body = provider.buildBody('claude-sonnet-4-6', 'system prompt', 'user content');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(8000);
    expect(body.temperature).toBe(0.3);
    expect(body.system).toEqual([{ type: 'text', text: 'system prompt', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'user content' }]);
  });

  test('respects maxTokens option', () => {
    const body = provider.buildBody('model', 'sys', 'usr', { maxTokens: 4000 });
    expect(body.max_tokens).toBe(4000);
  });

  test('respects temperature option', () => {
    const body = provider.buildBody('model', 'sys', 'usr', { temperature: 0.7 });
    expect(body.temperature).toBe(0.7);
  });

  test('uses default temperature 0.3 when not specified', () => {
    const body = provider.buildBody('model', 'sys', 'usr');
    expect(body.temperature).toBe(0.3);
  });
});

// ========== Anthropic buildBodyWithTools ==========

describe('Anthropic buildBodyWithTools', () => {
  const provider = PROVIDERS.anthropic;

  test('builds tool-use body with tool_choice any', () => {
    const tools = [{ name: 'click', description: 'Click an element', input_schema: {} }];
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', tools);
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('uses temperature 0.1 by default', () => {
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', []);
    expect(body.temperature).toBe(0.1);
  });

  test('respects custom temperature', () => {
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', [], { temperature: 0.5 });
    expect(body.temperature).toBe(0.5);
  });

  test('respects maxTokens option', () => {
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', [], { maxTokens: 2000 });
    expect(body.max_tokens).toBe(2000);
  });

  test('caches last tool with cache_control', () => {
    const tools = [
      { name: 'click', input_schema: {} },
      { name: 'type', input_schema: {} }
    ];
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', tools);
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools[0].cache_control).toBeUndefined();
  });
});

// ========== Anthropic buildBodyWithThinking ==========

describe('Anthropic buildBodyWithThinking', () => {
  const provider = PROVIDERS.anthropic;

  test('sets temperature to 1', () => {
    const body = provider.buildBodyWithThinking('model', 'sys', 'usr', [], 5000);
    expect(body.temperature).toBe(1);
  });

  test('adds thinking config with budget', () => {
    const body = provider.buildBodyWithThinking('model', 'sys', 'usr', [], 5000);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
  });

  test('max_tokens includes thinking budget', () => {
    const body = provider.buildBodyWithThinking('model', 'sys', 'usr', [], 5000);
    expect(body.max_tokens).toBe(13000); // 8000 default + 5000
  });

  test('max_tokens includes custom maxTokens + budget', () => {
    const body = provider.buildBodyWithThinking('model', 'sys', 'usr', [], 3000, { maxTokens: 4000 });
    expect(body.max_tokens).toBe(7000); // 4000 + 3000
  });

  test('includes tools with cache_control on last tool', () => {
    const tools = [{ name: 'action', input_schema: {} }];
    const body = provider.buildBodyWithThinking('model', 'sys', 'usr', tools, 1000);
    expect(body.tools[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

// ========== Anthropic buildBodyTextWithThinking ==========

describe('Anthropic buildBodyTextWithThinking', () => {
  const provider = PROVIDERS.anthropic;

  test('sets temperature to 1', () => {
    const body = provider.buildBodyTextWithThinking('model', 'sys', 'usr', 5000);
    expect(body.temperature).toBe(1);
  });

  test('adds thinking config', () => {
    const body = provider.buildBodyTextWithThinking('model', 'sys', 'usr', 5000);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
  });

  test('max_tokens includes default 4000 + budget', () => {
    const body = provider.buildBodyTextWithThinking('model', 'sys', 'usr', 5000);
    expect(body.max_tokens).toBe(9000);
  });

  test('max_tokens uses custom maxTokens + budget', () => {
    const body = provider.buildBodyTextWithThinking('model', 'sys', 'usr', 2000, { maxTokens: 3000 });
    expect(body.max_tokens).toBe(5000);
  });

  test('does not include tools or tool_choice', () => {
    const body = provider.buildBodyTextWithThinking('model', 'sys', 'usr', 1000);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

// ========== Anthropic parseResponse ==========

describe('Anthropic parseResponse', () => {
  const provider = PROVIDERS.anthropic;

  test('extracts text from content block', () => {
    const data = { content: [{ type: 'text', text: 'Hello world' }] };
    expect(provider.parseResponse(data)).toBe('Hello world');
  });

  test('extracts text when multiple blocks present', () => {
    const data = {
      content: [
        { type: 'thinking', thinking: 'reasoning...' },
        { type: 'text', text: 'the answer' }
      ]
    };
    expect(provider.parseResponse(data)).toBe('the answer');
  });

  test('throws when no text block found', () => {
    const data = { content: [{ type: 'thinking', thinking: 'no text' }] };
    expect(() => provider.parseResponse(data)).toThrow(/no text block/);
  });

  test('throws when content is empty', () => {
    expect(() => provider.parseResponse({ content: [] })).toThrow(/no text block/);
  });
});

// ========== OpenAI parseResponse ==========

describe('OpenAI parseResponse', () => {
  const provider = PROVIDERS.openai;

  test('extracts content from choices[0].message.content', () => {
    const data = { choices: [{ message: { content: 'response text' } }] };
    expect(provider.parseResponse(data)).toBe('response text');
  });

  test('falls back to reasoning_content when content is null', () => {
    const data = {
      choices: [{
        message: { content: null, reasoning_content: 'reasoned output' }
      }]
    };
    expect(provider.parseResponse(data)).toBe('reasoned output');
  });

  test('falls back to reasoning when content is null', () => {
    const data = {
      choices: [{
        message: { content: null, reasoning: 'reasoned' }
      }]
    };
    expect(provider.parseResponse(data)).toBe('reasoned');
  });

  test('throws when no choices array', () => {
    expect(() => provider.parseResponse({ error: { message: 'bad' } })).toThrow(/no valid response/);
  });

  test('throws when choices is empty', () => {
    expect(() => provider.parseResponse({ choices: [] })).toThrow(/no valid response/);
  });

  test('throws when message is null and no reasoning', () => {
    const data = { choices: [{ message: { content: null } }] };
    expect(() => provider.parseResponse(data)).toThrow(/null content/);
  });

  test('includes error message in thrown error when available', () => {
    const data = { error: { message: 'rate limited' } };
    expect(() => provider.parseResponse(data)).toThrow(/rate limited/);
  });
});

// ========== Anthropic parseToolUseResponse ==========

describe('Anthropic parseToolUseResponse', () => {
  const provider = PROVIDERS.anthropic;

  test('extracts tool_use block name and input', () => {
    const data = {
      content: [{
        type: 'tool_use',
        name: 'click',
        input: { selector: '#btn', x: 100, y: 200 }
      }]
    };
    const result = provider.parseToolUseResponse(data);
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
    expect(result.x).toBe(100);
  });

  test('throws when no tool_use block', () => {
    const data = { content: [{ type: 'text', text: 'no tool' }] };
    expect(() => provider.parseToolUseResponse(data)).toThrow(/no tool_use block/);
  });

  test('handles tool_use among multiple blocks', () => {
    const data = {
      content: [
        { type: 'text', text: 'thinking...' },
        { type: 'tool_use', name: 'type', input: { selector: 'input', text: 'hello' } }
      ]
    };
    const result = provider.parseToolUseResponse(data);
    expect(result.type).toBe('type');
    expect(result.text).toBe('hello');
  });
});

// ========== buildVisionContent ==========

describe('buildVisionContent', () => {
  test('anthropic builds image content block', () => {
    const result = PROVIDERS.anthropic.buildVisionContent('describe this', 'base64data');
    expect(result).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'base64data' } }
    ]);
  });

  test('openai builds image_url content block', () => {
    const result = PROVIDERS.openai.buildVisionContent('describe this', 'base64data');
    expect(result).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data' } }
    ]);
  });
});

// ========== OpenAI buildBody ==========

describe('OpenAI buildBody', () => {
  const provider = PROVIDERS.openai;

  test('builds basic body with system/user messages', () => {
    const body = provider.buildBody('gpt-4o', 'system msg', 'user msg');
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([
      { role: 'system', content: 'system msg' },
      { role: 'user', content: 'user msg' }
    ]);
  });

  test('uses default maxTokens 8000', () => {
    const body = provider.buildBody('gpt-4o', 'sys', 'usr');
    expect(body.max_tokens).toBe(8000);
  });

  test('respects custom maxTokens', () => {
    const body = provider.buildBody('gpt-4o', 'sys', 'usr', { maxTokens: 2000 });
    expect(body.max_tokens).toBe(2000);
  });

  test('uses default temperature 0.3', () => {
    const body = provider.buildBody('gpt-4o', 'sys', 'usr');
    expect(body.temperature).toBe(0.3);
  });

  test('respects custom temperature', () => {
    const body = provider.buildBody('gpt-4o', 'sys', 'usr', { temperature: 0.8 });
    expect(body.temperature).toBe(0.8);
  });
});

// ========== Anthropic systemPromptTweak ==========

describe('systemPromptTweak', () => {
  test('anthropic has systemPromptTweak', () => {
    expect(typeof PROVIDERS.anthropic.systemPromptTweak).toBe('string');
    expect(PROVIDERS.anthropic.systemPromptTweak.length).toBeGreaterThan(50);
  });

  test('openai has systemPromptTweak', () => {
    expect(typeof PROVIDERS.openai.systemPromptTweak).toBe('string');
    expect(PROVIDERS.openai.systemPromptTweak).toContain('JSON');
  });
});

// ========== _cacheLastTool (via buildBodyWithTools) ==========

describe('_cacheLastTool behavior', () => {
  const provider = PROVIDERS.anthropic;

  test('empty tools array returns empty array', () => {
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', []);
    expect(body.tools).toEqual([]);
  });

  test('single tool gets cache_control', () => {
    const tools = [{ name: 'only_tool', input_schema: {} }];
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', tools);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('only last tool gets cache_control', () => {
    const tools = [
      { name: 'first', input_schema: {} },
      { name: 'second', input_schema: {} },
      { name: 'third', input_schema: {} }
    ];
    const body = provider.buildBodyWithTools('model', 'sys', 'usr', tools);
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toBeUndefined();
    expect(body.tools[2].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('does not mutate original tools array', () => {
    const tools = [{ name: 'tool', input_schema: {} }];
    const original = JSON.stringify(tools);
    provider.buildBodyWithTools('model', 'sys', 'usr', tools);
    expect(JSON.stringify(tools)).toBe(original);
  });
});

// ========== getCatalogProvider ==========

describe('getCatalogProvider', () => {
  test('returns provider by id', () => {
    const openai = getCatalogProvider('openai');
    expect(openai).not.toBeNull();
    expect(openai.id).toBe('openai');
  });

  test('returns anthropic catalog entry', () => {
    const anthropic = getCatalogProvider('anthropic');
    expect(anthropic).not.toBeNull();
    expect(anthropic.id).toBe('anthropic');
    expect(anthropic.auth).toBe('x-api-key');
  });

  test('returns google catalog entry', () => {
    const google = getCatalogProvider('google');
    expect(google).not.toBeNull();
    expect(google.id).toBe('google');
  });

  test('returns ollama catalog entry with tagsResponse', () => {
    const ollama = getCatalogProvider('ollama');
    expect(ollama).not.toBeNull();
    expect(ollama.auth).toBe('none');
    expect(ollama.tagsResponse).toBe(true);
  });

  test('returns null for unknown id', () => {
    expect(getCatalogProvider('nonexistent')).toBeNull();
  });

  test('all catalog entries have required fields', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.kind).toBe('string');
      expect(typeof entry.endpoint).toBe('string');
      expect(typeof entry.auth).toBe('string');
    }
  });

  test('all catalog entries have docsUrl', () => {
    for (const entry of PROVIDER_CATALOG) {
      if (entry.id === 'custom') continue; // custom has empty docsUrl
      expect(entry.docsUrl).toBeTruthy();
    }
  });

  test('catalog has 16 entries', () => {
    expect(PROVIDER_CATALOG).toHaveLength(16);
  });
});

// ========== PROVIDER_CATALOG specific entries ==========

describe('PROVIDER_CATALOG entries', () => {
  test('openrouter has custom headers', () => {
    const or = getCatalogProvider('openrouter');
    expect(or.headers).toBeDefined();
    expect(or.headers['HTTP-Referer']).toBe('https://sentinel-override.local');
  });

  test('perplexity has no modelsUrl', () => {
    const p = getCatalogProvider('perplexity');
    expect(p.modelsUrl).toBeNull();
  });

  test('zai has no modelsUrl', () => {
    const z = getCatalogProvider('zai');
    expect(z.modelsUrl).toBeNull();
  });

  test('lmstudio has auth none', () => {
    const lm = getCatalogProvider('lmstudio');
    expect(lm.auth).toBe('none');
  });

  test('custom entry has empty endpoint and model', () => {
    const c = getCatalogProvider('custom');
    expect(c.endpoint).toBe('');
    expect(c.defaultModel).toBe('');
    expect(c.modelsUrl).toBe('');
  });
});

// ========== getActiveProvider ==========

describe('getActiveProvider', () => {
  let storageData;

  beforeEach(() => {
    storageData = {};
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys) => Promise.resolve(
            keys.reduce((acc, k) => { if (storageData[k] !== undefined) acc[k] = storageData[k]; return acc; }, {})
          ))
        }
      }
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('returns new provider structure when active_provider and providers exist', async () => {
    storageData = {
      active_provider: 'openai',
      providers: {
        openai: {
          endpoint: 'https://api.openai.com/v1/chat/completions',
          api_key: 'sk-test',
          model: 'gpt-4o',
          max_tokens: 4000,
          temperature: 0.5
        }
      }
    };
    const result = await getActiveProvider();
    expect(result.id).toBe('openai');
    expect(result.apiKey).toBe('sk-test');
    expect(result.model).toBe('gpt-4o');
    expect(result.maxTokens).toBe(4000);
    expect(result.temperature).toBe(0.5);
  });

  test('returns anthropic from new structure', async () => {
    storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: {
          endpoint: 'https://api.anthropic.com/v1/messages',
          api_key: 'ant-key',
          model: 'claude-sonnet-4-6'
        }
      }
    };
    const result = await getActiveProvider();
    expect(result.id).toBe('anthropic');
    expect(result.apiKey).toBe('ant-key');
    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.buildHeaders).toBeDefined();
  });

  test('falls back to legacy keys when no new structure', async () => {
    storageData = {
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      api_key: 'legacy-key',
      model: 'gpt-4o-mini'
    };
    const result = await getActiveProvider();
    expect(result.id).toBe('openai');
    expect(result.apiKey).toBe('legacy-key');
    expect(result.model).toBe('gpt-4o-mini');
  });

  test('falls back to legacy anthropic endpoint', async () => {
    storageData = {
      api_endpoint: 'https://api.anthropic.com/v1/messages',
      api_key: 'ant-legacy',
      model: 'claude-sonnet-4-6'
    };
    const result = await getActiveProvider();
    expect(result.id).toBe('anthropic');
  });

  test('uses defaults when storage is empty', async () => {
    storageData = {};
    const result = await getActiveProvider();
    expect(result.id).toBe('openai');
    expect(result.maxTokens).toBe(8000);
    expect(result.temperature).toBe(0.3);
  });

  test('uses provider defaults for missing model/endpoint', async () => {
    storageData = {
      active_provider: 'openai',
      providers: {
        openai: { api_key: 'key' }
      }
    };
    const result = await getActiveProvider();
    expect(result.model).toBe('gpt-4o');
    expect(result.endpoint).toBe('https://api.openai.com/v1/chat/completions');
  });
});

// ========== migrateLegacySettings ==========

describe('migrateLegacySettings', () => {
  let storageData;
  let setCalls;
  let removeCalls;

  beforeEach(() => {
    storageData = {};
    setCalls = [];
    removeCalls = [];
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys) => Promise.resolve(
            keys.reduce((acc, k) => { if (storageData[k] !== undefined) acc[k] = storageData[k]; return acc; }, {})
          )),
          set: jest.fn((obj) => { setCalls.push(obj); return Promise.resolve(); }),
          remove: jest.fn((keys) => { removeCalls.push(keys); return Promise.resolve(); })
        }
      }
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('does nothing when providers already exist', async () => {
    storageData = { providers: { openai: {} } };
    await migrateLegacySettings();
    expect(setCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });

  test('migrates openai legacy config', async () => {
    storageData = {
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      api_key: 'sk-test',
      model: 'gpt-4o-mini'
    };
    await migrateLegacySettings();
    expect(setCalls).toHaveLength(1);
    const setObj = setCalls[0];
    expect(setObj.active_provider).toBe('openai');
    expect(setObj.providers.openai.api_key).toBe('sk-test');
    expect(setObj.providers.openai.model).toBe('gpt-4o-mini');
    expect(setObj.providers.anthropic.api_key).toBe('');
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]).toEqual(['api_endpoint', 'api_key', 'model']);
  });

  test('migrates anthropic legacy config', async () => {
    storageData = {
      api_endpoint: 'https://api.anthropic.com/v1/messages',
      api_key: 'ant-key',
      model: 'claude-sonnet-4-6'
    };
    await migrateLegacySettings();
    const setObj = setCalls[0];
    expect(setObj.active_provider).toBe('anthropic');
    expect(setObj.providers.anthropic.api_key).toBe('ant-key');
    expect(setObj.providers.openai.api_key).toBe('');
  });

  test('migrates with empty storage (defaults)', async () => {
    storageData = {};
    await migrateLegacySettings();
    const setObj = setCalls[0];
    expect(setObj.active_provider).toBe('openai');
    expect(setObj.providers.openai.endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(setObj.providers.anthropic.endpoint).toBe('https://api.anthropic.com/v1/messages');
  });

  test('uses legacy model for openai, default for anthropic', async () => {
    storageData = {
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      api_key: 'sk-test',
      model: 'gpt-3.5-turbo'
    };
    await migrateLegacySettings();
    const setObj = setCalls[0];
    expect(setObj.providers.openai.model).toBe('gpt-3.5-turbo');
    expect(setObj.providers.anthropic.model).toBe('claude-sonnet-4-6');
  });
});

// ========== fetchModelsList ==========

describe('fetchModelsList', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('throws when no provider given', async () => {
    await expect(fetchModelsList(null)).rejects.toThrow(/No provider given/);
  });

  test('throws when provider has no modelsUrl', async () => {
    const provider = { label: 'TestProvider', modelsUrl: null };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow(/does not expose a \/models endpoint/);
  });

  test('throws when provider has empty modelsUrl', async () => {
    const provider = { label: 'TestProvider', modelsUrl: '' };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow(/does not expose a \/models endpoint/);
  });

  test('parses OpenAI-style response { data: [{id}] }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })
    });
    const provider = { modelsUrl: 'https://api.test.com/v1/models', auth: 'bearer' };
    const result = await fetchModelsList(provider, 'key');
    expect(result).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  test('parses Ollama-style tagsResponse { models: [{name}] }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'llama3:latest' }, { name: 'mistral:latest' }] })
    });
    const provider = { modelsUrl: 'http://localhost:11434/api/tags', auth: 'none', tagsResponse: true };
    const result = await fetchModelsList(provider, '');
    expect(result).toEqual(['llama3:latest', 'mistral:latest']);
  });

  test('parses { models: [{id}] } response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ id: 'model-a' }, { id: 'model-b' }] })
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    const result = await fetchModelsList(provider, 'key');
    expect(result).toEqual(['model-a', 'model-b']);
  });

  test('parses plain array response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(['model-x', 'model-y'])
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    const result = await fetchModelsList(provider, 'key');
    expect(result).toEqual(['model-x', 'model-y']);
  });

  test('sorts results alphabetically', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'm-model' }] })
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    const result = await fetchModelsList(provider, 'key');
    expect(result).toEqual(['a-model', 'm-model', 'z-model']);
  });

  test('sends bearer auth header when auth is bearer', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] })
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    await fetchModelsList(provider, 'my-key');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-key' })
      })
    );
  });

  test('sends x-api-key header when auth is x-api-key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] })
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'x-api-key' };
    await fetchModelsList(provider, 'my-key');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'my-key' })
      })
    );
  });

  test('merges provider custom headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] })
    });
    const provider = {
      modelsUrl: 'https://api.test.com/models',
      auth: 'bearer',
      headers: { 'X-Custom': 'value' }
    };
    await fetchModelsList(provider, 'key');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Custom': 'value' })
      })
    );
  });

  test('uses customModelsUrl over provider.modelsUrl', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] })
    });
    const provider = { modelsUrl: 'https://default.com/models', auth: 'bearer' };
    await fetchModelsList(provider, 'key', 'https://custom.com/models');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.com/models',
      expect.any(Object)
    );
  });

  test('throws on network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow(/Network error/);
  });

  test('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited')
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow(/returned 429/);
  });

  test('throws when response is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('invalid json'))
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow(/did not return JSON/);
  });

  test('throws when response has no parseable models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', message: 'no models here' })
    });
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow(/Could not parse models/);
  });

  test('does not send auth header when auth is none', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] })
    });
    const provider = { modelsUrl: 'http://localhost:11434/api/tags', auth: 'none', tagsResponse: true };
    await fetchModelsList(provider, '');
    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBeUndefined();
    expect(callArgs.headers['x-api-key']).toBeUndefined();
  });

  test('handles timeout via AbortController', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, opts) => new Promise((_resolve, reject) => {
      // Simulate abort
      setTimeout(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, 100);
    }));
    const provider = { modelsUrl: 'https://api.test.com/models', auth: 'bearer' };
    const promise = fetchModelsList(provider, 'key');
    jest.advanceTimersByTime(15000);
    await expect(promise).rejects.toThrow();
    jest.useRealTimers();
  });
});

// ========== getActiveProvider — error handling ==========

describe('getActiveProvider — storage failure handling', () => {
  beforeEach(() => {
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(() => Promise.reject(new Error('storage unavailable')))
        }
      }
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('returns defaults when storage.get rejects', async () => {
    const result = await getActiveProvider();
    expect(result).toBeDefined();
    expect(result.id).toBe('openai');
    expect(result.maxTokens).toBe(8000);
    expect(result.temperature).toBe(0.3);
  });
});

// ========== migrateLegacySettings — error handling ==========

describe('migrateLegacySettings — error handling', () => {
  let setCalls;
  let removeCalls;

  afterEach(() => {
    delete global.chrome;
  });

  test('returns early when storage.get rejects', async () => {
    setCalls = [];
    removeCalls = [];
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(() => Promise.reject(new Error('storage unavailable'))),
          set: jest.fn((obj) => { setCalls.push(obj); return Promise.resolve(); }),
          remove: jest.fn((keys) => { removeCalls.push(keys); return Promise.resolve(); })
        }
      }
    };
    await migrateLegacySettings();
    expect(setCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });

  test('catches storage.set rejection during migration', async () => {
    const storageData = {
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      api_key: 'sk-test',
      model: 'gpt-4o'
    };
    setCalls = [];
    removeCalls = [];
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys) => Promise.resolve(
            keys.reduce((acc, k) => { if (storageData[k] !== undefined) acc[k] = storageData[k]; return acc; }, {})
          )),
          set: jest.fn(() => Promise.reject(new Error('quota exceeded'))),
          remove: jest.fn((keys) => { removeCalls.push(keys); return Promise.resolve(); })
        }
      }
    };
    await expect(migrateLegacySettings()).resolves.toBeUndefined();
  });

  test('catches storage.remove rejection during migration', async () => {
    const storageData = {
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      api_key: 'sk-test',
      model: 'gpt-4o'
    };
    setCalls = [];
    removeCalls = [];
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys) => Promise.resolve(
            keys.reduce((acc, k) => { if (storageData[k] !== undefined) acc[k] = storageData[k]; return acc; }, {})
          )),
          set: jest.fn((obj) => { setCalls.push(obj); return Promise.resolve(); }),
          remove: jest.fn(() => Promise.reject(new Error('remove failed')))
        }
      }
    };
    await expect(migrateLegacySettings()).resolves.toBeUndefined();
  });
});
