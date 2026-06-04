/**
 * Federation Layer Tests
 * 
 * Tests for zero-trust multi-agent coordination
 * 
 * @version 10.0.0
 */

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

      const job = await federation.distributeGoal(
        'Navigate to example.com and verify page loads',
        {}
      );

      expect(job).toBeDefined();
      expect(job.status).toBeDefined();
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

      const job = await federation.distributeGoal(
        'Navigate to example.com',
        {}
      );

      expect(job.status).toBe('failed');
      expect(job.error).toContain('No sub-goals completed');
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
        trust: { current: 95 }
      });

      federation.activeJobs.set(jobId, {
        id: jobId,
        goal: 'Test goal',
        subGoals: [
          { 
            id: 'sub-1', 
            status: 'complete', 
            assignedTo: 'peer-high-trust',
            result: { findings: ['Test'] }
          }
        ],
        startTime: Date.now() - 10000
      });

      const result = await federation.reconcileResults(jobId);

      expect(result.trust_score).toBeGreaterThan(0);
      expect(result.trust_score).toBeLessThanOrEqual(100);
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

      const job = await federation.distributeGoal(
        'Navigate to example.com',
        {}
      );

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

      const job = await federation.distributeGoal(
        'Navigate to example.com',
        {}
      );

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
      const jobId = 'rebalance-test';
      
      federation.peers.set('peer-stalled', {
        id: 'peer-stalled',
        status: 'stalled',
        load: { activeGoals: 2 }
      });

      federation.activeJobs.set(jobId, {
        id: jobId,
        status: 'running',
        subGoals: [{
          id: 'sub-stalled',
          status: 'assigned',
          assignedTo: 'peer-stalled'
        }],
        assignedPeers: ['peer-stalled']
      });

      await federation.rebalance();

      const job = federation.activeJobs.get(jobId);
      expect(job.subGoals[0].status).toBe('pending');
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
        callback();
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
});
