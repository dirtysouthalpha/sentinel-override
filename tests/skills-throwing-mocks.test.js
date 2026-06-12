// tests/skills-throwing-mocks.test.js
// Covers catch blocks in runRecoverySkills triggered by skill methods that throw:
//   line 203-204: predicate (matches) throws
//   line 221:     autoApply throws
//   line 238:     promptInjection throws
//
// Real skill implementations catch their own errors internally, so we mock
// individual skill modules to produce uncaught throws.

import { jest } from '@jest/globals';

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: jest.fn() },
  },
  runtime: { lastError: null },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// navigate-loop: matches() throws → covers lines 203-204 (outer predicate catch)
jest.unstable_mockModule('../background/skills/navigate-loop.js', () => ({
  navigateLoop: {
    id: 'navigate-loop',
    priority: 10,
    matches: () => { throw new Error('predicate threw'); },
    autoApply: () => null,
    promptInjection: () => '',
  },
}));

// selector-miss: matches() returns true AND autoApply() throws → covers line 221
jest.unstable_mockModule('../background/skills/selector-miss.js', () => ({
  selectorMiss: {
    id: 'selector-miss',
    priority: 10,
    matches: () => true,
    autoApply: () => { throw new Error('autoApply threw'); },
    promptInjection: () => 'recovery text',
  },
}));

// auth-wall: matches() returns true AND promptInjection() throws → covers line 238
jest.unstable_mockModule('../background/skills/auth-wall.js', () => ({
  authWall: {
    id: 'auth-wall',
    priority: 5,
    matches: () => true,
    autoApply: () => null,
    promptInjection: () => { throw new Error('promptInjection threw'); },
  },
}));

const { runRecoverySkills } = await import('../background/skills/index.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runRecoverySkills — predicate throws (lines 203-204)', () => {
  test('logs warning when skill.matches() throws without internal catch', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    runRecoverySkills({ stepCount: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/skills] predicate error in', 'navigate-loop', ':', expect.any(String)
    );
    warnSpy.mockRestore();
  });
});

describe('runRecoverySkills — autoApply throws (line 221)', () => {
  test('logs warning when skill.autoApply() throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    runRecoverySkills({ stepCount: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/skills] autoApply error in', 'selector-miss', ':', expect.any(String)
    );
    warnSpy.mockRestore();
  });

  test('result is non-null even when autoApply throws', () => {
    const result = runRecoverySkills({ stepCount: 1 });
    expect(result).toBeTruthy();
  });
});

describe('runRecoverySkills — promptInjection throws (line 238)', () => {
  test('logs warning when skill.promptInjection() throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    runRecoverySkills({ stepCount: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/skills] promptInjection error in', 'auth-wall', ':', expect.any(String)
    );
    warnSpy.mockRestore();
  });

  test('result still includes injections from other matching skills', () => {
    // selector-miss matches and has a promptInjection that returns 'recovery text'
    const result = runRecoverySkills({ stepCount: 1 });
    expect(result.promptInjection).toContain('recovery text');
  });
});
