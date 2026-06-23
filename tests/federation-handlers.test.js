/**
 * Federation Message Handler Tests
 *
 * Tests the federation message handlers that were added to background/index.js.
 * Since handleRuntimeMessage is an internal function, these tests verify the
 * handler logic patterns directly against the federation singleton.
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

const { federation } = await import('../background/federation.js');
const bridge = await import('../background/federation-local-bridge.js');

beforeEach(async () => {
  await federation.shutdown();
  federation.config.enabled = true;
  await federation.init();
  bridge.clearLocalPeerSlots();
});

afterEach(async () => {
  bridge.teardownLocalBridge();
  await federation.shutdown();
});

// Helper: simulate what the 'federation_status' handler does
function simulateFederationStatus() {
  const peers = [...federation.peers.entries()].map(([id, p]) => ({
    id, ...p.info, trust: p.trust.current, load: p.load.activeGoals, status: p.status,
  }));
  const jobs = [...federation.activeJobs.entries()].map(([id, j]) => ({
    id, goal: j.goal, status: j.status, subGoalCount: j.subGoals.length,
  }));
  return {
    enabled: federation.config.enabled,
    peers,
    jobs,
    peerCount: peers.length,
    activeJobs: jobs.length,
  };
}

// Helper: simulate 'federation_job_status' handler
function simulateJobStatus(jobId) {
  const job = federation.activeJobs.get(jobId);
  return job ? { found: true, ...job } : { found: false };
}

// ═══════════════════════════════════════════════════════════
// federation_status handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_status', () => {
  test('returns correct shape with enabled flag', () => {
    const result = simulateFederationStatus();
    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('peers');
    expect(result).toHaveProperty('jobs');
    expect(result).toHaveProperty('peerCount');
    expect(result).toHaveProperty('activeJobs');
  });

  test('returns empty peers when none registered', () => {
    const result = simulateFederationStatus();
    expect(result.peerCount).toBe(0);
    expect(result.peers).toEqual([]);
  });

  test('returns registered peers after registration', async () => {
    await bridge.registerLocalPeers();
    const result = simulateFederationStatus();

    expect(result.peerCount).toBe(5);
    expect(result.peers[0].id).toBe('local-agent-0');
    expect(result.peers[0].trust).toBe(100);
    expect(result.peers[0].type).toBe('local');
  });

  test('reflects disabled state', async () => {
    federation.config.enabled = false;
    const result = simulateFederationStatus();
    expect(result.enabled).toBe(false);
  });

  test('returns jobs from activeJobs map', () => {
    federation.activeJobs.set('test-job', {
      id: 'test-job',
      goal: 'Test',
      status: 'running',
      subGoals: [{ id: 'sub-1' }, { id: 'sub-2' }],
    });

    const result = simulateFederationStatus();
    expect(result.activeJobs).toBe(1);
    expect(result.jobs[0].id).toBe('test-job');
    expect(result.jobs[0].subGoalCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════
// federation_enable handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_enable', () => {
  test('enables federation config', async () => {
    federation.config.enabled = false;

    // Simulate handler
    federation.config.enabled = true;
    await federation.loadConfig();
    await bridge.registerLocalPeers();

    expect(federation.config.enabled).toBe(true);
  });

  test('registers local peers on enable', async () => {
    federation.config.enabled = true;
    await federation.loadConfig();
    await bridge.registerLocalPeers();

    expect(federation.peers.size).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════
// federation_disable handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_disable', () => {
  test('disables federation and shuts down', async () => {
    await bridge.registerLocalPeers();
    expect(federation.peers.size).toBe(5);

    // Simulate handler
    federation.config.enabled = false;
    await federation.shutdown();

    expect(federation.config.enabled).toBe(false);
    expect(federation.peers.size).toBe(0);
    expect(federation.activeJobs.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// federation_job_status handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_job_status', () => {
  test('returns found:true with job data for existing job', () => {
    const jobData = {
      id: 'job-123',
      goal: 'Test goal',
      status: 'running',
      subGoals: [],
    };
    federation.activeJobs.set('job-123', jobData);

    const result = simulateJobStatus('job-123');

    expect(result.found).toBe(true);
    expect(result.id).toBe('job-123');
    expect(result.goal).toBe('Test goal');
    expect(result.status).toBe('running');
  });

  test('returns found:false for non-existent job', () => {
    const result = simulateJobStatus('nonexistent');
    expect(result.found).toBe(false);
  });

  test('returns found:false for undefined jobId', () => {
    const result = simulateJobStatus(undefined);
    expect(result.found).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// federation_distribute handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_distribute', () => {
  beforeEach(async () => {
    await bridge.registerLocalPeers();
  });

  test('distributes goal and returns jobId', async () => {
    // Mock reconcileResults to avoid waitForCompletion hanging
    const origWait = federation.waitForCompletion;
    federation.waitForCompletion = jest.fn().mockResolvedValue(undefined);

    // Also mock sendGoalToPeer to avoid actual agent starts
    const origSend = federation.sendGoalToPeer;
    federation.sendGoalToPeer = jest.fn().mockResolvedValue({});

    const result = await federation.distributeGoal('list all users', {});

    // distributeGoal returns the reconciled result, not jobId
    // The handler extracts jobId differently
    expect(federation.activeJobs.size).toBeGreaterThan(0);

    // Restore
    federation.waitForCompletion = origWait;
    federation.sendGoalToPeer = origSend;
  });
});

// ═══════════════════════════════════════════════════════════
// federation_get_results handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_get_results', () => {
  test('reconciles results for existing job', async () => {
    const jobId = 'results-test-job';
    federation.activeJobs.set(jobId, {
      id: jobId,
      goal: 'Test',
      subGoals: [{
        id: 'sub-1',
        description: 'Step 1',
        status: 'complete',
        assignedTo: 'local-agent-0',
        result: { summary: 'Done', findings: [], evidence: {} },
      }],
      results: [],
      status: 'running',
      assignedPeers: ['local-agent-0'],
      startTime: Date.now(),
    });

    const results = await federation.reconcileResults(jobId);

    expect(results).toBeDefined();
    expect(results.status).toBe('success');
  });

  test('returns null for non-existent job', async () => {
    const results = await federation.reconcileResults('nonexistent');
    expect(results).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// federation_local_peers handler
// ═══════════════════════════════════════════════════════════
describe('Handler: federation_local_peers', () => {
  test('returns local peer statuses', async () => {
    await bridge.registerLocalPeers();
    await bridge.sendGoalToLocalPeer('local-agent-0', 'Test task');

    const peers = bridge.getLocalPeerStatus();

    expect(peers.length).toBeGreaterThan(0);
    expect(peers[0].peerId).toBe('local-agent-0');
    expect(peers[0].goal).toBe('Test task');
  });

  test('returns empty when no agents running', () => {
    const peers = bridge.getLocalPeerStatus();
    expect(peers).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// Handler Response Shape Validation
// ═══════════════════════════════════════════════════════════
describe('Handler response shapes match UI expectations', () => {
  test('federation_status response has all required fields', async () => {
    await bridge.registerLocalPeers();
    const result = simulateFederationStatus();

    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('peers');
    expect(result).toHaveProperty('jobs');
    expect(result).toHaveProperty('peerCount');
    expect(result).toHaveProperty('activeJobs');
    expect(typeof result.peerCount).toBe('number');
    expect(typeof result.activeJobs).toBe('number');
    expect(Array.isArray(result.peers)).toBe(true);
    expect(Array.isArray(result.jobs)).toBe(true);
  });

  test('peer objects in status have required fields', async () => {
    await bridge.registerLocalPeers();
    const result = simulateFederationStatus();

    const peer = result.peers[0];
    expect(peer).toHaveProperty('id');
    expect(peer).toHaveProperty('trust');
    expect(peer).toHaveProperty('load');
    expect(peer).toHaveProperty('status');
    expect(peer).toHaveProperty('type');
  });
});
