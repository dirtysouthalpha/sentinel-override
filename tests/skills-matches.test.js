// tests/skills-matches.test.js
// Unit tests for background/skills/*.js — matches() and autoApply() branches.
// All skills are pure ES modules with no external state dependencies.

import { selectorMiss }        from '../background/skills/selector-miss.js';
import { cspBlocked }          from '../background/skills/csp-blocked.js';
import { clickNoTarget }       from '../background/skills/click-no-target.js';
import { navigateLoop }        from '../background/skills/navigate-loop.js';
import { consecutiveFailures } from '../background/skills/consecutive-failures.js';
import { slowLlmCall }         from '../background/skills/slow-llm-call.js';
import { unproductiveExtract } from '../background/skills/unproductive-extract.js';
import { emptyObservation }    from '../background/skills/empty-observation.js';
import { authWall }            from '../background/skills/auth-wall.js';

// ── selectorMiss ────────────────────────────────────────────────────────────

describe('selectorMiss.matches', () => {
  test('returns false for null context', () => {
    expect(selectorMiss.matches(null)).toBe(false);
  });

  test('returns false when lastResult is absent', () => {
    expect(selectorMiss.matches({ lastActionFailed: true })).toBe(false);
  });

  test('returns false when lastActionFailed is false', () => {
    expect(selectorMiss.matches({ lastResult: 'element not found', lastActionFailed: false })).toBe(false);
  });

  test('matches "element not found" result', () => {
    expect(selectorMiss.matches({ lastResult: 'element not found', lastActionFailed: true })).toBe(true);
  });

  test('matches "no element" result', () => {
    expect(selectorMiss.matches({ lastResult: 'no element matching selector', lastActionFailed: true })).toBe(true);
  });

  test('matches result starting with "error: element"', () => {
    expect(selectorMiss.matches({ lastResult: 'error: element did not render', lastActionFailed: true })).toBe(true);
  });

  test('does not match unrelated error result', () => {
    expect(selectorMiss.matches({ lastResult: 'network timeout', lastActionFailed: true })).toBe(false);
  });
});

describe('selectorMiss.autoApply', () => {
  test('returns read_page action', () => {
    const action = selectorMiss.autoApply({});
    expect(action.type).toBe('read_page');
    expect(action._autoAppliedBy).toBe('selector-miss');
  });
});

// ── cspBlocked ──────────────────────────────────────────────────────────────

describe('cspBlocked.matches', () => {
  test('returns false for null context', () => {
    expect(cspBlocked.matches(null)).toBe(false);
  });

  test('returns false when lastResult is absent', () => {
    expect(cspBlocked.matches({})).toBe(false);
  });

  test('matches CSP_BLOCKED: prefix', () => {
    expect(cspBlocked.matches({ lastResult: 'CSP_BLOCKED: page denies inline scripts' })).toBe(true);
  });

  test('matches case-insensitively', () => {
    expect(cspBlocked.matches({ lastResult: 'csp_blocked: reason' })).toBe(true);
  });

  test('does not match non-CSP result', () => {
    expect(cspBlocked.matches({ lastResult: 'element not found' })).toBe(false);
  });

  test('returns false when lastResult is a non-string', () => {
    expect(cspBlocked.matches({ lastResult: { error: 'csp' } })).toBe(false);
  });
});

describe('cspBlocked.autoApply', () => {
  test('returns read_page action', () => {
    const action = cspBlocked.autoApply({});
    expect(action.type).toBe('read_page');
    expect(action._autoAppliedBy).toBe('csp-blocked');
  });
});

// ── clickNoTarget ────────────────────────────────────────────────────────────

describe('clickNoTarget.matches', () => {
  test('returns false for null context', () => {
    expect(clickNoTarget.matches(null)).toBe(false);
  });

  test('returns false when lastActionFailed is false', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    })).toBe(false);
  });

  test('matches BLOCKED: click command has no target', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('matches BLOCKED: type command has no target', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: type command has no target',
      lastCommand: { type: 'type' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('does not match unrelated BLOCKED result', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastCommand: { type: 'navigate' },
      lastActionFailed: true,
    })).toBe(false);
  });
});

describe('clickNoTarget.autoApply', () => {
  test('returns read_page action', () => {
    const action = clickNoTarget.autoApply({});
    expect(action.type).toBe('read_page');
    expect(action._autoAppliedBy).toBe('click-no-target');
  });
});

// ── navigateLoop ─────────────────────────────────────────────────────────────

describe('navigateLoop.matches', () => {
  test('returns false for null context', () => {
    expect(navigateLoop.matches(null)).toBe(false);
  });

  test('returns false when lastActionFailed is false', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastActionFailed: false,
    })).toBe(false);
  });

  test('matches BLOCKED: already navigated to', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastActionFailed: true,
    })).toBe(true);
  });

  test('does not match unrelated blocked result', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: click command has no target',
      lastActionFailed: true,
    })).toBe(false);
  });

  test('returns false when lastResult is not a string', () => {
    expect(navigateLoop.matches({
      lastResult: 42,
      lastActionFailed: true,
    })).toBe(false);
  });
});

describe('navigateLoop.autoApply', () => {
  test('returns read_page action when ctx is provided', () => {
    const action = navigateLoop.autoApply({ lastCommand: { type: 'navigate' } });
    expect(action.type).toBe('read_page');
    expect(action._autoAppliedBy).toBe('navigate-loop');
  });

  test('returns null when ctx is null', () => {
    expect(navigateLoop.autoApply(null)).toBeNull();
  });
});

// ── consecutiveFailures ──────────────────────────────────────────────────────

describe('consecutiveFailures.matches', () => {
  test('returns false for null context', () => {
    expect(consecutiveFailures.matches(null)).toBe(false);
  });

  test('returns false when consecutiveFailures < 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 2 })).toBe(false);
  });

  test('returns false when consecutiveFailures is absent (defaults to 0)', () => {
    expect(consecutiveFailures.matches({})).toBe(false);
  });

  test('returns true when consecutiveFailures === 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 3 })).toBe(true);
  });

  test('returns true when consecutiveFailures > 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 7 })).toBe(true);
  });
});

describe('consecutiveFailures.autoApply', () => {
  test('returns null (no deterministic recovery)', () => {
    expect(consecutiveFailures.autoApply({})).toBeNull();
  });
});

// ── slowLlmCall ──────────────────────────────────────────────────────────────

describe('slowLlmCall.matches', () => {
  test('returns false for null context', () => {
    expect(slowLlmCall.matches(null)).toBe(false);
  });

  test('returns false when lastAiCallMs is absent', () => {
    expect(slowLlmCall.matches({})).toBe(false);
  });

  test('returns false when lastAiCallMs is a string (type guard)', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: '30000' })).toBe(false);
  });

  test('returns false when call was fast (< 25 s)', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 24999 })).toBe(false);
  });

  test('returns true when lastAiCallMs === 25000', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 25000 })).toBe(true);
  });

  test('returns true when lastAiCallMs > 25000', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 60000 })).toBe(true);
  });
});

describe('slowLlmCall.autoApply', () => {
  test('returns null (observability only, no auto-recovery)', () => {
    expect(slowLlmCall.autoApply({})).toBeNull();
  });
});

// ── unproductiveExtract ──────────────────────────────────────────────────────

describe('unproductiveExtract.matches', () => {
  const makeCtx = (type, result) => ({
    lastCommand: { type },
    lastResult: result,
  });

  test('returns false for null context', () => {
    expect(unproductiveExtract.matches(null)).toBe(false);
  });

  test('returns false when command type is not extract/extract_list/execute_js', () => {
    expect(unproductiveExtract.matches(makeCtx('click', 'JS returned an empty array'))).toBe(false);
  });

  test('matches extract with "JS returned an empty array"', () => {
    expect(unproductiveExtract.matches(makeCtx('extract', 'JS returned an empty array'))).toBe(true);
  });

  test('matches execute_js with "JS returned null"', () => {
    expect(unproductiveExtract.matches(makeCtx('execute_js', 'JS returned null'))).toBe(true);
  });

  test('matches extract_list with "rejected: value too short"', () => {
    expect(unproductiveExtract.matches(makeCtx('extract_list', 'rejected: value too short'))).toBe(true);
  });

  test('matches "memory hygiene" result', () => {
    expect(unproductiveExtract.matches(makeCtx('execute_js', 'memory hygiene: key pruned'))).toBe(true);
  });

  test('does not match unrelated result', () => {
    expect(unproductiveExtract.matches(makeCtx('execute_js', 'network timeout'))).toBe(false);
  });
});

describe('unproductiveExtract.autoApply', () => {
  test('returns null (LLM chooses recovery strategy)', () => {
    expect(unproductiveExtract.autoApply({})).toBeNull();
  });
});

// ── emptyObservation ─────────────────────────────────────────────────────────

describe('emptyObservation.matches', () => {
  test('returns false for null context', () => {
    expect(emptyObservation.matches(null)).toBe(false);
  });

  test('returns false when page is not empty (many elements)', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      lastActionFailed: false,
      allElements: new Array(20).fill({}),
      pageText: 'lots of page text here '.repeat(20),
      currentUrl: 'https://example.com',
    })).toBe(false);
  });

  test('returns false for restricted protocol URL', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      lastActionFailed: true,
      allElements: [],
      pageText: '',
      currentUrl: 'chrome://newtab/',
    })).toBe(false);
  });

  test('matches when elements < 5 and text < 200 after navigate', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      lastActionFailed: false,
      allElements: [{}],
      pageText: 'hi',
      currentUrl: 'https://example.com',
    })).toBe(true);
  });

  test('matches when lastActionFailed is true even for non-navigate command', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'click' },
      lastActionFailed: true,
      allElements: [],
      pageText: '',
      currentUrl: 'https://example.com',
    })).toBe(true);
  });

  test('returns false when no post-observe and not failed', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'click' },
      lastActionFailed: false,
      allElements: [],
      pageText: '',
      currentUrl: 'https://example.com',
    })).toBe(false);
  });
});

describe('emptyObservation.autoApply', () => {
  test('returns wait_for_navigation when last command was navigate', () => {
    const action = emptyObservation.autoApply({ lastCommand: { type: 'navigate' } });
    expect(action.type).toBe('wait_for_navigation');
    expect(action._autoAppliedBy).toBe('empty-observation');
  });

  test('returns null for non-navigate last command', () => {
    expect(emptyObservation.autoApply({ lastCommand: { type: 'read_page' } })).toBeNull();
  });

  test('returns null when context is null', () => {
    expect(emptyObservation.autoApply(null)).toBeNull();
  });
});

// ── authWall ─────────────────────────────────────────────────────────────────

describe('authWall.matches', () => {
  test('returns false for null context', () => {
    expect(authWall.matches(null)).toBe(false);
  });

  test('returns true when URL contains /login', () => {
    expect(authWall.matches({ currentUrl: 'https://example.com/login', pageText: '' })).toBe(true);
  });

  test('returns true for microsoftonline.com URL', () => {
    expect(authWall.matches({ currentUrl: 'https://login.microsoftonline.com/common/oauth2', pageText: '' })).toBe(true);
  });

  test('returns true when short page text contains sign-in language', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com',
      pageText: 'Sign in to your account to continue.',
    })).toBe(true);
  });

  test('returns false when sign-in text is in a long page (> 3000 chars)', () => {
    const longText = 'Sign in to your account. ' + 'x'.repeat(3000);
    expect(authWall.matches({ currentUrl: 'https://example.com', pageText: longText })).toBe(false);
  });

  test('returns false for regular page with no auth signals', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/dashboard',
      pageText: 'Welcome to the dashboard. You have 3 alerts.',
    })).toBe(false);
  });
});

describe('authWall.autoApply', () => {
  test('returns null (user must authenticate manually)', () => {
    expect(authWall.autoApply({})).toBeNull();
  });
});
