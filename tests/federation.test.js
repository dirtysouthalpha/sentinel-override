/**
 * Federation Layer Tests
 *
 * Tests for zero-trust multi-agent coordination
 *
 * @version 10.0.0
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// ── Chrome API mock ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
        }
        if (callback) {
          process.nextTick(() => callback(result));
        }
        return Promise.resolve(result);
      }),
      set: jest.fn((obj, callback) => {
        Object.assign(storageData, obj);
        if (callback) {
          process.nextTick(() => callback());
        }
        return Promise.resolve();
      }),
      remove: jest.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve()),
  },
};

import { federation } from '../background/federation.js';

describe('Federation Controller', () => {
  beforeEach(async () => {
    await federation.init();
  });

  afterEach(async () => {
    await federation.shutdown();
  });

  describe('Initialization', () => {
    test('should initialize with default config', async () => {
      expect(federation.config).toBeDefined();
      expect(federation.config.enabled).toBe(false);
    });

    test('should generate Ed25519 keypair', async () => {
      await federation.generateKeyPair();
      
      expect(federation.keyPair).toBeDefined();
      expect(federation.keyPair.publicKey).toContain('fed_');
      expect(federation.keyPair.secretKey).toContain('fed_sec_');
    });
  });

  describe('Peer Registration', () => {
    test('should register valid peer', async () => {
      const peerInfo = {
        peer_id: 'peer-test-1',
        capabilities: ['vision', 'network', 'knowledge_graph'],
        max_concurrent_goals: 5,
        trust_score_baseline: 85,
        signature: 'valid_signature_123'
      };

      const result = await federation.registerPeer(peerInfo);

      expect(result.status).toBe('registered');
      expect(result.federation_id).toBeDefined();
      expect(federation.peers.has('peer-test-1')).toBe(true);
    });

    test('should reject peer with invalid signature', async () => {
      const peerInfo = {
        peer_id: 'peer-invalid',
        capabilities: ['vision'],
        signature: null
      };

      await expect(federation.registerPeer(peerInfo)).rejects.toThrow('Invalid peer signature');
    });

    test('should enforce max peers limit', async () => {
      // Set low limit
      federation.config.maxPeers = 2;

      // Register 2 peers
      await federation.registerPeer({
        peer_id: 'peer-1',
        capabilities: ['vision'],
        signature: 'sig1'
      });

      await federation.registerPeer({
        peer_id: 'peer-2',
        capabilities: ['vision'],
        signature: 'sig2'
      });

      // Third should fail
      await expect(federation.registerPeer({
        peer_id: 'peer-3',
        capabilities: ['vision'],
        signature: 'sig3'
      })).rejects.toThrow('Max peers reached');
    });

    test('should unregister peer', () => {
      federation.peers.set('peer-remove', {
        id: 'peer-remove',
        status: 'active',
        load: { activeGoals: 1 }
      });

      const result = federation.unregisterPeer('peer-remove');
      
      expect(result).toBe(true);
      expect(federation.peers.has('peer-remove')).toBe(false);
    });
  });

  describe('Goal Distribution', () => {
    test('should decompose goal into sub-goals', async () => {
      const subGoals = await federation.decomposeGoal(
        'Check Entra and Exchange for suspicious activity',
        {}
      );

      expect(subGoals.length).toBeGreaterThan(0);
      expect(subGoals[0]).toHaveProperty('description');
      expect(subGoals[0]).toHaveProperty('requirements');
    });

    test('should detect multi-portal patterns', async () => {
      const subGoals = await federation.decomposeGoal(
        'Investigate both Entra sign-ins and Exchange mail logs',
        {}
      );

      // Should create separate sub-goals for each portal
      const hasEntra = subGoals.some(sg => 
        sg.description.toLowerCase().includes('entra')
      );
      const hasExchange = subGoals.some(sg => 
        sg.description.toLowerCase().includes('exchange')
      );

      expect(hasEntra).toBe(true);
      expect(hasExchange).toBe(true);
    });

    test('should assign sub-goals to capable peers', async () => {
      // Register capable peer
      await federation.registerPeer({
        peer_id: 'peer-vision',
        capabilities: ['vision', 'network'],
        max_concurrent_goals: 3,
        trust_score_baseline: 85,
        signature: 'sig_vision'
      });

      // Mock distributeGoal to skip waitForCompletion
      const jobId = uuidv4();
      const subGoals = await federation.decomposeGoal(
        'Navigate to example.com and verify page loads',
        {}
      );

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Navigate to example.com and verify page loads',
        context: {},
        subGoals: subGoals.map((sg, i) => ({
          id: `${jobId}_sub_${i}`,
          description: sg.description,
          requirements: sg.requirements,
          status: 'pending',
          assignedTo: null,
          result: null,
          attempts: 0
        })),
        results: [],
        status: 'distributing',
        assignedPeers: [],
        startTime: Date.now()
      });

      // Assign sub-goals
      for (const subGoal of federation.activeJobs.get(jobId).subGoals) {
        await federation.assignSubGoal(jobId, subGoal);
      }

      const job = federation.activeJobs.get(jobId);

      expect(job).toBeDefined();
      expect(job.subGoals[0].status).toBe('assigned');
      expect(job.subGoals[0].assignedTo).toBe('peer-vision');
    });

    test('should fail when no capable peers available', async () => {
      // Register peer without vision capability
      await federation.registerPeer({
        peer_id: 'peer-network-only',
        capabilities: ['network'],
        max_concurrent_goals: 3,
        trust_score_baseline: 85,
        signature: 'sig_network'
      });

      // Create job and assign sub-goal
      const jobId = uuidv4();
      const subGoals = await federation.decomposeGoal('Navigate to example.com', {});

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Navigate to example.com',
        context: {},
        subGoals: subGoals.map((sg, i) => ({
          id: `${jobId}_sub_${i}`,
          description: sg.description,
          requirements: sg.requirements,
          status: 'pending',
          assignedTo: null,
          result: null,
          attempts: 0
        })),
        results: [],
        status: 'distributing',
        assignedPeers: [],
        startTime: Date.now()
      });

      await federation.assignSubGoal(jobId, federation.activeJobs.get(jobId).subGoals[0]);

      const job = federation.activeJobs.get(jobId);

      expect(job.subGoals[0].status).toBe('failed');
      expect(job.subGoals[0].error).toBe('No capable peers available');
    });
  });

  describe('Result Reconciliation', () => {
    test('should aggregate findings from multiple peers', async () => {
      const jobId = 'test-job-1';
      
      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Test goal',
        subGoals: [
          { id: 'sub-1', status: 'complete', result: { findings: ['A', 'B'] } },
          { id: 'sub-2', status: 'complete', result: { findings: ['C', 'D'] } }
        ],
        assignedPeers: ['peer-1', 'peer-2']
      });

      const result = await federation.reconcileResults(jobId);

      expect(result.status).toBe('success');
      expect(result.findings.length).toBeGreaterThanOrEqual(4);
    });

    test('should calculate trust score from peer scores', async () => {
      const jobId = 'test-job-2';

      federation.peers.set('peer-high-trust', {
        id: 'peer-high-trust',
        status: 'active',
        capabilities: ['vision'],
        load: { activeGoals: 0, lastSeen: Date.now() },
        maxGoals: 3,
        trust: { current: 95, baseline: 85, history: [] }
      });

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Test goal',
        context: {},
        subGoals: [
          {
            id: 'sub-1',
            description: 'Test sub-goal',
            requirements: ['vision'],
            status: 'complete',
            assignedTo: 'peer-high-trust',
            result: { findings: ['Test'] },
            attempts: 0
          }
        ],
        assignedPeers: ['peer-high-trust'],
        results: [],
        startTime: Date.now() - 10000
      });

      const result = await federation.reconcileResults(jobId);

      expect(result.trustScore).toBeGreaterThan(0);
      expect(result.trustScore).toBeLessThanOrEqual(100);
    });

    test('should update peer trust scores after completion', async () => {
      const jobId = 'test-job-3';
      const peerId = 'peer-trust-update';

      federation.peers.set(peerId, {
        id: peerId,
        trust: { current: 80, history: [] },
        load: { activeGoals: 0 }
      });

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Test goal',
        subGoals: [{
          id: 'sub-1',
          status: 'complete',
          assignedTo: peerId,
          assignedAt: Date.now() - 5000,
          result: {
            findings: ['Important finding'],
            evidence: { data: 'value' },
            peerId: peerId,
            subGoalId: 'sub-1'
          }
        }],
        startTime: Date.now() - 10000
      });

      await federation.reconcileResults(jobId);

      const peer = federation.peers.get(peerId);
      expect(peer.trust.current).not.toBe(80); // Should have changed
    });
  });

  describe('Peer Selection', () => {
    test('should select peer with highest trust', async () => {
      // Register peers with different trust scores
      await federation.registerPeer({
        peer_id: 'peer-trust-90',
        capabilities: ['vision'],
        max_concurrent_goals: 3,
        trust_score_baseline: 90,
        signature: 'sig90'
      });

      await federation.registerPeer({
        peer_id: 'peer-trust-75',
        capabilities: ['vision'],
        max_concurrent_goals: 3,
        trust_score_baseline: 75,
        signature: 'sig75'
      });

      // Create job and assign sub-goal
      const jobId = uuidv4();
      const subGoals = await federation.decomposeGoal('Navigate to example.com', {});

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Navigate to example.com',
        context: {},
        subGoals: subGoals.map((sg, i) => ({
          id: `${jobId}_sub_${i}`,
          description: sg.description,
          requirements: sg.requirements,
          status: 'pending',
          assignedTo: null,
          result: null,
          attempts: 0
        })),
        results: [],
        status: 'distributing',
        assignedPeers: [],
        startTime: Date.now()
      });

      await federation.assignSubGoal(jobId, federation.activeJobs.get(jobId).subGoals[0]);

      const job = federation.activeJobs.get(jobId);

      // High-trust peer should be selected
      const selectedPeerId = job.assignedPeers[0];
      expect(selectedPeerId).toContain('90');
    });

    test('should select peer with lowest load when trust equal', async () => {
      // Register peers with same trust, different load
      await federation.registerPeer({
        peer_id: 'peer-busy',
        capabilities: ['vision'],
        max_concurrent_goals: 5,
        trust_score_baseline: 85,
        signature: 'sig_busy'
      });

      await federation.registerPeer({
        peer_id: 'peer-free',
        capabilities: ['vision'],
        max_concurrent_goals: 5,
        trust_score_baseline: 85,
        signature: 'sig_free'
      });

      // Make one peer busy
      const busyPeer = federation.peers.get('peer-busy');
      busyPeer.load.activeGoals = 4;

      // Create job and assign sub-goal
      const jobId = uuidv4();
      const subGoals = await federation.decomposeGoal('Navigate to example.com', {});

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Navigate to example.com',
        context: {},
        subGoals: subGoals.map((sg, i) => ({
          id: `${jobId}_sub_${i}`,
          description: sg.description,
          requirements: sg.requirements,
          status: 'pending',
          assignedTo: null,
          result: null,
          attempts: 0
        })),
        results: [],
        status: 'distributing',
        assignedPeers: [],
        startTime: Date.now()
      });

      await federation.assignSubGoal(jobId, federation.activeJobs.get(jobId).subGoals[0]);

      const job = federation.activeJobs.get(jobId);

      // Free peer should be selected
      expect(job.assignedPeers).toContain('peer-free');
    });
  });

  describe('Rebalancing', () => {
    test('should detect stalled peers', async () => {
      await federation.registerPeer({
        peer_id: 'peer-stalled',
        capabilities: ['vision'],
        max_concurrent_goals: 3,
        trust_score_baseline: 85,
        signature: 'sig_stalled'
      });

      // Mark peer as stalled
      const stalledPeer = federation.peers.get('peer-stalled');
      stalledPeer.load.lastSeen = Date.now() - 400000; // > 5 minutes ago

      await federation.rebalance();

      expect(stalledPeer.status).toBe('stalled');
    });

    test('should reassign work from stalled peers', async () => {
      // Register a capable peer to handle reassignment
      await federation.registerPeer({
        peer_id: 'peer-capable',
        capabilities: ['vision'],
        max_concurrent_goals: 3,
        trust_score_baseline: 85,
        signature: 'sig_capable'
      });

      const jobId = 'rebalance-test';

      federation.peers.set('peer-stalled', {
        id: 'peer-stalled',
        status: 'stalled',
        capabilities: ['vision'],
        load: { activeGoals: 2, lastSeen: Date.now() - 400000 },
        trust: { baseline: 75, current: 75, history: [] },
        maxGoals: 3
      });

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Test goal',
        context: {},
        status: 'running',
        subGoals: [{
          id: 'sub-stalled',
          description: 'Test sub-goal',
          requirements: ['vision'],
          status: 'assigned',
          assignedTo: 'peer-stalled',
          attempts: 0
        }],
        assignedPeers: ['peer-stalled'],
        results: [],
        startTime: Date.now()
      });

      await federation.rebalance();

      const job = federation.activeJobs.get(jobId);
      // Should be reassigned to peer-capable
      expect(job.subGoals[0].assignedTo).toBe('peer-capable');
      expect(job.subGoals[0].status).toBe('assigned');
    });
  });

  describe('Audit Logging', () => {
    test('should log peer registration', async () => {
      await federation.registerPeer({
        peer_id: 'peer-audit-1',
        capabilities: ['vision'],
        signature: 'sig_audit'
      });

      const lastEntry = federation.auditLog[federation.auditLog.length - 1];
      
      expect(lastEntry.event_type).toBe('peer_registered');
      expect(lastEntry.peer_id).toBe('peer-audit-1');
    });

    test('should persist audit log to storage', async () => {
      chrome.storage.local.set.mockImplementation((data, callback) => {
        Object.assign(storageData, data);
        if (typeof callback === 'function') {
          callback();
        }
        return Promise.resolve();
      });

      federation.logAudit('test_event', { test: 'value' });

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('Get Peer Status', () => {
    test('should return peer status', async () => {
      await federation.registerPeer({
        peer_id: 'peer-status-1',
        capabilities: ['vision'],
        max_concurrent_goals: 5,
        trust_score_baseline: 88,
        signature: 'sig_status'
      });

      const status = federation.getPeerStatus('peer-status-1');

      expect(status).toMatchObject({
        id: 'peer-status-1',
        status: 'active',
        trust: 88,
        capabilities: ['vision']
      });
    });

    test('should return null for unknown peer', () => {
      const status = federation.getPeerStatus('unknown-peer');
      expect(status).toBeNull();
    });

    test('should return all peers', async () => {
      await federation.registerPeer({
        peer_id: 'peer-all-1',
        capabilities: ['vision'],
        signature: 'sig_all_1'
      });

      await federation.registerPeer({
        peer_id: 'peer-all-2',
        capabilities: ['network'],
        signature: 'sig_all_2'
      });

      const allPeers = federation.getAllPeers();

      expect(allPeers.length).toBeGreaterThanOrEqual(2);
      expect(allPeers.every(p => p.id && p.trust !== undefined)).toBe(true);
    });
  });

  describe('buildSummary', () => {
    test('returns fallback when no results have summaries', () => {
      const result = federation.buildSummary('test goal', []);
      expect(result).toBe('Completed goal: test goal');
    });

    test('returns single summary when exactly one result has a summary', () => {
      const result = federation.buildSummary('test goal', [{ summary: 'Done the thing' }]);
      expect(result).toBe('Done the thing');
    });

    test('combines multiple summaries with multi-peer prefix', () => {
      const result = federation.buildSummary('test goal', [
        { summary: 'Summary A' },
        { summary: 'Summary B' }
      ]);
      expect(result).toContain('Multi-peer execution complete');
      expect(result).toContain('Summary A');
      expect(result).toContain('Summary B');
    });

    test('skips results without a summary field', () => {
      const result = federation.buildSummary('test goal', [
        { findings: ['x'] },
        { summary: 'Only one' }
      ]);
      expect(result).toBe('Only one');
    });
  });

  describe('aggregateEvidence', () => {
    test('accumulates array evidence by spreading each item', () => {
      const results = [{ peerId: 'p1', evidence: { items: ['a', 'b', 'c'] } }];
      const ev = federation.aggregateEvidence(results);
      expect(ev.items).toEqual(['a', 'b', 'c']);
    });

    test('wraps non-array evidence values in an array', () => {
      const results = [{ peerId: 'p1', evidence: { data: 'scalar' } }];
      const ev = federation.aggregateEvidence(results);
      expect(ev.data).toEqual(['scalar']);
    });

    test('merges evidence from multiple results under the same key', () => {
      const results = [
        { peerId: 'p1', evidence: { logs: ['entry1'] } },
        { peerId: 'p2', evidence: { logs: ['entry2'] } }
      ];
      const ev = federation.aggregateEvidence(results);
      expect(ev.logs).toContain('entry1');
      expect(ev.logs).toContain('entry2');
    });

    test('ignores results with no evidence', () => {
      const results = [{ peerId: 'p1', findings: ['x'] }];
      const ev = federation.aggregateEvidence(results);
      expect(Object.keys(ev).length).toBe(0);
    });
  });

  describe('aggregateFindings — deduplication', () => {
    test('deduplicates identical findings across peers', () => {
      const finding = { type: 'alert', severity: 'high' };
      const results = [
        { peerId: 'p1', findings: [finding] },
        { peerId: 'p2', findings: [finding] }
      ];
      const aggregated = federation.aggregateFindings(results);
      expect(aggregated.length).toBe(1);
    });

    test('includes unique findings from each peer', () => {
      const results = [
        { peerId: 'p1', findings: [{ type: 'a' }] },
        { peerId: 'p2', findings: [{ type: 'b' }] }
      ];
      const aggregated = federation.aggregateFindings(results);
      expect(aggregated.length).toBe(2);
    });
  });

  describe('decomposeGoal — all users branch', () => {
    test('decomposes "list users" goal into extract + analyze sub-goals', async () => {
      const subGoals = await federation.decomposeGoal('list users in the admin portal', {});
      expect(subGoals.length).toBe(2);
      const descriptions = subGoals.map(sg => sg.description.toLowerCase());
      expect(descriptions.some(d => d.includes('extract') || d.includes('user'))).toBe(true);
    });

    test('decomposes "all users" goal into two sub-goals', async () => {
      const subGoals = await federation.decomposeGoal('get all users from entra', {});
      expect(subGoals.length).toBe(2);
    });
  });

  describe('calculateJobTrustScore', () => {
    test('returns 0 when results array is empty', () => {
      const job = { subGoals: [{ id: 's1' }] };
      expect(federation.calculateJobTrustScore(job, [])).toBe(0);
    });

    test('averages peer trust weighted by completion rate', () => {
      federation.peers.set('p-calc', {
        id: 'p-calc',
        trust: { current: 80 }
      });
      const job = { subGoals: [{ id: 's1' }, { id: 's2' }] };
      const results = [{ peerId: 'p-calc', subGoalId: 's1' }];
      const score = federation.calculateJobTrustScore(job, results);
      // 80 trust * 0.5 completion = 40
      expect(score).toBe(40);
    });
  });

  describe('unregisterPeer — unknown peer', () => {
    test('returns false for unknown peer', () => {
      expect(federation.unregisterPeer('peer-does-not-exist-xyz')).toBe(false);
    });
  });

  describe('reassignSubGoal — edge cases', () => {
    test('is no-op for unknown jobId', async () => {
      await expect(federation.reassignSubGoal('no-such-job', 'peer-1')).resolves.toBeUndefined();
    });

    test('marks sub-goal failed after 3 attempts', async () => {
      const jobId = 'reassign-max-test';
      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'test',
        context: {},
        subGoals: [{
          id: 'sub-max',
          description: 'needs reassign',
          requirements: ['vision'],
          status: 'assigned',
          assignedTo: 'peer-gone',
          attempts: 3
        }],
        assignedPeers: ['peer-gone'],
        results: [],
        startTime: Date.now()
      });
      await federation.reassignSubGoal(jobId, 'peer-gone');
      const job = federation.activeJobs.get(jobId);
      expect(job.subGoals[0].status).toBe('failed');
      expect(job.subGoals[0].error).toContain('Max assignment attempts');
    });
  });

  describe('reconcileResults — no successes', () => {
    test('returns failed status when all sub-goals failed', async () => {
      const jobId = 'all-failed-job';
      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'test',
        subGoals: [
          { id: 'sub-1', status: 'failed', error: 'no peers' },
          { id: 'sub-2', status: 'failed', error: 'timeout' }
        ],
        startTime: Date.now()
      });
      const result = await federation.reconcileResults(jobId);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('No sub-goals');
    });

    test('returns null for unknown jobId', async () => {
      const result = await federation.reconcileResults('no-such-job');
      expect(result).toBeNull();
    });
  });

  describe('init — enabled:true path', () => {
    test('runs generateKeyPair and startRebalanceLoop when enabled', async () => {
      const ctrl = federation;
      ctrl.config.enabled = true;
      try {
        await ctrl.init();
        expect(ctrl.keyPair).toBeDefined();
        expect(ctrl.rebalanceTimer).not.toBeNull();
      } finally {
        clearInterval(ctrl.rebalanceTimer);
        ctrl.rebalanceTimer = null;
        ctrl.config.enabled = false;
      }
    });

    test('shutdown clears rebalanceTimer when it is running', async () => {
      const ctrl = federation;
      ctrl.config.enabled = true;
      try {
        await ctrl.init();
        expect(ctrl.rebalanceTimer).not.toBeNull();
        await ctrl.shutdown();
        expect(ctrl.rebalanceTimer).toBeNull();
      } finally {
        ctrl.config.enabled = false;
      }
    });
  });

  describe('loadConfig — edge branches', () => {
    test('merges stored federationConfig when present', async () => {
      const ctrl = federation;
      // Pre-load storage data with a config
      chrome.storage.local.get.mockImplementationOnce((_keys, cb) => {
        process.nextTick(() => cb({ federationConfig: { maxPeers: 99 } }));
      });
      const prevMax = ctrl.config.maxPeers;
      await ctrl.loadConfig();
      expect(ctrl.config.maxPeers).toBe(99);
      ctrl.config.maxPeers = prevMax; // restore
    });

    test('rejects when chrome.runtime.lastError is set', async () => {
      chrome.storage.local.get.mockImplementationOnce((_keys, cb) => {
        chrome.runtime = { ...chrome.runtime, lastError: { message: 'Storage read fail' } };
        process.nextTick(() => {
          cb({});
          chrome.runtime.lastError = null;
        });
      });
      await expect(federation.loadConfig()).rejects.toThrow('Storage read fail');
    });
  });

  describe('assignSubGoal — peer filter branches', () => {
    test('skips inactive peer', async () => {
      federation.peers.set('peer-inactive', {
        id: 'peer-inactive',
        status: 'stalled',
        capabilities: ['vision'],
        load: { activeGoals: 0, lastSeen: Date.now() },
        trust: { current: 85, history: [] },
        maxGoals: 3
      });
      const jobId = 'inactive-filter-job';
      federation.activeJobs.set(jobId, {
        id: jobId, goal: 'test', context: {},
        subGoals: [{ id: 'sg1', description: 'test', requirements: ['vision'], status: 'pending', assignedTo: null, result: null, attempts: 0 }],
        assignedPeers: [], results: [], startTime: Date.now()
      });
      await federation.assignSubGoal(jobId, federation.activeJobs.get(jobId).subGoals[0]);
      expect(federation.activeJobs.get(jobId).subGoals[0].status).toBe('failed');
    });

    test('skips peer at max load', async () => {
      federation.peers.set('peer-full', {
        id: 'peer-full',
        status: 'active',
        capabilities: ['vision'],
        load: { activeGoals: 3, lastSeen: Date.now() },
        trust: { current: 85, history: [] },
        maxGoals: 3
      });
      const jobId = 'full-load-job';
      federation.activeJobs.set(jobId, {
        id: jobId, goal: 'test', context: {},
        subGoals: [{ id: 'sg1', description: 'test', requirements: ['vision'], status: 'pending', assignedTo: null, result: null, attempts: 0 }],
        assignedPeers: [], results: [], startTime: Date.now()
      });
      await federation.assignSubGoal(jobId, federation.activeJobs.get(jobId).subGoals[0]);
      expect(federation.activeJobs.get(jobId).subGoals[0].status).toBe('failed');
    });

    test('skips peer below minTrustScore', async () => {
      federation.peers.set('peer-low-trust', {
        id: 'peer-low-trust',
        status: 'active',
        capabilities: ['vision'],
        load: { activeGoals: 0, lastSeen: Date.now() },
        trust: { current: 10, history: [] },
        maxGoals: 3
      });
      const jobId = 'low-trust-job';
      federation.activeJobs.set(jobId, {
        id: jobId, goal: 'test', context: {},
        subGoals: [{ id: 'sg1', description: 'test', requirements: ['vision'], status: 'pending', assignedTo: null, result: null, attempts: 0 }],
        assignedPeers: [], results: [], startTime: Date.now()
      });
      await federation.assignSubGoal(jobId, federation.activeJobs.get(jobId).subGoals[0]);
      expect(federation.activeJobs.get(jobId).subGoals[0].status).toBe('failed');
    });

    test('does not double-push peer into assignedPeers when already present', async () => {
      federation.peers.set('peer-already-in', {
        id: 'peer-already-in',
        status: 'active',
        capabilities: ['vision'],
        load: { activeGoals: 0, lastSeen: Date.now() },
        trust: { current: 85, history: [] },
        maxGoals: 5
      });
      const jobId = 'already-in-job';
      federation.activeJobs.set(jobId, {
        id: jobId, goal: 'test', context: {},
        subGoals: [
          { id: 'sg1', description: 'first', requirements: ['vision'], status: 'pending', assignedTo: null, result: null, attempts: 0 },
          { id: 'sg2', description: 'second', requirements: ['vision'], status: 'pending', assignedTo: null, result: null, attempts: 0 }
        ],
        assignedPeers: [], results: [], startTime: Date.now()
      });
      // Assign both sub-goals to the same peer
      const job = federation.activeJobs.get(jobId);
      await federation.assignSubGoal(jobId, job.subGoals[0]);
      await federation.assignSubGoal(jobId, job.subGoals[1]);
      // assignedPeers should contain the peer only once
      expect(job.assignedPeers.filter(p => p === 'peer-already-in').length).toBe(1);
    });
  });

  describe('updatePeerTrustScores — bonus/penalty branches', () => {
    function makeJob(assignedAt) {
      return {
        id: 'trust-job',
        goal: 'test',
        subGoals: [{ id: 'sub-1', status: 'complete', assignedTo: 'peer-t', assignedAt }]
      };
    }

    beforeEach(() => {
      federation.peers.set('peer-t', {
        id: 'peer-t',
        trust: { current: 80, history: [] },
        load: { activeGoals: 0 }
      });
    });

    test('no findings and no evidence: only success bonus (+5)', () => {
      const job = makeJob(Date.now() - 5000);
      const results = [{ peerId: 'peer-t', subGoalId: 'sub-1' }]; // no findings, no evidence
      federation.updatePeerTrustScores(job, results);
      expect(federation.peers.get('peer-t').trust.current).toBe(85); // 80 + 5
    });

    test('empty findings array: no quality bonus', () => {
      const job = makeJob(Date.now() - 5000);
      const results = [{ peerId: 'peer-t', subGoalId: 'sub-1', findings: [] }];
      federation.updatePeerTrustScores(job, results);
      expect(federation.peers.get('peer-t').trust.current).toBe(85); // 80 + 5, no +3
    });

    test('slow sub-goal (>60s) applies speed penalty (-2)', () => {
      const job = makeJob(Date.now() - 70000); // 70s ago
      const results = [{ peerId: 'peer-t', subGoalId: 'sub-1' }];
      federation.updatePeerTrustScores(job, results);
      expect(federation.peers.get('peer-t').trust.current).toBe(83); // 80 + 5 - 2
    });

    test('skips result when peer is not found', () => {
      const job = makeJob(Date.now() - 5000);
      const results = [{ peerId: 'peer-missing', subGoalId: 'sub-1' }];
      expect(() => federation.updatePeerTrustScores(job, results)).not.toThrow();
    });
  });

  describe('calculateJobTrustScore — unknown peer fallback', () => {
    test('uses 0 for peer trust when peer not in map', () => {
      const job = { subGoals: [{ id: 's1' }, { id: 's2' }] };
      const results = [{ peerId: 'ghost-peer', subGoalId: 's1' }]; // peer not registered
      const score = federation.calculateJobTrustScore(job, results);
      // peerScore = 0, completionRate = 1/2 = 0.5 → 0 * 0.5 = 0
      expect(score).toBe(0);
    });
  });

  describe('rebalance — null peer reference', () => {
    test('handles missing peer for assigned subGoal gracefully', async () => {
      const jobId = 'null-peer-job';
      federation.activeJobs.set(jobId, {
        id: jobId, goal: 'test', context: {},
        status: 'running',
        subGoals: [{
          id: 'sub-np',
          description: 'test',
          requirements: ['vision'],
          status: 'assigned',
          assignedTo: 'peer-deleted', // peer not in the peers map
          attempts: 0
        }],
        assignedPeers: ['peer-deleted'], results: [], startTime: Date.now()
      });
      // peer-deleted is not in federation.peers — rebalance should handle this gracefully
      expect(() => federation.rebalance()).not.toThrow();
    });
  });
});
