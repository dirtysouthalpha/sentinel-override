// tests/skills-navigation-failure.test.js
// Unit tests for the navigation-failure recovery skill.

import { navigationFailure } from '../background/skills/navigation-failure.js';

describe('navigationFailure skill', () => {
  test('has required interface', () => {
    expect(typeof navigationFailure.id).toBe('string');
    expect(typeof navigationFailure.description).toBe('string');
    expect(typeof navigationFailure.priority).toBe('number');
    expect(typeof navigationFailure.matches).toBe('function');
    expect(typeof navigationFailure.autoApply).toBe('function');
    expect(typeof navigationFailure.promptInjection).toBe('function');
  });

  test('matches navigate failure (network error)', () => {
    const ctx = {
      lastResult: 'net::ERR_CONNECTION_REFUSED',
      lastActionFailed: true,
      lastCommand: { type: 'navigate', url: 'https://example.com' },
    };
    expect(navigationFailure.matches(ctx)).toBe(true);
  });

  test('matches navigate failure (timeout)', () => {
    const ctx = {
      lastResult: 'Navigation failed: load timeout',
      lastActionFailed: true,
      lastCommand: { type: 'navigate', url: 'https://example.com' },
    };
    expect(navigationFailure.matches(ctx)).toBe(true);
  });

  test('matches navigate failure (DNS error)', () => {
    const ctx = {
      lastResult: 'DNS_PROBE_FINISHED_NXDOMAIN',
      lastActionFailed: true,
      lastCommand: { type: 'navigate', url: 'https://example.com' },
    };
    expect(navigationFailure.matches(ctx)).toBe(true);
  });

  test('does not match non-navigate command', () => {
    const ctx = {
      lastResult: 'net::ERR_CONNECTION_REFUSED',
      lastActionFailed: true,
      lastCommand: { type: 'click', selector: '#btn' },
    };
    expect(navigationFailure.matches(ctx)).toBe(false);
  });

  test('does not match when action succeeded', () => {
    const ctx = {
      lastResult: 'net::ERR_CONNECTION_REFUSED',
      lastActionFailed: false,
      lastCommand: { type: 'navigate', url: 'https://example.com' },
    };
    expect(navigationFailure.matches(ctx)).toBe(false);
  });

  test('does not match null context', () => {
    expect(navigationFailure.matches(null)).toBe(false);
  });

  test('autoApply returns retry navigate for network errors', () => {
    const ctx = {
      lastResult: 'net::ERR_CONNECTION_REFUSED',
      lastCommand: { type: 'navigate', url: 'https://example.com' },
    };
    const cmd = navigationFailure.autoApply(ctx);
    expect(cmd).not.toBeNull();
    expect(cmd.type).toBe('navigate');
    expect(cmd.url).toBe('https://example.com');
    expect(cmd._autoAppliedBy).toBe('navigation-failure');
  });

  test('autoApply returns null for auth wall errors', () => {
    const ctx = {
      lastResult: '401 Unauthorized — login required',
      lastCommand: { type: 'navigate', url: 'https://example.com' },
    };
    const cmd = navigationFailure.autoApply(ctx);
    expect(cmd).toBeNull();
  });

  test('promptInjection includes URL', () => {
    const ctx = { lastCommand: { type: 'navigate', url: 'https://example.com/page' } };
    const text = navigationFailure.promptInjection(ctx);
    expect(text).toContain('https://example.com/page');
  });

  test('promptInjection detects auth wall', () => {
    const ctx = {
      lastResult: '403 Forbidden',
      lastCommand: { type: 'navigate', url: 'https://example.com/admin' },
    };
    const text = navigationFailure.promptInjection(ctx);
    expect(text).toContain('auth');
  });
});
