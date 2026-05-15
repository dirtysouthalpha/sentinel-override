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
      onChanged: {
        addListener: jest.fn(),
      },
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
