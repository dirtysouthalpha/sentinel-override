// tests/llm-client-pure-functions.test.js
// Tests for estimateCostUsd, isSimpleStep, and additional edge cases
// for detectGoalPortals and getMultiPortalDirective.

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

const _originalFetch = globalThis.fetch;

import {
  estimateCostUsd,
  isSimpleStep,
  detectGoalPortals,
  getMultiPortalDirective,
  getMultiArticleDirective,
  extractFirstJsonObject,
  supportsVision,
  resetLLMRateLimiter,
} from '../background/llm-client.js';

beforeEach(() => {
  _storageData = {};
  resetLLMRateLimiter();
  globalThis.fetch = _originalFetch;
});

// ══════════════════════════════════════════════════════════════════
// estimateCostUsd
// ══════════════════════════════════════════════════════════════════
describe('estimateCostUsd', () => {
  test('default rates (sonnet-class) with null model', () => {
    // Default: [3.00, 15.00] per 1M tokens
    const cost = estimateCostUsd(1000000, 500000, null);
    expect(cost).toBeCloseTo(3.00 * 1 + 15.00 * 0.5); // 3 + 7.5 = 10.5
  });

  test('default rates with empty string model', () => {
    const cost = estimateCostUsd(1000000, 1000000, '');
    expect(cost).toBeCloseTo(3.00 + 15.00); // 18.00
  });

  test('default rates with undefined model', () => {
    const cost = estimateCostUsd(1000, 1000, undefined);
    expect(cost).toBeCloseTo((3.00 * 1000 + 15.00 * 1000) / 1_000_000);
  });

  test('claude-haiku-4-5 pricing', () => {
    // [0.80, 4.00] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'claude-haiku-4-5');
    expect(cost).toBeCloseTo(0.80 + 4.00);
  });

  test('claude-3-haiku pricing', () => {
    // [0.25, 1.25] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'claude-3-haiku');
    expect(cost).toBeCloseTo(0.25 + 1.25);
  });

  test('claude-sonnet-4-6 pricing', () => {
    // [3.00, 15.00] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(3.00 + 15.00);
  });

  test('claude-opus-4-6 pricing', () => {
    // [15.00, 75.00] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'claude-opus-4-6');
    expect(cost).toBeCloseTo(15.00 + 75.00);
  });

  test('gpt-4o pricing', () => {
    // [2.50, 10.00] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4o');
    expect(cost).toBeCloseTo(2.50 + 10.00);
  });

  test('gpt-4o-mini pricing (specific model matched)', () => {
    // Correctly matches gpt-4o-mini specific rate
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4o-mini');
    expect(cost).toBeCloseTo(0.15 + 0.60); // gpt-4o-mini specific rate
  });

  test('gpt-4.1 pricing', () => {
    // [2.00, 8.00] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4.1');
    expect(cost).toBeCloseTo(2.00 + 8.00);
  });

  test('gpt-4.1-mini pricing (specific model matched)', () => {
    // Correctly matches gpt-4.1-mini specific rate
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4.1-mini');
    expect(cost).toBeCloseTo(0.40 + 1.60); // gpt-4.1-mini specific rate
  });

  test('gpt-4.1-nano pricing (specific model matched)', () => {
    // Correctly matches gpt-4.1-nano specific rate
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4.1-nano');
    expect(cost).toBeCloseTo(0.10 + 0.40); // gpt-4.1-nano specific rate
  });

  test('o4-mini pricing', () => {
    // [1.10, 4.40] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'o4-mini');
    expect(cost).toBeCloseTo(1.10 + 4.40);
  });

  test('o3 pricing', () => {
    // [10.00, 40.00] per 1M
    const cost = estimateCostUsd(1000000, 1000000, 'o3');
    expect(cost).toBeCloseTo(10.00 + 40.00);
  });

  test('claude-3-5-sonnet pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-3-5-sonnet');
    expect(cost).toBeCloseTo(3.00 + 15.00);
  });

  test('claude-opus-4-7 pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-opus-4-7');
    expect(cost).toBeCloseTo(15.00 + 75.00);
  });

  test('case insensitive model matching', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'GPT-4O');
    expect(cost).toBeCloseTo(2.50 + 10.00);
  });

  test('model with version suffix matches base', () => {
    // 'claude-sonnet-4-6-20250514' should match 'claude-sonnet-4-6'
    const cost = estimateCostUsd(1000000, 1000000, 'claude-sonnet-4-6-20250514');
    expect(cost).toBeCloseTo(3.00 + 15.00);
  });

  test('null token counts treated as 0', () => {
    const cost = estimateCostUsd(null, null, 'gpt-4o');
    expect(cost).toBe(0);
  });

  test('undefined token counts treated as 0', () => {
    const cost = estimateCostUsd(undefined, undefined, 'gpt-4o');
    expect(cost).toBe(0);
  });

  test('zero tokens returns 0', () => {
    expect(estimateCostUsd(0, 0, 'gpt-4o')).toBe(0);
  });

  test('unknown model uses default sonnet rates', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'unknown-custom-model');
    expect(cost).toBeCloseTo(3.00 + 15.00);
  });

  test('large token count produces correct cost', () => {
    // 10M input + 5M output with gpt-4o [2.50, 10.00]
    const cost = estimateCostUsd(10_000_000, 5_000_000, 'gpt-4o');
    expect(cost).toBeCloseTo(2.50 * 10 + 10.00 * 5); // 25 + 50 = 75
  });
});

// ══════════════════════════════════════════════════════════════════
// isSimpleStep
// ══════════════════════════════════════════════════════════════════
describe('isSimpleStep', () => {
  const makeState = (overrides = {}) => ({
    consecutiveFailures: 0,
    quickMode: false,
    goal: 'Click the button',
    ...overrides,
  });

  test('returns true for simple early step', () => {
    expect(isSimpleStep(makeState(), 1, [])).toBe(true);
  });

  test('returns false when consecutiveFailures > 0', () => {
    expect(isSimpleStep(makeState({ consecutiveFailures: 1 }), 1, [])).toBe(false);
    expect(isSimpleStep(makeState({ consecutiveFailures: 3 }), 1, [])).toBe(false);
  });

  test('returns false when quickMode is true', () => {
    expect(isSimpleStep(makeState({ quickMode: true }), 1, [])).toBe(false);
  });

  test('returns false for runbook goal (STEP)', () => {
    expect(isSimpleStep(makeState({ goal: 'STEP 1: Navigate to the portal' }), 1, [])).toBe(false);
  });

  test('returns false for runbook goal (PHASE)', () => {
    expect(isSimpleStep(makeState({ goal: 'PHASE 2: Investigation' }), 1, [])).toBe(false);
  });

  test('returns false for runbook goal (INVESTIGATION)', () => {
    expect(isSimpleStep(makeState({ goal: 'INVESTIGATION of ticket #123' }), 1, [])).toBe(false);
  });

  test('returns false for runbook goal (RUNBOOK)', () => {
    expect(isSimpleStep(makeState({ goal: 'RUNBOOK: follow steps' }), 1, [])).toBe(false);
  });

  test('returns false for runbook goal (case-insensitive)', () => {
    expect(isSimpleStep(makeState({ goal: 'investigation for issue' }), 1, [])).toBe(false);
  });

  test('returns false when stepCount > 6', () => {
    expect(isSimpleStep(makeState(), 7, [])).toBe(false);
    expect(isSimpleStep(makeState(), 10, [])).toBe(false);
  });

  test('returns true when stepCount is exactly 6', () => {
    expect(isSimpleStep(makeState(), 6, [])).toBe(true);
  });

  test('returns false when history.length > 8', () => {
    const history = new Array(9).fill({ action: { type: 'click' } });
    expect(isSimpleStep(makeState(), 1, history)).toBe(false);
  });

  test('returns true when history.length is exactly 8', () => {
    const history = new Array(8).fill({ action: { type: 'click' } });
    expect(isSimpleStep(makeState(), 1, history)).toBe(true);
  });

  test('returns true when history is null', () => {
    expect(isSimpleStep(makeState(), 1, null)).toBe(true);
  });

  test('returns true when history is undefined', () => {
    expect(isSimpleStep(makeState(), 1, undefined)).toBe(true);
  });

  test('handles undefined agentState fields gracefully', () => {
    expect(isSimpleStep({}, 1, [])).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// detectGoalPortals — additional edge cases
// ══════════════════════════════════════════════════════════════════
describe('detectGoalPortals — additional', () => {
  test('null returns empty array', () => {
    expect(detectGoalPortals(null)).toEqual([]);
  });

  test('number input returns empty array', () => {
    expect(detectGoalPortals(12345)).toEqual([]);
  });

  test('empty string returns empty array', () => {
    expect(detectGoalPortals('')).toEqual([]);
  });

  test('detects connectwise', () => {
    expect(detectGoalPortals('Check CW Manage for ticket status')).toContain('connectwise');
  });

  test('detects ninjaone', () => {
    expect(detectGoalPortals('Check NinjaOne for device status')).toContain('ninjaone');
  });

  test('detects datto', () => {
    expect(detectGoalPortals('Check Datto backup status')).toContain('datto');
  });

  test('detects itglue', () => {
    expect(detectGoalPortals('Update IT Glue documentation')).toContain('itglue');
  });

  test('detects huntress', () => {
    expect(detectGoalPortals('Check Huntress for threats')).toContain('huntress');
  });

  test('detects sentinelone', () => {
    expect(detectGoalPortals('Check SentinelOne console for detections')).toContain('sentinelone');
  });

  test('detects multiple portals', () => {
    const result = detectGoalPortals('Compare Entra sign-in logs with Defender alerts');
    expect(result).toContain('entra');
    expect(result).toContain('defender');
  });

  test('no portals in generic text', () => {
    expect(detectGoalPortals('Click the submit button')).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
// getMultiPortalDirective — edge cases
// ══════════════════════════════════════════════════════════════════
describe('getMultiPortalDirective — edge cases', () => {
  test('returns empty for single portal', () => {
    expect(getMultiPortalDirective('Check Entra sign-in logs')).toBe('');
  });

  test('returns empty for no portals', () => {
    expect(getMultiPortalDirective('Click the button')).toBe('');
  });

  test('returns directive for 2+ portals', () => {
    const result = getMultiPortalDirective('Check Entra sign-in logs and Exchange mailbox rules');
    expect(result).toContain('MULTI-PORTAL');
    expect(result.length).toBeGreaterThan(100);
  });

  test('null returns empty', () => {
    expect(getMultiPortalDirective(null)).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════
// getMultiArticleDirective — edge cases
// ══════════════════════════════════════════════════════════════════
describe('getMultiArticleDirective — edge cases', () => {
  test('null returns empty', () => {
    expect(getMultiArticleDirective(null)).toBe('');
  });

  test('empty returns empty', () => {
    expect(getMultiArticleDirective('')).toBe('');
  });

  test('non-multi-article goal returns empty', () => {
    expect(getMultiArticleDirective('Click the login button')).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════
// extractFirstJsonObject — additional edge cases
// ══════════════════════════════════════════════════════════════════
describe('extractFirstJsonObject — edge cases', () => {
  test('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  test('returns null for no braces', () => {
    expect(extractFirstJsonObject('just text without any objects')).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(extractFirstJsonObject('{invalid json}')).toBeNull();
  });

  test('returns null for object without valid type field', () => {
    expect(extractFirstJsonObject('{"foo": "bar"}')).toBeNull();
  });

  test('parses click action from prepended text', () => {
    const input = 'I will click the button. {"type": "click", "selector": "#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('click');
  });

  test('parses nested JSON objects', () => {
    const input = 'Result: {"type": "extract", "key": "data", "selector": ".table", "options": {"limit": 10}}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('extract');
    expect(parsed.options.limit).toBe(10);
  });

  test('skips first invalid JSON and finds valid one', () => {
    const input = '{bad json} then {"type": "note", "text": "found it"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('note');
  });

  test('handles JSON with escaped quotes in strings', () => {
    const input = '{"type": "note", "text": "He said \\"hello\\""}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.text).toContain('hello');
  });

  test('returns null for all non-valid types', () => {
    const input = '{"type": "invalid_action_type", "data": "test"}';
    expect(extractFirstJsonObject(input)).toBeNull();
  });

  test('batch action type is valid', () => {
    const input = '{"type": "batch", "actions": []}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
  });

  test('smart_navigate type is valid', () => {
    const input = '{"type": "smart_navigate", "url": "https://example.com"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// supportsVision — additional coverage
// ══════════════════════════════════════════════════════════════════
describe('supportsVision — additional', () => {
  test('null model returns false', () => {
    expect(supportsVision(null)).toBe(false);
  });

  test('empty model returns false', () => {
    expect(supportsVision('')).toBe(false);
  });

  test('known vision model returns true', () => {
    expect(supportsVision('gpt-4o')).toBe(true);
  });

  test('known non-vision model returns false', () => {
    expect(supportsVision('gpt-3.5-turbo')).toBe(false);
  });
});
