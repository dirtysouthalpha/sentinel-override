// tests/agent-learning-unit.test.js
// Tests for agent-learning.js that require the real module (not the mock used in agent-learning.test.js).
// Specifically covers edge cases in the actual implementation that the mock cannot exercise.

import { describe, test, expect, beforeAll } from '@jest/globals';

// Set up chrome global before importing the real module
const _storage = {};
globalThis.chrome = {
  storage: {
    local: {
      get(keys, cb) {
        const r = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (_storage[k] !== undefined) r[k] = _storage[k];
        });
        if (cb) cb(r);
      },
      set(data, cb) { Object.assign(_storage, data); if (cb) cb(); }
    }
  },
  runtime: { lastError: null }
};

// Pre-populate storage with a legacy playbook that has no triggerPatterns field.
// This simulates data written by an older version of the extension before triggerPatterns was added.
_storage['agent_auto_playbooks'] = [
  {
    id: 'pb_legacy',
    goalKey: 'block ip address',
    platform: 'sonicwall_nsm',
    // intentionally missing triggerPatterns — old format
    steps: [{ type: 'click', selector: '#block-btn', value: '', description: '' }],
    runCount: 5,
    successRate: 0.9,
    createdAt: 1000,
    lastUsed: 2000
  }
];

const mod = await import('../background/agent-learning.js');

describe('agent-learning (real module) — triggerPatterns guard', () => {
  beforeAll(async () => {
    await mod.initLearningEngine();
  });

  test('findOneShotPlaybook does not crash when playbook has no triggerPatterns', () => {
    // Before the fix, this would throw: Cannot read properties of undefined (reading 'some')
    expect(() => mod.findOneShotPlaybook('block ip address', 'sonicwall_nsm')).not.toThrow();
  });

  test('findOneShotPlaybook returns null for playbook with no triggerPatterns (no false match)', () => {
    // A playbook without triggerPatterns should not match any goal
    const result = mod.findOneShotPlaybook('block ip address', 'sonicwall_nsm');
    expect(result).toBeNull();
  });
});
