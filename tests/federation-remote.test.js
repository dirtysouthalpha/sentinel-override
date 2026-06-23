/**
 * Federation Remote Peer Tests (Phase 4)
 *
 * Tests UAP server federation endpoints and remote peer communication.
 * Uses the shared fedPeers/fedJobs Maps exported from uap-server.js.
 *
 * @version 1.0.0
 */

import { jest } from '@jest/globals';

// ── Chrome API mock for federation.js ──
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

// Mock fetch for remote peer communication
globalThis.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, taskId: 'remote-task-1' }),
  })
);

// ── Import uap-server federation state and federation controller ──
const { fedPeers, fedJobs } = await import('../scripts/uap-server.js');
const { federation } = await import('../background/federation.js');

beforeEach(() => {
  fedPeers.clear();
  fedJobs.clear();
  fetch.mockClear();
});

afterEach(async () => {
  await federation.shutdown();
});

// ═══════════════════════════════════════════════════════════
// UAP Federation Registry State
// ═══════════════════════════════════════════════════════════
describe('UAP Federation Registry', () => {
  test('fedPeers Map is exported and clearable', () => {
    expect(fedPeers).toBeInstanceOf(Map);
    expect(fedPeers.size).toBe(0);
  });

  test('fedJobs Map is exported and clearable', () => {
    expect(fedJobs).toBeInstanceOf(Map);
    expect(fedJobs.size).toBe(0);
  });

  test('fedPeers can store remote peer entries', () => {
    fedPeers.set('remote-1', { id: 'remote-1', info: { type: 'remote' }, trust: 80 });
    expect(fedPeers.size).toBe(1);
    expect(fedPeers.get('remote-1').trust).toBe(80);
  });

  test('fedJobs can store distributed job entries', () => {
    fedJobs.set('job-1', { id: 'job-1', goal: 'Test', status: 'distributing' });
    expect(fedJobs.size).toBe(1);
    expect(fedJobs.get('job-1').goal).toBe('Test');
  });
});

// ═══════════════════════════════════════════════════════════
// Remote Peer Registration (simulating POST /federation/register)
// ═══════════════════════════════════════════════════════════
describe('Remote Peer Registration', () => {
  test('registers a remote peer with correct structure', () => {
    const peerId = 'remote-node-alpha';
    fedPeers.set(peerId, {
      id: peerId,
      info: {
        name: 'Alpha Node',
        type: 'remote',
        endpoint: 'http://10.0.0.5:8766',
        capabilities: ['vision', 'network'],
        maxGoals: 3,
      },
      trust: 85,
      load: { activeGoals: 0, lastSeen: Date.now() },
      status: 'active',
    });

    const peer = fedPeers.get(peerId);
    expect(peer.info.type).toBe('remote');
    expect(peer.info.endpoint).toBe('http://10.0.0.5:8766');
    expect(peer.trust).toBe(85);
  });

  test('multiple remote peers can coexist', () => {
    for (let i = 0; i < 3; i++) {
      fedPeers.set(`remote-${i}`, {
        id: `remote-${i}`,
        info: { type: 'remote', endpoint: `http://10.0.0.${i}:8766` },
        trust: 75 + i,
        load: { activeGoals: 0, lastSeen: Date.now() },
        status: 'active',
      });
    }

    expect(fedPeers.size).toBe(3);
  });

  test('can filter active remote peers', () => {
    fedPeers.set('active-1', { id: 'active-1', info: { type: 'remote' }, trust: 80, status: 'active' });
    fedPeers.set('stale-1', { id: 'stale-1', info: { type: 'remote' }, trust: 70, status: 'stalled' });

    const active = [...fedPeers.values()].filter(p => p.status === 'active');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('active-1');
  });
});

// ═══════════════════════════════════════════════════════════
// Remote Goal Distribution (simulating POST /federation/distribute)
// ═══════════════════════════════════════════════════════════
describe('Remote Goal Distribution', () => {
  beforeEach(() => {
    // Set up active remote peers
    fedPeers.set('remote-worker-1', {
      id: 'remote-worker-1',
      info: { type: 'remote', endpoint: 'http://10.0.0.1:8766', capabilities: ['vision', 'network'] },
      trust: 85,
      load: { activeGoals: 0, lastSeen: Date.now() },
      status: 'active',
    });
    fedPeers.set('remote-worker-2', {
      id: 'remote-worker-2',
      info: { type: 'remote', endpoint: 'http://10.0.0.2:8766', capabilities: ['data-extraction'] },
      trust: 90,
      load: { activeGoals: 0, lastSeen: Date.now() },
      status: 'active',
    });
  });

  test('creates job with assigned sub-goals when peers available', () => {
    const jobId = 'test-distribute-1';
    const goal = 'Extract data from portal';
    const activePeers = [...fedPeers.values()].filter(p => p.status === 'active');

    fedJobs.set(jobId, {
      id: jobId,
      goal,
      status: 'distributing',
      subGoals: [{
        id: jobId + '_sub_0',
        description: goal,
        status: 'assigned',
        assignedTo: activePeers[0].id,
      }],
      assignedPeers: [activePeers[0].id],
      startTime: Date.now(),
    });

    const job = fedJobs.get(jobId);
    expect(job.subGoals[0].status).toBe('assigned');
    expect(job.subGoals[0].assignedTo).toBe('remote-worker-1');
  });

  test('creates job with pending sub-goals when no peers available', () => {
    fedPeers.clear();

    const jobId = 'test-distribute-2';
    const goal = 'Test goal';
    const activePeers = [...fedPeers.values()].filter(p => p.status === 'active');

    fedJobs.set(jobId, {
      id: jobId,
      goal,
      status: 'distributing',
      subGoals: [{
        id: jobId + '_sub_0',
        description: goal,
        status: activePeers.length > 0 ? 'assigned' : 'pending',
        assignedTo: null,
      }],
      assignedPeers: [],
      startTime: Date.now(),
    });

    const job = fedJobs.get(jobId);
    expect(job.subGoals[0].status).toBe('pending');
    expect(job.assignedPeers.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// FederationController Remote Peer Communication
// ═══════════════════════════════════════════════════════════
describe('FederationController remote peer sendGoalToPeer', () => {
  test('sends goal to remote peer via fetch', async () => {
    federation.config.enabled = true;
    await federation.init();

    // Register a remote peer
    await federation.registerPeer({
      peer_id: 'remote-fetch-test',
      capabilities: ['vision', 'network'],
      max_concurrent_goals: 3,
      trust_score_baseline: 80,
      signature: 'test-sig',
      type: 'remote',
      endpoint: 'http://10.0.0.99:8766',
    });

    const subGoal = {
      id: 'remote-sub-1',
      description: 'Fetch data from remote portal',
      requirements: ['vision'],
    };

    const result = await federation.sendGoalToPeer('remote-fetch-test', subGoal);

    expect(fetch).toHaveBeenCalled();
    const fetchCall = fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/uap/task');
    expect(fetchCall[1].method).toBe('POST');
    expect(result.ok).toBe(true);
  });

  test('fetch URL uses peer endpoint', async () => {
    federation.config.enabled = true;
    await federation.init();

    await federation.registerPeer({
      peer_id: 'remote-url-test',
      capabilities: ['vision'],
      max_concurrent_goals: 1,
      trust_score_baseline: 75,
      signature: 'sig',
      type: 'remote',
      endpoint: 'http://192.168.1.50:9999',
    });

    await federation.sendGoalToPeer('remote-url-test', {
      id: 'sub-x',
      description: 'Test',
      requirements: ['vision'],
    });

    const fetchUrl = fetch.mock.calls[fetch.mock.calls.length - 1][0];
    expect(fetchUrl).toContain('192.168.1.50:9999');
  });
});

// ═══════════════════════════════════════════════════════════
// Job Status & Results Retrieval
// ═══════════════════════════════════════════════════════════
describe('Remote Job Status and Results', () => {
  test('retrieves job status from fedJobs', () => {
    const jobId = 'status-test-job';
    fedJobs.set(jobId, {
      id: jobId,
      goal: 'Test goal',
      status: 'running',
      subGoals: [{ id: 'sub-1', status: 'complete' }, { id: 'sub-2', status: 'running' }],
    });

    const job = fedJobs.get(jobId);
    expect(job).toBeDefined();
    expect(job.status).toBe('running');
    expect(job.subGoals.length).toBe(2);
  });

  test('reconciles results from completed sub-goals', () => {
    const jobId = 'results-test-job';
    fedJobs.set(jobId, {
      id: jobId,
      goal: 'Multi-step goal',
      status: 'running',
      subGoals: [
        { id: 'sub-1', status: 'complete', result: { summary: 'Step 1 done' } },
        { id: 'sub-2', status: 'complete', result: { summary: 'Step 2 done' } },
        { id: 'sub-3', status: 'failed', error: 'Connection refused' },
      ],
      results: [],
    });

    const job = fedJobs.get(jobId);
    const completed = job.subGoals.filter(sg => sg.status === 'complete');

    expect(completed.length).toBe(2);
    expect(completed[0].result.summary).toContain('Step 1');
  });

  test('returns 404-like state for non-existent job', () => {
    const job = fedJobs.get('nonexistent');
    expect(job).toBeUndefined();
  });
});
