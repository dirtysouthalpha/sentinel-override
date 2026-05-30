// tests/llm-client-parse-branches.test.js
// Additional branch coverage for parseLLMResponse, extractFirstJsonObject

import { jest } from '@jest/globals';

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({
        active_provider: 'zai',
        providers: {
          zai: { endpoint: 'https://api.z.ai/v1', api_key: 'test-key', model: 'test-model' },
        },
      })),
      set: jest.fn(async () => {}),
    },
  },
  runtime: {
    id: 'test',
    getURL: jest.fn((p) => p),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
  },
};
globalThis.fetch = jest.fn();
globalThis.URL = URL;

const { parseLLMResponse, extractFirstJsonObject } = await import('../background/llm-client.js');

describe('extractFirstJsonObject additional branches', () => {
  test('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  test('returns null for string with no braces', () => {
    expect(extractFirstJsonObject('just plain text')).toBeNull();
  });

  test('returns null for string with unmatched brace', () => {
    expect(extractFirstJsonObject('{ "type": "click"')).toBeNull();
  });

  test('finds first valid action object', () => {
    const result = extractFirstJsonObject('Some text {"type":"click","selector":"#btn"}');
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('click');
  });

  test('skips invalid JSON objects', () => {
    const result = extractFirstJsonObject('{ broken } {"type":"navigate","url":"https://example.com"}');
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('navigate');
  });

  test('skips JSON without valid type', () => {
    const result = extractFirstJsonObject('{"foo":"bar"} {"type":"finish","summary":"done"}');
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('finish');
  });

  test('handles nested braces inside strings', () => {
    const result = extractFirstJsonObject('{"type":"note","text":"use obj.foo {bar} for reference"}');
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('note');
  });

  test('handles escaped quotes in strings', () => {
    const result = extractFirstJsonObject('{"type":"note","text":"He said \\"hello\\" to me"}');
    expect(result).toBeTruthy();
  });

  test('handles batch type', () => {
    const result = extractFirstJsonObject('{"type":"batch","actions":[]}');
    expect(result).toBeTruthy();
  });

  test('handles smart_navigate type', () => {
    const result = extractFirstJsonObject('{"type":"smart_navigate","url":"https://example.com"}');
    expect(result).toBeTruthy();
  });

  test('handles verify type', () => {
    const result = extractFirstJsonObject('{"type":"verify","selector":"#status"}');
    expect(result).toBeTruthy();
  });

  test('handles repeat_for_each type', () => {
    const result = extractFirstJsonObject('{"type":"repeat_for_each","selector":".item"}');
    expect(result).toBeTruthy();
  });

  test('handles read_console_messages type', () => {
    const result = extractFirstJsonObject('{"type":"read_console_messages"}');
    expect(result).toBeTruthy();
  });

  test('handles read_network_requests type', () => {
    const result = extractFirstJsonObject('{"type":"read_network_requests"}');
    expect(result).toBeTruthy();
  });
});

describe('parseLLMResponse additional branches', () => {
  test('returns note on null content', () => {
    const result = parseLLMResponse(null);
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('returns note on undefined content', () => {
    const result = parseLLMResponse(undefined);
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('returns note on empty string', () => {
    const result = parseLLMResponse('');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('returns note on non-string', () => {
    const result = parseLLMResponse(42);
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('strips thinking tags (GLM/DeepSeek)', () => {
    const input = '<thinkreasoning>Let me think about this</thinkreasoning>{"type":"click","selector":"#btn"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('click');
  });

  test('strips think tags case-insensitively', () => {
    const input = '<THINK>reasoning</THINK>{"type":"navigate","url":"https://example.com"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('navigate');
  });

  test('extracts from markdown code fence', () => {
    const input = '```json\n{"type":"finish","summary":"all done"}\n```';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('finish');
    expect(result.summary).toBe('all done');
  });

  test('extracts from code fence without json label', () => {
    const input = '```\n{"type":"note","text":"found something"}\n```';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
  });

  test('unwraps action wrapper', () => {
    const input = '{"action":{"type":"click","selector":"#btn"}}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('click');
  });

  test('unwraps command wrapper', () => {
    const input = '{"command":{"type":"type","selector":"#input","text":"hello"}}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('type');
  });

  test('unwraps next_action wrapper', () => {
    const input = '{"next_action":{"type":"navigate","url":"https://example.com"}}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('navigate');
  });

  test('returns note on missing type field (catch salvage)', () => {
    const result = parseLLMResponse('{"foo":"bar"}');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('returns note on invalid type (catch salvage)', () => {
    const result = parseLLMResponse('{"type":"unknown_action"}');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Invalid command type');
  });

  test('handles scroll_to action type', () => {
    const input = '{"type":"scroll_to","selector":"#footer"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('scroll_to');
  });

  test('handles click_at action type', () => {
    const input = '{"type":"click_at","x":100,"y":200}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('click_at');
  });

  test('handles check action type', () => {
    const input = '{"type":"check","selector":"#agree"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('check');
  });

  test('handles check_all action type', () => {
    const input = '{"type":"check_all","selector":".checkbox"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('check_all');
  });

  test('handles open_dropdown action type', () => {
    const input = '{"type":"open_dropdown","selector":"#menu"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('open_dropdown');
  });

  test('handles upload_file action type', () => {
    const input = '{"type":"upload_file","selector":"#file-input"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('upload_file');
  });

  test('handles drag_and_drop action type', () => {
    const input = '{"type":"drag_and_drop","source":"#item","target":"#drop"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('drag_and_drop');
  });

  test('handles right_click action type', () => {
    const input = '{"type":"right_click","selector":"#context"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('right_click');
  });

  test('handles double_click action type', () => {
    const input = '{"type":"double_click","selector":"#item"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('double_click');
  });

  test('handles navigate_back action type', () => {
    const input = '{"type":"navigate_back"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('navigate_back');
  });

  test('handles navigate_forward action type', () => {
    const input = '{"type":"navigate_forward"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('navigate_forward');
  });

  test('handles dismiss_overlay action type', () => {
    const input = '{"type":"dismiss_overlay"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('dismiss_overlay');
  });

  test('handles switch_to_frame action type', () => {
    const input = '{"type":"switch_to_frame","selector":"iframe"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('switch_to_frame');
  });

  test('handles switch_to_parent_frame action type', () => {
    const input = '{"type":"switch_to_parent_frame"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('switch_to_parent_frame');
  });

  test('handles lookup action type', () => {
    const input = '{"type":"lookup","query":"test"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('lookup');
  });

  test('handles run_remote_command action type', () => {
    const input = '{"type":"run_remote_command","command":"ls"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('run_remote_command');
  });
});
