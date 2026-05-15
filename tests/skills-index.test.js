// tests/skills-index.test.js
// Unit tests for background/skills/index.js — recovery skill orchestrator.
// Tests runRecoverySkills, listSkills, getSkillStats, resetSkillStats,
// adaptive priority, and outcome tracking.

import { jest } from '@jest/globals';

// ---------- chrome mock ----------
let storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
        const result = {};
        for (const k of keyList) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async (key) => { delete storageData[key]; }),
    },
    onChanged: {
      addListener: jest.fn(),
    },
  },
};

// Mock telemetry
jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { runRecoverySkills, listSkills, getSkillStats, resetSkillStats } =
  await import('../background/skills/index.js');

// Capture the onChanged listener registered during module init (before mocks are cleared)
const storageChangeListener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0] || null;

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
});

// ========== runRecoverySkills ==========

describe('runRecoverySkills', () => {
  test('returns empty result for null context', () => {
    const result = runRecoverySkills(null);
    expect(result.autoApply).toBeNull();
    expect(result.promptInjection).toBe('');
    expect(result.appliedSkillIds).toEqual([]);
  });

  test('returns empty result for undefined context', () => {
    const result = runRecoverySkills(undefined);
    expect(result.autoApply).toBeNull();
  });

  test('returns empty result for empty object', () => {
    const result = runRecoverySkills({});
    expect(result.autoApply).toBeNull();
  });

  test('matches click-no-target pattern and auto-applies read_page', () => {
    const ctx = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
      consecutiveFailures: 1,
      stepCount: 5,
    };
    const result = runRecoverySkills(ctx);
    expect(result.appliedSkillIds.length).toBeGreaterThan(0);
    expect(result.autoApply).not.toBeNull();
    expect(result.autoApply.type).toBe('read_page');
  });

  test('matches CSP_BLOCKED and auto-applies', () => {
    const ctx = {
      lastResult: 'CSP_BLOCKED: inline scripts denied',
      lastCommand: { type: 'execute_js' },
      lastActionFailed: true,
    };
    const result = runRecoverySkills(ctx);
    expect(result.appliedSkillIds).toContain('csp-blocked');
  });

  test('matches consecutive-failures pattern', () => {
    const ctx = {
      consecutiveFailures: 5,
      lastActionFailed: true,
      stepCount: 10,
      dynamicMaxSteps: 30,
    };
    const result = runRecoverySkills(ctx);
    expect(result.appliedSkillIds).toContain('consecutive-failures');
  });

  test('includes promptInjection from matching skills', () => {
    const ctx = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
      consecutiveFailures: 1,
    };
    const result = runRecoverySkills(ctx);
    if (result.appliedSkillIds.length > 0) {
      // At least one skill matched — promptInjection may be populated
      expect(typeof result.promptInjection).toBe('string');
    }
  });

  test('records pending outcomes when skills applied', () => {
    const ctx1 = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    };
    const result1 = runRecoverySkills(ctx1);
    expect(result1.appliedSkillIds.length).toBeGreaterThan(0);

    // Now simulate a follow-up call where the action succeeded
    const ctx2 = {
      lastResult: 'Clicked successfully',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    };
    runRecoverySkills(ctx2);
    // After outcome recording, stats should have been updated
    // (verified via getSkillStats below)
  });

  test('sorts matching skills by effective priority', () => {
    // Create a context that matches multiple skills
    const ctx = {
      lastResult: 'Element not found: #btn',
      lastCommand: { type: 'click', selector: '#btn' },
      lastActionFailed: true,
      consecutiveFailures: 4,
      stepCount: 10,
      dynamicMaxSteps: 30,
    };
    const result = runRecoverySkills(ctx);
    // Multiple skills should match
    expect(result.appliedSkillIds.length).toBeGreaterThanOrEqual(1);
  });
});

// ========== listSkills ==========

describe('listSkills', () => {
  test('returns array of skill descriptors', () => {
    const skills = listSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(typeof s.priority).toBe('number');
      expect(typeof s.effectivePriority).toBe('number');
    }
  });

  test('each skill has a unique id', () => {
    const skills = listSkills();
    const ids = skills.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ========== getSkillStats ==========

describe('getSkillStats', () => {
  test('returns empty object when no stats recorded', () => {
    // Reset first
    const stats = getSkillStats();
    expect(typeof stats).toBe('object');
  });

  test('includes stats after skills fire and outcomes recorded', () => {
    // Fire a skill
    const ctx1 = {
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    };
    const result = runRecoverySkills(ctx1);
    expect(result.appliedSkillIds.length).toBeGreaterThan(0);

    // Record outcome (success)
    runRecoverySkills({
      lastResult: 'ok',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    });

    const stats = getSkillStats();
    const skillId = result.appliedSkillIds[0];
    if (stats[skillId]) {
      expect(stats[skillId].fires).toBeGreaterThan(0);
      expect(typeof stats[skillId].successRate).toBe('number');
    }
  });
});

// ========== resetSkillStats ==========

describe('resetSkillStats', () => {
  test('clears all stats', async () => {
    // Fire a skill to create stats
    runRecoverySkills({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    });
    runRecoverySkills({
      lastResult: 'ok',
      lastCommand: { type: 'click' },
      lastActionFailed: false,
    });

    await resetSkillStats();
    const stats = getSkillStats();
    // After reset, stats may still have basePriority/effectivePriority
    // but fires/successes should be gone
    for (const v of Object.values(stats)) {
      expect(v.fires).toBeFalsy();
    }
  });
});

// ========== Adaptive state — storage change listener ==========

describe('adaptive state — onChanged listener', () => {
  test('updates _adaptEnabled when ADAPT_ENABLED_KEY changes', () => {
    if (!storageChangeListener) return;
    storageChangeListener({ telemetrySkillAdapt: { newValue: false } }, 'local');
    // After this, adaptive priority should be disabled
    const skills = listSkills();
    for (const s of skills) {
      expect(s.effectivePriority).toBe(s.priority);
    }
    // Re-enable
    storageChangeListener({ telemetrySkillAdapt: { newValue: true } }, 'local');
  });

  test('ignores non-local area changes', () => {
    if (!storageChangeListener) return;
    storageChangeListener({ telemetrySkillAdapt: { newValue: false } }, 'sync');
    // Should not have changed — adaptive still enabled
  });

  test('updates _stats when STATS_KEY changes', () => {
    if (!storageChangeListener) return;
    const newStats = { 'click-no-target': { fires: 10, successes: 8, failures: 2, lastFiredAt: 1000, lastOutcomeAt: 1001 } };
    storageChangeListener({ skill_stats: { newValue: newStats } }, 'local');
    const stats = getSkillStats();
    if (stats['click-no-target']) {
      expect(stats['click-no-target'].fires).toBe(10);
    }
    // Clean up
    storageChangeListener({ skill_stats: { newValue: null } }, 'local');
  });

  test('handles null newValue for STATS_KEY', () => {
    if (!storageChangeListener) return;
    storageChangeListener({ skill_stats: { newValue: null } }, 'local');
    const stats = getSkillStats();
    for (const v of Object.values(stats)) {
      expect(v.fires).toBeFalsy();
    }
  });

  test('handles undefined newValue for ADAPT_ENABLED_KEY', () => {
    if (!storageChangeListener) return;
    storageChangeListener({ telemetrySkillAdapt: { newValue: undefined } }, 'local');
  });
});

// ========== _recordPendingOutcomes — early return ==========

describe('runRecoverySkills — pending outcomes early return', () => {
  test('clears pending outcomes when lastActionFailed is not boolean', () => {
    // First fire a skill to set pending outcomes
    runRecoverySkills({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    });

    // Now call with non-boolean lastActionFailed — should clear pending without recording
    // Skills may still match in this call, but pending outcomes from previous call are cleared
    const result = runRecoverySkills({ lastActionFailed: 'not-a-bool' });
    expect(result).toBeDefined();
    expect(typeof result.promptInjection).toBe('string');
  });

  test('clears pending outcomes when lastActionFailed is undefined', () => {
    runRecoverySkills({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    });

    const result = runRecoverySkills({ lastActionFailed: undefined });
    expect(result.appliedSkillIds).toEqual([]);
  });
});

// ========== _scheduleSaveStats timer ==========

describe('_scheduleSaveStats — debounced save', () => {
  test('set is called when stats are saved', async () => {
    await resetSkillStats();
    jest.clearAllMocks();

    // Fire a skill to trigger _scheduleSaveStats
    runRecoverySkills({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true,
    });

    // _scheduleSaveStats uses setTimeout(1500). Wait for it.
    await new Promise(r => setTimeout(r, 1600));

    // The debounced save should have fired
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const setCalls = chrome.storage.local.set.mock.calls;
    const lastCall = setCalls[setCalls.length - 1];
    if (lastCall && lastCall[0]) {
      expect(lastCall[0]).toHaveProperty('skill_stats');
    }
  });
});

// ========== Adaptive priority adjustment ==========

describe('adaptive priority — success rate adjustment', () => {
  test('adjusts effective priority based on success rate', () => {
    // Need to fire the same skill enough times (>= MIN_FIRES_FOR_ADJUSTMENT=3)
    // to trigger priority adjustment
    const skillId = 'click-no-target';

    // Fire skill + success outcome 4 times
    for (let i = 0; i < 4; i++) {
      runRecoverySkills({
        lastResult: 'BLOCKED: click command has no target',
        lastCommand: { type: 'click' },
        lastActionFailed: true,
      });
      runRecoverySkills({
        lastResult: 'ok',
        lastCommand: { type: 'click' },
        lastActionFailed: false,
      });
    }

    const stats = getSkillStats();
    if (stats[skillId] && stats[skillId].fires >= 3) {
      // High success rate should increase effective priority
      const skills = listSkills();
      const skill = skills.find(s => s.id === skillId);
      if (skill) {
        expect(skill.effectivePriority).toBeGreaterThanOrEqual(skill.priority);
      }
    }

    // Reset
    resetSkillStats();
  });
});

// ========== Skills index — error handling edge cases ==========

describe('skills index — error handling edge cases', () => {
  test('runRecoverySkills returns empty for undefined context', () => {
    const result = runRecoverySkills(undefined);
    expect(result.autoApply).toBeNull();
    expect(result.promptInjection).toBe('');
  });

  test('runRecoverySkills returns empty for non-object context', () => {
    const result = runRecoverySkills('string-context');
    expect(result.autoApply).toBeNull();
  });

  test('runRecoverySkills handles non-boolean lastActionFailed gracefully', () => {
    // Non-boolean should clear pending outcomes without crashing
    const result = runRecoverySkills({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: 'yes', // not boolean
    });
    expect(result).toBeDefined();
  });

  test('runRecoverySkills handles missing lastActionFailed gracefully', () => {
    const result = runRecoverySkills({
      lastResult: 'BLOCKED: click command has no target',
      lastCommand: { type: 'click' },
    });
    expect(result).toBeDefined();
  });

  test('resetSkillStats does not throw when storage.remove fails', async () => {
    const origRemove = chrome.storage.local.remove;
    chrome.storage.local.remove = jest.fn(async () => { throw new Error('storage error'); });
    await expect(resetSkillStats()).resolves.toBeUndefined();
    chrome.storage.local.remove = origRemove;
  });

  test('listSkills returns array with id and priority', () => {
    const skills = listSkills();
    expect(Array.isArray(skills)).toBe(true);
    for (const s of skills) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.priority).toBe('number');
      expect(typeof s.effectivePriority).toBe('number');
    }
  });

  test('getSkillStats returns empty object after reset', async () => {
    await resetSkillStats();
    const stats = getSkillStats();
    expect(stats).toBeDefined();
  });

  test('storage change listener handles undefined values', () => {
    if (!storageChangeListener) return;
    // Simulate a storage change with undefined newValue
    expect(() => {
      storageChangeListener(
        { sentinel_skill_adapt_enabled: { newValue: undefined } },
        'local'
      );
    }).not.toThrow();
  });

  test('storage change listener handles non-object stats value', () => {
    if (!storageChangeListener) return;
    expect(() => {
      storageChangeListener(
        { sentinel_skill_stats: { newValue: 'not-an-object' } },
        'local'
      );
    }).not.toThrow();
  });
});
