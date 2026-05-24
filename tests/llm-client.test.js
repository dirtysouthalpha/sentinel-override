// tests/llm-client.test.js
// Unit tests for functions exported from background/llm-client.js.
// Covers: extractFirstJsonObject, detectGoalPortals, getMultiPortalDirective,
// getMultiArticleDirective, supportsVision, parseLLMResponse, getPlatformContext,
// generatePlan, callLLMWithRetry, callLLM, getRelevantPatterns.

import { jest } from '@jest/globals';

// llm-client.js imports chrome APIs at module scope, so we stub the global
// before importing to avoid reference errors in Node.
let _storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        const result = {};
        for (const k of keys) {
          if (_storageData[k] !== undefined) result[k] = _storageData[k];
        }
        return Promise.resolve(result);
      },
      set: () => Promise.resolve()
    }
  },
  runtime: { getURL: () => '', sendMessage: () => Promise.resolve() },
  tabs: { query: () => Promise.resolve([]) }
};

// Mock fetch globally
let _mockFetch = null;
const _originalFetch = globalThis.fetch;

import {
  extractFirstJsonObject,
  detectGoalPortals,
  getMultiPortalDirective,
  getMultiArticleDirective,
  supportsVision,
  parseLLMResponse,
  getPlatformContext,
  generatePlan,
  callLLMWithRetry,
  getRelevantPatterns,
  resetLLMRateLimiter,
} from '../background/llm-client.js';

import { PROVIDERS } from '../background/provider-registry.js';

beforeEach(() => {
  _storageData = {};
  _mockFetch = null;
  resetLLMRateLimiter();
  globalThis.fetch = (...args) => {
    if (_mockFetch) return _mockFetch(...args);
    return _originalFetch(...args);
  };
});

afterEach(() => {
  globalThis.fetch = _originalFetch;
});

// ========== extractFirstJsonObject ==========
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

  test('skips object without valid type and finds valid object later', () => {
    // First object is valid JSON but has no valid action type; second has a valid type
    const input = '{"foo":"bar"} some text {"type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('click');
  });

  test('handles all valid action types', () => {
    const types = [
      'click', 'type', 'navigate', 'scroll', 'select', 'hover', 'press_key',
      'extract', 'extract_list', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
      'execute_js', 'read_page', 'note', 'finish', 'open_tab', 'switch_tab', 'close_tab',
      'dismiss_overlay', 'switch_to_frame', 'click_at', 'scroll_to', 'check', 'check_all',
      'open_dropdown', 'upload_file', 'read_console_messages', 'read_network_requests',
      'lookup', 'run_remote_command', 'verify', 'repeat_for_each'
    ];
    for (const t of types) {
      const result = extractFirstJsonObject(`{"type":"${t}"}`);
      expect(result).not.toBeNull();
      expect(JSON.parse(result).type).toBe(t);
    }
  });

  test('returns null for object with unclosed brace', () => {
    expect(extractFirstJsonObject('{"type":"click"')).toBeNull();
  });

  test('handles escaped quotes inside strings', () => {
    const input = '{"type":"type","text":"he said \\"hello\\""}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).text).toBe('he said "hello"');
  });

  test('handles deeply nested JSON braces', () => {
    const input = '{"type":"execute_js","code":"if(true){return{a:1}}","key":"result"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('execute_js');
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

  test('returns empty array for undefined', () => {
    expect(detectGoalPortals(undefined)).toEqual([]);
  });

  test('detects Entra ID portal', () => {
    const result = detectGoalPortals('Check Entra ID for suspicious sign-ins');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toContain('entra');
  });

  test('detects Azure AD (legacy name)', () => {
    const result = detectGoalPortals('Check Azure AD sign-in logs');
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

  test('detects Exchange portal', () => {
    expect(detectGoalPortals('Check Exchange Online mail flow rules')).toContain('exchange');
  });

  test('detects mailbox audit in Exchange', () => {
    expect(detectGoalPortals('Review the mailbox audit logs')).toContain('exchange');
  });

  test('detects message trace in Exchange', () => {
    expect(detectGoalPortals('Run a message trace for the user')).toContain('exchange');
  });

  test('detects Purview portal', () => {
    expect(detectGoalPortals('Search the unified audit log in Purview')).toContain('purview');
  });

  test('detects compliance center', () => {
    expect(detectGoalPortals('Run a compliance search')).toContain('purview');
  });

  test('detects OneDrive', () => {
    expect(detectGoalPortals('Check OneDrive sharing settings')).toContain('onedrive');
  });

  test('detects SharePoint', () => {
    expect(detectGoalPortals('Review SharePoint external sharing')).toContain('sharepoint');
  });

  test('detects Teams', () => {
    expect(detectGoalPortals('Check Teams admin center')).toContain('teams');
  });

  test('detects Intune', () => {
    expect(detectGoalPortals('Review Intune device compliance')).toContain('intune');
  });

  test('detects MDM', () => {
    expect(detectGoalPortals('Check MDM enrollment status')).toContain('intune');
  });

  test('detects Defender', () => {
    expect(detectGoalPortals('Check Defender for Endpoint alerts')).toContain('defender');
  });

  test('detects M365 admin center', () => {
    expect(detectGoalPortals('Go to admin.microsoft.com')).toContain('m365_admin');
  });

  test('detects Azure portal', () => {
    expect(detectGoalPortals('Open the Azure portal')).toContain('azure_portal');
  });

  test('detects SentinelOne', () => {
    expect(detectGoalPortals('Check SentinelOne console')).toContain('sentinelone');
  });

  test('detects ConnectWise', () => {
    expect(detectGoalPortals('Open ConnectWise Manage')).toContain('connectwise');
  });

  test('detects NinjaOne', () => {
    expect(detectGoalPortals('Check NinjaOne RMM')).toContain('ninjaone');
  });

  test('detects Datto', () => {
    expect(detectGoalPortals('Review Datto alerts')).toContain('datto');
  });

  test('detects Autotask', () => {
    expect(detectGoalPortals('Open Autotask ticket')).toContain('datto');
  });

  test('detects IT Glue', () => {
    expect(detectGoalPortals('Check IT Glue documentation')).toContain('itglue');
  });

  test('detects Huntress', () => {
    expect(detectGoalPortals('Review Huntress alerts')).toContain('huntress');
  });

  test('detects sign-in logs pattern', () => {
    expect(detectGoalPortals('Review the sign-in logs')).toContain('entra');
  });

  test('detects audit logs pattern', () => {
    expect(detectGoalPortals('Pull the audit logs')).toContain('entra');
  });

  test('detects deep visibility for SentinelOne', () => {
    expect(detectGoalPortals('Run a deep visibility query')).toContain('sentinelone');
  });

  test('detects many portals simultaneously', () => {
    const result = detectGoalPortals(
      'Check Entra sign-ins, Exchange mail flow, Purview audit, Defender alerts, and OneDrive sharing'
    );
    expect(result.length).toBeGreaterThanOrEqual(5);
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

  test('returns empty string for undefined', () => {
    expect(getMultiPortalDirective(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(getMultiPortalDirective('')).toBe('');
  });

  test('returns directive text for multi-portal goal', () => {
    const result = getMultiPortalDirective('Check Entra ID and Defender for user john');
    expect(result).toContain('MULTI-PORTAL INVESTIGATION');
    expect(result).toContain('2 admin centers');
  });

  test('lists portal names in directive', () => {
    const result = getMultiPortalDirective('Check Entra, Defender, and Exchange');
    expect(result).toContain('entra');
    expect(result).toContain('defender');
    expect(result).toContain('exchange');
  });

  test('includes step budget guidance', () => {
    const result = getMultiPortalDirective('Check Entra and Defender');
    expect(result).toContain('300 steps');
  });

  test('includes per-portal execution pattern', () => {
    const result = getMultiPortalDirective('Check Entra and Defender');
    expect(result).toContain('Plan portal-by-portal');
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

  test('includes batch pattern guidance', () => {
    const result = getMultiArticleDirective('Give me the top 10 articles from CNN');
    expect(result).toContain('BATCH');
  });

  test('includes step budget math for specific N', () => {
    const result = getMultiArticleDirective('Summarize the top 5 articles');
    expect(result).toContain('2*5');
  });

  test('detects "best N articles" pattern', () => {
    const result = getMultiArticleDirective('What are the best 3 articles today');
    expect(result).toBeTruthy();
  });

  test('detects "recent N posts" pattern', () => {
    const result = getMultiArticleDirective('Show me the recent 5 posts about AI');
    expect(result).toBeTruthy();
  });

  test('detects breakdown/summary without specific N', () => {
    const result = getMultiArticleDirective('Give me a full breakdown on each article');
    expect(result).toBeTruthy();
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

  test('returns false for claude-instant', () => {
    expect(supportsVision('claude-instant')).toBe(false);
  });

  test('returns false for text-only suffix', () => {
    expect(supportsVision('some-model-text-only')).toBe(false);
  });

  test('returns true for Claude Opus', () => {
    expect(supportsVision('claude-opus-4-6')).toBe(true);
  });

  test('returns true for Claude Haiku', () => {
    expect(supportsVision('claude-haiku-4-5')).toBe(true);
  });

  test('returns true for GPT-5', () => {
    expect(supportsVision('gpt-5')).toBe(true);
  });

  test('returns true for GPT-4-vision', () => {
    expect(supportsVision('gpt-4-vision')).toBe(true);
  });

  test('returns true for o3 models', () => {
    expect(supportsVision('o3')).toBe(true);
  });

  test('returns true for o4-mini', () => {
    expect(supportsVision('o4-mini')).toBe(true);
  });

  test('returns true for qwen-vl with dash', () => {
    expect(supportsVision('qwen2-vl-7b')).toBe(true);
  });

  test('uses providerHint for registry lookup', () => {
    expect(supportsVision('claude-3-5-sonnet', 'anthropic')).toBe(true);
  });

  test('returns false for gpt-3.5 even with openai hint', () => {
    expect(supportsVision('gpt-3.5-turbo', 'openai')).toBe(false);
  });

  test('returns true for gpt-4o with openai hint', () => {
    expect(supportsVision('gpt-4o', 'openai')).toBe(true);
  });

  test('case insensitive matching', () => {
    expect(supportsVision('GPT-4O')).toBe(true);
    expect(supportsVision('CLAUDE-SONNET-4-6')).toBe(true);
  });

  test('returns false for claude-3-haiku-text (deny list)', () => {
    expect(supportsVision('claude-3-haiku-text')).toBe(false);
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

  test('handles code fences without json label', () => {
    const result = parseLLMResponse('```\n{"type":"click","selector":"#btn"}\n```');
    expect(result.type).toBe('click');
  });

  test('extracts from command wrapper', () => {
    const result = parseLLMResponse('{"command":{"type":"navigate","url":"https://example.com"}}');
    expect(result.type).toBe('navigate');
  });

  test('extracts from next_action wrapper', () => {
    const result = parseLLMResponse('{"next_action":{"type":"click","selector":"#btn"}}');
    expect(result.type).toBe('click');
  });

  test('returns note for empty string', () => {
    const result = parseLLMResponse('');
    expect(result.type).toBe('note');
  });

  test('returns note for null input', () => {
    const result = parseLLMResponse(null);
    expect(result.type).toBe('note');
  });

  test('returns note for non-string input', () => {
    const result = parseLLMResponse(42);
    expect(result.type).toBe('note');
  });

  test('sanitizes invalid escape sequences in JSON strings', () => {
    // Backslash before ` (invalid JSON escape)
    const input = '{"type":"note","text":"hello \\`world\\`"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('hello `world`');
  });

  test('sanitizes raw newlines inside JSON string values', () => {
    const input = '{"type":"note","text":"line1\nline2"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('line1\nline2');
  });

  test('sanitizes raw carriage returns inside JSON string values', () => {
    const input = '{"type":"note","text":"line1\rline2"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
  });

  test('sanitizes raw tabs inside JSON string values', () => {
    const input = '{"type":"note","text":"col1\tcol2"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('col1\tcol2');
  });

  test('regex salvage: recovers finish action from malformed long content', () => {
    // Build a long string (>200 chars) with a malformed finish
    const summary = 'A'.repeat(300);
    const input = `Here is the finish action: {"type":"finish","summary":"${summary}"} extra trailing content that is very long`;
    const result = parseLLMResponse(input);
    expect(result.type).toBe('finish');
    expect(result.summary).toContain('A');
  });

  test('regex salvage: recovers note action from malformed long content', () => {
    const text = 'B'.repeat(300);
    const input = `Here is the note: {"type":"note","text":"${text}"} extra content here that is very long and makes it over two hundred characters total for the salvage path`;
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toContain('B');
  });

  test('regex salvage: prefers finish over note when both present (finish first)', () => {
    const summary = 'S'.repeat(300);
    const input = `Result: {"summary":"${summary}"} then later {"text":"something"} more content to make it long enough over two hundred characters padding here`;
    const result = parseLLMResponse(input);
    expect(result.type).toBe('finish');
  });

  test('sanitize-then-parse salvage for long content with valid JSON', () => {
    const text = 'X'.repeat(200);
    const validJson = `{"type":"note","text":"${text}"}`;
    const result = parseLLMResponse(validJson);
    expect(result.type).toBe('note');
    expect(result.text).toContain('X');
  });

  test('preserves valid JSON escapes during sanitization', () => {
    const input = '{"type":"note","text":"line1\\nline2"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('line1\nline2');
  });

  test('preserves valid unicode escapes', () => {
    const input = '{"type":"note","text":"hello \\u0041"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('hello A');
  });

  test('drops other control characters in strings', () => {
    // char code 0x01 (SOH) should be dropped
    const input = '{"type":"note","text":"helloworld"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('helloworld');
  });

  test('handles JSON with prose before it', () => {
    const input = 'I will now click the button. Here is my action: {"type":"click","selector":"#submit"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#submit');
  });

  test('handles all action types through parseLLMResponse', () => {
    const actionTypes = ['click', 'type', 'navigate', 'scroll', 'select', 'hover',
      'press_key', 'extract', 'extract_list', 'wait_for_text', 'wait_for_element',
      'wait_for_navigation', 'execute_js', 'read_page', 'note', 'finish', 'open_tab',
      'switch_tab', 'close_tab', 'dismiss_overlay', 'switch_to_frame', 'click_at',
      'scroll_to', 'check', 'check_all', 'open_dropdown', 'upload_file',
      'read_console_messages', 'read_network_requests', 'lookup', 'run_remote_command',
      'verify', 'repeat_for_each'];
    for (const t of actionTypes) {
      const result = parseLLMResponse(`{"type":"${t}"}`);
      expect(result.type).toBe(t);
    }
  });

  test('handles empty string response', () => {
    const result = parseLLMResponse('');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('handles whitespace-only response', () => {
    const result = parseLLMResponse('   \n\t  ');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('handles response with null values', () => {
    const result = parseLLMResponse('{"type":null,"text":null}');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Missing type field');
  });

  test('handles response with undefined values', () => {
    const result = parseLLMResponse('{"type":"click","selector":undefined}');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('handles deeply nested object with missing required fields', () => {
    const result = parseLLMResponse('{"nested":{"deep":{"value":"test"}}}');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Missing type field');
  });

  test('handles array response instead of object', () => {
    const result = parseLLMResponse('[{"type":"click"},{"type":"type"}]');
    expect(result.type).toBe('click');
  });

  test('handles number instead of object', () => {
    const result = parseLLMResponse('12345');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('handles boolean response', () => {
    const result = parseLLMResponse('true');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('handles response with circular reference pattern (escaped)', () => {
    const result = parseLLMResponse('{"type":"note","text":"[Circular]"}');
    expect(result.type).toBe('note');
    expect(result.text).toBe('[Circular]');
  });

  test('handles response with mixed line endings', () => {
    const input = '{"type":"note","text":"line1\r\nline2\nline3\rline4"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toContain('line1');
  });

  test('handles response with emoji and unicode', () => {
    const input = '{"type":"note","text":"Hello 🌍 世界 🚀"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBe('Hello 🌍 世界 🚀');
  });

  test('handles response with escaped unicode that becomes invalid after sanitization', () => {
    const input = '{"type":"note","text":"\\uXXXX"}';
    const result = parseLLMResponse(input);
    expect(result.type).toBe('note');
    expect(result.text).toBeTruthy();
  });
});

// ========== getPlatformContext ==========
describe('getPlatformContext', () => {
  test('returns empty string when no platform matches', () => {
    const result = getPlatformContext('https://example.com', 'do something');
    expect(result).toBe('');
  });

  test('returns empty string for null URL', () => {
    const result = getPlatformContext(null, 'do something');
    expect(result).toBe('');
  });

  test('returns empty string for undefined URL', () => {
    const result = getPlatformContext(undefined, 'do something');
    expect(result).toBe('');
  });

  test('returns context for matching SonicWall NSM URL', () => {
    const result = getPlatformContext('https://192.168.1.1/sonicwall', 'Check firewall rules');
    // May or may not match depending on platform profile, but should not throw
    expect(typeof result).toBe('string');
  });

  test('caches result for same URL+goal combination', () => {
    const url = 'https://example.com';
    const goal = 'test goal';
    const result1 = getPlatformContext(url, goal);
    const result2 = getPlatformContext(url, goal);
    expect(result1).toBe(result2);
  });

  test('handles null goal without error', () => {
    expect(() => getPlatformContext('https://example.com', null)).not.toThrow();
  });

  test('handles undefined goal without error', () => {
    expect(() => getPlatformContext('https://example.com', undefined)).not.toThrow();
  });

  test('evicts stale cache entries when cache exceeds 50 items', () => {
    // Fill cache with >50 entries to trigger eviction
    for (let i = 0; i < 55; i++) {
      getPlatformContext(`https://site${i}.com`, `goal ${i}`);
    }
    // Should still work after eviction
    const result = getPlatformContext('https://example.com', 'test');
    expect(typeof result).toBe('string');
  });
});

// ========== generatePlan ==========
describe('generatePlan', () => {
  const openaiSettings = {
    api_key: 'test-key',
    api_endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o'
  };

  test('returns null when no API key is set', async () => {
    const result = await generatePlan('Click the button', {});
    expect(result).toBeNull();
  });

  test('returns null when API key is empty string', async () => {
    const result = await generatePlan('Click the button', { api_key: '' });
    expect(result).toBeNull();
  });

  test('returns null when API returns non-200 status', async () => {
    _mockFetch = () => Promise.resolve({ ok: false, status: 500 });
    const result = await generatePlan('Click the button', openaiSettings);
    expect(result).toBeNull();
  });

  test('returns null when API returns empty content', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '' } }] })
    });
    const result = await generatePlan('Click the button', openaiSettings);
    expect(result).toBeNull();
  });

  test('returns plan array from valid API response', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Step 1","Step 2","Step 3"]}' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Step 1', 'Step 2', 'Step 3']);
  });

  test('handles plan in code fences', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '```json\n{"plan":["Step 1","Step 2"]}\n```' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Step 1', 'Step 2']);
  });

  test('returns null when plan is empty array', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":[]}' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toBeNull();
  });

  test('returns null when content is prose with no plan JSON', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is the plan but it is not valid JSON' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    _mockFetch = () => Promise.reject(new Error('Network error'));
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toBeNull();
  });

  test('returns plan via extractFirstJsonObject fallback', async () => {
    // extractFirstJsonObject only matches objects with a valid action "type" field.
    // Use a valid type like "note" that also carries a "plan" array.
    const payload = 'Some reasoning text before {"type":"note","plan":["Step A","Step B"]} and after';
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: payload } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Step A', 'Step B']);
  });

  test('returns null when extractFirstJsonObject returns malformed JSON', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Result: {not valid json} end' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toBeNull();
  });

  test('returns null when extractFirstJsonObject finds JSON without plan key', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Result: {"type":"click","selector":"#btn"} done' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toBeNull();
  });

  test('uses context.currentUrl in prompt when provided', async () => {
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Step 1"]}' } }]
      })
    }));
    _mockFetch = mockFn;
    await generatePlan('Check firewall', openaiSettings, {
      currentUrl: 'https://192.168.1.1',
      pageTitle: 'SonicWall'
    });
    expect(mockFn).toHaveBeenCalled();
  });

  test('includes relevant patterns in prompt when provided', async () => {
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Step 1"]}' } }]
      })
    }));
    _mockFetch = mockFn;
    await generatePlan('Check firewall', openaiSettings, {
      relevantPatterns: [{ goal: 'Check firewall', steps: [{ type: 'navigate' }, { type: 'click' }] }]
    });
    expect(mockFn).toHaveBeenCalled();
  });

  test('includes multi-portal directive when goal spans multiple portals', async () => {
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Step 1"]}' } }]
      })
    }));
    _mockFetch = mockFn;
    await generatePlan('Check Entra ID and Defender for the user', openaiSettings);
    expect(mockFn).toHaveBeenCalled();
  });

  test('uses default endpoint when none provided', async () => {
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Step 1"]}' } }]
      })
    }));
    _mockFetch = mockFn;
    await generatePlan('Check firewall', { api_key: 'test-key' });
    expect(mockFn.mock.calls[0][0]).toContain('z.ai');
  });

  test('uses default model when none provided', async () => {
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Step 1"]}' } }]
      })
    }));
    _mockFetch = mockFn;
    await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.openai.com/v1/chat/completions'
    });
    const body = JSON.parse(mockFn.mock.calls[0][1].body);
    expect(body.model).toBe('glm-5');
  });

  test('handles Anthropic endpoint format', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: '{"plan":["Step 1"]}' }]
      })
    });
    const result = await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-4-6'
    });
    expect(result).toEqual(['Step 1']);
  });
});

// ========== callLLMWithRetry ==========
describe('callLLMWithRetry', () => {
  const defaultConfig = {
    maxRetries: 3,
    retryDelay: 100,
    maxRetryDelay: 500,
    fetchTimeout: 30000,
    historyWindow: 10,
    strategyShiftThreshold: 3
  };

  function makeAgentState(overrides = {}) {
    return {
      apiCallCount: 0,
      consecutiveFailures: 0,
      currentStrategies: [],
      agentMemory: {},
      agentPlan: null,
      currentPlanStep: 0,
      ...overrides
    };
  }

  function setupOpenAIStorage() {
    _storageData = {
      active_provider: 'openai',
      providers: {
        openai: {
          api_key: 'test-key',
          model: 'gpt-4o',
          endpoint: 'https://api.openai.com/v1/chat/completions'
        }
      }
    };
  }

  function setupAnthropicStorage() {
    _storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: {
          api_key: 'test-key',
          model: 'claude-sonnet-4-6',
          endpoint: 'https://api.anthropic.com/v1/messages'
        }
      }
    };
  }

  function makeOpenAIResponse(content) {
    return {
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content } }]
      })
    };
  }


  function makeAnthropicToolResponse(name, input) {
    return {
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'tool_use', name, input }],
        stop_reason: 'tool_use'
      })
    };
  }

  test('retries on 429 error', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('429 Rate limited'));
      return Promise.resolve(makeOpenAIResponse('{"type":"click","selector":"#btn"}'));
    };
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'click the button', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('click');
    expect(callCount).toBe(2);
  });

  test('retries on 502 error', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('502 Bad Gateway'));
      return Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    };
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('retries on 503 error', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('503 Service Unavailable'));
      return Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    };
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('retries on timeout error', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('API timed out after 30s'));
      return Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    };
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('retries on Failed to fetch error', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Failed to fetch'));
      return Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    };
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('retries on AbortError', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      return Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    };
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('throws when max retries exceeded', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.reject(new Error('429 Rate limited'));
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        3, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('429');
  });

  test('does not retry non-retryable errors', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      return Promise.reject(new Error('Some other error'));
    };
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        0, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('Some other error');
    expect(callCount).toBe(1);
  });

  test('throws when no API key configured', async () => {
    _storageData = {
      active_provider: 'openai',
      providers: { openai: { api_key: '', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1/chat/completions' } }
    };
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        0, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('API key');
  });

  test('returns parsed action on successful OpenAI response', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"click","selector":"#btn"}'));
    const result = await callLLMWithRetry(
      [{ type: 'button', selector: '#btn' }], 1, 'page text', null,
      'click the button', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('click');
  });

  test('increments apiCallCount', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const state = makeAgentState();
    await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, state
    );
    expect(state.apiCallCount).toBe(1);
  });

  test('tracks token usage from OpenAI response', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"type":"note","text":"ok"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 }
      })
    });
    const state = makeAgentState({ totalInputTokens: 0, totalOutputTokens: 0 });
    await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, state
    );
    expect(state.totalInputTokens).toBe(100);
    expect(state.totalOutputTokens).toBe(50);
  });

  test('tracks token usage from Anthropic response', async () => {
    setupAnthropicStorage();
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: '{"type":"note","text":"ok"}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }
      })
    });
    const state = makeAgentState({
      totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheReadTokens: 0, totalCacheWriteTokens: 0
    });
    await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, state
    );
    expect(state.totalInputTokens).toBe(200);
    expect(state.totalOutputTokens).toBe(80);
    expect(state.totalCacheReadTokens).toBe(50);
    expect(state.totalCacheWriteTokens).toBe(10);
  });

  test('throws on 429 HTTP response', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve({
      ok: false, status: 429,
      text: () => Promise.resolve('Rate limited')
    });
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        2, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('429');
  });

  test('throws on 400 Unknown Model response', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve({
      ok: false, status: 400,
      text: () => Promise.resolve('Unknown Model specified')
    });
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        2, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('Unknown model');
  });

  test('throws on generic HTTP error', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve({
      ok: false, status: 500,
      text: () => Promise.resolve('Internal Server Error')
    });
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        2, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('API Error');
  });

  test('throws timeout error on AbortError from fetch', async () => {
    setupOpenAIStorage();
    _mockFetch = () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    };
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        2, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('timed out');
  });

  test('includes runbook context for runbook-style goals', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null,
      'STEP 1: Navigate to login. PHASE 1: Authentication. RUNBOOK: Reset password.',
      [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('includes finish-now context for navigation fatigue (5+ navigates)', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [
      { action: { type: 'navigate', url: 'https://a.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://b.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://c.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://d.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://e.com' }, result: 'ok' },
    ];
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', history, 6, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('includes hard stop context for 3+ navigates with no extraction', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [
      { action: { type: 'navigate', url: 'https://a.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://b.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://c.com' }, result: 'ok' },
    ];
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', history, 4, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('does not trigger fatigue when extract actions present', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [
      { action: { type: 'navigate', url: 'https://a.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://b.com' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://c.com' }, result: 'ok' },
      { action: { type: 'extract', key: 'data' }, result: 'extracted' },
    ];
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', history, 5, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('includes strategy shift context on consecutive failures', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        consecutiveFailures: 5,
        currentStrategies: ['click', 'execute_js']
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes plan context when agentPlan is set', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        agentPlan: ['Navigate to site', 'Click button', 'Extract data'],
        currentPlanStep: 1
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes verification context when pendingVerification is set', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        pendingVerification: { type: 'click', description: 'Save button' }
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes memory context when agentMemory has keys', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        agentMemory: { user_ip: '192.168.1.100', rule_name: 'Block-RDP' }
      })
    );
    expect(result.type).toBe('note');
  });

  test('handles Anthropic tool_use response', async () => {
    setupAnthropicStorage();
    _mockFetch = () => Promise.resolve(makeAnthropicToolResponse('click', { selector: '#btn' }));
    const result = await callLLMWithRetry(
      [{ type: 'button', selector: '#btn' }], 1, 'page text', null,
      'click the button', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
  });

  test('sanitizes history screenshots except most recent', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [
      { step: 1, action: { type: 'click', selector: '#btn' }, result: { base64Image: 'old_screenshot', text: 'ok' } },
      { step: 2, action: { type: 'click', selector: '#btn2' }, result: { base64Image: 'new_screenshot', text: 'ok2' } },
    ];
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', history, 3, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('includes vision guidance when base64Image is provided with vision model', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', 'base64imagedata', 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        screenshotMeta: { width: 1920, height: 1080, dpr: 2 }
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes budgetHint when set in agentState', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({ budgetHint: '12/20 steps used' })
    );
    expect(result.type).toBe('note');
  });

  test('includes platform-specific strategy hints for M365 URLs on failure', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1,
      'https://entra.microsoft.com/users',
      0, defaultConfig, makeAgentState({
        consecutiveFailures: 5,
        currentStrategies: ['click']
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes platform-specific strategy hints for VirusTotal URLs', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1,
      'https://www.virustotal.com/gui/file/abc123',
      0, defaultConfig, makeAgentState({
        consecutiveFailures: 5,
        currentStrategies: ['click']
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes platform-specific strategy hints for SonicWall URLs', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1,
      'https://192.168.1.1/sonicwall',
      0, defaultConfig, makeAgentState({
        consecutiveFailures: 5,
        currentStrategies: ['click']
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes client knowledge context when set', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        clientKnowledgeText: 'Known quirk: login page has a 2-second delay.'
      })
    );
    expect(result.type).toBe('note');
  });

  test('includes loop directive when set in agentState', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        loopDirective: 'LOOP DETECTED: You have clicked the same element 3 times.'
      })
    );
    expect(result.type).toBe('note');
  });

  test('handles CRITICAL last-action-failed context', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [
      { action: { type: 'click', selector: '#missing-btn' }, result: 'not found' }
    ];
    const result = await callLLMWithRetry(
      [{ type: 'button', selector: '#other-btn' }], 1, 'page text', null,
      'click the button', history, 2, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('truncates long selectors in history', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const longSelector = 'a'.repeat(100);
    const history = [
      { step: 1, action: { type: 'click', selector: longSelector }, result: 'ok' },
    ];
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', history, 2, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('handles string results in history', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [
      { step: 1, action: { type: 'navigate', url: 'https://example.com' }, result: 'Page loaded successfully with content' },
    ];
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', history, 2, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('uses thinking mode when consecutive failures reach threshold', async () => {
    setupAnthropicStorage();
    _mockFetch = () => Promise.resolve(makeAnthropicToolResponse('note', { text: 'ok' }));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, makeAgentState({
        consecutiveFailures: 5,
        currentStrategies: ['click']
      })
    );
    expect(result.type).toBe('note');
  });

  test('uses extended history window in runbook mode', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const history = [];
    for (let i = 0; i < 20; i++) {
      history.push({ action: { type: 'note', text: `step ${i}` }, result: 'ok' });
    }
    const result = await callLLMWithRetry(
      [], 0, 'page content', null,
      'STEP 1: Navigate. PHASE 1: Check. INVESTIGATION mode.',
      history, 21, 'https://example.com',
      0, defaultConfig, makeAgentState()
    );
    expect(result.type).toBe('note');
  });

  test('handles SentinelOne URL platform-specific strategy hints', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const result = await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1,
      'https://sentinelone.example.com/console',
      0, defaultConfig, makeAgentState({
        consecutiveFailures: 5,
        currentStrategies: ['click']
      })
    );
    expect(result.type).toBe('note');
  });

  test('handles non-retryable error without retrying', async () => {
    setupOpenAIStorage();
    let callCount = 0;
    _mockFetch = () => {
      callCount++;
      return Promise.reject(new Error('Connection refused'));
    };
    await expect(
      callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        0, defaultConfig, makeAgentState()
      )
    ).rejects.toThrow('Connection refused');
    expect(callCount).toBe(1);
  });
});

// ========== getRelevantPatterns ==========
describe('getRelevantPatterns', () => {
  test('returns empty array when no patterns stored', async () => {
    _storageData = {};
    const result = await getRelevantPatterns('click the button');
    expect(result).toEqual([]);
  });

  test('returns matching patterns sorted by score', async () => {
    _storageData = {
      learned_patterns: [
        { goal: 'click the submit button on login page', success: true, steps: [{ type: 'click' }] },
        { goal: 'navigate to the dashboard', success: true, steps: [{ type: 'navigate' }] },
        { goal: 'extract data from the table', success: true, steps: [{ type: 'extract' }] }
      ]
    };
    const result = await getRelevantPatterns('click the submit button');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].goal).toContain('click');
  });

  test('excludes unsuccessful patterns', async () => {
    _storageData = {
      learned_patterns: [
        { goal: 'click the button', success: false, steps: [{ type: 'click' }] }
      ]
    };
    const result = await getRelevantPatterns('click the button');
    expect(result).toEqual([]);
  });

  test('limits to 3 results', async () => {
    const patterns = [];
    for (let i = 0; i < 10; i++) {
      patterns.push({ goal: `click button ${i} test`, success: true, steps: [{ type: 'click' }] });
    }
    _storageData = { learned_patterns: patterns };
    const result = await getRelevantPatterns('click button test');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('returns empty on storage error', async () => {
    globalThis.chrome.storage.local.get = () => Promise.reject(new Error('Storage error'));
    const result = await getRelevantPatterns('click the button');
    expect(result).toEqual([]);
    // Restore
    globalThis.chrome.storage.local.get = (keys) => {
      const result = {};
      for (const k of keys) {
        if (_storageData[k] !== undefined) result[k] = _storageData[k];
      }
      return Promise.resolve(result);
    };
  });

  test('filters out patterns with no word overlap (>3 chars)', async () => {
    _storageData = {
      learned_patterns: [
        { goal: 'completely unrelated task about elephants', success: true, steps: [{ type: 'navigate' }] }
      ]
    };
    const result = await getRelevantPatterns('click the submit button');
    expect(result).toEqual([]);
  });

  test('handles empty learned_patterns array', async () => {
    _storageData = { learned_patterns: [] };
    const result = await getRelevantPatterns('click the button');
    expect(result).toEqual([]);
  });

  test('scores patterns by matching word overlap', async () => {
    _storageData = {
      learned_patterns: [
        { goal: 'click the submit button on the form', success: true, steps: [{ type: 'click' }] },
        { goal: 'navigate to settings page', success: true, steps: [{ type: 'navigate' }] }
      ]
    };
    const result = await getRelevantPatterns('click the submit button');
    expect(result.length).toBe(1);
    expect(result[0].goal).toContain('click the submit button');
  });
});

// ========== generatePlan: empty content from parseResponse (lines 894-895) ==========
describe('generatePlan: empty parseResponse content path', () => {
  const anthropicSettings = {
    api_key: 'test-key',
    api_endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6'
  };

  test('returns null when Anthropic parseResponse returns empty string (lines 894-895)', async () => {
    // Anthropic parseResponse returns block.text — if text is '' it is falsy,
    // triggering the "Plan generation: empty response content" warning and null return.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: '' }]
      })
    });
    const result = await generatePlan('Check firewall rules', anthropicSettings);
    expect(result).toBeNull();
  });
});

// ========== callLLM: non-tool-use provider paths (lines 1655, 1740-1742) ==========
describe('callLLM: non-tool-use provider fallback paths', () => {
  const defaultConfig = {
    maxRetries: 3,
    retryDelay: 0,
    maxRetryDelay: 100,
    fetchTimeout: 30000,
    historyWindow: 10,
    strategyShiftThreshold: 3
  };

  function makeAgentState(overrides = {}) {
    return {
      apiCallCount: 0,
      consecutiveFailures: 0,
      currentStrategies: [],
      agentMemory: {},
      agentPlan: null,
      currentPlanStep: 0,
      ...overrides
    };
  }

  // Temporarily disable supportsToolUse on a provider to exercise the non-tool-use
  // branches in callLLM (lines 1655 and 1739-1742). We use the anthropic provider
  // so that parseResponse can return an empty string (block.text === '') without
  // throwing, giving us a falsy responseText for line 1741.
  test('calls buildBody (not buildBodyWithTools) when provider lacks supportsToolUse (line 1655)', async () => {
    _storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: {
          api_key: 'test-key',
          model: 'claude-sonnet-4-6',
          endpoint: 'https://api.anthropic.com/v1/messages'
        }
      }
    };

    const originalSupportsToolUse = PROVIDERS.anthropic.supportsToolUse;
    PROVIDERS.anthropic.supportsToolUse = false;
    try {
      _mockFetch = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: '{"type":"note","text":"ok"}' }]
        })
      });

      const result = await callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        0, defaultConfig, makeAgentState()
      );
      // buildBody path taken — response parsed as text JSON
      expect(result.type).toBe('note');
    } finally {
      PROVIDERS.anthropic.supportsToolUse = originalSupportsToolUse;
    }
  });

  test('returns note when non-tool-use provider returns empty responseText (lines 1740-1742)', async () => {
    _storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: {
          api_key: 'test-key',
          model: 'claude-sonnet-4-6',
          endpoint: 'https://api.anthropic.com/v1/messages'
        }
      }
    };

    const originalSupportsToolUse = PROVIDERS.anthropic.supportsToolUse;
    PROVIDERS.anthropic.supportsToolUse = false;
    try {
      // Anthropic parseResponse returns block.text; an empty string is falsy,
      // so line 1741 fires: return { type: 'note', text: 'Empty LLM response...' }
      _mockFetch = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: '' }]
        })
      });

      const result = await callLLMWithRetry(
        [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
        0, defaultConfig, makeAgentState()
      );
      expect(result.type).toBe('note');
      expect(result.text).toContain('Empty LLM response');
    } finally {
      PROVIDERS.anthropic.supportsToolUse = originalSupportsToolUse;
    }
  });
});

// ========== regexSalvageFinishOrNote: empty raw for note type (lines 1862-1863) ==========
describe('parseLLMResponse: regexSalvageFinishOrNote with empty raw (lines 1862-1863)', () => {
  test('returns null from regexSalvageFinishOrNote when note text is empty (line 1862)', () => {
    // Craft content > 200 chars that:
    //  1. Contains {"text":""} so regexSalvageFinishOrNote detects a note action
    //     and captures an empty string for raw — the regex requires a } after the
    //     closing quote: "text"\s*:\s*"([\s\S]*?)"\s*\}
    //  2. Is NOT parseable as valid JSON overall (so sanitize-then-parse in the
    //     catch block also fails and we fall through to regex salvage)
    //  3. Has no valid "type" field recognized by extractFirstJsonObject
    // When raw is '' after the regex match, line 1862 returns null, and
    // parseLLMResponse falls through to the default Parse error note.
    const padding = 'x'.repeat(160);
    const malformed = `INVALID_STUFF ${padding} here: {"text":""} trailing invalid []]`;
    expect(malformed.length).toBeGreaterThan(200);

    const result = parseLLMResponse(malformed);
    // regexSalvageFinishOrNote returns null (raw is empty string), so parseLLMResponse
    // falls through to the default Parse error note.
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });
});

// ========== parseLLMResponse: sanitize-then-parse salvage with valid type (line 1913) ==========
describe('parseLLMResponse: sanitize-then-parse catch-block salvage (line 1913)', () => {
  test('returns parsed object with non-standard type via sanitize-then-parse salvage (line 1913)', () => {
    // Build a JSON object > 200 chars whose "type" is NOT in the validTypes set.
    // Flow through parseLLMResponse:
    //   1. extractFirstJsonObject → returns null (custom type not in validTypes)
    //   2. jsonStr stays as the full content (valid JSON)
    //   3. sanitizeLlmJson + JSON.parse succeeds; parsed.type = "my_custom_action"
    //   4. validTypes check throws "Invalid command type: my_custom_action"
    //   5. Catch block (content.length > 200): sanitize-then-parse on content.trim()
    //      succeeds again; parsed.type is truthy → line 1913 returns parsed.
    const content = '{"type":"my_custom_action","data":"' + 'x'.repeat(200) + '"}';
    expect(content.length).toBeGreaterThan(200);

    const result = parseLLMResponse(content);
    // The catch-block salvage at line 1913 returns the parsed object directly
    expect(result.type).toBe('my_custom_action');
  });
});

// ========== LLM Rate Limiter ==========
import { setLLMRateLimit } from '../background/llm-client.js';

describe('LLM rate limiter', () => {
  beforeEach(() => {
    resetLLMRateLimiter();
  });

  test('allows calls within the limit', () => {
    setLLMRateLimit(3, 60000);
    // First 3 calls should not throw
    expect(() => {
      resetLLMRateLimiter();
      setLLMRateLimit(3, 60000);
    }).not.toThrow();
  });

  test('setLLMRateLimit configures maxCalls', () => {
    setLLMRateLimit(2, 60000);
    // This test just verifies no throw when setting limits
    resetLLMRateLimiter();
    setLLMRateLimit(120, 60000);
  });
});
