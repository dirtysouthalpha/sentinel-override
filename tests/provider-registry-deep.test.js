// tests/provider-registry-deep.test.js
// Deep coverage for provider-registry.js uncovered lines:
// - getModelSupportsVision deny lists, per-model overrides, null provider
// - resolveProvider edge cases
// - detectProviderFromEndpoint edge cases
// - getActiveProvider fallback paths
// - migrateLegacySettings edge cases
// - fetchModelsList error paths and response shapes
// - getCatalogProvider
// - PROVIDERS parseResponse / parseToolUseResponse auth errors

import { jest } from '@jest/globals';

const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        for (const k of (Array.isArray(keys) ? keys : [keys])) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: jest.fn(async (data) => Object.assign(storageData, data)),
      remove: jest.fn(async (keys) => {
        for (const k of (Array.isArray(keys) ? keys : [keys])) delete storageData[k];
      }),
    },
  },
  runtime: { id: 'test' },
};
globalThis.fetch = jest.fn();

function mockFetchOk(jsonData) {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(jsonData),
    json: async () => jsonData,
  });
}

function mockFetchError(status, body) {
  globalThis.fetch.mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  });
}

function mockFetchNetworkError(msg) {
  globalThis.fetch.mockRejectedValue(new Error(msg));
}

function mockFetchJsonError() {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => 'not json at all',
    json: async () => { throw new SyntaxError('Unexpected token'); },
  });
}

function mockFetchNullBody() {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => 'null',
    json: async () => null,
  });
}

const {
  getModelSupportsVision,
  resolveProvider,
  detectProviderFromEndpoint,
  getActiveProvider,
  migrateLegacySettings,
  fetchModelsList,
  getCatalogProvider,
  PROVIDERS,
  PROVIDER_CATALOG,
} = await import('../background/provider-registry.js');

describe('getModelSupportsVision — deny list paths', () => {
  test('Anthropic deny: claude-3-haiku-text exact model denied (explicit override wins)', () => {
    // MODEL_VISION_OVERRIDES has 'claude-3-haiku-text': false which is more specific
    // than 'claude-3-haiku': true, so the explicit deny wins due to longer key length
    const result = getModelSupportsVision('anthropic', 'claude-3-haiku-text');
    expect(result).toBe(false); // Explicit 'claude-3-haiku-text': false override wins
  });

  test('Anthropic deny: exact regex match without override wins', () => {
    // claude-3-haiku-text-only has no substring override match but matches deny
    // Actually this string still matches "claude-3-haiku" as substring (>= 5 chars)
    // So let's test with a string that matches deny but no override
    expect(getModelSupportsVision('anthropic', 'claude-2')).toBe(false);
  });

  test('Anthropic deny: claude-2', () => {
    expect(getModelSupportsVision('anthropic', 'claude-2')).toBe(false);
  });

  test('Anthropic deny: claude-instant', () => {
    expect(getModelSupportsVision('anthropic', 'claude-instant')).toBe(false);
  });

  test('Anthropic default: unknown model gets true', () => {
    expect(getModelSupportsVision('anthropic', 'some-unknown-model')).toBe(true);
  });

  test('OpenAI deny: gpt-3.5-turbo', () => {
    expect(getModelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
  });

  test('OpenAI deny: gpt-4-0314 (raw, non-vision)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4-0314')).toBe(false);
  });

  test('OpenAI deny: text-davinci-003', () => {
    expect(getModelSupportsVision('openai', 'text-davinci-003')).toBe(false);
  });

  test('OpenAI deny: davinci', () => {
    expect(getModelSupportsVision('openai', 'davinci')).toBe(false);
  });

  test('OpenAI deny: babbage', () => {
    expect(getModelSupportsVision('openai', 'babbage-002')).toBe(false);
  });

  test('OpenAI default: unknown model gets true', () => {
    expect(getModelSupportsVision('openai', 'my-custom-model')).toBe(true);
  });

  test('Per-model override: gpt-4o is true', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o')).toBe(true);
  });

  test('Per-model override: gpt-3.5-turbo is false', () => {
    expect(getModelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
  });

  test('Per-model override: glm-4.5v is true', () => {
    expect(getModelSupportsVision('zai', 'glm-4.5v')).toBe(true);
  });

  test('Per-model override: glm-5 is true', () => {
    expect(getModelSupportsVision('zai', 'glm-5')).toBe(true);
  });

  test('Per-model override: o3 is true', () => {
    expect(getModelSupportsVision('openai', 'o3')).toBe(true);
  });

  test('Per-model override: o3-mini is true', () => {
    expect(getModelSupportsVision('openai', 'o3-mini')).toBe(true);
  });

  test('Per-model override: o4 is true', () => {
    expect(getModelSupportsVision('openai', 'o4')).toBe(true);
  });

  test('Per-model override: o4-mini is true', () => {
    expect(getModelSupportsVision('openai', 'o4-mini')).toBe(true);
  });

  test('Per-model override: gemini-2.5-pro is true', () => {
    expect(getModelSupportsVision('google', 'gemini-2.5-pro')).toBe(true);
  });

  test('Per-model override: gemini-2.5-flash is true', () => {
    expect(getModelSupportsVision('google', 'gemini-2.5-flash')).toBe(true);
  });

  test('Per-model override: claude-2 is false', () => {
    expect(getModelSupportsVision('anthropic', 'claude-2')).toBe(false);
  });

  test('Per-model override: claude-instant is false', () => {
    expect(getModelSupportsVision('anthropic', 'claude-instant')).toBe(false);
  });

  test('Null model returns false', () => {
    expect(getModelSupportsVision('openai', null)).toBe(false);
  });

  test('Empty model returns false', () => {
    expect(getModelSupportsVision('openai', '')).toBe(false);
  });

  test('Unknown provider returns null (no opinion)', () => {
    expect(getModelSupportsVision('unknown-provider', 'some-model')).toBe(null);
  });

  test('Case insensitive: GPT-4O matches override', () => {
    expect(getModelSupportsVision('openai', 'GPT-4O')).toBe(true);
  });

  test('Substring matching for long keys: glm-4.5v-plus matches glm-4.5v', () => {
    expect(getModelSupportsVision('zai', 'glm-4.5v-plus')).toBe(true);
  });

  test('Short prefix matching: o3-mini matches o3', () => {
    expect(getModelSupportsVision('openai', 'o3-mini')).toBe(true);
  });

  test('qwen2-vl override', () => {
    expect(getModelSupportsVision('qwen', 'qwen2-vl-7b')).toBe(true);
  });

  test('llava override', () => {
    expect(getModelSupportsVision('llava', 'llava-1.5')).toBe(true);
  });
});

describe('resolveProvider — edge cases', () => {
  test('null endpoint returns openai', () => {
    const result = resolveProvider(null);
    expect(result.id).toBe('openai');
  });

  test('empty string returns openai', () => {
    const result = resolveProvider('');
    expect(result.id).toBe('openai');
  });

  test('undefined returns openai', () => {
    const result = resolveProvider(undefined);
    expect(result.id).toBe('openai');
  });

  test('anthropic endpoint', () => {
    const result = resolveProvider('https://api.anthropic.com/v1/messages');
    expect(result.id).toBe('anthropic');
  });

  test('z.ai endpoint', () => {
    const result = resolveProvider('https://api.z.ai/api/coding/paas/v4/chat/completions');
    expect(result.id).toBe('zai');
  });

  test('z.ai without api prefix', () => {
    const result = resolveProvider('https://z.ai/v1/chat');
    expect(result.id).toBe('zai');
  });

  test('unknown endpoint returns openai', () => {
    const result = resolveProvider('https://custom-llm.example.com/v1/chat');
    expect(result.id).toBe('openai');
  });
});

describe('detectProviderFromEndpoint — edge cases', () => {
  test('null returns openai', () => {
    expect(detectProviderFromEndpoint(null)).toBe('openai');
  });

  test('empty returns openai', () => {
    expect(detectProviderFromEndpoint('')).toBe('openai');
  });

  test('anthropic detected', () => {
    expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages')).toBe('anthropic');
  });

  test('z.ai detected', () => {
    expect(detectProviderFromEndpoint('https://api.z.ai/v1/chat')).toBe('zai');
  });

  test('unknown returns openai', () => {
    expect(detectProviderFromEndpoint('https://custom.example.com/v1')).toBe('openai');
  });
});

describe('getActiveProvider — fallback paths', () => {
  beforeEach(() => {
    for (const k of Object.keys(storageData)) delete storageData[k];
  });

  test('no stored data returns openai defaults', async () => {
    const result = await getActiveProvider();
    expect(result.id).toBe('openai');
    expect(result.endpoint).toBeTruthy();
    expect(result.model).toBeTruthy();
  });

  test('legacy keys are used when no new structure', async () => {
    storageData.api_endpoint = 'https://api.anthropic.com/v1/messages';
    storageData.api_key = 'sk-test-123';
    storageData.model = 'claude-sonnet-4-6';
    const result = await getActiveProvider();
    expect(result.id).toBe('anthropic');
    expect(result.apiKey).toBe('sk-test-123');
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  test('new structure takes precedence', async () => {
    storageData.active_provider = 'zai';
    storageData.providers = {
      zai: { endpoint: 'https://api.z.ai/v1', api_key: 'zai-key', model: 'glm-5' },
    };
    storageData.api_endpoint = 'https://api.openai.com/v1';
    const result = await getActiveProvider();
    expect(result.id).toBe('zai');
    expect(result.apiKey).toBe('zai-key');
  });

  test('legacy z.ai endpoint detected correctly', async () => {
    storageData.api_endpoint = 'https://api.z.ai/v1/chat';
    storageData.api_key = 'zai-test';
    storageData.model = 'glm-5';
    const result = await getActiveProvider();
    expect(result.id).toBe('zai');
  });
});

describe('migrateLegacySettings — edge cases', () => {
  beforeEach(() => {
    for (const k of Object.keys(storageData)) delete storageData[k];
  });

  test('skips if providers already exist', async () => {
    storageData.providers = { openai: { api_key: 'test' } };
    await migrateLegacySettings();
    expect(storageData.active_provider).toBeUndefined();
  });

  test('migrates openai endpoint', async () => {
    storageData.api_endpoint = 'https://api.openai.com/v1/chat/completions';
    storageData.api_key = 'sk-test';
    storageData.model = 'gpt-4o';
    await migrateLegacySettings();
    expect(storageData.active_provider).toBe('openai');
    expect(storageData.providers.openai.api_key).toBe('sk-test');
    expect(storageData.providers.zai.api_key).toBe('');
  });

  test('migrates anthropic endpoint', async () => {
    storageData.api_endpoint = 'https://api.anthropic.com/v1/messages';
    storageData.api_key = 'ant-test';
    storageData.model = 'claude-3';
    await migrateLegacySettings();
    expect(storageData.active_provider).toBe('anthropic');
    expect(storageData.providers.anthropic.api_key).toBe('ant-test');
    expect(storageData.providers.openai.api_key).toBe('');
  });

  test('migrates z.ai endpoint', async () => {
    storageData.api_endpoint = 'https://api.z.ai/v1/chat';
    storageData.api_key = 'zai-test';
    storageData.model = 'glm-5';
    await migrateLegacySettings();
    expect(storageData.active_provider).toBe('zai');
    expect(storageData.providers.zai.api_key).toBe('zai-test');
  });

  test('removes old keys after migration', async () => {
    storageData.api_endpoint = 'https://api.openai.com/v1';
    storageData.api_key = 'sk-test';
    storageData.model = 'gpt-4o';
    await migrateLegacySettings();
    expect(storageData.api_endpoint).toBeUndefined();
    expect(storageData.api_key).toBeUndefined();
    expect(storageData.model).toBeUndefined();
  });
});

describe('fetchModelsList — error paths', () => {
  beforeEach(() => {
    globalThis.fetch.mockReset();
  });

  test('throws on non-ok response', async () => {
    mockFetchError(401, 'Unauthorized');
    await expect(fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key'))
      .rejects.toThrow('401');
  });

  test('throws on network error', async () => {
    mockFetchNetworkError('ECONNREFUSED');
    await expect(fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key'))
      .rejects.toThrow('Network error');
  });

  test('throws on JSON parse error', async () => {
    mockFetchJsonError();
    await expect(fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key'))
      .rejects.toThrow('JSON');
  });

  test('throws on null data', async () => {
    mockFetchNullBody();
    await expect(fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key'))
      .rejects.toThrow('null');
  });

  test('parses OpenAI format { data: [{id}] }', async () => {
    mockFetchOk({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
    const result = await fetchModelsList({ modelsUrl: 'https://api.openai.com/v1/models' }, 'key');
    expect(result).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  test('parses Ollama format { models: [{name}] } with tagsResponse', async () => {
    mockFetchOk({ models: [{ name: 'llama3:latest' }, { name: 'mistral:latest' }] });
    const result = await fetchModelsList({
      modelsUrl: 'http://localhost:11434/api/tags',
      tagsResponse: true,
    }, '');
    expect(result).toEqual(['llama3:latest', 'mistral:latest']);
  });

  test('parses models array format [{id}]', async () => {
    mockFetchOk({ models: [{ id: 'model-1' }, { id: 'model-2' }] });
    const result = await fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key');
    expect(result).toEqual(['model-1', 'model-2']);
  });

  test('parses plain array of strings', async () => {
    mockFetchOk(['model-a', 'model-b']);
    const result = await fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key');
    expect(result).toEqual(['model-a', 'model-b']);
  });

  test('parses plain array of objects with id/name', async () => {
    mockFetchOk([{ id: 'm1' }, { name: 'm2' }]);
    const result = await fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key');
    expect(result).toEqual(['m1', 'm2']);
  });

  test('throws when no models can be parsed', async () => {
    mockFetchOk({ foo: 'bar' });
    await expect(fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key'))
      .rejects.toThrow('Could not parse');
  });

  test('returns sorted models', async () => {
    mockFetchOk({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'm-model' }] });
    const result = await fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key');
    expect(result).toEqual(['a-model', 'm-model', 'z-model']);
  });

  test('skips models with falsy id', async () => {
    mockFetchOk({ data: [{ id: 'good' }, { id: null }, { id: '' }] });
    const result = await fetchModelsList({ modelsUrl: 'https://api.example.com/models' }, 'key');
    expect(result).toEqual(['good']);
  });

  test('throws when provider has no modelsUrl', async () => {
    await expect(fetchModelsList({ label: 'Test' }, 'key'))
      .rejects.toThrow();
  });

  test('throws when no provider given', async () => {
    await expect(fetchModelsList(null, 'key'))
      .rejects.toThrow('No provider');
  });
});

describe('getCatalogProvider', () => {
  test('returns null for unknown provider', () => {
    expect(getCatalogProvider('nonexistent')).toBeNull();
  });

  test('returns matching provider from catalog', () => {
    if (PROVIDER_CATALOG && PROVIDER_CATALOG.length > 0) {
      const first = PROVIDER_CATALOG[0];
      const result = getCatalogProvider(first.id);
      expect(result).toBeTruthy();
      expect(result.id).toBe(first.id);
    }
  });
});

describe('PROVIDERS — openai parseResponse', () => {
  const provider = PROVIDERS.openai;

  test('throws on Z.AI code 1000 auth error', () => {
    expect(() => provider.parseResponse({ code: 1000, msg: 'Authentication Failed' }))
      .toThrow(/Authentication/i);
  });

  test('throws on Z.AI code 1001 auth error', () => {
    expect(() => provider.parseResponse({ code: 1001, msg: 'Rate limited' }))
      .toThrow(/Authentication/i);
  });

  test('throws on error.message auth error', () => {
    expect(() => provider.parseResponse({ error: { message: 'Invalid API key provided' } }))
      .toThrow(/Authentication/i);
  });

  test('throws on no choices', () => {
    expect(() => provider.parseResponse({ choices: [] }))
      .toThrow('no valid response');
  });

  test('throws on malformed choice', () => {
    expect(() => provider.parseResponse({ choices: [{}] }))
      .toThrow('malformed choice');
  });

  test('throws on null content without reasoning', () => {
    expect(() => provider.parseResponse({ choices: [{ message: { content: null } }] }))
      .toThrow('null content');
  });

  test('returns reasoning_content when content is null', () => {
    const result = provider.parseResponse({ choices: [{ message: { content: null, reasoning_content: 'thinking...' } }] });
    expect(result).toBe('thinking...');
  });

  test('returns reasoning when content is null', () => {
    const result = provider.parseResponse({ choices: [{ message: { content: null, reasoning: 'deep thought' } }] });
    expect(result).toBe('deep thought');
  });

  test('returns content on successful response', () => {
    const result = provider.parseResponse({ choices: [{ message: { content: 'Hello world' } }] });
    expect(result).toBe('Hello world');
  });
});

describe('PROVIDERS — anthropic parseResponse', () => {
  const provider = PROVIDERS.anthropic;

  test('throws when no text block found', () => {
    expect(() => provider.parseResponse({ error: { message: 'invalid x-api-key' } }))
      .toThrow('no text block');
  });

  test('returns text from text block', () => {
    const result = provider.parseResponse({
      content: [{ type: 'text', text: 'Claude response here' }],
    });
    expect(result).toBe('Claude response here');
  });
});

describe('PROVIDERS — zai parseResponse', () => {
  const provider = PROVIDERS.zai;

  test('throws on error message auth error', () => {
    expect(() => provider.parseResponse({ msg: 'API key not valid' }))
      .toThrow(/Authentication/i);
  });

  test('throws on code+success=false auth error', () => {
    expect(() => provider.parseResponse({ code: 1000, success: false }))
      .toThrow(/Authentication Failed/i);
  });

  test('throws on no choices', () => {
    expect(() => provider.parseResponse({ choices: [] }))
      .toThrow('no valid response');
  });

  test('returns content on success', () => {
    const result = provider.parseResponse({ choices: [{ message: { content: 'GLM response' } }] });
    expect(result).toBe('GLM response');
  });
});

describe('PROVIDERS — zai parseToolUseResponse', () => {
  const provider = PROVIDERS.zai;

  test('throws on auth error message', () => {
    expect(() => provider.parseToolUseResponse({ msg: 'Authentication failed' }))
      .toThrow(/Authentication/i);
  });

  test('throws on code+success=false', () => {
    expect(() => provider.parseToolUseResponse({ code: 1000, success: false }))
      .toThrow(/Authentication Failed/i);
  });

  test('extracts tool call from response', () => {
    const result = provider.parseToolUseResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: { name: 'click', arguments: '{"selector":"#btn"}' },
          }],
        },
      }],
    });
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });

  test('throws when no tool_calls', () => {
    expect(() => provider.parseToolUseResponse({
      choices: [{ message: { content: 'no tools' } }],
    })).toThrow('no tool_calls');
  });
});

describe('PROVIDERS — anthropic parseToolUseResponse', () => {
  const provider = PROVIDERS.anthropic;

  test('throws when no tool_use block', () => {
    expect(() => provider.parseToolUseResponse({ content: [{ type: 'text', text: 'no tools' }] }))
      .toThrow('no tool_use block');
  });

  test('extracts tool use from response', () => {
    const result = provider.parseToolUseResponse({
      content: [{ type: 'tool_use', name: 'click', input: { selector: '#btn' } }],
    });
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });
});

describe('PROVIDERS — buildHeaders', () => {
  test('openai buildHeaders returns authorization bearer', () => {
    const headers = PROVIDERS.openai.buildHeaders('sk-test-key');
    expect(headers.Authorization || headers.authorization).toContain('sk-test-key');
  });

  test('anthropic buildHeaders returns x-api-key', () => {
    const headers = PROVIDERS.anthropic.buildHeaders('ant-test-key');
    expect(headers['x-api-key']).toBe('ant-test-key');
  });

  test('zai buildHeaders returns authorization bearer', () => {
    const headers = PROVIDERS.zai.buildHeaders('zai-test-key');
    expect(headers.Authorization).toContain('zai-test-key');
  });
});

describe('PROVIDERS — buildBody variations', () => {
  test('openai buildBody creates messages array', () => {
    const body = PROVIDERS.openai.buildBody('gpt-4o', 'system prompt', 'user content');
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  test('anthropic buildBody creates system and messages', () => {
    const body = PROVIDERS.anthropic.buildBody('claude-sonnet-4-6', 'system prompt', 'user content');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].text).toBe('system prompt');
    expect(body.messages).toHaveLength(1);
  });

  test('zai buildBody creates messages array', () => {
    const body = PROVIDERS.zai.buildBody('glm-5', 'system prompt', 'user content');
    expect(body.model).toBe('glm-5');
    expect(body.messages).toHaveLength(2);
  });

  test('zai buildBody with jsonMode', () => {
    const body = PROVIDERS.zai.buildBody('glm-5', 'sys', 'user', { jsonMode: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('openai buildBodyWithTools creates tools', () => {
    const tools = [{ name: 'click', description: 'Click', input_schema: { type: 'object' } }];
    const body = PROVIDERS.openai.buildBodyWithTools('gpt-4o', 'sys', 'user', tools);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
  });

  test('anthropic buildBodyWithTools creates tools with cache', () => {
    const tools = [{ name: 'click', description: 'Click', input_schema: { type: 'object' } }];
    const body = PROVIDERS.anthropic.buildBodyWithTools('claude-sonnet-4-6', 'sys', 'user', tools);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].cache_control).toBeTruthy();
  });

  test('zai buildBodyWithTools creates tools', () => {
    const tools = [{ name: 'click', description: 'Click', input_schema: { type: 'object' } }];
    const body = PROVIDERS.zai.buildBodyWithTools('glm-5', 'sys', 'user', tools);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
  });
});
