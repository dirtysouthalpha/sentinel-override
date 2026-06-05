// tests/provider-registry-zai-error-paths.test.js
// Tests for Z.AI provider parseResponse and parseToolUseResponse error paths.
// Covers provider-registry.js lines 387-467 (previously uncovered).

import { PROVIDERS } from '../background/provider-registry.js';

const zai = PROVIDERS.zai;

describe('Z.AI parseResponse', () => {
  test('returns content when valid response', () => {
    const result = zai.parseResponse({
      choices: [{ message: { content: 'Hello world' } }]
    });
    expect(result).toBe('Hello world');
  });

  test('throws auth error when no choices and msg field present', () => {
    expect(() => zai.parseResponse({ msg: 'Invalid API key' }))
      .toThrow(/🔑 Authentication failed: Invalid API key/);
  });

  test('throws auth error when no choices and error.message present', () => {
    expect(() => zai.parseResponse({ error: { message: 'Unauthorized' } }))
      .toThrow(/🔑 Authentication failed: Unauthorized/);
  });

  test('throws auth error when no choices and message field present', () => {
    expect(() => zai.parseResponse({ message: 'Forbidden' }))
      .toThrow(/🔑 Authentication failed: Forbidden/);
  });

  test('throws auth error with code and success=false (no msg)', () => {
    expect(() => zai.parseResponse({ code: 1001, success: false }))
      .toThrow(/🔑 API Authentication Failed: Unknown error \(code 1001\)/);
  });

  test('throws auth error with code, success=false, and msg', () => {
    // msg is truthy, so it takes the first branch (Authentication failed, not API Authentication Failed)
    expect(() => zai.parseResponse({ code: 1001, success: false, msg: 'Bad key' }))
      .toThrow(/🔑 Authentication failed: Bad key/);
  });

  test('throws generic error when no choices and no error info', () => {
    expect(() => zai.parseResponse({}))
      .toThrow(/API returned no valid response/);
  });

  test('throws generic error when choices is empty array', () => {
    expect(() => zai.parseResponse({ choices: [] }))
      .toThrow(/API returned no valid response/);
  });

  test('throws malformed choice error when choice has no message', () => {
    expect(() => zai.parseResponse({ choices: [{}] }))
      .toThrow(/API returned malformed choice/);
  });

  test('throws null content error when content is null and no reasoning', () => {
    expect(() => zai.parseResponse({
      choices: [{ message: { content: null } }]
    })).toThrow(/API returned null content/);
  });

  test('throws null content error when content is empty string and no reasoning', () => {
    // Empty string is falsy, so it falls through to the null content check
    expect(() => zai.parseResponse({
      choices: [{ message: { content: '' } }]
    })).toThrow(/API returned null content/);
  });

  test('returns reasoning_content when content is null', () => {
    const result = zai.parseResponse({
      choices: [{ message: { content: null, reasoning_content: 'I think therefore I am' } }]
    });
    expect(result).toBe('I think therefore I am');
  });

  test('returns reasoning when content is null and no reasoning_content', () => {
    const result = zai.parseResponse({
      choices: [{ message: { content: null, reasoning: 'Step by step...' } }]
    });
    expect(result).toBe('Step by step...');
  });

  test('prefers reasoning_content over reasoning when both present', () => {
    const result = zai.parseResponse({
      choices: [{ message: { content: null, reasoning_content: 'RC', reasoning: 'R' } }]
    });
    expect(result).toBe('RC');
  });

  test('handles response with error.message being null', () => {
    expect(() => zai.parseResponse({ error: { message: null }, msg: 'Z.AI error' }))
      .toThrow(/🔑 Authentication failed: Z.AI error/);
  });

  test('handles response with choices[0] being null', () => {
    expect(() => zai.parseResponse({ choices: [null] }))
      .toThrow(/API returned malformed choice/);
  });
});

describe('Z.AI parseToolUseResponse', () => {
  test('parses valid tool call response', () => {
    const result = zai.parseToolUseResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'click',
              arguments: '{"selector":"#btn"}'
            }
          }]
        }
      }]
    });
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });

  test('throws auth error when no choices and msg field present', () => {
    expect(() => zai.parseToolUseResponse({ msg: 'Invalid API key' }))
      .toThrow(/🔑 Authentication failed: Invalid API key/);
  });

  test('throws auth error when no choices and error.message present', () => {
    expect(() => zai.parseToolUseResponse({ error: { message: 'Unauthorized' } }))
      .toThrow(/🔑 Authentication failed: Unauthorized/);
  });

  test('throws auth error when no choices and message field present', () => {
    expect(() => zai.parseToolUseResponse({ message: 'Forbidden' }))
      .toThrow(/🔑 Authentication failed: Forbidden/);
  });

  test('throws auth error with code and success=false', () => {
    expect(() => zai.parseToolUseResponse({ code: 1001, success: false }))
      .toThrow(/🔑 API Authentication Failed/);
  });

  test('throws auth error with code, success=false, and msg', () => {
    // msg is truthy, so it takes the first branch (Authentication failed, not API Authentication Failed)
    expect(() => zai.parseToolUseResponse({ code: 1001, success: false, msg: 'Bad key' }))
      .toThrow(/🔑 Authentication failed: Bad key/);
  });

  test('throws generic error when no choices and no error info', () => {
    expect(() => zai.parseToolUseResponse({}))
      .toThrow(/OpenAI response had no valid choice/);
  });

  test('throws generic error when choices is empty array', () => {
    expect(() => zai.parseToolUseResponse({ choices: [] }))
      .toThrow(/OpenAI response had no valid choice/);
  });

  test('throws when choice has no message', () => {
    expect(() => zai.parseToolUseResponse({ choices: [{}] }))
      .toThrow(/OpenAI response had no valid choice/);
  });

  test('throws when choice.message is null', () => {
    expect(() => zai.parseToolUseResponse({ choices: [{ message: null }] }))
      .toThrow(/OpenAI response had no valid choice/);
  });

  test('throws when no tool_calls in message', () => {
    expect(() => zai.parseToolUseResponse({
      choices: [{ message: { content: 'text' } }]
    })).toThrow(/no tool_calls/);
  });

  test('throws when tool_calls is empty', () => {
    expect(() => zai.parseToolUseResponse({
      choices: [{ message: { tool_calls: [] } }]
    })).toThrow(/no tool_calls/);
  });

  test('falls back to text when arguments are not valid JSON', () => {
    const result = zai.parseToolUseResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'navigate',
              arguments: 'not valid json'
            }
          }]
        }
      }]
    });
    expect(result.type).toBe('navigate');
    expect(result.text).toBe('not valid json');
  });

  test('handles empty arguments as empty object', () => {
    const result = zai.parseToolUseResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'click',
              arguments: ''
            }
          }]
        }
      }]
    });
    expect(result.type).toBe('click');
  });

  test('handles tool call with no function.name (skips that call)', () => {
    expect(() => zai.parseToolUseResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: { arguments: '{}' }
          }]
        }
      }]
    })).toThrow(/no tool_calls/);
  });

  test('handles tool call with function but no name field', () => {
    expect(() => zai.parseToolUseResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: {}
          }]
        }
      }]
    })).toThrow(/no tool_calls/);
  });
});

describe('Z.AI buildBody', () => {
  test('builds correct body', () => {
    const body = zai.buildBody('glm-4.6v', 'System prompt', 'User message');
    expect(body.model).toBe('glm-4.6v');
    expect(body.messages).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' }
    ]);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(8000);
  });

  test('uses custom opts', () => {
    const body = zai.buildBody('glm-4.6v', 'sys', 'user', { temperature: 0.5, maxTokens: 4000 });
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(4000);
  });

  test('adds response_format when jsonMode is true', () => {
    const body = zai.buildBody('glm-4.6v', 'sys', 'user', { jsonMode: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('does not add response_format when jsonMode is false', () => {
    const body = zai.buildBody('glm-4.6v', 'sys', 'user');
    expect(body.response_format).toBeUndefined();
  });
});

describe('Z.AI buildVisionContent', () => {
  test('builds vision content array', () => {
    const result = zai.buildVisionContent('Describe this', 'base64data');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'Describe this' });
    expect(result[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data' } });
  });
});

describe('Z.AI convertToolsToOpenAIFormat', () => {
  test('converts tools to OpenAI format', () => {
    const tools = [{
      name: 'click',
      description: 'Click an element',
      input_schema: { type: 'object', properties: { selector: { type: 'string' } } }
    }];
    const result = zai.convertToolsToOpenAIFormat(tools);
    expect(result).toEqual([{
      type: 'function',
      function: {
        name: 'click',
        description: 'Click an element',
        parameters: { type: 'object', properties: { selector: { type: 'string' } } }
      }
    }]);
  });

  test('uses default parameters when input_schema missing', () => {
    const tools = [{ name: 'test', description: 'Test' }];
    const result = zai.convertToolsToOpenAIFormat(tools);
    expect(result[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('Z.AI buildBodyWithTools', () => {
  test('builds body with tools', () => {
    const tools = [{ name: 'click', description: 'Click', input_schema: { type: 'object', properties: {} } }];
    const body = zai.buildBodyWithTools('glm-4.6v', 'sys', 'user', tools);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tool_choice).toBe('auto');
  });

  test('uses custom opts', () => {
    const tools = [];
    const body = zai.buildBodyWithTools('glm-4.6v', 'sys', 'user', tools, { temperature: 0.7, maxTokens: 2000 });
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2000);
  });
});

describe('Z.AI provider metadata', () => {
  test('has correct id and name', () => {
    expect(zai.id).toBe('zai');
    expect(zai.name).toBe('Z.AI (GLM)');
  });

  test('has correct default endpoint', () => {
    expect(zai.defaultEndpoint).toContain('z.ai');
  });

  test('has correct default model', () => {
    expect(zai.defaultModel).toBe('glm-4.6v');
  });

  test('supports tool use', () => {
    expect(zai.supportsToolUse).toBe(true);
  });

  test('has systemPromptTweak', () => {
    expect(typeof zai.systemPromptTweak).toBe('string');
    expect(zai.systemPromptTweak.length).toBeGreaterThan(0);
  });

  test('buildHeaders creates correct headers', () => {
    const headers = zai.buildHeaders('test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer test-api-key');
  });
});
