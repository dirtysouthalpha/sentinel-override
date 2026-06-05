// tests/skills-index-deep.test.js
// Deep branch tests for background/skills/index.js — covers uncovered lines:
//   44-46 (IIFE: chrome.runtime.lastError, _stats load, _adaptEnabled = false)
//   59   (IIFE catch block)
//   153-154 (skill.matches() throws -> tel.error + console.warn)
//   171 (skill.autoApply() throws -> console.warn)
//   188 (skill.promptInjection() throws -> console.warn)
//
// Strategy:
//   - Lines 45-46: covered at primary import by pre-loading getCallbackResult with
//     stats data and telemetrySkillAdapt=false. The IIFE callback runs synchronously.
//   - Line 44: covered via jest.isolateModules() which re-imports index.js with
//     lastErrorValue set, so the IIFE callback hits the lastError guard.
//   - Lines 153-154, 171, 188: covered by mocking click-no-target skill to throw
//     from matches(), autoApply(), and promptInjection() respectively.

import { jest } from '@jest/globals';

// ---------- chrome mock ----------
// The IIFE calls chrome.storage.local.get(keys, callback). Our mock invokes the
// callback synchronously so lines 44-46 execute at import time.
let lastErrorValue = undefined;
const getCallbackResult = {
  skill_stats: { 'test-skill': { fires: 5, successes: 3, failures: 2, lastFiredAt: 1, lastOutcomeAt: 2 } },
  telemetrySkillAdapt: false,
};

globalThis.chrome = {
  runtime: {
    get lastError() { return lastErrorValue; },
  },
  storage: {
    local: {
      get: jest.fn((_keys, callback) => {
        if (typeof callback === 'function') {
          callback(getCallbackResult);
        }
        return getCallbackResult;
      }),
      set: jest.fn((_obj) => {}),
      remove: jest.fn((_key) => {}),
    },
    onChanged: {
      addListener: jest.fn(),
    },
  },
};

// ---------- Mock telemetry ----------
jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------- Mock skill modules ----------
// A throwing skill that exercises error branches (lines 153-154, 171, 188).
const throwingSkill = {
  id: 'throwing-skill',
  description: 'A skill that throws in matches/autoApply/promptInjection',
  priority: 80,
  matches: jest.fn(() => { throw new Error('matches-boom'); }),
  autoApply: jest.fn(() => { throw new Error('autoApply-boom'); }),
  promptInjection: jest.fn(() => { throw new Error('promptInjection-boom'); }),
};

jest.unstable_mockModule('../background/skills/click-no-target.js', () => ({
  clickNoTarget: throwingSkill,
}));

// No-op skills for all other slots — they never match, so only throwingSkill runs.
const noopSkill = (id) => ({
  id,
  description: `noop ${id}`,
  priority: 50,
  matches: () => false,
  autoApply: () => null,
  promptInjection: () => '',
});

jest.unstable_mockModule('../background/skills/navigate-loop.js', () => ({
  navigateLoop: noopSkill('navigate-loop'),
}));
jest.unstable_mockModule('../background/skills/unproductive-extract.js', () => ({
  unproductiveExtract: noopSkill('unproductive-extract'),
}));
jest.unstable_mockModule('../background/skills/selector-miss.js', () => ({
  selectorMiss: noopSkill('selector-miss'),
}));
jest.unstable_mockModule('../background/skills/consecutive-failures.js', () => ({
  consecutiveFailures: noopSkill('consecutive-failures'),
}));
jest.unstable_mockModule('../background/skills/empty-observation.js', () => ({
  emptyObservation: noopSkill('empty-observation'),
}));
jest.unstable_mockModule('../background/skills/slow-llm-call.js', () => ({
  slowLlmCall: noopSkill('slow-llm-call'),
}));
jest.unstable_mockModule('../background/skills/csp-blocked.js', () => ({
  cspBlocked: noopSkill('csp-blocked'),
}));

// ---------- Import module under test ----------
// The IIFE in index.js runs now. Our chrome.storage.local.get mock invokes the
// callback synchronously with:
//   - lastErrorValue = undefined              -> line 44 NOT hit (no lastError)
//   - getCallbackResult.skill_stats is set     -> line 45 HIT  (_stats loaded)
//   - getCallbackResult.telemetrySkillAdapt = false -> line 46 HIT (_adaptEnabled = false)
const { runRecoverySkills, listSkills, getSkillStats } =
  await import('../background/skills/index.js');

// Capture the onChanged listener registered during IIFE init
const storageChangeListener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0] || null;

beforeEach(() => {
  lastErrorValue = undefined;
  jest.clearAllMocks();
});

// ========== Lines 45-46: IIFE loadAdaptiveState — loaded at import ==========

describe('IIFE loadAdaptiveState — lines 45-46 (loaded at import time)', () => {
  test('line 45: _stats loaded from storage result at import', () => {
    const stats = getSkillStats();
    expect(stats['test-skill']).toBeDefined();
    expect(stats['test-skill'].fires).toBe(5);
    expect(stats['test-skill'].successes).toBe(3);
  });

  test('line 46: _adaptEnabled set to false at import — effectivePriority equals base', () => {
    const skills = listSkills();
    for (const s of skills) {
      expect(s.effectivePriority).toBe(s.priority);
    }
    // Re-enable adapt for subsequent tests
    if (storageChangeListener) {
      storageChangeListener({ telemetrySkillAdapt: { newValue: true } }, 'local');
    }
  });
});

// ========== Line 44: chrome.runtime.lastError guard ==========

describe('IIFE loadAdaptiveState — line 44 (lastError guard)', () => {
  test('line 44: lastError causes console.warn and early return in IIFE callback', async () => {
    // Use jest.isolateModules to re-import index.js with lastErrorValue set.
    // This causes the IIFE callback to hit line 44 (lastError guard) and return early.
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    lastErrorValue = { message: 'storage read failed' };

    await jest.isolateModulesAsync(async () => {
      // Re-register mocks inside the isolated module context
      jest.unstable_mockModule('../background/telemetry.js', () => ({
        tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }));
      const noop = (id) => ({
        id, description: `noop ${id}`, priority: 50,
        matches: () => false, autoApply: () => null, promptInjection: () => '',
      });
      jest.unstable_mockModule('../background/skills/click-no-target.js', () => ({ clickNoTarget: noop('click-no-target') }));
      jest.unstable_mockModule('../background/skills/navigate-loop.js', () => ({ navigateLoop: noop('navigate-loop') }));
      jest.unstable_mockModule('../background/skills/unproductive-extract.js', () => ({ unproductiveExtract: noop('unproductive-extract') }));
      jest.unstable_mockModule('../background/skills/selector-miss.js', () => ({ selectorMiss: noop('selector-miss') }));
      jest.unstable_mockModule('../background/skills/consecutive-failures.js', () => ({ consecutiveFailures: noop('consecutive-failures') }));
      jest.unstable_mockModule('../background/skills/empty-observation.js', () => ({ emptyObservation: noop('empty-observation') }));
      jest.unstable_mockModule('../background/skills/slow-llm-call.js', () => ({ slowLlmCall: noop('slow-llm-call') }));
      jest.unstable_mockModule('../background/skills/csp-blocked.js', () => ({ cspBlocked: noop('csp-blocked') }));

      // Import triggers IIFE — with lastErrorValue set, line 44 executes
      await import('../background/skills/index.js');
    });

    // The IIFE callback should have logged the lastError warning
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Sentinel/skills] storage load error:',
      'storage read failed'
    );

    lastErrorValue = undefined;
    consoleWarnSpy.mockRestore();
  });
});

// ========== Line 59: IIFE catch block ==========

describe('IIFE catch block — line 59', () => {
  test('catch block fires when chrome.storage.local.get throws synchronously', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Use isolateModules to re-import with a get that throws, covering line 59
    const origGet = chrome.storage.local.get;
    chrome.storage.local.get = jest.fn(() => { throw new Error('init catastrophe'); });

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../background/telemetry.js', () => ({
        tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }));
      const noop = (id) => ({
        id, description: `noop ${id}`, priority: 50,
        matches: () => false, autoApply: () => null, promptInjection: () => '',
      });
      jest.unstable_mockModule('../background/skills/click-no-target.js', () => ({ clickNoTarget: noop('click-no-target') }));
      jest.unstable_mockModule('../background/skills/navigate-loop.js', () => ({ navigateLoop: noop('navigate-loop') }));
      jest.unstable_mockModule('../background/skills/unproductive-extract.js', () => ({ unproductiveExtract: noop('unproductive-extract') }));
      jest.unstable_mockModule('../background/skills/selector-miss.js', () => ({ selectorMiss: noop('selector-miss') }));
      jest.unstable_mockModule('../background/skills/consecutive-failures.js', () => ({ consecutiveFailures: noop('consecutive-failures') }));
      jest.unstable_mockModule('../background/skills/empty-observation.js', () => ({ emptyObservation: noop('empty-observation') }));
      jest.unstable_mockModule('../background/skills/slow-llm-call.js', () => ({ slowLlmCall: noop('slow-llm-call') }));
      jest.unstable_mockModule('../background/skills/csp-blocked.js', () => ({ cspBlocked: noop('csp-blocked') }));

      // Import triggers IIFE — get throws, catch on line 59 executes
      await import('../background/skills/index.js');
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Sentinel/skills] init error:',
      'init catastrophe'
    );

    chrome.storage.local.get = origGet;
    consoleWarnSpy.mockRestore();
  });
});

// ========== Lines 153-154: skill.matches() throws ==========

describe('skill.matches() throws — lines 153-154', () => {
  test('tel.error and console.warn are called when matches() throws', async () => {
    const { tel } = await import('../background/telemetry.js');
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    };

    const result = runRecoverySkills(ctx);

    expect(result).toBeDefined();
    expect(result.autoApply).toBeNull();
    expect(result.appliedSkillIds).toEqual([]);
    expect(result.promptInjection).toBe('');

    // Line 153: tel.error
    expect(tel.error).toHaveBeenCalledWith(
      'skill',
      expect.stringContaining('Skill predicate threw: throwing-skill'),
      expect.objectContaining({ skillId: 'throwing-skill' })
    );

    // Line 154: console.warn
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('predicate error in'),
      'throwing-skill',
      ':',
      'matches-boom'
    );

    consoleWarnSpy.mockRestore();
  });
});

// ========== Line 171: skill.autoApply() throws ==========

describe('skill.autoApply() throws — line 171', () => {
  test('console.warn is called when autoApply() throws', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const origMatches = throwingSkill.matches;
    throwingSkill.matches = jest.fn(() => true);

    const ctx = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    };

    const result = runRecoverySkills(ctx);

    expect(result).toBeDefined();
    expect(result.autoApply).toBeNull();

    // Line 171: console.warn
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('autoApply error in'),
      'throwing-skill',
      ':',
      'autoApply-boom'
    );

    throwingSkill.matches = origMatches;
    consoleWarnSpy.mockRestore();
  });
});

// ========== Line 188: skill.promptInjection() throws ==========

describe('skill.promptInjection() throws — line 188', () => {
  test('console.warn is called when promptInjection() throws', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const origMatches = throwingSkill.matches;
    const origAutoApply = throwingSkill.autoApply;
    throwingSkill.matches = jest.fn(() => true);
    throwingSkill.autoApply = jest.fn(() => null);

    const ctx = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    };

    const result = runRecoverySkills(ctx);

    expect(result).toBeDefined();

    // Line 188: console.warn
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('promptInjection error in'),
      'throwing-skill',
      ':',
      'promptInjection-boom'
    );

    throwingSkill.matches = origMatches;
    throwingSkill.autoApply = origAutoApply;
    consoleWarnSpy.mockRestore();
  });
});
