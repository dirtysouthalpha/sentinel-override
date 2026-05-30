// tests/provider-registry-errors.test.js
// Deep error-path tests for Z.AI and OpenAI parseResponse / parseToolUseResponse
// auth-error detection, malformed payloads, and edge cases.

import { jest } from '@jest/globals';
import { PROVIDERS } from '../background/provider-registry.js';

// ══════════════════════════════════════════════════════════════════
// OpenAI parseResponse — auth / error detection
// ══════════════════════════════════════════════════════════════════
describe('OpenAI parseResponse — auth error paths', () => {
  const p = PROVIDERS.openai;

  test('code 1000 throws authentication error', () => {
    const data = { code: 1000, msg: 'Authentication Failed', success: false };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed/);
  });

  test('code 1001 throws authentication error', () => {
    const data = { code: 1001, msg: 'Token Expired', success: false };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed/);
  });

  test('code 1000 uses msg field in error', () => {
    const data = { code: 1000, msg: 'Invalid API key provided', success: false };
    expect(() => p.parseResponse(data)).toThrow(/Invalid API key provided/);
  });

  test('code 1000 with no msg checks message field', () => {
    const data = { code: 1000, message: 'Auth failed via message field' };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*Auth failed via message field/);
  });

  test('code 1000 with only code uses Unknown error', () => {
    const data = { code: 1000 };
    expect(() => p.parseResponse(data)).toThrow(/Unknown error \(code 1000\)/);
  });

  test('empty choices with error.message throws auth error', () => {
    const data = { error: { message: 'API key is invalid' } };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*API key is invalid/);
  });

  test('empty choices with msg field throws auth error', () => {
    const data = { msg: 'Unauthorized access' };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*Unauthorized access/);
  });

  test('empty choices with message field throws auth error', () => {
    const data = { message: 'Access denied' };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*Access denied/);
  });

  test('empty choices with no error/msg/message throws generic error', () => {
    const data = { foo: 'bar' };
    expect(() => p.parseResponse(data)).toThrow(/no valid response/);
  });

  test('empty choices array throws generic error', () => {
    const data = { choices: [] };
    expect(() => p.parseResponse(data)).toThrow(/no valid response/);
  });

  test('null choices throws generic error', () => {
    const data = { choices: null };
    expect(() => p.parseResponse(data)).toThrow(/no valid response/);
  });

  test('malformed choice (null message) throws error', () => {
    const data = { choices: [null] };
    expect(() => p.parseResponse(data)).toThrow(/malformed choice/);
  });

  test('malformed choice (no message key) throws error', () => {
    const data = { choices: [{ foo: 'bar' }] };
    expect(() => p.parseResponse(data)).toThrow(/malformed choice/);
  });

  test('null content with no reasoning throws null content error', () => {
    const data = { choices: [{ message: { content: null } }] };
    expect(() => p.parseResponse(data)).toThrow(/null content/);
  });

  test('empty string content is falsy, throws null content error', () => {
    const data = { choices: [{ message: { content: '' } }] };
    expect(() => p.parseResponse(data)).toThrow(/null content/);
  });

  test('reasoning_content takes priority over reasoning when content is null', () => {
    const data = {
      choices: [{
        message: {
          content: null,
          reasoning_content: 'primary reasoning',
          reasoning: 'secondary reasoning'
        }
      }]
    };
    expect(p.parseResponse(data)).toBe('primary reasoning');
  });

  test('falls back to reasoning field when reasoning_content is absent', () => {
    const data = {
      choices: [{
        message: {
          content: null,
          reasoning: 'only reasoning'
        }
      }]
    };
    expect(p.parseResponse(data)).toBe('only reasoning');
  });
});

// ══════════════════════════════════════════════════════════════════
// Z.AI parseResponse — auth error paths
// ══════════════════════════════════════════════════════════════════
describe('Z.AI parseResponse — auth error paths', () => {
  const p = PROVIDERS.zai;

  test('empty choices with msg throws auth error', () => {
    const data = { msg: 'Authentication Failed' };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*Authentication Failed/);
  });

  test('empty choices with error.message throws auth error', () => {
    const data = { error: { message: 'Token is expired' } };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*Token is expired/);
  });

  test('empty choices with message field throws auth error', () => {
    const data = { message: 'Unauthorized' };
    expect(() => p.parseResponse(data)).toThrow(/Authentication failed.*Unauthorized/);
  });

  test('code + success=false with no msg throws API Authentication Failed', () => {
    const data = { code: 2001, success: false };
    expect(() => p.parseResponse(data)).toThrow(/API Authentication Failed.*Unknown error \(code 2001\)/);
  });

  test('no choices with no error info throws generic error', () => {
    const data = { foo: 'bar' };
    expect(() => p.parseResponse(data)).toThrow(/no valid response/);
  });

  test('empty choices array throws generic error', () => {
    const data = { choices: [] };
    expect(() => p.parseResponse(data)).toThrow(/no valid response/);
  });

  test('malformed choice throws error', () => {
    const data = { choices: [null] };
    expect(() => p.parseResponse(data)).toThrow(/malformed choice/);
  });

  test('null content with reasoning_content returns reasoning', () => {
    const data = {
      choices: [{
        message: { content: null, reasoning_content: 'reasoned' }
      }]
    };
    expect(p.parseResponse(data)).toBe('reasoned');
  });

  test('null content with reasoning field returns reasoning', () => {
    const data = {
      choices: [{
        message: { content: null, reasoning: 'reason' }
      }]
    };
    expect(p.parseResponse(data)).toBe('reason');
  });

  test('null content with no reasoning throws null content error', () => {
    const data = { choices: [{ message: { content: null } }] };
    expect(() => p.parseResponse(data)).toThrow(/null content/);
  });

  test('valid content returns it', () => {
    const data = { choices: [{ message: { content: 'GLM response' } }] };
    expect(p.parseResponse(data)).toBe('GLM response');
  });
});

// ══════════════════════════════════════════════════════════════════
// OpenAI parseToolUseResponse — error paths
// ══════════════════════════════════════════════════════════════════
describe('OpenAI parseToolUseResponse — error paths', () => {
  const p = PROVIDERS.openai;

  test('no choices with error.message throws auth error', () => {
    const data = { error: { message: 'Invalid token' } };
    expect(() => p.parseToolUseResponse(data)).toThrow(/Authentication failed.*Invalid token/);
  });

  test('no choices with msg throws auth error', () => {
    const data = { msg: 'Auth required' };
    expect(() => p.parseToolUseResponse(data)).toThrow(/Authentication failed.*Auth required/);
  });

  test('no choices with message throws auth error', () => {
    const data = { message: 'Forbidden' };
    expect(() => p.parseToolUseResponse(data)).toThrow(/Authentication failed.*Forbidden/);
  });

  test('no choices and no error info throws no valid choice', () => {
    const data = { foo: 'bar' };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no valid choice/);
  });

  test('empty choices throws no valid choice', () => {
    const data = { choices: [] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no valid choice/);
  });

  test('choice with null message throws no valid choice', () => {
    const data = { choices: [null] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no valid choice/);
  });

  test('message with no tool_calls throws no tool_calls', () => {
    const data = { choices: [{ message: { content: 'no tools' } }] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no tool_calls/);
  });

  test('empty tool_calls throws no tool_calls', () => {
    const data = { choices: [{ message: { tool_calls: [] } }] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no tool_calls/);
  });

  test('tool_call with no function name throws no tool_calls', () => {
    const data = { choices: [{ message: { tool_calls: [{ function: {} }] } }] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no tool_calls/);
  });

  test('invalid JSON arguments falls back to text property', () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'extract',
              arguments: 'not valid json {[{'
            }
          }]
        }
      }]
    };
    const result = p.parseToolUseResponse(data);
    expect(result.type).toBe('extract');
    expect(result.text).toBe('not valid json {[{');
  });

  test('null arguments falls back gracefully', () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'click',
              arguments: null
            }
          }]
        }
      }]
    };
    const result = p.parseToolUseResponse(data);
    expect(result.type).toBe('click');
  });

  test('undefined arguments falls back gracefully', () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'navigate',
            }
          }]
        }
      }]
    };
    const result = p.parseToolUseResponse(data);
    expect(result.type).toBe('navigate');
  });

  test('valid tool_call with JSON arguments returns correct result', () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'click',
              arguments: '{"selector": "#btn", "x": 100}'
            }
          }]
        }
      }]
    };
    const result = p.parseToolUseResponse(data);
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
    expect(result.x).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════
// Z.AI parseToolUseResponse — error paths
// ══════════════════════════════════════════════════════════════════
describe('Z.AI parseToolUseResponse — error paths', () => {
  const p = PROVIDERS.zai;

  test('no choices with msg throws auth error', () => {
    const data = { msg: 'Auth Failed' };
    expect(() => p.parseToolUseResponse(data)).toThrow(/Authentication failed.*Auth Failed/);
  });

  test('no choices with error.message throws auth error', () => {
    const data = { error: { message: 'Bad token' } };
    expect(() => p.parseToolUseResponse(data)).toThrow(/Authentication failed.*Bad token/);
  });

  test('no choices with message throws auth error', () => {
    const data = { message: 'Access denied' };
    expect(() => p.parseToolUseResponse(data)).toThrow(/Authentication failed.*Access denied/);
  });

  test('code + success=false with no msg uses fallback', () => {
    const data = { code: 2001, success: false };
    expect(() => p.parseToolUseResponse(data)).toThrow(/API Authentication Failed.*Unknown error \(code 2001\)/);
  });

  test('no choices and no error info throws no valid choice', () => {
    const data = { foo: 'bar' };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no valid choice/);
  });

  test('empty choices throws no valid choice', () => {
    const data = { choices: [] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no valid choice/);
  });

  test('null message throws no valid choice', () => {
    const data = { choices: [null] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no valid choice/);
  });

  test('no tool_calls throws no tool_calls', () => {
    const data = { choices: [{ message: { content: 'done' } }] };
    expect(() => p.parseToolUseResponse(data)).toThrow(/no tool_calls/);
  });

  test('valid tool_call returns parsed result', () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'navigate',
              arguments: '{"url": "https://example.com"}'
            }
          }]
        }
      }]
    };
    const result = p.parseToolUseResponse(data);
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://example.com');
  });

  test('invalid JSON arguments falls back to text', () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: 'click',
              arguments: '{{invalid}}'
            }
          }]
        }
      }]
    };
    const result = p.parseToolUseResponse(data);
    expect(result.type).toBe('click');
    expect(result.text).toBe('{{invalid}}');
  });
});

// ══════════════════════════════════════════════════════════════════
// Z.AI provider structure
// ══════════════════════════════════════════════════════════════════
describe('Z.AI provider structure', () => {
  const p = PROVIDERS.zai;

  test('has correct id and name', () => {
    expect(p.id).toBe('zai');
    expect(p.name).toBe('Z.AI (GLM)');
  });

  test('supports tool use', () => {
    expect(p.supportsToolUse).toBe(true);
  });

  test('has systemPromptTweak', () => {
    expect(typeof p.systemPromptTweak).toBe('string');
    expect(p.systemPromptTweak.length).toBeGreaterThan(50);
  });

  test('buildHeaders returns Bearer auth', () => {
    const headers = p.buildHeaders('test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer test-key');
  });

  test('buildBody creates correct structure', () => {
    const body = p.buildBody('glm-4.6v', 'sys', 'usr');
    expect(body.model).toBe('glm-4.6v');
    expect(body.max_tokens).toBe(8000);
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toHaveLength(2);
  });

  test('buildBody with jsonMode', () => {
    const body = p.buildBody('glm-4.6v', 'sys', 'usr', { jsonMode: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('buildBody with custom temperature', () => {
    const body = p.buildBody('glm-4.6v', 'sys', 'usr', { temperature: 0.7 });
    expect(body.temperature).toBe(0.7);
  });

  test('buildBodyWithTools creates OpenAI-format tools', () => {
    const tools = [{ name: 'click', description: 'Click', input_schema: { type: 'object' } }];
    const body = p.buildBodyWithTools('glm-4.6v', 'sys', 'usr', tools);
    expect(body.model).toBe('glm-4.6v');
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('click');
    expect(body.tool_choice).toBe('auto');
  });

  test('buildVisionContent creates image_url block', () => {
    const result = p.buildVisionContent('describe', 'base64data');
    expect(result).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data' } }
    ]);
  });

  test('convertToolsToOpenAIFormat maps tools', () => {
    const tools = [
      { name: 'click', description: 'Click', input_schema: { type: 'object', properties: {} } }
    ];
    const result = p.convertToolsToOpenAIFormat(tools);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'click',
        description: 'Click',
        parameters: { type: 'object', properties: {} }
      }
    });
  });

  test('convertToolsToOpenAIFormat defaults to empty schema', () => {
    const tools = [{ name: 'test', description: 'Test' }];
    const result = p.convertToolsToOpenAIFormat(tools);
    expect(result[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });
});
