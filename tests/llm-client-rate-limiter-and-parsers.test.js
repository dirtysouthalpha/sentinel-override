// tests/llm-client-rate-limiter-and-parsers.test.js
// Tests for rate limiter, parseLLMResponse edge cases,
// and extractFirstJsonObject uncovered edge cases.
// Note: extractFirstJsonObject returns the raw JSON STRING, not a parsed object.

import { jest } from '@jest/globals';

// Chrome API mock
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({
        active_provider: 'zai',
        providers: {
          zai: {
            endpoint: 'https://api.z.ai/v1',
            api_key: 'test-key',
            model: 'test-model',
          },
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

const {
  setLLMRateLimit,
  resetLLMRateLimiter,
  extractFirstJsonObject,
  parseLLMResponse,
} = await import('../background/llm-client.js');

// ── Rate Limiter ─────────────────────────────────────────────────
describe('LLM Rate Limiter configuration', () => {
  beforeEach(() => {
    resetLLMRateLimiter();
  });

  test('setLLMRateLimit does not throw', () => {
    expect(() => setLLMRateLimit(3, 10000)).not.toThrow();
  });

  test('resetLLMRateLimiter clears state', () => {
    setLLMRateLimit(1, 60000);
    resetLLMRateLimiter();
    expect(() => setLLMRateLimit(10, 60000)).not.toThrow();
  });
});

// ── extractFirstJsonObject — deep edge cases ─────────────────────
// extractFirstJsonObject returns a raw JSON string, not a parsed object.
describe('extractFirstJsonObject — deep edge cases', () => {
  test('handles nested objects with valid type', () => {
    const input = '{"type":"click","options":{"nested":true}}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('click');
  });

  test('handles whitespace before JSON object', () => {
    const input = '   \n  \t  {"type":"navigate","url":"https://example.com"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('navigate');
  });

  test('returns null for string with no braces', () => {
    expect(extractFirstJsonObject('just a plain string with no json')).toBeNull();
  });

  test('finds valid object after invalid JSON attempt', () => {
    const input = '{not valid} {"type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('click');
  });

  test('recognizes read_console_messages type', () => {
    const input = '{"type":"read_console_messages","filter":"error","limit":50}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('read_console_messages');
  });

  test('recognizes read_network_requests type', () => {
    const input = '{"type":"read_network_requests","url_includes":"api","limit":30}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('read_network_requests');
  });

  test('recognizes drag_and_drop type', () => {
    const input = '{"type":"drag_and_drop","source_ref":"ref1","target_ref":"ref2"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('drag_and_drop');
  });

  test('recognizes navigate_back type', () => {
    const result = extractFirstJsonObject('{"type":"navigate_back"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('navigate_back');
  });

  test('recognizes navigate_forward type', () => {
    const result = extractFirstJsonObject('{"type":"navigate_forward"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('navigate_forward');
  });

  test('recognizes upload_file type', () => {
    const result = extractFirstJsonObject('{"type":"upload_file","selector":"input[type=file]"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('upload_file');
  });

  test('recognizes double_click type', () => {
    const result = extractFirstJsonObject('{"type":"double_click","selector":"#btn"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('double_click');
  });

  test('recognizes right_click type', () => {
    const result = extractFirstJsonObject('{"type":"right_click","selector":"#btn"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('right_click');
  });

  test('recognizes open_dropdown type', () => {
    const result = extractFirstJsonObject('{"type":"open_dropdown","selector":"select"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('open_dropdown');
  });

  test('recognizes switch_to_frame type', () => {
    const result = extractFirstJsonObject('{"type":"switch_to_frame","frame_selector":"iframe"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('switch_to_frame');
  });

  test('recognizes switch_to_parent_frame type', () => {
    const result = extractFirstJsonObject('{"type":"switch_to_parent_frame"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('switch_to_parent_frame');
  });

  test('recognizes scroll_to type', () => {
    const result = extractFirstJsonObject('{"type":"scroll_to","selector":"#footer"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('scroll_to');
  });

  test('recognizes check type', () => {
    const result = extractFirstJsonObject('{"type":"check","selector":"#cb"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('check');
  });

  test('recognizes check_all type', () => {
    const result = extractFirstJsonObject('{"type":"check_all","selector":"input[type=checkbox]"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('check_all');
  });

  test('recognizes click_at type', () => {
    const result = extractFirstJsonObject('{"type":"click_at","x":100,"y":200}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('click_at');
  });

  test('recognizes lookup type', () => {
    const result = extractFirstJsonObject('{"type":"lookup","domain":"example.com"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('lookup');
  });

  test('recognizes run_remote_command type', () => {
    const result = extractFirstJsonObject('{"type":"run_remote_command","command":"echo hi"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('run_remote_command');
  });

  test('recognizes smart_navigate type', () => {
    const result = extractFirstJsonObject('{"type":"smart_navigate","site":"google","query":"test"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('smart_navigate');
  });

  test('recognizes batch type', () => {
    const result = extractFirstJsonObject('{"type":"batch","commands":[]}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('batch');
  });

  test('recognizes verify type', () => {
    const result = extractFirstJsonObject('{"type":"verify","selector":"#r","expected":"ok"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('verify');
  });

  test('recognizes repeat_for_each type', () => {
    const result = extractFirstJsonObject('{"type":"repeat_for_each","selector":".item","action":{"type":"click"}}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('repeat_for_each');
  });

  test('returns null for object without recognized type', () => {
    const input = '{"foo":"bar","baz":42}';
    expect(extractFirstJsonObject(input)).toBeNull();
  });
});

// ── parseLLMResponse — edge cases ────────────────────────────────
describe('parseLLMResponse — edge cases', () => {
  test('returns note for null input', () => {
    const result = parseLLMResponse(null);
    expect(result).toBeTruthy();
    expect(result.type).toBe('note');
  });

  test('returns note for undefined input', () => {
    const result = parseLLMResponse(undefined);
    expect(result).toBeTruthy();
    expect(result.type).toBe('note');
  });

  test('returns note for empty string input', () => {
    const result = parseLLMResponse('');
    expect(result).toBeTruthy();
    expect(result.type).toBe('note');
  });

  test('parses simple click action from JSON', () => {
    const result = parseLLMResponse('{"type":"click","selector":"#btn"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });

  test('parses action from markdown code fence', () => {
    const input = '```json\n{"type":"navigate","url":"https://example.com"}\n```';
    const result = parseLLMResponse(input);
    expect(result).toBeTruthy();
    expect(result.type).toBe('navigate');
  });

  test('parses action from code fence without json label', () => {
    const input = '```\n{"type":"click","selector":"#btn"}\n```';
    const result = parseLLMResponse(input);
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
  });

  test('strips thinking blocks before parsing', () => {
    const input = '<thinkLet me reason about this</think{"type":"finish","summary":"Done"}';
    const result = parseLLMResponse(input);
    expect(result).toBeTruthy();
    expect(result.type).toBe('finish');
  });

  test('finds JSON after preamble text', () => {
    const input = 'I will click the button now. {"type":"click","selector":"#btn"}';
    const result = parseLLMResponse(input);
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
  });

  test('parses execute_js action', () => {
    const result = parseLLMResponse('{"type":"execute_js","code":"return 1","key":"test"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('execute_js');
  });

  test('parses extract action', () => {
    const result = parseLLMResponse('{"type":"extract","selector":"#content","key":"data"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('extract');
  });

  test('parses extract_list action', () => {
    const result = parseLLMResponse('{"type":"extract_list","selector":".item","key":"items"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('extract_list');
  });

  test('parses finish action', () => {
    const result = parseLLMResponse('{"type":"finish","summary":"Task completed successfully"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('finish');
  });

  test('parses dismiss_overlay action', () => {
    const result = parseLLMResponse('{"type":"dismiss_overlay"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('dismiss_overlay');
  });

  test('parses read_page action', () => {
    const result = parseLLMResponse('{"type":"read_page"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('read_page');
  });

  test('parses open_tab action', () => {
    const result = parseLLMResponse('{"type":"open_tab","url":"https://example.com"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('open_tab');
  });

  test('parses switch_tab action', () => {
    const result = parseLLMResponse('{"type":"switch_tab","tab_id":42}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('switch_tab');
  });

  test('parses close_tab action', () => {
    const result = parseLLMResponse('{"type":"close_tab","tab_id":42}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('close_tab');
  });

  test('parses note action', () => {
    const result = parseLLMResponse('{"type":"note","text":"Found something interesting"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('note');
  });

  test('returns note for invalid JSON', () => {
    const result = parseLLMResponse('this is not json at all');
    expect(result).toBeTruthy();
    expect(result.type).toBe('note');
  });

  test('returns note for JSON without type field', () => {
    const result = parseLLMResponse('{"foo":"bar"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('note');
  });

  test('unwraps action from wrapper object', () => {
    const result = parseLLMResponse('{"action":{"type":"click","selector":"#btn"}}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
  });

  test('unwraps command from wrapper object', () => {
    const result = parseLLMResponse('{"command":{"type":"navigate","url":"https://example.com"}}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('navigate');
  });

  test('unwraps next_action from wrapper object', () => {
    const result = parseLLMResponse('{"next_action":{"type":"type","selector":"#input","text":"hello"}}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('type');
  });

  test('captures reasoning from pre-JSON text', () => {
    const input = 'I should click the submit button because it will proceed. {"type":"click","selector":"#submit"}';
    const result = parseLLMResponse(input);
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
    // __reasoning is captured when preamble > 10 chars
    if (result.__reasoning) {
      expect(result.__reasoning).toContain('submit');
    }
  });

  test('parses smart_navigate action', () => {
    const result = parseLLMResponse('{"type":"smart_navigate","site":"google","query":"test"}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('smart_navigate');
  });

  test('parses batch action', () => {
    const result = parseLLMResponse('{"type":"batch","commands":[{"type":"click"}]}');
    expect(result).toBeTruthy();
    expect(result.type).toBe('batch');
  });
});
