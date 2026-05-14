// tests/llm-client.test.js
// Unit tests for pure utility functions exported from background/llm-client.js.
// These have no chrome.* or DOM dependencies.

// llm-client.js imports chrome APIs at module scope, so we stub the global
// before importing to avoid reference errors in Node.
globalThis.chrome = {
  storage: { local: { get: () => {}, set: () => {} } },
  runtime: { getURL: () => '' }
};

import {
  extractFirstJsonObject,
  detectGoalPortals,
  getMultiPortalDirective,
  getMultiArticleDirective,
  supportsVision,
  parseLLMResponse,
} from '../background/llm-client.js';

// extractFirstJsonObject returns the raw JSON string (not a parsed object)
// for the first valid command object found in the input.
describe('extractFirstJsonObject', () => {
  test('extracts a valid action JSON string from clean input', () => {
    const result = extractFirstJsonObject('{"type":"click","selector":"#btn"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('click');
  });

  test('extracts JSON string from text with leading prose', () => {
    const result = extractFirstJsonObject(
      'I will now click the button. {"type":"navigate","url":"https://example.com"}'
    );
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('navigate');
    expect(parsed.url).toBe('https://example.com');
  });

  test('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  test('returns null for plain text with no JSON', () => {
    expect(extractFirstJsonObject('no json here at all')).toBeNull();
  });

  test('returns null for JSON without a valid type field', () => {
    expect(extractFirstJsonObject('{"foo":"bar"}')).toBeNull();
  });

  test('handles JSON with nested object values without crashing', () => {
    const nested = '{"type":"execute_js","code":"var x=1;","key":"result"}';
    const result = extractFirstJsonObject(nested);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('execute_js');
  });

  test('picks first valid object when multiple JSON objects present', () => {
    const input = '{"type":"note","text":"first"} and {"type":"finish","summary":"done"}';
    const result = extractFirstJsonObject(input);
    expect(JSON.parse(result).type).toBe('note');
  });
});

// ========== detectGoalPortals ==========
describe('detectGoalPortals', () => {
  test('returns empty array for null', () => {
    expect(detectGoalPortals(null)).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(detectGoalPortals('')).toEqual([]);
  });

  test('returns empty array for non-string input', () => {
    expect(detectGoalPortals(42)).toEqual([]);
  });

  test('returns empty array for single portal mention', () => {
    const result = detectGoalPortals('Check Entra ID for suspicious sign-ins');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toContain('entra');
  });

  test('detects multiple portals in a goal', () => {
    const result = detectGoalPortals('Check Entra ID sign-ins and Defender alerts for the same user');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result).toContain('entra');
    expect(result).toContain('defender');
  });

  test('returns empty for goal with no portal mentions', () => {
    expect(detectGoalPortals('Navigate to example.com and click the button')).toEqual([]);
  });
});

// ========== getMultiPortalDirective ==========
describe('getMultiPortalDirective', () => {
  test('returns empty string for single portal goal', () => {
    const result = getMultiPortalDirective('Check Entra ID sign-ins');
    expect(result).toBe('');
  });

  test('returns empty string for null', () => {
    expect(getMultiPortalDirective(null)).toBe('');
  });

  test('returns directive text for multi-portal goal', () => {
    const result = getMultiPortalDirective('Check Entra ID and Defender for user john');
    expect(result).toContain('MULTI-PORTAL INVESTIGATION');
    expect(result).toContain('2 admin centers');
  });
});

// ========== getMultiArticleDirective ==========
describe('getMultiArticleDirective', () => {
  test('returns empty string for null', () => {
    expect(getMultiArticleDirective(null)).toBe('');
  });

  test('returns empty string for non-matching goal', () => {
    expect(getMultiArticleDirective('Check the dashboard for alerts')).toBe('');
  });

  test('returns directive for "top N articles" pattern', () => {
    const result = getMultiArticleDirective('Give me a breakdown of the top 5 articles about AI');
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns directive for "first N stories" pattern', () => {
    const result = getMultiArticleDirective('Summarize the first 3 stories about cybersecurity');
    expect(result).toBeTruthy();
  });

  test('returns empty for singular article mention', () => {
    expect(getMultiArticleDirective('Read the article about cybersecurity')).toBe('');
  });
});

// ========== supportsVision ==========
describe('supportsVision', () => {
  test('returns false for null model', () => {
    expect(supportsVision(null)).toBe(false);
  });

  test('returns false for undefined model', () => {
    expect(supportsVision(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(supportsVision('')).toBe(false);
  });

  test('returns false for GPT-3.5 (text-only)', () => {
    expect(supportsVision('gpt-3.5-turbo')).toBe(false);
  });

  test('returns true for GPT-4o', () => {
    expect(supportsVision('gpt-4o')).toBe(true);
  });

  test('returns true for Claude Sonnet', () => {
    expect(supportsVision('claude-sonnet-4-6')).toBe(true);
  });

  test('returns false for claude-2', () => {
    expect(supportsVision('claude-2')).toBe(false);
  });

  test('returns true for Gemini models', () => {
    expect(supportsVision('gemini-pro')).toBe(true);
  });

  test('returns true for models with "vision" in name', () => {
    expect(supportsVision('my-custom-vision-model')).toBe(true);
  });

  test('returns true for models with -vl suffix', () => {
    expect(supportsVision('qwen2.5-7b-vl')).toBe(true);
  });

  test('returns true for llava models', () => {
    expect(supportsVision('llava-1.5')).toBe(true);
  });
});

// ========== parseLLMResponse ==========
describe('parseLLMResponse', () => {
  test('parses valid JSON action object', () => {
    const result = parseLLMResponse('{"type":"click","selector":"#btn"}');
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });

  test('parses JSON wrapped in code fences', () => {
    const result = parseLLMResponse('```json\n{"type":"note","text":"hello"}\n```');
    expect(result.type).toBe('note');
    expect(result.text).toBe('hello');
  });

  test('extracts action from wrapper with action field', () => {
    const result = parseLLMResponse('{"action":{"type":"navigate","url":"https://example.com"}}');
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://example.com');
  });

  test('returns note on unparseable content', () => {
    const result = parseLLMResponse('I cannot parse this text');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('returns note on JSON with missing type', () => {
    const result = parseLLMResponse('{"foo":"bar"}');
    expect(result.type).toBe('note');
  });

  test('returns note on invalid type field', () => {
    const result = parseLLMResponse('{"type":"invalid_type_xyz"}');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Invalid command type');
  });

  test('parses finish action', () => {
    const result = parseLLMResponse('{"type":"finish","summary":"All done"}');
    expect(result.type).toBe('finish');
    expect(result.summary).toBe('All done');
  });
});
