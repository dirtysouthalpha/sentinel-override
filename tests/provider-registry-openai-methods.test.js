// tests/provider-registry-openai-methods.test.js
// Tests for OpenAI provider methods: convertToolsToOpenAIFormat, buildBodyWithTools,
// buildVisionContent, and related uncovered paths.

import { PROVIDERS, getModelSupportsVision, fetchModelsList, getCatalogProvider } from '../background/provider-registry.js';

const openai = PROVIDERS.openai;

// ========== OpenAI convertToolsToOpenAIFormat ==========

describe('OpenAI convertToolsToOpenAIFormat', () => {
  test('converts Anthropic-format tools to OpenAI function calling format', () => {
    const tools = [
      { name: 'click', description: 'Click an element', input_schema: { type: 'object', properties: { selector: { type: 'string' } } } },
      { name: 'type', description: 'Type text', input_schema: { type: 'object', properties: { text: { type: 'string' } } } }
    ];
    const result = openai.convertToolsToOpenAIFormat(tools);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'click',
        description: 'Click an element',
        parameters: { type: 'object', properties: { selector: { type: 'string' } } }
      }
    });
    expect(result[1].function.name).toBe('type');
  });

  test('uses default empty schema when input_schema is missing', () => {
    const tools = [{ name: 'test', description: 'A test tool' }];
    const result = openai.convertToolsToOpenAIFormat(tools);
    expect(result[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });

  test('returns empty array for empty tools', () => {
    expect(openai.convertToolsToOpenAIFormat([])).toEqual([]);
  });
});

// ========== OpenAI buildBodyWithTools ==========

describe('OpenAI buildBodyWithTools', () => {
  test('builds correct request body with tools', () => {
    const tools = [
      { name: 'click', description: 'Click', input_schema: { type: 'object', properties: {} } }
    ];
    const body = openai.buildBodyWithTools('gpt-4o', 'system prompt', 'user content', tools);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'user content' });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tool_choice).toBe('auto');
  });

  test('uses default temperature and maxTokens when no opts provided', () => {
    const body = openai.buildBodyWithTools('gpt-4o', 'sys', 'usr', []);
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(8000);
  });

  test('respects custom temperature', () => {
    const body = openai.buildBodyWithTools('gpt-4o', 'sys', 'usr', [], { temperature: 0.7 });
    expect(body.temperature).toBe(0.7);
  });

  test('respects custom maxTokens', () => {
    const body = openai.buildBodyWithTools('gpt-4o', 'sys', 'usr', [], { maxTokens: 4000 });
    expect(body.max_tokens).toBe(4000);
  });

  test('handles array userContent (vision blocks)', () => {
    const content = [
      { type: 'text', text: 'Describe this image' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc123' } }
    ];
    const body = openai.buildBodyWithTools('gpt-4o', 'sys', content, []);
    expect(body.messages[1].content).toEqual(content);
  });

  test('converts tools from Anthropic to OpenAI format', () => {
    const tools = [
      { name: 'navigate', description: 'Navigate to URL', input_schema: { type: 'object', properties: { url: { type: 'string' } } } }
    ];
    const body = openai.buildBodyWithTools('gpt-4o', 'sys', 'usr', tools);
    expect(body.tools[0].function.name).toBe('navigate');
    expect(body.tools[0].function.parameters).toEqual({ type: 'object', properties: { url: { type: 'string' } } });
  });
});

// ========== OpenAI buildVisionContent ==========

describe('OpenAI buildVisionContent', () => {
  test('builds content array with text and image_url blocks', () => {
    const result = openai.buildVisionContent('Describe this', 'base64data==');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'Describe this' });
    expect(result[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data==' } });
  });

  test('works with empty text', () => {
    const result = openai.buildVisionContent('', 'abc');
    expect(result[0].text).toBe('');
    expect(result[1].image_url.url).toContain('abc');
  });
});

// ========== OpenAI parseResponse / parseToolUseResponse ==========

describe('OpenAI parseResponse additional paths', () => {
  test('parseResponse returns text from first choice message', () => {
    const data = {
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }]
    };
    expect(openai.parseResponse(data)).toBe('Hello world');
  });

  test('parseResponse throws for null content (no reasoning fallback)', () => {
    const data = {
      choices: [{ message: { content: null }, finish_reason: 'stop' }]
    };
    expect(() => openai.parseResponse(data)).toThrow('API returned null content');
  });

  test('parseResponse returns reasoning_content when content is null', () => {
    const data = {
      choices: [{ message: { content: null, reasoning_content: 'thinking...' }, finish_reason: 'stop' }]
    };
    expect(openai.parseResponse(data)).toBe('thinking...');
  });

  test('parseResponse returns reasoning when content is null and reasoning_content missing', () => {
    const data = {
      choices: [{ message: { content: null, reasoning: 'chain of thought' }, finish_reason: 'stop' }]
    };
    expect(openai.parseResponse(data)).toBe('chain of thought');
  });

  test('parseResponse throws auth error for code 1000', () => {
    const data = { code: 1000, msg: 'Authentication Failed' };
    expect(() => openai.parseResponse(data)).toThrow('Authentication failed');
  });

  test('parseResponse throws auth error for code 1001', () => {
    const data = { code: 1001, msg: 'Invalid API Key' };
    expect(() => openai.parseResponse(data)).toThrow('Authentication failed');
  });

  test('parseResponse throws for no choices', () => {
    const data = { choices: [] };
    expect(() => openai.parseResponse(data)).toThrow();
  });

  test('parseResponse throws for malformed choice', () => {
    const data = { choices: [{}] };
    expect(() => openai.parseResponse(data)).toThrow('malformed choice');
  });

  test('parseToolUseResponse throws when no tool_calls present', () => {
    const data = {
      choices: [{ message: { content: 'just text' }, finish_reason: 'stop' }]
    };
    expect(() => openai.parseToolUseResponse(data)).toThrow('no tool_calls');
  });

  test('parseToolUseResponse parses tool calls correctly', () => {
    const data = {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            function: {
              name: 'click',
              arguments: '{"selector": "#btn"}'
            }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    };
    const result = openai.parseToolUseResponse(data);
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });

  test('parseToolUseResponse handles invalid JSON arguments gracefully', () => {
    const data = {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            function: {
              name: 'note',
              arguments: 'not valid json {'
            }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    };
    const result = openai.parseToolUseResponse(data);
    expect(result.type).toBe('note');
    expect(result.text).toBe('not valid json {');
  });

  test('parseToolUseResponse throws auth error for code 1000', () => {
    const data = { code: 1000, msg: 'Auth Failed' };
    expect(() => openai.parseToolUseResponse(data)).toThrow('Authentication failed');
  });

  test('parseToolUseResponse throws for no choices', () => {
    const data = {};
    expect(() => openai.parseToolUseResponse(data)).toThrow();
  });

  test('parseToolUseResponse throws for choice without message', () => {
    const data = { choices: [{}] };
    expect(() => openai.parseToolUseResponse(data)).toThrow();
  });
});

// ========== OpenAI buildHeaders ==========

describe('OpenAI buildHeaders', () => {
  test('returns Authorization Bearer header', () => {
    const headers = openai.buildHeaders('sk-test-key');
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ========== getCatalogProvider ==========

describe('getCatalogProvider', () => {
  test('returns openai catalog entry', () => {
    const entry = getCatalogProvider('openai');
    expect(entry).toBeTruthy();
    expect(entry.id).toBe('openai');
  });

  test('returns anthropic catalog entry', () => {
    const entry = getCatalogProvider('anthropic');
    expect(entry).toBeTruthy();
    expect(entry.id).toBe('anthropic');
  });

  test('returns null for unknown provider', () => {
    expect(getCatalogProvider('nonexistent')).toBeNull();
  });
});

// ========== fetchModelsList error paths ==========

describe('fetchModelsList error paths', () => {
  test('throws for null provider', async () => {
    await expect(fetchModelsList(null, 'key')).rejects.toThrow('No provider given');
  });

  test('throws for provider without modelsUrl', async () => {
    await expect(fetchModelsList({ label: 'Test' }, 'key')).rejects.toThrow('does not expose a /models endpoint');
  });

  test('throws for customModelsUrl with network error', async () => {
    const provider = { label: 'Test', modelsUrl: 'https://invalid.example.com/models', auth: 'bearer' };
    await expect(fetchModelsList(provider, 'key')).rejects.toThrow();
  });
});

// ========== getModelSupportsVision deny list paths ==========

describe('getModelSupportsVision deny list paths', () => {
  test('denies gpt-3.5 models via openai deny list', () => {
    expect(getModelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
  });

  test('denies claude-2 models via anthropic deny list', () => {
    expect(getModelSupportsVision('anthropic', 'claude-2-1')).toBe(false);
  });

  test('denies claude-instant via anthropic deny list', () => {
    expect(getModelSupportsVision('anthropic', 'claude-instant-1')).toBe(false);
  });

  test('denies text- models via openai deny list', () => {
    expect(getModelSupportsVision('openai', 'text-davinci-003')).toBe(false);
  });

  test('returns true for gpt-4o via override (not deny list)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o')).toBe(true);
  });

  test('returns true for openai default (not in deny or override)', () => {
    // gpt-4-turbo is in overrides, let's try a model that hits the default path
    expect(getModelSupportsVision('openai', 'gpt-4-turbo')).toBe(true);
  });

  test('returns null for unknown provider with unknown model', () => {
    expect(getModelSupportsVision('unknown-provider', 'some-random-model')).toBeNull();
  });

  test('returns false for null model', () => {
    expect(getModelSupportsVision('openai', null)).toBe(false);
  });

  test('returns false for undefined model', () => {
    expect(getModelSupportsVision('openai', undefined)).toBe(false);
  });

  test('handles Z.AI glm models', () => {
    expect(getModelSupportsVision('zai', 'glm-5')).toBe(true);
    expect(getModelSupportsVision('zai', 'glm-4.5')).toBe(true);
  });
});
