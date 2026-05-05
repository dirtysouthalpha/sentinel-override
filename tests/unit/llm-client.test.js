// Sentinel Override v3 -- Unit tests for background/llm-client.js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

// --- Module-level mocks (hoisted by vitest before dynamic import) ---
vi.mock('../../background/message-protocol.js', () => ({
  sendSilentUpdate: vi.fn(),
  sendTabStateUpdate: vi.fn(),
}));

vi.mock('../../background/tab-context.js', () => ({
  getAllTabContexts: vi.fn(() => []),
  getActiveTabId: vi.fn(() => null),
  getTabContext: vi.fn(() => undefined),
  TAB_LIMIT: 5,
}));

vi.mock('../../background/provider-registry.js', () => {
  const openaiProvider = {
    id: 'openai',
    buildHeaders: (apiKey) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }),
    buildBody: (model, sys, user, opts) => ({
      model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: opts.temperature || 0.3, max_tokens: opts.maxTokens || 8000,
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || null,
    buildVisionContent: (text, img) => [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } }],
    systemPromptTweak: 'You are a web automation agent.',
  };
  const anthropicProvider = {
    ...openaiProvider,
    id: 'anthropic',
    buildHeaders: (apiKey) => ({ 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
    buildBody: (model, sys, user, opts) => ({
      model, max_tokens: opts.maxTokens || 8000, temperature: opts.temperature || 0.3,
      system: sys, messages: [{ role: 'user', content: user }],
    }),
    parseResponse: (data) => {
      const block = data.content?.find(b => b.type === 'text');
      return block ? block.text : null;
    },
    buildVisionContent: (text, img) => [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }],
  };
  return {
    resolveProvider: vi.fn((endpoint) => endpoint?.includes('api.anthropic.com') ? anthropicProvider : openaiProvider),
    getActiveProvider: vi.fn(),
    PROVIDERS: { openai: openaiProvider, anthropic: anthropicProvider },
  };
});

describe('llm-client', () => {
  let chrome;

  beforeAll(() => {
    chrome = setupChromeMock();
  });

  // ===== Import module under test =====
  let getPlatformContext, supportsVision, parseLLMResponse, extractFirstJsonObject, getRelevantPatterns;
  let callLLMWithRetry, generatePlan;

  beforeAll(async () => {
    const mod = await import('../../background/llm-client.js');
    getPlatformContext = mod.getPlatformContext;
    supportsVision = mod.supportsVision;
    parseLLMResponse = mod.parseLLMResponse;
    extractFirstJsonObject = mod.extractFirstJsonObject;
    getRelevantPatterns = mod.getRelevantPatterns;
    callLLMWithRetry = mod.callLLMWithRetry;
    generatePlan = mod.generatePlan;
  });

  // ========== getPlatformContext ==========
  describe('getPlatformContext', () => {
    it('returns empty string for generic URLs', () => {
      expect(getPlatformContext('https://google.com', 'search for cats')).toBe('');
    });

    it('returns empty string for null/undefined inputs', () => {
      expect(getPlatformContext(null, null)).toBe('');
      expect(getPlatformContext(undefined, undefined)).toBe('');
    });

    it('detects SonicWall from URL', () => {
      const result = getPlatformContext('https://192.168.1.1/sonicwall', '');
      expect(result).toContain('SonicWall');
      expect(result).toContain('DROPDOWNS');
    });

    it('detects SonicWall from goal text', () => {
      const result = getPlatformContext('', 'configure sonicwall firewall');
      expect(result).toContain('SonicWall');
    });

    it('detects SonicWall from SonicOS reference', () => {
      const result = getPlatformContext('', 'login to sonicOS');
      expect(result).toContain('SonicWall');
    });

    it('detects SonicWall from hash routes', () => {
      const result = getPlatformContext('https://192.168.1.1/#/firewall', '');
      expect(result).toContain('SonicWall');
    });

    it('detects Fortinet from URL', () => {
      const result = getPlatformContext('https://fortigate.local', '');
      expect(result).toContain('Fortinet');
    });

    it('detects Fortinet from goal text', () => {
      const result = getPlatformContext('', 'check fortinet policies');
      expect(result).toContain('Fortinet');
    });

    it('detects Cisco from URL', () => {
      const result = getPlatformContext('https://cisco.local/fmc', '');
      expect(result).toContain('Cisco');
    });

    it('detects Cisco Meraki from goal', () => {
      const result = getPlatformContext('', 'configure meraki dashboard');
      expect(result).toContain('Cisco');
    });

    it('detects Palo Alto from URL', () => {
      const result = getPlatformContext('https://paloalto.local', '');
      expect(result).toContain('Palo Alto');
    });

    it('detects Palo Alto from goal', () => {
      const result = getPlatformContext('', 'check palo alto firewall rules');
      expect(result).toContain('Palo Alto');
    });

    it('detects generic network device from goal', () => {
      expect(getPlatformContext('', 'configure firewall rules')).toContain('Network');
      expect(getPlatformContext('', 'check router config')).toContain('Network');
      expect(getPlatformContext('', 'manage switch ports')).toContain('Network');
    });

    it('is case insensitive', () => {
      expect(getPlatformContext('HTTPS://SONICWALL.LOCAL', '')).toContain('SonicWall');
      expect(getPlatformContext('', 'CHECK FORTIGATE')).toContain('Fortinet');
    });
  });

  // ========== supportsVision ==========
  describe('supportsVision', () => {
    it('returns false for null/undefined', () => {
      expect(supportsVision(null)).toBe(false);
      expect(supportsVision(undefined)).toBe(false);
    });

    it('returns false for text-only models', () => {
      expect(supportsVision('gpt-3.5-turbo')).toBe(false);
      expect(supportsVision('glm-5.1')).toBe(false);
      expect(supportsVision('llama-3')).toBe(false);
    });

    it('returns true for vision models', () => {
      expect(supportsVision('gpt-4o')).toBe(true);
      expect(supportsVision('gpt-4-vision')).toBe(true);
      expect(supportsVision('claude-3-opus')).toBe(true);
      expect(supportsVision('claude-4-sonnet')).toBe(true);
      expect(supportsVision('gemini-pro-vision')).toBe(true);
    });

    it('returns true for models with vl- prefix/suffix', () => {
      expect(supportsVision('qwen-vl-max')).toBe(true);
      expect(supportsVision('llava-1.5')).toBe(true);
      expect(supportsVision('model-vl-beta')).toBe(true);
    });

    it('returns true for GLM vision models', () => {
      expect(supportsVision('glm-4.5v')).toBe(true);
      expect(supportsVision('glm-4.6v')).toBe(true);
      expect(supportsVision('glm-5v')).toBe(true);
    });

    it('is case insensitive', () => {
      expect(supportsVision('GPT-4O')).toBe(true);
      expect(supportsVision('Gemini-Pro')).toBe(true);
    });
  });

  // ========== extractFirstJsonObject ==========
  describe('extractFirstJsonObject', () => {
    it('returns null for strings without objects', () => {
      expect(extractFirstJsonObject('no json here')).toBeNull();
    });

    it('returns null for objects without valid type', () => {
      expect(extractFirstJsonObject('{"foo": "bar"}')).toBeNull();
    });

    it('extracts a valid action object', () => {
      const result = extractFirstJsonObject('{"type": "click", "selector": "#btn"}');
      expect(result).toBe('{"type": "click", "selector": "#btn"}');
    });

    it('extracts object from text with prefix', () => {
      const result = extractFirstJsonObject('I think you should {"type": "navigate", "url": "https://example.com"}');
      expect(result).toContain('"type": "navigate"');
    });

    it('extracts the first valid object when multiple exist', () => {
      const result = extractFirstJsonObject('{"type": "click", "selector": "#a"} and {"type": "type", "text": "hello"}');
      expect(result).toContain('"type": "click"');
    });

    it('handles nested JSON objects', () => {
      const result = extractFirstJsonObject('{"type": "execute_js", "code": "return {a: 1}"}');
      expect(result).toContain('"type": "execute_js"');
    });

    it('handles finish action', () => {
      const result = extractFirstJsonObject('{"type": "finish", "summary": "done"}');
      expect(result).toContain('"type": "finish"');
    });

    it('returns null for empty string', () => {
      expect(extractFirstJsonObject('')).toBeNull();
    });
  });

  // ========== parseLLMResponse ==========
  describe('parseLLMResponse', () => {
    it('parses a valid click action', () => {
      const result = parseLLMResponse('{"type": "click", "selector": "#btn"}');
      expect(result.type).toBe('click');
      expect(result.selector).toBe('#btn');
    });

    it('parses a navigate action', () => {
      const result = parseLLMResponse('{"type": "navigate", "url": "https://example.com"}');
      expect(result.type).toBe('navigate');
      expect(result.url).toBe('https://example.com');
    });

    it('parses a finish action', () => {
      const result = parseLLMResponse('{"type": "finish", "summary": "Task completed successfully"}');
      expect(result.type).toBe('finish');
      expect(result.summary).toBe('Task completed successfully');
    });

    it('extracts JSON from markdown code blocks', () => {
      const content = '```json\n{"type": "read_page"}\n```';
      const result = parseLLMResponse(content);
      expect(result.type).toBe('read_page');
    });

    it('extracts JSON from text with prefix', () => {
      const content = 'I will click the button\n{"type": "click", "selector": "#submit"}';
      const result = parseLLMResponse(content);
      expect(result.type).toBe('click');
    });

    it('unwraps action wrapper', () => {
      const content = '{"action": {"type": "type", "selector": "#input", "text": "hello"}}';
      const result = parseLLMResponse(content);
      expect(result.type).toBe('type');
      expect(result.text).toBe('hello');
    });

    it('unwraps command wrapper', () => {
      const content = '{"command": {"type": "scroll", "amount": 500}}';
      const result = parseLLMResponse(content);
      expect(result.type).toBe('scroll');
      expect(result.amount).toBe(500);
    });

    it('unwraps next_action wrapper', () => {
      const content = '{"next_action": {"type": "note", "text": "found it"}}';
      const result = parseLLMResponse(content);
      expect(result.type).toBe('note');
      expect(result.text).toBe('found it');
    });

    it('returns note action for null content', () => {
      const result = parseLLMResponse(null);
      expect(result.type).toBe('note');
      expect(result.text).toContain('Parse error');
    });

    it('returns note action for empty string', () => {
      const result = parseLLMResponse('');
      expect(result.type).toBe('note');
    });

    it('returns note action for invalid JSON', () => {
      const result = parseLLMResponse('not json at all');
      expect(result.type).toBe('note');
      expect(result.text).toContain('Parse error');
    });

    it('returns note action for object without type', () => {
      const result = parseLLMResponse('{"foo": "bar"}');
      expect(result.type).toBe('note');
      expect(result.text).toContain('Missing type field');
    });

    it('returns note action for invalid type', () => {
      const result = parseLLMResponse('{"type": "fly_to_moon"}');
      expect(result.type).toBe('note');
      expect(result.text).toContain('Invalid command type');
    });

    it('handles all valid action types', () => {
      const types = [
        'click', 'type', 'navigate', 'scroll', 'select', 'hover', 'press_key',
        'extract', 'extract_list', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
        'execute_js', 'read_page', 'note', 'finish', 'open_tab', 'switch_tab', 'close_tab',
        'dismiss_overlay', 'switch_to_frame', 'click_at',
      ];
      types.forEach(type => {
        const result = parseLLMResponse(`{"type": "${type}"}`);
        expect(result.type).toBe(type);
      });
    });

    it('strips control characters', () => {
      const content = '{"type": "note", "text": "hello\x00world\x01"}';
      const result = parseLLMResponse(content);
      expect(result.type).toBe('note');
    });

    it('salvages finish response with long content', () => {
      // Build a finish response that needs fixing
      const summary = 'A'.repeat(300);
      const content = `{"type": "finish", "summary": "${summary}"}`;
      const result = parseLLMResponse(content);
      expect(result.type).toBe('finish');
    });
  });

  // ========== getRelevantPatterns ==========
  describe('getRelevantPatterns', () => {
    it('returns empty array when no patterns stored', async () => {
      const result = await getRelevantPatterns('check firewall rules');
      expect(result).toEqual([]);
    });

    it('returns matching patterns from storage', async () => {
      await chrome.storage.local.set({
        learned_patterns: [
          { goal: 'check sonicwall firewall rules', success: true, steps: [{ type: 'navigate' }, { type: 'click' }] },
          { goal: 'configure vpn tunnel', success: true, steps: [{ type: 'navigate' }] },
          { goal: 'unrelated task', success: true, steps: [] },
        ],
      });

      const result = await getRelevantPatterns('check firewall rules on sonicwall');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].goal).toContain('firewall');
    });

    it('filters out unsuccessful patterns', async () => {
      await chrome.storage.local.set({
        learned_patterns: [
          { goal: 'check firewall rules', success: false, steps: [] },
        ],
      });

      const result = await getRelevantPatterns('check firewall rules');
      expect(result).toEqual([]);
    });

    it('returns at most 3 patterns', async () => {
      const patterns = Array.from({ length: 10 }, (_, i) => ({
        goal: `firewall task ${i}`,
        success: true,
        steps: [{ type: 'click' }],
      }));
      await chrome.storage.local.set({ learned_patterns: patterns });

      const result = await getRelevantPatterns('firewall task');
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('ignores short words when matching', async () => {
      await chrome.storage.local.set({
        learned_patterns: [
          { goal: 'do it now', success: true, steps: [] },
        ],
      });

      // All words in goal are <= 3 chars, so no word > 3 to match
      const result = await getRelevantPatterns('do it now');
      expect(result).toEqual([]);
    });
  });
});
