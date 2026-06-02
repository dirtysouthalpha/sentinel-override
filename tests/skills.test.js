// tests/skills.test.js
// Unit tests for all recovery skill modules in background/skills/.
// Each skill exports { id, matches(ctx), autoApply(ctx), promptInjection(ctx) } — pure functions.

import { clickNoTarget } from '../background/skills/click-no-target.js';
import { navigateLoop } from '../background/skills/navigate-loop.js';
import { selectorMiss } from '../background/skills/selector-miss.js';
import { unproductiveExtract } from '../background/skills/unproductive-extract.js';
import { consecutiveFailures } from '../background/skills/consecutive-failures.js';
import { emptyObservation } from '../background/skills/empty-observation.js';
import { cspBlocked } from '../background/skills/csp-blocked.js';
import { slowLlmCall } from '../background/skills/slow-llm-call.js';
import { authWall } from '../background/skills/auth-wall.js';

const allSkills = [cspBlocked, authWall, clickNoTarget, navigateLoop, selectorMiss, unproductiveExtract, emptyObservation, consecutiveFailures, slowLlmCall];

// ========== Shared shape validation ==========

describe('all skills conform to the skill interface', () => {
  test('each skill has id, description, priority, matches, autoApply, promptInjection', () => {
    for (const skill of allSkills) {
      expect(typeof skill.id).toBe('string');
      expect(skill.id.length).toBeGreaterThan(0);
      expect(typeof skill.description).toBe('string');
      expect(typeof skill.priority).toBe('number');
      expect(typeof skill.matches).toBe('function');
      expect(typeof skill.autoApply).toBe('function');
      expect(typeof skill.promptInjection).toBe('function');
    }
  });

  test('skill ids are unique', () => {
    const ids = allSkills.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('matches returns false for null context', () => {
    for (const skill of allSkills) {
      expect(skill.matches(null)).toBe(false);
    }
  });

  test('matches returns false for undefined context', () => {
    for (const skill of allSkills) {
      expect(skill.matches(undefined)).toBe(false);
    }
  });

  test('matches returns false for empty object', () => {
    for (const skill of allSkills) {
      expect(skill.matches({})).toBe(false);
    }
  });

  test('autoApply returns null or an object with a type field', () => {
    for (const skill of allSkills) {
      const result = skill.autoApply({ lastResult: '', lastCommand: { type: 'click' }, lastActionFailed: true });
      if (result !== null) {
        expect(typeof result).toBe('object');
        expect(typeof result.type).toBe('string');
      }
    }
  });

  test('promptInjection returns a non-empty string for matching context', () => {
    // At least one skill should match a typical failure context
    const ctx = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
      consecutiveFailures: 4,
      stepCount: 10,
      dynamicMaxSteps: 50,
    };
    let matchCount = 0;
    for (const skill of allSkills) {
      if (skill.matches(ctx)) {
        matchCount++;
        const text = skill.promptInjection(ctx);
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(20);
      }
    }
    expect(matchCount).toBeGreaterThan(0);
  });
});

// ========== click-no-target ==========

describe('clickNoTarget', () => {
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

  test('does not match when lastActionFailed is false', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    })).toBe(false);
  });

  test('does not match non-blocked results', () => {
    expect(clickNoTarget.matches({
      lastResult: 'Clicked button successfully',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    })).toBe(false);
  });

  test('autoApply returns read_page command', () => {
    const cmd = clickNoTarget.autoApply({
      lastCommand: { type: 'click' },
    });
    expect(cmd).not.toBeNull();
    expect(cmd.type).toBe('read_page');
    expect(cmd._autoAppliedBy).toBe('click-no-target');
  });

  test('promptInjection mentions the command type', () => {
    const text = clickNoTarget.promptInjection({ lastCommand: { type: 'hover' } });
    expect(text).toContain('hover');
  });
});

// ========== navigate-loop ==========

describe('navigateLoop', () => {
  test('matches BLOCKED: already navigated to', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastCommand: { type: 'navigate' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('does not match when action did not fail', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: already navigated to https://example.com',
      lastCommand: { type: 'navigate' },
      lastActionFailed: false,
    })).toBe(false);
  });

  test('does not match unrelated BLOCKED messages', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    })).toBe(false);
  });

  test('autoApply returns read_page', () => {
    const cmd = navigateLoop.autoApply({});
    expect(cmd.type).toBe('read_page');
  });

  test('promptInjection tells agent not to navigate again', () => {
    const text = navigateLoop.promptInjection({});
    expect(typeof text === 'string' ? text.toLowerCase() : String(text)).toContain('do not');
  });
});

// ========== selector-miss ==========

describe('selectorMiss', () => {
  test('matches "element not found"', () => {
    expect(selectorMiss.matches({
      lastResult: 'Element not found: #missing-btn',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('matches "no element" in result', () => {
    expect(selectorMiss.matches({
      lastResult: 'No element matched selector .btn',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('matches "not in element list"', () => {
    expect(selectorMiss.matches({
      lastResult: 'ref abc not in element list',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('matches "error: element" prefix', () => {
    expect(selectorMiss.matches({
      lastResult: 'Error: element selector failed',
      lastCommand: { type: 'type' },
      lastActionFailed: true,
    })).toBe(true);
  });

  test('does not match when action succeeded', () => {
    expect(selectorMiss.matches({
      lastResult: 'Element not found: .btn',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    })).toBe(false);
  });

  test('autoApply returns read_page', () => {
    const cmd = selectorMiss.autoApply({});
    expect(cmd.type).toBe('read_page');
  });

  test('promptInjection includes the failed selector', () => {
    const text = selectorMiss.promptInjection({ lastCommand: { selector: '#my-btn' } });
    expect(text).toContain('#my-btn');
  });
});

// ========== unproductive-extract ==========

describe('unproductiveExtract', () => {
  test('matches "JS returned an empty array"', () => {
    expect(unproductiveExtract.matches({
      lastResult: 'JS returned an empty array',
      lastCommand: { type: 'extract' },
    })).toBe(true);
  });

  test('matches "JS returned null"', () => {
    expect(unproductiveExtract.matches({
      lastResult: 'JS returned null',
      lastCommand: { type: 'execute_js' },
    })).toBe(true);
  });

  test('matches "memory hygiene"', () => {
    expect(unproductiveExtract.matches({
      lastResult: 'Rejected: memory hygiene violation',
      lastCommand: { type: 'extract' },
    })).toBe(true);
  });

  test('matches "rejected: value too short"', () => {
    expect(unproductiveExtract.matches({
      lastResult: 'Rejected: value too short',
      lastCommand: { type: 'extract_list' },
    })).toBe(true);
  });

  test('does not match non-extract command types', () => {
    expect(unproductiveExtract.matches({
      lastResult: 'JS returned null',
      lastCommand: { type: 'click' },
    })).toBe(false);
  });

  test('autoApply returns null (LLM decides)', () => {
    const cmd = unproductiveExtract.autoApply({});
    expect(cmd).toBeNull();
  });

  test('promptInjection includes the key name', () => {
    const text = unproductiveExtract.promptInjection({ lastCommand: { key: 'policy_data' } });
    expect(text).toContain('policy_data');
  });
});

// ========== csp-blocked ==========

describe('cspBlocked', () => {
  test('matches CSP_BLOCKED prefix', () => {
    expect(cspBlocked.matches({
      lastResult: 'CSP_BLOCKED: page denies inline scripts',
    })).toBe(true);
  });

  test('does not match unrelated result', () => {
    expect(cspBlocked.matches({
      lastResult: 'Script executed successfully',
    })).toBe(false);
  });

  test('autoApply returns read_page', () => {
    const cmd = cspBlocked.autoApply({});
    expect(cmd.type).toBe('read_page');
  });

  test('promptInjection includes the key from lastCommand', () => {
    const text = cspBlocked.promptInjection({ lastCommand: { key: 'audit_data' } });
    expect(text).toContain('audit_data');
  });

  test('promptInjection tells agent not to retry execute_js', () => {
    const text = cspBlocked.promptInjection({ lastCommand: { key: 'x' } });
    expect(typeof text === 'string' ? text.toLowerCase() : String(text).toLowerCase()).toContain('do not');
  });
});

// ========== empty-observation ==========

describe('emptyObservation', () => {
  test('matches when elements < 5 and text < 200 after navigate', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      lastActionFailed: false,
      allElements: [{}, {}],
      pageText: 'hi',
      currentUrl: 'https://example.com',
    })).toBe(true);
  });

  test('matches when elements < 5 and text < 200 after read_page with failure', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'read_page' },
      lastActionFailed: true,
      allElements: [],
      pageText: '',
      currentUrl: 'https://example.com',
    })).toBe(true);
  });

  test('does not match when elements >= 5', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      allElements: Array(10).fill({}),
      pageText: '',
      currentUrl: 'https://example.com',
    })).toBe(false);
  });

  test('does not match chrome:// URLs', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      allElements: [],
      pageText: '',
      currentUrl: 'chrome://extensions',
    })).toBe(false);
  });

  test('does not match about: URLs', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'navigate' },
      allElements: [],
      pageText: '',
      currentUrl: 'about:blank',
    })).toBe(false);
  });

  test('does not match successful non-observe actions', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'click' },
      lastActionFailed: false,
      allElements: [],
      pageText: '',
      currentUrl: 'https://example.com',
    })).toBe(false);
  });

  test('autoApply returns wait_for_navigation after navigate', () => {
    const cmd = emptyObservation.autoApply({ lastCommand: { type: 'navigate' } });
    expect(cmd).not.toBeNull();
    expect(cmd.type).toBe('wait_for_navigation');
  });

  test('autoApply returns null after read_page', () => {
    const cmd = emptyObservation.autoApply({ lastCommand: { type: 'read_page' } });
    expect(cmd).toBeNull();
  });
});

// ========== consecutive-failures ==========

describe('consecutiveFailures', () => {
  test('matches when consecutiveFailures >= 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 3 })).toBe(true);
    expect(consecutiveFailures.matches({ consecutiveFailures: 5 })).toBe(true);
  });

  test('does not match when consecutiveFailures < 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 2 })).toBe(false);
    expect(consecutiveFailures.matches({ consecutiveFailures: 0 })).toBe(false);
  });

  test('autoApply returns null at 3 failures (lets LLM try with directive)', () => {
    const cmd = consecutiveFailures.autoApply({ consecutiveFailures: 3 });
    expect(cmd).toBeNull();
  });

  test('promptInjection mentions the failure count', () => {
    const text = consecutiveFailures.promptInjection({ consecutiveFailures: 4 });
    expect(text).toContain('4');
  });

  test('promptInjection mentions remaining steps', () => {
    const text = consecutiveFailures.promptInjection({
      consecutiveFailures: 3,
      stepCount: 10,
      dynamicMaxSteps: 30,
    });
    expect(text).toContain('20');
  });
});

// ========== slow-llm-call ==========

describe('slowLlmCall', () => {
  test('matches when lastAiCallMs >= 25000', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 25000 })).toBe(true);
    expect(slowLlmCall.matches({ lastAiCallMs: 60000 })).toBe(true);
  });

  test('does not match when lastAiCallMs < 25000', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 24999 })).toBe(false);
    expect(slowLlmCall.matches({ lastAiCallMs: 5000 })).toBe(false);
  });

  test('does not match when lastAiCallMs is not a number', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 'slow' })).toBe(false);
    expect(slowLlmCall.matches({})).toBe(false);
  });

  test('autoApply returns null (no deterministic recovery)', () => {
    const cmd = slowLlmCall.autoApply({ lastAiCallMs: 30000 });
    expect(cmd).toBeNull();
  });

  test('promptInjection mentions the duration in seconds', () => {
    const text = slowLlmCall.promptInjection({ lastAiCallMs: 35000 });
    expect(text).toContain('35');
  });
});

// ========== authWall ==========

describe('authWall', () => {
  test('matches on known SSO/login URL patterns', () => {
    const ssoUrls = [
      'https://login.microsoftonline.com/tenant/oauth2/authorize',
      'https://accounts.google.com/signin/v2/identifier',
      'https://myorg.okta.com/login/login.htm',
      'https://example.com/auth/login',
      'https://example.com/sso/saml',
    ];
    for (const url of ssoUrls) {
      expect(authWall.matches({ currentUrl: url, pageText: 'some text' })).toBe(true);
    }
  });

  test('matches on MFA/login text with short page', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/app',
      pageText: 'Enter your two-factor authentication code',
    })).toBe(true);
  });

  test('matches on session expired text', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/app',
      pageText: 'Your session has expired. Please sign in again.',
    })).toBe(true);
  });

  test('does not match on a normal page with short text', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/dashboard',
      pageText: 'Welcome back. Your dashboard is loading.',
    })).toBe(false);
  });

  test('does not match on long page that mentions login incidentally', () => {
    const longPage = 'Click Login to sign in. '.repeat(200);
    expect(authWall.matches({
      currentUrl: 'https://example.com/docs',
      pageText: longPage,
    })).toBe(false);
  });

  test('returns null from autoApply (user must authenticate)', () => {
    const cmd = authWall.autoApply({ currentUrl: 'https://login.microsoftonline.com/', pageText: 'Sign in' });
    expect(cmd).toBeNull();
  });

  test('promptInjection for MFA challenge mentions wait_for_navigation', () => {
    const text = authWall.promptInjection({
      currentUrl: 'https://duo.com/verify',
      pageText: 'Approve this sign-in request from Duo',
    });
    expect(text).toContain('wait_for_navigation');
    expect(text).toContain('MFA');
  });

  test('promptInjection for SSO redirect mentions SSO and waiting', () => {
    const text = authWall.promptInjection({
      currentUrl: 'https://login.microsoftonline.com/tenant/oauth2',
      pageText: 'Sign in to your account',
    });
    expect(text).toContain('SSO');
    expect(text).toContain('wait_for_navigation');
  });

  test('promptInjection for generic login mentions credentials', () => {
    const text = authWall.promptInjection({
      currentUrl: 'https://example.com/login',
      pageText: 'Enter your email and password',
    });
    expect(text).toContain('login');
  });

  test('matches returns false for null', () => {
    expect(authWall.matches(null)).toBe(false);
  });
});
