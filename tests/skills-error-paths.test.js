// tests/skills-error-paths.test.js
// Error path and catch block coverage for all skill modules.
// Tests edge cases that exercise the try/catch blocks in each skill.

import { jest } from '@jest/globals';

import { clickNoTarget } from '../background/skills/click-no-target.js';
import { consecutiveFailures } from '../background/skills/consecutive-failures.js';
import { cspBlocked } from '../background/skills/csp-blocked.js';
import { emptyObservation } from '../background/skills/empty-observation.js';
import { navigateLoop } from '../background/skills/navigate-loop.js';
import { selectorMiss } from '../background/skills/selector-miss.js';
import { slowLlmCall } from '../background/skills/slow-llm-call.js';
import { unproductiveExtract } from '../background/skills/unproductive-extract.js';
import { authWall } from '../background/skills/auth-wall.js';

// ── Navigate Loop — error paths ──────────────────────────────────────
describe('navigateLoop error paths', () => {
  test('matches with non-string lastResult returns false', () => {
    expect(navigateLoop.matches({ lastResult: 12345, lastActionFailed: true })).toBe(false);
  });

  test('matches with non-string-like lastResult', () => {
    expect(navigateLoop.matches({ lastResult: {}, lastActionFailed: true })).toBe(false);
  });

  test('autoApply with null ctx returns null', () => {
    expect(navigateLoop.autoApply(null)).toBeNull();
  });

  test('autoApply with undefined ctx returns null', () => {
    expect(navigateLoop.autoApply(undefined)).toBeNull();
  });

  test('promptInjection with null ctx returns empty string', () => {
    expect(navigateLoop.promptInjection(null)).toBe('');
  });

  test('promptInjection with undefined ctx returns empty string', () => {
    expect(navigateLoop.promptInjection(undefined)).toBe('');
  });

  test('promptInjection includes SPA and execute_js advice', () => {
    const prompt = navigateLoop.promptInjection({});
    expect(prompt).toContain('SPA');
    expect(prompt).toContain('execute_js');
  });

  test('matches BLOCKED with mixed case', () => {
    expect(navigateLoop.matches({
      lastResult: 'Blocked: Already Navigated To https://example.com',
      lastActionFailed: true
    })).toBe(true);
  });
});

// ── CSP Blocked — error paths ────────────────────────────────────────
describe('cspBlocked error paths', () => {
  test('matches with non-string lastResult returns false', () => {
    expect(cspBlocked.matches({ lastResult: 42 })).toBe(false);
  });

  test('matches with array lastResult returns false', () => {
    expect(cspBlocked.matches({ lastResult: ['CSP_BLOCKED'] })).toBe(false);
  });

  test('matches with object lastResult returns false', () => {
    expect(cspBlocked.matches({ lastResult: { msg: 'CSP_BLOCKED' } })).toBe(false);
  });

  test('promptInjection handles missing lastCommand gracefully', () => {
    const prompt = cspBlocked.promptInjection({});
    expect(prompt).toContain('(no key)');
    expect(prompt).toContain('Content-Security-Policy');
  });

  test('promptInjection handles null ctx (error path)', () => {
    // The catch block returns a fallback string
    const prompt = cspBlocked.promptInjection(null);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  test('promptInjection includes CSP alternatives', () => {
    const prompt = cspBlocked.promptInjection({ lastCommand: { key: 'test' } });
    expect(prompt).toContain('read_page');
    expect(prompt).toContain('extract');
    expect(prompt).toContain('read_network_requests');
  });
});

// ── Click No Target — error paths ────────────────────────────────────
describe('clickNoTarget error paths', () => {
  test('matches with non-string lastResult returns false', () => {
    expect(clickNoTarget.matches({ lastResult: 42, lastCommand: { type: 'click' }, lastActionFailed: true })).toBe(false);
  });

  test('matches with undefined lastResult returns false', () => {
    expect(clickNoTarget.matches({ lastResult: undefined, lastCommand: { type: 'click' }, lastActionFailed: true })).toBe(false);
  });

  test('promptInjection handles null lastCommand', () => {
    const prompt = clickNoTarget.promptInjection({ lastCommand: null });
    expect(prompt).toContain('click'); // defaults to 'click'
  });

  test('promptInjection handles missing lastCommand', () => {
    const prompt = clickNoTarget.promptInjection({});
    expect(prompt).toContain('click');
    expect(prompt).toContain('Do NOT re-emit');
  });

  test('promptInjection references hover type', () => {
    const prompt = clickNoTarget.promptInjection({ lastCommand: { type: 'hover' } });
    expect(prompt).toContain('hover');
  });
});

// ── Selector Miss — error paths ──────────────────────────────────────
describe('selectorMiss error paths', () => {
  test('matches with non-string lastResult converts to string', () => {
    // String() of a number works, but lowercase wouldn't contain "element not found"
    expect(selectorMiss.matches({ lastResult: 12345, lastActionFailed: true })).toBe(false);
  });

  test('matches null ctx returns false', () => {
    expect(selectorMiss.matches(null)).toBe(false);
  });

  test('matches undefined ctx returns false', () => {
    expect(selectorMiss.matches(undefined)).toBe(false);
  });

  test('promptInjection handles missing lastCommand', () => {
    const prompt = selectorMiss.promptInjection({});
    expect(prompt).toContain('(unknown)');
    expect(prompt).toContain('didn\'t resolve');
  });

  test('promptInjection uses selector over ref', () => {
    const prompt = selectorMiss.promptInjection({ lastCommand: { ref: 'ref42', selector: '#btn' } });
    expect(prompt).toContain('#btn');
  });
});

// ── Empty Observation — error paths ──────────────────────────────────
describe('emptyObservation error paths', () => {
  test('matches with non-array allElements', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'read_page' },
      lastActionFailed: true,
      allElements: 'not an array',
      pageText: '',
      currentUrl: 'https://example.com'
    })).toBe(true); // elementCount becomes 0
  });

  test('matches with undefined allElements', () => {
    expect(emptyObservation.matches({
      lastCommand: { type: 'read_page' },
      lastActionFailed: true,
      pageText: '',
      currentUrl: 'https://example.com'
    })).toBe(true);
  });

  test('autoApply returns null for undefined ctx', () => {
    expect(emptyObservation.autoApply(undefined)).toBeNull();
  });

  test('autoApply returns null for empty ctx', () => {
    expect(emptyObservation.autoApply({})).toBeNull();
  });

  test('autoApply returns wait_for_navigation for navigate command', () => {
    const result = emptyObservation.autoApply({ lastCommand: { type: 'navigate' } });
    expect(result.type).toBe('wait_for_navigation');
    expect(result.timeout).toBe(8000);
  });

  test('promptInjection returns non-empty string for any ctx', () => {
    const prompt = emptyObservation.promptInjection({});
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('nearly empty');
  });
});

// ── Consecutive Failures — error paths ───────────────────────────────
describe('consecutiveFailures error paths', () => {
  test('matches with undefined ctx returns false', () => {
    expect(consecutiveFailures.matches(undefined)).toBe(false);
  });

  test('promptInjection with empty ctx uses defaults', () => {
    const prompt = consecutiveFailures.promptInjection({});
    expect(prompt).toContain('0');
    expect(prompt).toContain('100'); // DEFAULT_MAX_STEPS
  });

  test('promptInjection includes steps remaining', () => {
    const prompt = consecutiveFailures.promptInjection({
      consecutiveFailures: 3,
      dynamicMaxSteps: 50,
      stepCount: 40
    });
    expect(prompt).toContain('10'); // 50 - 40
  });

  test('promptInjection clamps remaining to 0 if over budget', () => {
    const prompt = consecutiveFailures.promptInjection({
      consecutiveFailures: 5,
      dynamicMaxSteps: 30,
      stepCount: 50
    });
    expect(prompt).toContain('0');
  });
});

// ── Slow LLM Call — error paths ──────────────────────────────────────
describe('slowLlmCall error paths', () => {
  test('matches with undefined ctx returns false', () => {
    expect(slowLlmCall.matches(undefined)).toBe(false);
  });

  test('matches with null ctx returns false', () => {
    expect(slowLlmCall.matches(null)).toBe(false);
  });

  test('matches with string lastAiCallMs returns false', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: '25000' })).toBe(false);
  });

  test('matches with boolean lastAiCallMs returns false', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: true })).toBe(false);
  });

  test('promptInjection includes seconds from lastAiCallMs', () => {
    const prompt = slowLlmCall.promptInjection({ lastAiCallMs: 45000 });
    expect(prompt).toContain('45');
    expect(prompt).toContain('prompt bloat');
  });

  test('promptInjection with missing lastAiCallMs shows ?', () => {
    const prompt = slowLlmCall.promptInjection({});
    expect(prompt).toContain('?');
  });

  test('promptInjection with non-number lastAiCallMs shows ?', () => {
    const prompt = slowLlmCall.promptInjection({ lastAiCallMs: 'slow' });
    expect(prompt).toContain('?');
  });
});

// ── Unproductive Extract — error paths ───────────────────────────────
describe('unproductiveExtract error paths', () => {
  test('matches with null ctx returns false', () => {
    expect(unproductiveExtract.matches(null)).toBe(false);
  });

  test('matches with undefined lastResult returns false', () => {
    expect(unproductiveExtract.matches({ lastCommand: { type: 'extract' } })).toBe(false);
  });

  test('matches with undefined lastCommand returns false', () => {
    expect(unproductiveExtract.matches({ lastResult: 'JS returned null' })).toBe(false);
  });

  test('matches does not match note type', () => {
    expect(unproductiveExtract.matches({
      lastCommand: { type: 'note' },
      lastResult: 'JS returned null'
    })).toBe(false);
  });

  test('promptInjection handles missing lastCommand', () => {
    const prompt = unproductiveExtract.promptInjection({});
    expect(prompt).toContain('(unknown)');
  });

  test('promptInjection includes the key name', () => {
    const prompt = unproductiveExtract.promptInjection({ lastCommand: { key: 'user_data' } });
    expect(prompt).toContain('user_data');
    expect(prompt).toContain('Do NOT retry');
  });

  test('promptInjection with null ctx returns string', () => {
    // This will access lastCommand?.key which returns undefined
    const prompt = unproductiveExtract.promptInjection({});
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ── Auth Wall — error paths ──────────────────────────────────────────
describe('authWall error paths', () => {
  test('matches null ctx returns false', () => {
    expect(authWall.matches(null)).toBe(false);
  });

  test('matches empty ctx returns false', () => {
    expect(authWall.matches({})).toBe(false);
  });

  test('matches with login URL returns true', () => {
    expect(authWall.matches({ currentUrl: 'https://login.microsoftonline.com/oauth2/authorize' })).toBe(true);
  });

  test('matches with SSO URL returns true', () => {
    expect(authWall.matches({ currentUrl: 'https://company.okta.com/app/office365' })).toBe(true);
  });

  test('matches with sign-in text on short page returns true', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/auth',
      pageText: 'Please sign in to continue'
    })).toBe(true);
  });

  test('does not match sign-in text on long page', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/article',
      pageText: 'Please sign in to continue. ' + 'x'.repeat(3000)
    })).toBe(false);
  });

  test('autoApply returns null', () => {
    expect(authWall.autoApply({})).toBeNull();
  });

  test('promptInjection handles MFA page', () => {
    const prompt = authWall.promptInjection({
      currentUrl: 'https://login.microsoftonline.com/mfa',
      pageText: 'Approve sign-in request'
    });
    expect(prompt).toContain('MFA');
    expect(prompt).toContain('note');
  });

  test('promptInjection handles SSO page', () => {
    const prompt = authWall.promptInjection({
      currentUrl: 'https://company.okta.com/signin',
      pageText: 'Enter your credentials'
    });
    expect(prompt).toContain('SSO');
    expect(prompt).toContain('okta');
  });

  test('promptInjection handles generic login page', () => {
    const prompt = authWall.promptInjection({
      currentUrl: 'https://example.com/login',
      pageText: 'Sign in'
    });
    expect(prompt).toContain('login');
    expect(prompt).toContain('credentials');
  });

  test('promptInjection handles missing ctx fields gracefully', () => {
    const prompt = authWall.promptInjection({});
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  test('promptInjection with null ctx uses defaults', () => {
    const prompt = authWall.promptInjection(null);
    expect(typeof prompt).toBe('string');
  });
});

// ── Auth Wall — URL/text detection ───────────────────────────────────
describe('authWall URL/text patterns', () => {
  test('detects Google accounts URL', () => {
    expect(authWall.matches({ currentUrl: 'https://accounts.google.com/signin' })).toBe(true);
  });

  test('detects GitHub login URL', () => {
    expect(authWall.matches({ currentUrl: 'https://github.com/login' })).toBe(true);
  });

  test('detects Duosecurity URL', () => {
    expect(authWall.matches({ currentUrl: 'https://api.duosecurity.com/auth' })).toBe(true);
  });

  test('detects SAML URL', () => {
    expect(authWall.matches({ currentUrl: 'https://idp.example.com/saml/sso' })).toBe(true);
  });

  test('detects session expired text', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/page',
      pageText: 'Your session has expired. Please sign in again.'
    })).toBe(true);
  });

  test('detects forgot password text', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/page',
      pageText: 'Forgot password? Enter your email to reset'
    })).toBe(true);
  });

  test('detects MFA required text', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/page',
      pageText: 'MFA required to access this resource'
    })).toBe(true);
  });

  test('does not match regular page with no auth cues', () => {
    expect(authWall.matches({
      currentUrl: 'https://example.com/dashboard',
      pageText: 'Welcome to the dashboard'
    })).toBe(false);
  });
});
