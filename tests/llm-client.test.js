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
        if (!keys || typeof keys[Symbol.iterator] !== 'function') {
          return Promise.resolve(result);
        }
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
  parseVisionResponse,
  getPlatformContext,
  generatePlan,
  callLLMWithRetry,
  getRelevantPatterns,
  resetLLMRateLimiter,
  callLLMSimple,
  selectModelForStep,
  recordModelUsage,
  getCostTracker,
  estimateCostUsd,
  isSimpleStep,
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
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
    expect(parsed.type).toBe('click');
  });

  test('extracts JSON string from text with leading prose', () => {
    const result = extractFirstJsonObject(
      'I will now click the button. {"type":"navigate","url":"https://example.com"}'
    );
    expect(result).toBeTruthy();
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
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
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
    expect(parsed.type).toBe('execute_js');
  });

  test('picks first valid object when multiple JSON objects present', () => {
    const input = '{"type":"note","text":"first"} and {"type":"finish","summary":"done"}';
    const result = extractFirstJsonObject(input);
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
    expect(parsed.type).toBe('note');
  });

  test('skips object without valid type and finds valid object later', () => {
    // First object is valid JSON but has no valid action type; second has a valid type
    const input = '{"foo":"bar"} some text {"type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
    expect(parsed.type).toBe('click');
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
      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (e) {
        throw new Error(`Failed to parse JSON result for type "${t}": ${result}`);
      }
      expect(parsed.type).toBe(t);
    }
  });

  test('returns null for object with unclosed brace', () => {
    expect(extractFirstJsonObject('{"type":"click"')).toBeNull();
  });

  test('handles escaped quotes inside strings', () => {
    const input = '{"type":"type","text":"he said \\"hello\\""}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
    expect(parsed.text).toBe('he said "hello"');
  });

  test('handles deeply nested JSON braces', () => {
    const input = '{"type":"execute_js","code":"if(true){return{a:1}}","key":"result"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse JSON result: ${result}`);
    }
    expect(parsed.type).toBe('execute_js');
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

// ========== parseVisionResponse ==========
describe('parseVisionResponse', () => {
  test('parses a clean vision response object', () => {
    const r = parseVisionResponse('{"thinking":"x","action":{"type":"click","index":3}}');
    expect(r.action.type).toBe('click');
    expect(r.action.index).toBe(3);
  });

  test('strips a markdown code fence (GLM-4V wraps JSON in ```)', () => {
    const r = parseVisionResponse('```json\n{"action":{"type":"click","index":5}}\n```');
    expect(r.action.index).toBe(5);
  });

  test('strips <think> reasoning blocks before the JSON', () => {
    const r = parseVisionResponse('<think>I should click accept</think>\n{"action":{"type":"click","index":2}}');
    expect(r.action.index).toBe(2);
  });

  test('tolerates explanatory prose before and after the JSON', () => {
    const r = parseVisionResponse('Sure! Here is my decision:\n{"action":{"type":"input","index":7,"text":"hi"}}\nLet me know if that works.');
    expect(r.action.type).toBe('input');
    expect(r.action.index).toBe(7);
    expect(r.action.text).toBe('hi');
  });

  test('recovers the nested action object when the outer wrapper is malformed', () => {
    // trailing garbage after the action object breaks a naive JSON.parse
    const r = parseVisionResponse('{"thinking":"x","action":{"type":"click","index":4}} <<< done');
    expect(r.action.index).toBe(4);
  });

  test('sanitizes invalid escape sequences inside string values', () => {
    const r = parseVisionResponse('{"thinking":"path C:\\\\temp \\`x\\`","action":{"type":"scroll","direction":"down"}}');
    expect(r.action.type).toBe('scroll');
  });

  test('regex-salvages a bare type when JSON is too broken to parse', () => {
    const r = parseVisionResponse('garbage "type": "click", "index": 9 more garbage }');
    expect(r.action.type).toBe('click');
    expect(r.action.index).toBe(9);
  });

  test('returns null for empty or non-string input', () => {
    expect(parseVisionResponse('')).toBeNull();
    expect(parseVisionResponse(null)).toBeNull();
    expect(parseVisionResponse(42)).toBeNull();
  });

  test('returns null for content with no recoverable action', () => {
    expect(parseVisionResponse('I am not sure what to do here.')).toBeNull();
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

  test('returns single-step fallback when API returns non-200 status', async () => {
    _mockFetch = () => Promise.resolve({ ok: false, status: 500 });
    const result = await generatePlan('Click the button', openaiSettings);
    expect(result).toEqual(['Click the button']);
  });

  test('returns single-step fallback when API returns empty content', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '' } }] })
    });
    const result = await generatePlan('Click the button', openaiSettings);
    expect(result).toEqual(['Click the button']);
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

  test('returns single-step fallback when plan is empty array', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":[]}' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Check firewall']);
  });

  test('returns single-step fallback when content is prose with no plan JSON', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is the plan but it is not valid JSON' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Check firewall']);
  });

  test('returns single-step fallback on network error', async () => {
    _mockFetch = () => Promise.reject(new Error('Network error'));
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Check firewall']);
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

  test('returns single-step fallback when response is malformed JSON', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Result: {not valid json} end' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Check firewall']);
  });

  test('returns single-step fallback when JSON has no plan/steps key', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Result: {"type":"click","selector":"#btn"} done' } }]
      })
    });
    const result = await generatePlan('Check firewall', openaiSettings);
    expect(result).toEqual(['Check firewall']);
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
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    expect(mockFn.mock.calls[0]?.[0]).toContain('z.ai');
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
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    const callArgs = mockFn.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    let body;
    try {
      body = JSON.parse(callArgs?.body);
    } catch (e) {
      throw new Error(`Failed to parse request body: ${callArgs?.body}`);
    }
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

  test('Z.AI endpoint does NOT include response_format in request body (Bug #2 regression guard)', async () => {
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":["Navigate to site","Extract articles"]}' } }]
      })
    }));
    _mockFetch = mockFn;
    const result = await generatePlan('Go to dnn.com and give me top articles', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(result).toEqual(['Navigate to site', 'Extract articles']);
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    const callArgs = mockFn.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    let body;
    try {
      body = JSON.parse(callArgs?.body);
    } catch (e) {
      throw new Error(`Failed to parse request body: ${callArgs?.body}`);
    }
    expect(body.response_format).toBeUndefined();
  });

  test('Z.AI numbered-prose response parsed via Strategy 4 (no JSON in response)', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is my plan:\n1. Navigate to dnn.com\n2. Read the homepage to find top stories\n3. Extract the top 10 article links and titles\n4. Open each article tab\n5. Read and summarize each article' } }]
      })
    });
    const result = await generatePlan('Go to dnn.com and give me top 10 articles', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toMatch(/navigate/i);
  });

  test('Z.AI bulleted-prose response parsed via Strategy 4b', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Steps to complete the task:\n- Navigate to the firewall management URL\n- Log in with provided credentials\n- Check the access rules table\n- Extract blocked connection entries' } }]
      })
    });
    const result = await generatePlan('Check firewall rules', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toMatch(/navigate/i);
  });

  test('Z.AI plain array response handled by Strategy 1 (no wrapper object)', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["Navigate to the firewall admin page","Login with credentials","Check access rules","Extract blocked entries","Finish with summary"]' } }]
      })
    });
    const result = await generatePlan('Check firewall rules', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toMatch(/navigate/i);
  });

  test('Z.AI object-steps response normalized to strings by Strategy 1', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"plan":[{"step":1,"action":"Navigate to firewall admin"},{"step":2,"action":"Login with credentials"},{"step":3,"action":"Check rules"}]}' } }]
      })
    });
    const result = await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toMatch(/navigate/i);
  });

  test('Z.AI bold-markdown numbered steps parsed by Strategy 4', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '**Steps:**\n**1. Navigate to the firewall admin panel**\n**2. Login with your credentials**\n**3. Click on Access Rules to view them**\n**4. Extract all blocked connection entries**' } }]
      })
    });
    const result = await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('Z.AI bare array embedded in prose handled by Strategy 3', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is the plan: ["Navigate to the admin panel","Login with credentials","Check firewall rules","Extract blocked entries","Finish with a summary of findings"] Hope this helps!' } }]
      })
    });
    const result = await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toMatch(/navigate/i);
  });

  test('Z.AI <think> block with JSON inside does NOT corrupt the real plan (Bug #2 regression)', async () => {
    // GLM models sometimes embed <think>...</think> in content. The thinking block
    // may contain a JSON snippet that looks like a plan — it must be stripped so
    // Strategy 2 finds the REAL plan JSON that follows the closing </think>.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '<think>\nI should structure this as JSON like {"plan":["wrong step 1","wrong step 2"]}.\n</think>\n\n{"plan":["Navigate to the firewall admin panel","Login with credentials","Check access rules","Extract blocked entries","Finish with findings"]}' } }]
      })
    });
    const result = await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toMatch(/navigate/i);
    // Must NOT return steps from the thinking block
    expect(result[0]).not.toMatch(/wrong/i);
  });

  test('Z.AI <think> block strips correctly when only prose follows (Strategy 4 fallback)', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '<think>Let me think through this task step by step.</think>\n\n1. Navigate to the SonicWall admin URL\n2. Login with provided credentials\n3. Check the firewall access rules\n4. Extract blocked connection entries\n5. Finish with a summary' } }]
      })
    });
    const result = await generatePlan('Check firewall', {
      api_key: 'test-key',
      api_endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      model: 'glm-5'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toMatch(/navigate/i);
  });

  test('returns single-step fallback when fetch throws (network error to any endpoint)', async () => {
    // Verifies the catch-all fallback at the end of generatePlan covers hard failures
    // (e.g. provider.buildBody crash, network error, AbortError from timeout).
    _mockFetch = () => Promise.reject(new Error('Network unreachable'));
    const result = await generatePlan('Do something important', {
      api_key: 'test-key',
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toContain('Do something important');
  });

  test('returns fallback when provider returns HTTP 200 with error payload (data.error auth failure)', async () => {
    // Auth error throw at line 1178 is caught by the outer catch which returns fallback.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [], error: { message: 'Invalid API key' } })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe('Do task');
  });

  test('returns fallback when provider returns HTTP 200 with data.msg auth failure (Z.AI style)', async () => {
    // data.msg + data.code + data.success===false triggers auth error → caught → fallback.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [], msg: 'Unauthorized', code: 401, success: false })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe('Do task');
  });

  test('extracts steps from phases format JSON (Strategy 1)', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"phases":[{"phase":1,"title":"Setup","steps":["Navigate to page","Click the button"]},{"phase":2,"title":"Verify","steps":["Check the result"]}]}' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Navigate to page', 'Click the button', 'Check the result']);
  });

  test('extracts steps from phases format JSON embedded in prose (Strategy 2)', async () => {
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is my plan: {"phases":[{"phase":1,"steps":["Step one","Step two","Step three"]}]} — hope that helps!' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Step one', 'Step two', 'Step three']);
  });

  test('extracts steps from {"plan":[...]} embedded in prose via Strategy 2', async () => {
    // Strategy 1 fails (JSON.parse rejects the prose prefix).
    // Strategy 2 balanced-brace scan finds {"plan":[...]} and returns the steps array.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is the plan: {"plan":["Navigate to settings","Click save","Verify change"]} — follow these steps.' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Navigate to settings', 'Click save', 'Verify change']);
  });

  test('extracts steps from {"steps":[...]} embedded in prose via Strategy 2', async () => {
    // Strategy 1 fails (JSON.parse rejects the prose prefix).
    // Strategy 2 balanced-brace scan finds {"steps":[...]} and returns the steps array.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Let me break this down: {"steps":["Open the app","Navigate to settings","Confirm"]}. Good luck!' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Open the app', 'Navigate to settings', 'Confirm']);
  });

  test('extracts steps from phases format with control char prefix via Strategy 2', async () => {
    // Content has a control char (\x01) before the JSON object. Strategy 1's jsonStr strips
    // control chars so "Prefix  {..." fails JSON.parse. Strategy 2 scans contentNoThink
    // (which retains the \x01) and correctly finds the balanced {"phases":[...]} block.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Prefix \x01 {"phases":[{"steps":["Alpha","Beta"]}]} suffix' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
  });

  test('Strategy 2 advances past non-plan JSON objects before finding plan (covers L1260 s2from advance)', async () => {
    // Strategy 1: JSON.parse rejects the whole string (two JSON values).
    // Strategy 2: scans {"action":"click"} first — valid JSON but no plan/steps/phases
    // → s2from = s2end + 1 (L1260), then finds {"plan":[...]} and returns it.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"action":"click","selector":"#btn"} then {"plan":["Open settings","Click save"]}' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Open settings', 'Click save']);
  });

  test('Strategy 2 else-break when brace is never closed (covers L1261)', async () => {
    // Strategy 1: JSON.parse fails (not valid JSON).
    // Strategy 2: finds { but never finds matching } — depth never returns to 0 — s2end stays -1
    // → else { break; } at L1261 fires. Strategies 3-4 also fail (no }), Strategy 5 returns goal.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'The plan is: {"plan":["Open settings","Close dialog"' } }] // no closing }
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('Strategy 2 brace scanner handles backslash escapes in JSON strings (covers L1234-1235)', async () => {
    // Content with \" inside JSON strings: Strategy 1 fails (prose prefix), Strategy 2 runs.
    // During the brace-balance scan, hitting \ inside a string sets esc=true (L1235);
    // the next char then hits the esc=true branch (L1234) to reset it and skip the char.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Plan: {"plan":["Step with \\"quotes\\"","Step with \\nnewline","Final step"]}' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  test('returns fallback when API response body is not an object (array)', async () => {
    // `Array.isArray(data)` check throws internally, caught by outer catch → fallback.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([1, 2, 3])
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe('Do task');
  });

  test('extracts steps from phases format via Strategy 2 when step value contains } character', async () => {
    // Strategy 1 fails (prose prefix prevents JSON.parse). Strategy 2's string-aware
    // brace scanner correctly ignores the } inside the quoted string "Set value }=10"
    // and parses the full phases object, returning all three steps.
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here is my plan: {"phases":[{"steps":["Open admin panel","Set value }=10","Verify config"]}]}' } }]
      })
    });
    const result = await generatePlan('Do task', openaiSettings);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Open admin panel', 'Set value }=10', 'Verify config']);
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

  test('writes resolved model to agentState.model so supportsVision works', async () => {
    setupOpenAIStorage();
    _mockFetch = () => Promise.resolve(makeOpenAIResponse('{"type":"note","text":"ok"}'));
    const state = makeAgentState();
    expect(state.model).toBeUndefined();
    await callLLMWithRetry(
      [], 0, 'page content', null, 'do something', [], 1, 'https://example.com',
      0, defaultConfig, state
    );
    expect(state.model).toBe('gpt-4o');
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
      if (!keys || typeof keys[Symbol.iterator] !== 'function') {
        return Promise.resolve(result);
      }
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

  test('returns single-step fallback when Anthropic parseResponse returns empty string', async () => {
    // Anthropic parseResponse returns block.text — if text is '' it is falsy,
    // triggering the single-step fallback (Strategy 5).
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: '' }]
      })
    });
    const result = await generatePlan('Check firewall rules', anthropicSettings);
    expect(result).toEqual(['Check firewall rules']);
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

  test('vision fallback uses buildBody when supportsToolUse is false (covers L2229)', async () => {
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
      let callCount = 0;
      _mockFetch = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('vision not supported') });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ type: 'text', text: '{"type":"note","text":"done"}' }] })
        });
      };
      const result = await callLLMWithRetry(
        [], 0, 'page content', 'base64data==', 'do something', [], 1, 'https://example.com',
        0, { ...defaultConfig, maxRetries: 0 }, makeAgentState()
      );
      expect(result.type).toBe('note');
      expect(callCount).toBe(2);
    } finally {
      PROVIDERS.anthropic.supportsToolUse = originalSupportsToolUse;
    }
  });
});

// ========== callLLM early-exit paths (credit limit, no provider) ==========
describe('callLLM: early-exit guard paths', () => {
  const defaultConfig = {
    maxRetries: 0,
    retryDelay: 0,
    maxRetryDelay: 100,
    fetchTimeout: 30000,
    historyWindow: 10,
    strategyShiftThreshold: 3
  };

  function makeState(overrides = {}) {
    return { apiCallCount: 0, consecutiveFailures: 0, currentStrategies: [], agentMemory: {}, agentPlan: null, currentPlanStep: 0, ...overrides };
  }

  test('returns credit-limit finish when sendMessage reports limit exceeded (L2030-2031)', async () => {
    const orig = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = () => Promise.resolve({ allowed: false });
    try {
      const result = await callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://example.com', 0, defaultConfig, makeState());
      expect(result.type).toBe('finish');
      expect(result.summary).toContain('Daily credit limit');
    } finally {
      globalThis.chrome.runtime.sendMessage = orig;
    }
  });

});

// ========== callLLM API response validation paths ==========
describe('callLLM: API response validation paths', () => {
  const defaultConfig = {
    maxRetries: 0,
    retryDelay: 0,
    maxRetryDelay: 100,
    fetchTimeout: 30000,
    historyWindow: 10,
    strategyShiftThreshold: 3
  };

  function makeState(overrides = {}) {
    return { apiCallCount: 0, consecutiveFailures: 0, currentStrategies: [], agentMemory: {}, agentPlan: null, currentPlanStep: 0, ...overrides };
  }

  function setupOpenAI() {
    _storageData = {
      active_provider: 'openai',
      providers: {
        openai: { api_key: 'test-key', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1/chat/completions' }
      }
    };
  }

  test('throws when API returns array instead of object (L2268)', async () => {
    setupOpenAI();
    _mockFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([1, 2, 3]) });
    await expect(
      callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://api.openai.com/v1/chat/completions', 0, defaultConfig, makeState())
    ).rejects.toThrow('invalid response body');
  });

  test('throws auth error when 200 response contains error payload (L2272-2273)', async () => {
    setupOpenAI();
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ error: { message: 'Invalid API key supplied.' } })
    });
    await expect(
      callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://api.openai.com/v1/chat/completions', 0, defaultConfig, makeState())
    ).rejects.toThrow('Authentication Failed');
  });

  test('throws auth error for msg-based error payload (L2272-2273 msg path)', async () => {
    setupOpenAI();
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ msg: 'Unauthorized access' })
    });
    await expect(
      callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://api.openai.com/v1/chat/completions', 0, defaultConfig, makeState())
    ).rejects.toThrow('Authentication Failed');
  });

  test('returns note when parseResponse throws on non-tool-use provider (L2421-2422)', async () => {
    setupOpenAI();
    const orig = PROVIDERS.openai.supportsToolUse;
    PROVIDERS.openai.supportsToolUse = false;
    try {
      // No choices in response → parseResponse throws → caught at L2420 → returns note
      _mockFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      const result = await callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://api.openai.com/v1/chat/completions', 0, defaultConfig, makeState());
      expect(result.type).toBe('note');
      expect(result.text).toContain('unparseable');
    } finally {
      PROVIDERS.openai.supportsToolUse = orig;
    }
  });

  test('warns and falls through when Anthropic parseToolUseResponse throws (L2328)', async () => {
    _storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: { api_key: 'test-key', model: 'claude-sonnet-4-6', endpoint: 'https://api.anthropic.com/v1/messages' }
      }
    };
    // stop_reason=tool_use but malformed content → parseToolUseResponse throws → falls through to text parse → no content → note
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ stop_reason: 'tool_use', content: null })
    });
    const result = await callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://api.anthropic.com/v1/messages', 0, defaultConfig, makeState());
    expect(result.type).toBe('note');
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
  test('returns Parse error note for non-standard type (salvage requires valid type)', () => {
    // Build a JSON object > 200 chars whose "type" is NOT in the validTypes set.
    // Flow through parseLLMResponse:
    //   1. extractFirstJsonObject → returns null (custom type not in validTypes)
    //   2. jsonStr stays as the full content (valid JSON)
    //   3. sanitizeLlmJson + JSON.parse succeeds; parsed.type = "my_custom_action"
    //   4. validTypes check throws "Invalid command type: my_custom_action"
    //   5. Catch block salvage: sanitize-then-parse succeeds but type is not valid → not returned
    //   6. Falls through to default Parse error note.
    const content = '{"type":"my_custom_action","data":"' + 'x'.repeat(200) + '"}';
    expect(content.length).toBeGreaterThan(200);

    const result = parseLLMResponse(content);
    // Salvage correctly rejects invalid types — returns a Parse error note instead
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });

  test('salvage path recovers valid action from short content with bad escape (< 200 chars)', () => {
    // Verify the length guard was removed — short valid-action JSON with a sanitizable
    // escape should be recovered even when < 200 chars.
    const content = '{"type":"navigate","url":"https://example.com/path\\`end"}';
    expect(content.length).toBeLessThan(200);
    const result = parseLLMResponse(content);
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://example.com/path`end');
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

  test('throws rate limit exceeded when limit is exhausted', async () => {
    resetLLMRateLimiter();
    setLLMRateLimit(1, 60000);
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
    const cfg = {
      maxRetries: 0, retryDelay: 100, maxRetryDelay: 500,
      fetchTimeout: 30000, historyWindow: 10, strategyShiftThreshold: 3
    };
    const state = {
      apiCallCount: 0, consecutiveFailures: 0,
      currentStrategies: [], agentMemory: {}, agentPlan: null, currentPlanStep: 0
    };
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '{"type":"note","text":"ok"}' } }] })
    });
    // First call consumes the one allowed slot
    await callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://example.com', 0, cfg, state);
    // Second call hits the rate limit
    await expect(
      callLLMWithRetry([], 0, 'page', null, 'goal', [], 1, 'https://example.com', 0, cfg, { ...state })
    ).rejects.toThrow('rate limit exceeded');
    // Restore defaults
    setLLMRateLimit(120, 60000);
  });
});

// ==========================
// Bug #2 regression tests: generatePlan prose fallback
// ==========================
describe('Bug #2 regression: generatePlan prose fallback', () => {
  test('extracts numbered steps from prose when JSON parsing fails', async () => {
    // Each line must have at least 10 characters after the number for regex to match
    const proseResponse = `Here's the plan:
1. Navigate to the account settings page and find security
2. Click on the two-factor authentication option
3. Scan the QR code with your authenticator app`;

    _mockFetch = () => Promise.resolve({
      ok: true,
      json: async () => ({ choices: [{ message: { content: proseResponse } }] }),
    });

    const { generatePlan } = await import('../background/llm-client.js');
    const result = await generatePlan('Enable 2FA', {
      api_key: 'test-key',
      api_endpoint: 'https://api.test.com/v1/chat/completions',
      model: 'test-model',
    });

    // Should extract numbered steps from prose
    expect(result).toEqual([
      'Navigate to the account settings page and find security',
      'Click on the two-factor authentication option',
      'Scan the QR code with your authenticator app',
    ]);
  });

  test('extracts bullet steps from prose when JSON parsing fails', async () => {
    // Each line must have at least 10 characters after the bullet for regex to match
    const proseResponse = `Plan:
- Navigate to the admin panel and log in with credentials
- Select the users management option from sidebar
- Add a new user with email and temporary password`;

    _mockFetch = () => Promise.resolve({
      ok: true,
      json: async () => ({ choices: [{ message: { content: proseResponse } }] }),
    });

    const { generatePlan } = await import('../background/llm-client.js');
    const result = await generatePlan('Add user', {
      api_key: 'test-key',
      api_endpoint: 'https://api.test.com/v1/chat/completions',
      model: 'test-model',
    });

    // Should extract bullet steps from prose
    expect(result).toEqual([
      'Navigate to the admin panel and log in with credentials',
      'Select the users management option from sidebar',
      'Add a new user with email and temporary password',
    ]);
  });

  test('falls back to single-step plan when prose parsing fails', async () => {
    const gibberishResponse = 'This is not valid JSON or prose steps';

    _mockFetch = () => Promise.resolve({
      ok: true,
      json: async () => ({ choices: [{ message: { content: gibberishResponse } }] }),
    });

    const { generatePlan } = await import('../background/llm-client.js');
    const result = await generatePlan('Do something complex', {
      api_key: 'test-key',
      api_endpoint: 'https://api.test.com/v1/chat/completions',
      model: 'test-model',
    });

    // Should fall back to single-step plan from goal
    expect(result).toEqual(['Do something complex']);
  });

  test('handles JSON with steps instead of plan key', async () => {
    const stepsKeyResponse = `{"steps": ["Navigate to the page", "Click the button", "Verify result"]}`;

    _mockFetch = () => Promise.resolve({
      ok: true,
      json: async () => ({ choices: [{ message: { content: stepsKeyResponse } }] }),
    });

    const { generatePlan } = await import('../background/llm-client.js');
    const result = await generatePlan('Test goal', {
      api_key: 'test-key',
      api_endpoint: 'https://api.test.com/v1/chat/completions',
      model: 'test-model',
    });

    // Should handle both "plan" and "steps" keys
    expect(result).toEqual(['Navigate to the page', 'Click the button', 'Verify result']);
  });

  test('handles Z.AI endpoint without JSON mode', async () => {
    // Z.AI endpoint should NOT receive response_format:json_object
    // to avoid 400 errors
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"plan": ["Step 1", "Step 2"]}' } }] }),
    }));

    _mockFetch = mockFn;

    const { generatePlan } = await import('../background/llm-client.js');
    const result = await generatePlan('Test goal', {
      api_key: 'test-key',
      api_endpoint: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
      model: 'MiMo-V2.5',
    });

    // Verify the request was made without jsonMode causing 400
    expect(mockFn).toHaveBeenCalled();
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    expect(result).toEqual(['Step 1', 'Step 2']);

    // Verify response_format is not sent (would cause 400 on Z.AI)
    const callArgs = mockFn.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    let body;
    try {
      body = JSON.parse(callArgs?.body);
    } catch (e) {
      throw new Error(`Failed to parse request body: ${callArgs?.body}`);
    }
    expect(body.response_format).toBeUndefined();
  });
});

// ========== callLLMSimple ==========
describe('callLLMSimple', () => {
  const openAiProvider = {
    active_provider: 'openai',
    providers: {
      openai: {
        api_key: 'sk-test123',
        model: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1/chat/completions'
      }
    }
  };

  test('returns parsed text on success (OpenAI)', async () => {
    _storageData = { ...openAiProvider };
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'Hello from the model' } }] })
    });
    const result = await callLLMSimple('system prompt', 'user prompt');
    expect(result).toBe('Hello from the model');
  });

  test('returns parsed text on success (Anthropic)', async () => {
    _storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: {
          api_key: 'sk-ant-test',
          model: 'claude-sonnet-4-6',
          endpoint: 'https://api.anthropic.com/v1/messages'
        }
      }
    };
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'Anthropic response' }] })
    });
    const result = await callLLMSimple('sys', 'user');
    expect(result).toBe('Anthropic response');
  });

  test('throws when API key is missing (empty storage → legacy fallback with no key)', async () => {
    _storageData = {};
    // getActiveProvider() always returns a provider — empty storage triggers legacy
    // fallback with apiKey: '' which hits the "API key not configured" guard.
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('API key not configured');
  });

  test('throws when API key is missing (explicit empty key)', async () => {
    _storageData = {
      active_provider: 'openai',
      providers: {
        openai: { api_key: '', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1/chat/completions' }
      }
    };
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('API key not configured');
  });

  test('throws when API returns non-ok status', async () => {
    _storageData = { ...openAiProvider };
    _mockFetch = () => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized')
    });
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('API Error 401');
  });

  test('throws when API response body is null', async () => {
    _storageData = { ...openAiProvider };
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(null)
    });
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('null response body');
  });

  test('throws "Empty response from API" when Anthropic returns empty text block', async () => {
    // Anthropic parseResponse returns block.text; '' is falsy so callLLMSimple
    // throws its own "Empty response" guard (not the provider's error).
    _storageData = {
      active_provider: 'anthropic',
      providers: {
        anthropic: {
          api_key: 'sk-ant-test',
          model: 'claude-sonnet-4-6',
          endpoint: 'https://api.anthropic.com/v1/messages'
        }
      }
    };
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: [{ type: 'text', text: '' }] })
    });
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('Empty response from API');
  });

  test('throws provider error when OpenAI returns null content', async () => {
    // OpenAI parseResponse throws "API returned null content" before callLLMSimple
    // can check for empty text — the provider error propagates as-is.
    _storageData = { ...openAiProvider };
    _mockFetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: null } }] })
    });
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('API returned null content');
  });

  test('converts AbortError to timeout message', async () => {
    _storageData = { ...openAiProvider };
    _mockFetch = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    };
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('timed out after 30s');
  });

  test('re-throws non-abort errors as-is', async () => {
    _storageData = { ...openAiProvider };
    _mockFetch = () => Promise.reject(new Error('Network failure'));
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('Network failure');
  });

  test('passes maxTokens parameter to provider buildBody', async () => {
    _storageData = { ...openAiProvider };
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] })
    }));
    _mockFetch = mockFn;
    await callLLMSimple('sys', 'user', 500);
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    const callArgs = mockFn.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    let body;
    try {
      body = JSON.parse(callArgs?.body);
    } catch (e) {
      throw new Error(`Failed to parse request body: ${callArgs?.body}`);
    }
    expect(body.max_tokens).toBe(500);
  });

  test('uses default maxTokens of 1200 when not provided', async () => {
    _storageData = { ...openAiProvider };
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] })
    }));
    _mockFetch = mockFn;
    await callLLMSimple('sys', 'user');
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    const callArgs = mockFn.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    let body;
    try {
      body = JSON.parse(callArgs?.body);
    } catch (e) {
      throw new Error(`Failed to parse request body: ${callArgs?.body}`);
    }
    expect(body.max_tokens).toBe(1200);
  });

  test('passes system and user prompts to the API correctly', async () => {
    _storageData = { ...openAiProvider };
    const mockFn = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'done' } }] })
    }));
    _mockFetch = mockFn;
    await callLLMSimple('my system prompt', 'my user prompt');
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    const callArgs = mockFn.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    let body;
    try {
      body = JSON.parse(callArgs?.body);
    } catch (e) {
      throw new Error(`Failed to parse request body: ${callArgs?.body}`);
    }
    const msgs = body.messages;
    expect(msgs.some(m => m.role === 'system' && m.content === 'my system prompt')).toBe(true);
    expect(msgs.some(m => m.role === 'user' && m.content === 'my user prompt')).toBe(true);
  });

  test('includes error text in API error message (truncated to 200 chars)', async () => {
    _storageData = { ...openAiProvider };
    const longError = 'x'.repeat(300);
    _mockFetch = () => Promise.resolve({
      ok: false,
      status: 500,
      text: () => Promise.resolve(longError)
    });
    const err = await callLLMSimple('sys', 'user').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(typeof err.message === 'string' && err.message).toContain('API Error 500');
    expect(typeof err.message === 'string' && err.message.length).toBeLessThan(220);
  });

  test('throws when systemPrompt is empty (L2664 guard)', async () => {
    await expect(callLLMSimple('', 'user prompt')).rejects.toThrow('systemPrompt and userPrompt are required');
  });

  test('throws when userPrompt is null (L2664 guard)', async () => {
    await expect(callLLMSimple('system prompt', null)).rejects.toThrow('systemPrompt and userPrompt are required');
  });

  test('covers inner response.text() catch when text() throws on error response (L2681)', async () => {
    _storageData = {
      active_provider: 'openai',
      providers: { openai: { api_key: 'sk-test', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1/chat/completions' } }
    };
    _mockFetch = () => Promise.resolve({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error('body stream error'))
    });
    await expect(callLLMSimple('sys', 'user')).rejects.toThrow('API Error 503');
  });
});

// ========== selectModelForStep ==========
describe('selectModelForStep', () => {
  test('returns null for null or undefined input', () => {
    expect(selectModelForStep(null)).toBeNull();
    expect(selectModelForStep(undefined)).toBeNull();
  });

  test('returns light for all simple observation types', () => {
    const simpleTypes = ['read_page', 'extract', 'extract_list', 'read_network_requests', 'read_console_messages', 'scroll', 'wait'];
    for (const type of simpleTypes) {
      expect(selectModelForStep({ type })).toBe('light');
    }
  });

  test('returns default for complex type with 0 or 1 previous failures', () => {
    expect(selectModelForStep({ type: 'click', previousFailures: 0 })).toBe('default');
    expect(selectModelForStep({ type: 'type', previousFailures: 1 })).toBe('default');
    expect(selectModelForStep({ type: 'navigate', previousFailures: 0 })).toBe('default');
    expect(selectModelForStep({ type: 'form_fill', previousFailures: 1 })).toBe('default');
    expect(selectModelForStep({ type: 'execute_js', previousFailures: 0 })).toBe('default');
  });

  test('returns heavy for complex type with more than 1 previous failure', () => {
    expect(selectModelForStep({ type: 'click', previousFailures: 2 })).toBe('heavy');
    expect(selectModelForStep({ type: 'form_fill', previousFailures: 5 })).toBe('heavy');
  });

  test('returns heavy when hasScreenshot is true', () => {
    expect(selectModelForStep({ type: 'unknown_type', hasScreenshot: true })).toBe('heavy');
    expect(selectModelForStep({ type: '', hasScreenshot: true })).toBe('heavy');
  });

  test('returns heavy for final or second-to-last step', () => {
    expect(selectModelForStep({ type: '', stepNumber: 5, totalSteps: 6 })).toBe('heavy');
    expect(selectModelForStep({ type: '', stepNumber: 4, totalSteps: 5 })).toBe('heavy');
  });

  test('returns null for non-final step with unknown type', () => {
    expect(selectModelForStep({ type: '', stepNumber: 3, totalSteps: 6 })).toBeNull();
    expect(selectModelForStep({ type: 'unknown_action' })).toBeNull();
    expect(selectModelForStep({ type: '' })).toBeNull();
  });
});

// ========== estimateCostUsd ==========
describe('estimateCostUsd', () => {
  test('returns 0 for zero tokens regardless of model', () => {
    expect(estimateCostUsd(0, 0, 'gpt-4o')).toBe(0);
    expect(estimateCostUsd(0, 0, '')).toBe(0);
    expect(estimateCostUsd(0, 0, null)).toBe(0);
  });

  test('uses default rates (3.00 input / 15.00 output per M) when model is empty', () => {
    expect(estimateCostUsd(1_000_000, 0, '')).toBeCloseTo(3.00, 5);
    expect(estimateCostUsd(0, 1_000_000, null)).toBeCloseTo(15.00, 5);
  });

  test('handles null or undefined token counts gracefully', () => {
    expect(() => estimateCostUsd(null, null, '')).not.toThrow();
    expect(estimateCostUsd(null, null, '')).toBe(0);
  });

  test('returns a number for a known model', () => {
    const cost = estimateCostUsd(100_000, 20_000, 'gpt-4o');
    expect(typeof cost).toBe('number');
    expect(cost).toBeGreaterThan(0);
  });
});

// ========== isSimpleStep ==========
describe('isSimpleStep', () => {
  test('returns false for null agentState', () => {
    expect(isSimpleStep(null, 1, [])).toBe(false);
  });

  test('returns false when consecutiveFailures > 0', () => {
    expect(isSimpleStep({ consecutiveFailures: 1, goal: 'do task', quickMode: false }, 1, [])).toBe(false);
  });

  test('returns false when quickMode is true', () => {
    expect(isSimpleStep({ consecutiveFailures: 0, goal: 'do task', quickMode: true }, 1, [])).toBe(false);
  });

  test('returns false for runbook-style goals', () => {
    expect(isSimpleStep({ consecutiveFailures: 0, goal: 'runbook: deploy', quickMode: false }, 1, [])).toBe(false);
  });

  test('returns false when stepCount > 6', () => {
    expect(isSimpleStep({ consecutiveFailures: 0, goal: 'task', quickMode: false }, 7, [])).toBe(false);
  });

  test('returns false when history has more than 8 entries', () => {
    const history = new Array(9).fill({});
    expect(isSimpleStep({ consecutiveFailures: 0, goal: 'task', quickMode: false }, 1, history)).toBe(false);
  });

  test('returns true when all conditions are met', () => {
    expect(isSimpleStep({ consecutiveFailures: 0, goal: 'click the button', quickMode: false }, 3, [{}, {}])).toBe(true);
  });

  test('returns true with null history', () => {
    expect(isSimpleStep({ consecutiveFailures: 0, goal: 'do thing', quickMode: false }, 1, null)).toBe(true);
  });
});

// ========== recordModelUsage + getCostTracker ==========
describe('recordModelUsage and getCostTracker', () => {
  test('getCostTracker returns the expected shape', () => {
    const tracker = getCostTracker();
    expect(tracker).toHaveProperty('totalCalls');
    expect(tracker).toHaveProperty('byTier');
    expect(tracker).toHaveProperty('estimatedCost');
    expect(tracker.byTier).toHaveProperty('light');
    expect(tracker.byTier).toHaveProperty('default');
    expect(tracker.byTier).toHaveProperty('heavy');
  });

  test('estimatedCost is returned as a string (toFixed)', () => {
    const tracker = getCostTracker();
    expect(typeof tracker.estimatedCost).toBe('string');
  });

  test('recordModelUsage increments totalCalls', () => {
    const before = getCostTracker().totalCalls;
    recordModelUsage('light', 100, 50);
    expect(getCostTracker().totalCalls).toBe(before + 1);
  });

  test('recordModelUsage increments light tier counter', () => {
    const before = getCostTracker().byTier.light;
    recordModelUsage('light', 200, 100);
    expect(getCostTracker().byTier.light).toBe(before + 1);
  });

  test('recordModelUsage increments heavy tier counter', () => {
    const before = getCostTracker().byTier.heavy;
    recordModelUsage('heavy', 500, 200);
    expect(getCostTracker().byTier.heavy).toBe(before + 1);
  });

  test('recordModelUsage falls back to default tier for unknown tier name', () => {
    const before = getCostTracker().byTier.default;
    recordModelUsage('ultra_tier', 100, 50);
    expect(getCostTracker().byTier.default).toBe(before + 1);
  });

  test('getCostTracker returns a snapshot — mutations do not alias the internal state', () => {
    const snap1 = getCostTracker();
    recordModelUsage('light', 10, 5);
    const snap2 = getCostTracker();
    expect(snap2.totalCalls).toBe(snap1.totalCalls + 1);
    expect(snap1.totalCalls).toBe(snap1.totalCalls); // snap1 unchanged
  });
});
