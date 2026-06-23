/**
 * Federation Local Bridge Tests
 *
 * Tests the bridge between FederationController and local AgentPool.
 * Covers: registerLocalPeers, sendGoalToLocalPeer, completion/failure
 * reporting, status mapping, teardown, and edge cases.
 *
 * @version 1.0.0
 */

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys
          : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k]
            : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
        }
        if (callback) process.nextTick(() => callback(result));
        return Promise.resolve(result);
      }),
      set: jest.fn((obj, callback) => {
        Object.assign(storageData, obj);
        if (callback) process.nextTick(() => callback());
        return Promise.resolve();
      }),
      remove: jest.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve()),
    onStartup: { addListener: jest.fn() },
    onInstalled: { addListener: jest.fn() },
  },
};

// Dynamic imports AFTER chrome mock is set
const { federation } = await import('../background/federation.js');
const bridge = await import('../background/federation-local-bridge.js');
const pool = await import('../background/agent-pool.js');

beforeEach(async () => {
  // Reset federation to clean state
  await federation.shutdown();
  federation.config.enabled = true;
  await federation.init();

  // Clear bridge slots and pool
  bridge.clearLocalPeerSlots();
  pool.stopAllAgents();
});

afterEach(async () => {
  bridge.teardownLocalBridge();
  await federation.shutdown();
});

// ═══════════════════════════════════════════════════════════
// registerLocalPeers
// ═══════════════════════════════════════════════════════════
describe('registerLocalPeers', () => {
  test('registers max concurrent agents as virtual peers', async () => {
    const count = await bridge.registerLocalPeers();

    expect(count).toBe(pool.getMaxConcurrentAgents());
    expect(federation.peers.size).toBe(count);
  });

  test('registers peers with correct peerId format', async () => {
    await bridge.registerLocalPeers();

    for (let i = 0; i < pool.getMaxConcurrentAgents(); i++) {
      const peerId = `local-agent-${i}`;
      expect(federation.peers.has(peerId)).toBe(true);
    }
  });

  test('registers peers with local type in info field', async () => {
    await bridge.registerLocalPeers();

    const peer = federation.peers.get('local-agent-0');
    expect(peer.info).toBeDefined();
    expect(peer.info.type).toBe('local');
    expect(peer.info.name).toContain('Local Agent');
  });

  test('registers peers with max trust score (100)', async () => {
    await bridge.registerLocalPeers();

    for (let i = 0; i < pool.getMaxConcurrentAgents(); i++) {
      const peer = federation.peers.get(`local-agent-${i}`);
      expect(peer.trust.current).toBe(100);
      expect(peer.trust.baseline).toBe(100);
    }
  });

  test('registers peers with full capabilities', async () => {
    await bridge.registerLocalPeers();

    const peer = federation.peers.get('local-agent-0');
    expect(peer.capabilities).toContain('vision');
    expect(peer.capabilities).toContain('network');
    expect(peer.capabilities).toContain('browser-automation');
    expect(peer.capabilities).toContain('form-filling');
    expect(peer.capabilities).toContain('m365');
  });

  test('registers peers with max_concurrent_goals of 1', async () => {
    await bridge.registerLocalPeers();

    for (let i = 0; i < pool.getMaxConcurrentAgents(); i++) {
      const peer = federation.peers.get(`local-agent-${i}`);
      expect(peer.maxGoals).toBe(1);
    }
  });

  test('is idempotent — calling twice does not duplicate peers', async () => {
    await bridge.registerLocalPeers();
    const firstCount = federation.peers.size;

    await bridge.registerLocalPeers();
    const secondCount = federation.peers.size;

    expect(secondCount).toBe(firstCount);
  });
});

// ═══════════════════════════════════════════════════════════
// sendGoalToLocalPeer
// ═══════════════════════════════════════════════════════════
describe('sendGoalToLocalPeer', () => {
  beforeEach(async () => {
    await bridge.registerLocalPeers();
  });

  test('starts a local agent when goal is sent to local peer', async () => {
    const subGoal = {
      id: 'test-sub-1',
      description: 'Extract data from page',
      requirements: ['vision'],
      status: 'assigned',
    };

    const result = await bridge.sendGoalToLocalPeer('local-agent-0', subGoal);

    expect(result.peerId).toBe('local-agent-0');
    expect(result.tabId).toBeDefined();
    expect(result.instance).toBeDefined();
    expect(result.instance.goal).toBe('Extract data from page');
    expect(result.instance.state).toBe('running');
  });

  test('sets sub-goal status to running', async () => {
    const subGoal = {
      id: 'test-sub-2',
      description: 'Navigate to portal',
      requirements: ['navigation'],
      status: 'assigned',
    };

    await bridge.sendGoalToLocalPeer('local-agent-1', subGoal);

    expect(subGoal.status).toBe('running');
  });

  test('accepts string sub-goal', async () => {
    const result = await bridge.sendGoalToLocalPeer('local-agent-2', 'Simple goal string');

    expect(result.instance.goal).toBe('Simple goal string');
  });

  test('throws on invalid peer ID format', async () => {
    await expect(bridge.sendGoalToLocalPeer('remote-peer-1', { description: 'test' }))
      .rejects.toThrow('Invalid local peer ID');
  });

  test('throws on non-local-agent peer ID', async () => {
    await expect(bridge.sendGoalToLocalPeer('not-a-local-peer', { description: 'test' }))
      .rejects.toThrow('Invalid local peer ID');
  });

  test('creates agent in the pool', async () => {
    const subGoal = { id: 'test-sub-3', description: 'Fill form', requirements: ['form-filling'] };
    const result = await bridge.sendGoalToLocalPeer('local-agent-0', subGoal);

    const agentInPool = pool.getAgentByTab(result.tabId);
    expect(agentInPool).toBeDefined();
    expect(agentInPool.state).toBe('running');
  });

  test('reuses existing tab for same slot', async () => {
    const r1 = await bridge.sendGoalToLocalPeer('local-agent-0', 'First goal');
    const r2 = await bridge.sendGoalToLocalPeer('local-agent-0', 'Second goal');

    expect(r1.tabId).toBe(r2.tabId);
  });

  test('uses different tabs for different slots', async () => {
    const r1 = await bridge.sendGoalToLocalPeer('local-agent-0', 'Goal A');
    const r2 = await bridge.sendGoalToLocalPeer('local-agent-1', 'Goal B');

    expect(r1.tabId).not.toBe(r2.tabId);
  });
});

// ═══════════════════════════════════════════════════════════
// reportSubGoalCompletion
// ═══════════════════════════════════════════════════════════
describe('reportSubGoalCompletion', () => {
  let jobId;
  let subGoalId;

  beforeEach(async () => {
    await bridge.registerLocalPeers();

    // Create a job manually in federation
    jobId = 'test-job-complete';
    subGoalId = 'test-job-complete_sub_0';

    federation.activeJobs.set(jobId, {
      id: jobId,
      goal: 'Test goal',
      context: {},
      subGoals: [{
        id: subGoalId,
        description: 'Test sub-goal',
        status: 'running',
        assignedTo: 'local-agent-0',
        result: null,
        attempts: 0,
      }],
      results: [],
      status: 'running',
      assignedPeers: ['local-agent-0'],
      startTime: Date.now(),
    });

    // Increment load to simulate assignment
    const peer = federation.peers.get('local-agent-0');
    peer.load.activeGoals = 1;
  });

  test('marks sub-goal as complete', () => {
    const result = bridge.reportSubGoalCompletion(subGoalId, jobId, {
      summary: 'Task done',
      findings: ['data1'],
    });

    expect(result).toBe(true);
    const job = federation.activeJobs.get(jobId);
    expect(job.subGoals[0].status).toBe('complete');
  });

  test('stores result in sub-goal', () => {
    const testResult = {
      summary: 'Found 5 users',
      findings: [{ user: 'admin' }],
      evidence: { url: 'https://example.com' },
    };

    bridge.reportSubGoalCompletion(subGoalId, jobId, testResult);

    const job = federation.activeJobs.get(jobId);
    expect(job.subGoals[0].result).toEqual(testResult);
  });

  test('decrements peer load after completion', () => {
    bridge.reportSubGoalCompletion(subGoalId, jobId);

    const peer = federation.peers.get('local-agent-0');
    expect(peer.load.activeGoals).toBe(0);
  });

  test('updates lastSeen timestamp on completion', () => {
    const peer = federation.peers.get('local-agent-0');
    const oldTime = peer.load.lastSeen;

    // Wait a bit to ensure timestamp differs
    const futureTime = oldTime + 1000;
    jest.spyOn(Date, 'now').mockReturnValue(futureTime);

    bridge.reportSubGoalCompletion(subGoalId, jobId);

    expect(peer.load.lastSeen).toBe(futureTime);
    jest.restoreAllMocks();
  });

  test('provides default result when none given', () => {
    bridge.reportSubGoalCompletion(subGoalId, jobId);

    const job = federation.activeJobs.get(jobId);
    expect(job.subGoals[0].result).toBeDefined();
    expect(job.subGoals[0].result.summary).toContain('Completed');
  });

  test('returns false for unknown job', () => {
    const result = bridge.reportSubGoalCompletion(subGoalId, 'nonexistent-job');
    expect(result).toBe(false);
  });

  test('returns false for unknown sub-goal', () => {
    const result = bridge.reportSubGoalCompletion('unknown-sub', jobId);
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// reportSubGoalFailure
// ═══════════════════════════════════════════════════════════
describe('reportSubGoalFailure', () => {
  let jobId;
  let subGoalId;

  beforeEach(async () => {
    await bridge.registerLocalPeers();

    jobId = 'test-job-fail';
    subGoalId = 'test-job-fail_sub_0';

    federation.activeJobs.set(jobId, {
      id: jobId,
      goal: 'Test goal',
      context: {},
      subGoals: [{
        id: subGoalId,
        description: 'Failing sub-goal',
        status: 'running',
        assignedTo: 'local-agent-1',
        result: null,
        attempts: 0,
      }],
      results: [],
      status: 'running',
      assignedPeers: ['local-agent-1'],
      startTime: Date.now(),
    });

    const peer = federation.peers.get('local-agent-1');
    peer.load.activeGoals = 1;
  });

  test('marks sub-goal as failed', () => {
    const result = bridge.reportSubGoalFailure(subGoalId, jobId, 'Agent crashed');

    expect(result).toBe(true);
    const job = federation.activeJobs.get(jobId);
    expect(job.subGoals[0].status).toBe('failed');
    expect(job.subGoals[0].error).toBe('Agent crashed');
  });

  test('provides default error when none given', () => {
    bridge.reportSubGoalFailure(subGoalId, jobId);

    const job = federation.activeJobs.get(jobId);
    expect(job.subGoals[0].error).toBe('Local agent failed');
  });

  test('decrements peer load after failure', () => {
    bridge.reportSubGoalFailure(subGoalId, jobId, 'Error');

    const peer = federation.peers.get('local-agent-1');
    expect(peer.load.activeGoals).toBe(0);
  });

  test('returns false for unknown job', () => {
    expect(bridge.reportSubGoalFailure(subGoalId, 'nonexistent')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// getLocalPeerStatus
// ═══════════════════════════════════════════════════════════
describe('getLocalPeerStatus', () => {
  test('returns empty array when no slots are active', () => {
    const status = bridge.getLocalPeerStatus();
    expect(status).toEqual([]);
  });

  test('returns status for active agents', async () => {
    await bridge.registerLocalPeers();
    await bridge.sendGoalToLocalPeer('local-agent-0', 'Task A');
    await bridge.sendGoalToLocalPeer('local-agent-1', 'Task B');

    const statuses = bridge.getLocalPeerStatus();

    expect(statuses.length).toBe(2);
    expect(statuses[0].peerId).toBe('local-agent-0');
    expect(statuses[0].goal).toBe('Task A');
    expect(statuses[0].state).toBe('running');
    expect(statuses[1].peerId).toBe('local-agent-1');
    expect(statuses[1].goal).toBe('Task B');
  });

  test('includes runtime and stepCount fields', async () => {
    await bridge.registerLocalPeers();
    await bridge.sendGoalToLocalPeer('local-agent-0', 'Runtime test');

    const statuses = bridge.getLocalPeerStatus();

    expect(statuses[0].runtime).toBeDefined();
    expect(typeof statuses[0].runtime).toBe('number');
    expect(statuses[0].stepCount).toBeDefined();
    expect(typeof statuses[0].stepCount).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════
// clearLocalPeerSlots / teardownLocalBridge
// ═══════════════════════════════════════════════════════════
describe('clearLocalPeerSlots', () => {
  test('clears all slot mappings', async () => {
    await bridge.registerLocalPeers();
    await bridge.sendGoalToLocalPeer('local-agent-0', 'Test');

    expect(bridge.getLocalPeerStatus().length).toBeGreaterThan(0);

    bridge.clearLocalPeerSlots();

    expect(bridge.getLocalPeerStatus().length).toBe(0);
  });
});

describe('teardownLocalBridge', () => {
  test('stops all agents and clears slots', async () => {
    await bridge.registerLocalPeers();
    await bridge.sendGoalToLocalPeer('local-agent-0', 'Task 1');
    await bridge.sendGoalToLocalPeer('local-agent-1', 'Task 2');

    expect(pool.getActiveAgentCount()).toBeGreaterThan(0);

    bridge.teardownLocalBridge();

    expect(pool.getActiveAgentCount()).toBe(0);
    expect(bridge.getLocalPeerStatus().length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Integration: Federation → Bridge → Pool
// ═══════════════════════════════════════════════════════════
describe('Integration: Federation routes to local bridge', () => {
  beforeEach(async () => {
    await bridge.registerLocalPeers();
  });

  test('federation.sendGoalToPeer routes local peers to bridge', async () => {
    const subGoal = {
      id: 'integration-sub-1',
      description: 'Integration test goal',
      requirements: ['vision'],
      status: 'assigned',
    };

    const result = await federation.sendGoalToPeer('local-agent-0', subGoal);

    expect(result.peerId).toBe('local-agent-0');
    expect(result.instance).toBeDefined();
    expect(result.instance.state).toBe('running');
  });

  test('federation.sendGoalToPeer throws for unknown peer', async () => {
    await expect(federation.sendGoalToPeer('nonexistent-peer', { description: 'test' }))
      .rejects.toThrow('Unknown peer');
  });

  test('local peers pass federation trust check (trust=100 > minTrust=70)', () => {
    const peer = federation.peers.get('local-agent-0');
    expect(peer.trust.current).toBeGreaterThanOrEqual(federation.config.minTrustScore);
  });

  test('local peers are assigned by federation.assignSubGoal', async () => {
    const jobId = 'integration-assign-test';
    federation.activeJobs.set(jobId, {
      id: jobId,
      goal: 'Multi-step goal',
      context: {},
      subGoals: [{
        id: 'integration-assign-test_sub_0',
        description: 'Step 1',
        requirements: ['vision'],
        status: 'pending',
        assignedTo: null,
        result: null,
        attempts: 0,
      }],
      results: [],
      status: 'distributing',
      assignedPeers: [],
      startTime: Date.now(),
    });

    const job = federation.activeJobs.get(jobId);
    const subGoal = job.subGoals[0];

    await federation.assignSubGoal(jobId, subGoal);

    expect(subGoal.assignedTo).toMatch(/local-agent-/);
    // Bridge starts agent immediately, transitioning status to 'running'
    expect(['assigned', 'running']).toContain(subGoal.status);
  });
});
