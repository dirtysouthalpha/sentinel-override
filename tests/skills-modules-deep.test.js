// tests/skills-modules-deep.test.js
// Coverage for all 8 individual skill modules

import { jest } from '@jest/globals';

const { clickNoTarget } = await import('../background/skills/click-no-target.js');
const { consecutiveFailures } = await import('../background/skills/consecutive-failures.js');
const { cspBlocked } = await import('../background/skills/csp-blocked.js');
const { emptyObservation } = await import('../background/skills/empty-observation.js');
const { navigateLoop } = await import('../background/skills/navigate-loop.js');
const { selectorMiss } = await import('../background/skills/selector-miss.js');
const { slowLlmCall } = await import('../background/skills/slow-llm-call.js');
const { unproductiveExtract } = await import('../background/skills/unproductive-extract.js');

const allSkills = [
  clickNoTarget, consecutiveFailures, cspBlocked, emptyObservation,
  navigateLoop, selectorMiss, slowLlmCall, unproductiveExtract,
];

describe('all skill modules have required interface', () => {
  test.each(allSkills)('$id exports required fields', (skill) => {
    expect(skill.id).toBeDefined();
    expect(typeof skill.id).toBe('string');
    expect(skill.description).toBeDefined();
    expect(typeof skill.description).toBe('string');
    expect(typeof skill.priority).toBe('number');
    expect(typeof skill.matches).toBe('function');
    expect(typeof skill.autoApply).toBe('function');
    expect(typeof skill.promptInjection).toBe('function');
  });
});

// ── click-no-target ──────────────────────────────────────────────────────────

describe('click-no-target', () => {
  const skill = clickNoTarget;

  test('matches BLOCKED click with no target', () => {
    const ctx = {
      lastCommand: { type: 'click' },
      lastResult: 'BLOCKED: click command has no target',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches BLOCKED type with no target', () => {
    const ctx = {
      lastCommand: { type: 'type' },
      lastResult: 'BLOCKED: type command has no target',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches BLOCKED hover with no target', () => {
    const ctx = {
      lastCommand: { type: 'hover' },
      lastResult: 'BLOCKED: hover command has no target',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('does not match when action did not fail', () => {
    const ctx = {
      lastCommand: { type: 'click' },
      lastResult: 'BLOCKED: click command has no target',
      lastActionFailed: false,
    };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('does not match non-BLOCKED result', () => {
    const ctx = {
      lastCommand: { type: 'click' },
      lastResult: 'Clicked OK',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('returns false for null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('returns false for missing lastResult', () => {
    expect(skill.matches({ lastCommand: { type: 'click' }, lastActionFailed: true })).toBe(false);
  });

  test('autoApply returns read_page action', () => {
    const result = skill.autoApply({});
    expect(result.type).toBe('read_page');
    expect(result._autoAppliedBy).toBe('click-no-target');
  });

  test('promptInjection references command type', () => {
    const ctx = { lastCommand: { type: 'click' }, lastResult: 'BLOCKED: click command has no target' };
    const prompt = skill.promptInjection(ctx);
    expect(prompt).toContain('click');
    expect(prompt).toContain('Do NOT re-emit');
  });

  test('promptInjection defaults to click for missing type', () => {
    const ctx = { lastCommand: {}, lastResult: '' };
    const prompt = skill.promptInjection(ctx);
    expect(prompt).toContain('click');
  });
});

// ── consecutive-failures ─────────────────────────────────────────────────────

describe('consecutive-failures', () => {
  const skill = consecutiveFailures;

  test('matches when consecutiveFailures >= 3', () => {
    expect(skill.matches({ consecutiveFailures: 3 })).toBe(true);
    expect(skill.matches({ consecutiveFailures: 5 })).toBe(true);
    expect(skill.matches({ consecutiveFailures: 10 })).toBe(true);
  });

  test('does not match when consecutiveFailures < 3', () => {
    expect(skill.matches({ consecutiveFailures: 0 })).toBe(false);
    expect(skill.matches({ consecutiveFailures: 2 })).toBe(false);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('does not match ctx without consecutiveFailures', () => {
    expect(skill.matches({})).toBe(false);
  });

  test('autoApply returns null', () => {
    expect(skill.autoApply({ consecutiveFailures: 3 })).toBeNull();
  });

  test('promptInjection includes failure count', () => {
    const prompt = skill.promptInjection({ consecutiveFailures: 4, dynamicMaxSteps: 50, stepCount: 20 });
    expect(prompt).toContain('4');
    expect(prompt).toContain('30');
    expect(prompt).toContain('fundamentally different');
  });

  test('promptInjection handles missing fields gracefully', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('0');
    expect(typeof prompt).toBe('string');
  });
});

// ── csp-blocked ──────────────────────────────────────────────────────────────

describe('csp-blocked', () => {
  const skill = cspBlocked;

  test('matches CSP_BLOCKED result', () => {
    const ctx = {
      lastResult: 'CSP_BLOCKED: page denies inline scripts on this origin',
      lastCommand: { type: 'execute_js', key: 'test_key' },
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches lowercase csp_blocked', () => {
    const ctx = { lastResult: 'csp_blocked: something' };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('does not match non-CSP result', () => {
    expect(skill.matches({ lastResult: 'OK: executed' })).toBe(false);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('does not match ctx without lastResult', () => {
    expect(skill.matches({ lastCommand: { type: 'execute_js' } })).toBe(false);
  });

  test('autoApply returns read_page', () => {
    const result = skill.autoApply({});
    expect(result.type).toBe('read_page');
    expect(result._autoAppliedBy).toBe('csp-blocked');
  });

  test('promptInjection references the key', () => {
    const prompt = skill.promptInjection({ lastCommand: { key: 'my_data' } });
    expect(prompt).toContain('my_data');
    expect(prompt).toContain('Content-Security-Policy');
  });

  test('promptInjection handles missing key', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('(no key)');
  });
});

// ── empty-observation ────────────────────────────────────────────────────────

describe('empty-observation', () => {
  const skill = emptyObservation;

  const makeCtx = (overrides = {}) => ({
    lastCommand: { type: 'read_page' },
    lastActionFailed: true,
    allElements: [],
    pageText: '',
    currentUrl: 'https://example.com/page',
    ...overrides,
  });

  test('matches empty page after read_page', () => {
    expect(skill.matches(makeCtx())).toBe(true);
  });

  test('matches empty page after navigate', () => {
    expect(skill.matches(makeCtx({ lastCommand: { type: 'navigate' } }))).toBe(true);
  });

  test('does not match when elements >= 5', () => {
    expect(skill.matches(makeCtx({ allElements: [1, 2, 3, 4, 5] }))).toBe(false);
  });

  test('does not match when pageText >= 200 chars', () => {
    expect(skill.matches(makeCtx({ pageText: 'a'.repeat(200) }))).toBe(false);
  });

  test('does not match about: URLs', () => {
    expect(skill.matches(makeCtx({ currentUrl: 'about:blank' }))).toBe(false);
  });

  test('does not match chrome: URLs', () => {
    expect(skill.matches(makeCtx({ currentUrl: 'chrome://newtab' }))).toBe(false);
  });

  test('does not match data: URLs', () => {
    expect(skill.matches(makeCtx({ currentUrl: 'data:text/html,hello' }))).toBe(false);
  });

  test('does not match file: URLs', () => {
    expect(skill.matches(makeCtx({ currentUrl: 'file:///C:/test.html' }))).toBe(false);
  });

  test('does not match non-observe/non-failed action', () => {
    const ctx = makeCtx({ lastCommand: { type: 'click' }, lastActionFailed: false });
    expect(skill.matches(ctx)).toBe(false);
  });

  test('does match failed click on empty page', () => {
    const ctx = makeCtx({ lastCommand: { type: 'click' }, lastActionFailed: true });
    expect(skill.matches(ctx)).toBe(true);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('autoApply returns wait_for_navigation after navigate', () => {
    const result = skill.autoApply(makeCtx({ lastCommand: { type: 'navigate' } }));
    expect(result.type).toBe('wait_for_navigation');
    expect(result.timeout).toBe(8000);
    expect(result._autoAppliedBy).toBe('empty-observation');
  });

  test('autoApply returns null for non-navigate', () => {
    const result = skill.autoApply(makeCtx());
    expect(result).toBeNull();
  });

  test('promptInjection mentions strategies', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('nearly empty');
    expect(prompt).toContain('Wait');
    expect(prompt).toContain('execute_js');
  });
});

// ── navigate-loop ────────────────────────────────────────────────────────────

describe('navigate-loop', () => {
  const skill = navigateLoop;

  test('matches BLOCKED already navigated', () => {
    const ctx = {
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('does not match when action did not fail', () => {
    const ctx = {
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastActionFailed: false,
    };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('does not match other BLOCKED types', () => {
    const ctx = { lastResult: 'BLOCKED: something else', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('does not match missing lastResult', () => {
    expect(skill.matches({ lastActionFailed: true })).toBe(false);
  });

  test('autoApply returns read_page', () => {
    const result = skill.autoApply({});
    expect(result.type).toBe('read_page');
    expect(result._autoAppliedBy).toBe('navigate-loop');
  });

  test('promptInjection mentions loop', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('same URL twice');
    expect(prompt).toContain('do NOT navigate');
  });
});

// ── selector-miss ────────────────────────────────────────────────────────────

describe('selector-miss', () => {
  const skill = selectorMiss;

  test('matches "element not found"', () => {
    const ctx = { lastResult: 'Element not found: .my-btn', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches "no element" in result', () => {
    const ctx = { lastResult: 'Error: no element matched selector', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches "not in element list"', () => {
    const ctx = { lastResult: 'ref abc not in element list', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches "error: element" prefix', () => {
    const ctx = { lastResult: 'Error: element could not be found', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('is case-insensitive', () => {
    const ctx = { lastResult: 'ELEMENT NOT FOUND', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('does not match when action did not fail', () => {
    const ctx = { lastResult: 'Element not found', lastActionFailed: false };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('does not match successful result', () => {
    const ctx = { lastResult: 'Clicked OK', lastActionFailed: true };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('autoApply returns read_page', () => {
    const result = skill.autoApply({});
    expect(result.type).toBe('read_page');
    expect(result._autoAppliedBy).toBe('selector-miss');
  });

  test('promptInjection includes last selector', () => {
    const ctx = { lastCommand: { selector: '.my-btn' } };
    const prompt = skill.promptInjection(ctx);
    expect(prompt).toContain('.my-btn');
  });

  test('promptInjection includes last ref', () => {
    const ctx = { lastCommand: { ref: 'ref42' } };
    const prompt = skill.promptInjection(ctx);
    expect(prompt).toContain('ref42');
  });

  test('promptInjection handles missing selector/ref', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('(unknown)');
  });
});

// ── slow-llm-call ────────────────────────────────────────────────────────────

describe('slow-llm-call', () => {
  const skill = slowLlmCall;

  test('matches when lastAiCallMs >= 25000', () => {
    expect(skill.matches({ lastAiCallMs: 25000 })).toBe(true);
    expect(skill.matches({ lastAiCallMs: 60000 })).toBe(true);
  });

  test('does not match when lastAiCallMs < 25000', () => {
    expect(skill.matches({ lastAiCallMs: 24999 })).toBe(false);
    expect(skill.matches({ lastAiCallMs: 0 })).toBe(false);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('does not match when lastAiCallMs is not a number', () => {
    expect(skill.matches({ lastAiCallMs: 'slow' })).toBe(false);
    expect(skill.matches({ lastAiCallMs: undefined })).toBe(false);
  });

  test('autoApply returns null', () => {
    expect(skill.autoApply({ lastAiCallMs: 30000 })).toBeNull();
  });

  test('promptInjection includes seconds', () => {
    const prompt = skill.promptInjection({ lastAiCallMs: 32000 });
    expect(prompt).toContain('32');
    expect(prompt).toContain('prompt bloat');
  });

  test('promptInjection handles missing lastAiCallMs', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('?');
  });
});

// ── unproductive-extract ─────────────────────────────────────────────────────

describe('unproductive-extract', () => {
  const skill = unproductiveExtract;

  test('matches extract with empty array result', () => {
    const ctx = {
      lastCommand: { type: 'extract', key: 'data' },
      lastResult: 'JS returned an empty array',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches extract_list with empty object result', () => {
    const ctx = {
      lastCommand: { type: 'extract_list', key: 'rows' },
      lastResult: 'JS returned an empty object',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches execute_js with null result', () => {
    const ctx = {
      lastCommand: { type: 'execute_js', key: 'val' },
      lastResult: 'JS returned null',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches non-serializable value', () => {
    const ctx = {
      lastCommand: { type: 'execute_js', key: 'x' },
      lastResult: 'JS returned a non-serializable value',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches memory hygiene', () => {
    const ctx = {
      lastCommand: { type: 'extract', key: 'd' },
      lastResult: 'memory hygiene: trimmed value',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches rejected value too short', () => {
    const ctx = {
      lastCommand: { type: 'extract', key: 'd' },
      lastResult: 'rejected: value too short',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('matches rejected duplicates existing key', () => {
    const ctx = {
      lastCommand: { type: 'extract', key: 'd' },
      lastResult: 'rejected: duplicates existing key',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(true);
  });

  test('does not match non-extract type', () => {
    const ctx = {
      lastCommand: { type: 'click' },
      lastResult: 'JS returned null',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('does not match null ctx', () => {
    expect(skill.matches(null)).toBe(false);
  });

  test('does not match missing lastResult', () => {
    expect(skill.matches({ lastCommand: { type: 'extract' } })).toBe(false);
  });

  test('does not match non-pattern result', () => {
    const ctx = {
      lastCommand: { type: 'extract', key: 'd' },
      lastResult: 'Extracted 42 items successfully',
      lastActionFailed: true,
    };
    expect(skill.matches(ctx)).toBe(false);
  });

  test('autoApply returns null', () => {
    expect(skill.autoApply({})).toBeNull();
  });

  test('promptInjection includes key name', () => {
    const ctx = { lastCommand: { key: 'device_list' } };
    const prompt = skill.promptInjection(ctx);
    expect(prompt).toContain('device_list');
  });

  test('promptInjection handles missing key', () => {
    const prompt = skill.promptInjection({});
    expect(prompt).toContain('(unknown)');
  });
});
