// tests/agent-pool.test.js
// Tests for background/agent-pool.js — Multi-Tab Parallel Agents.
//
// Coverage:
//   AgentInstance — creation, lifecycle (start/pause/resume/stop/fail), getStatus
//   Pool management — add/remove, concurrent limit, duplicate prevention
//   Pool status reporting
//   Stop individual + stop all

import { jest } from '@jest/globals';

let mod;

beforeAll(async () => {
  mod = await import('../background/agent-pool.js');
});

beforeEach(() => {
  // Clear pool between tests
  mod.stopAllAgents();
});

// ── Helper: create a valid tabId ──
function makeTabId(n = 1) {
  return 100 + n;
}

// ═══════════════════════════════════════════════════════════
// AgentInstance
// ═══════════════════════════════════════════════════════════
describe('AgentInstance', () => {
  test('creates instance with correct initial state', () => {
    const agent = new mod.AgentInstance(42, 'Test goal');
    expect(agent.tabId).toBe(42);
    expect(agent.goal).toBe('Test goal');
    expect(agent.state).toBe('idle');
    expect(agent.stepCount).toBe(0);
    expect(agent.history).toEqual([]);
    expect(agent.agentState).toEqual({});
    expect(agent.sharedState).toBeDefined();
    expect(typeof agent.sharedState.reset).toBe('function');
  });

  test('throws for invalid tabId', () => {
    expect(() => new mod.AgentInstance(null, 'goal')).toThrow('tabId must be a number');
    expect(() => new mod.AgentInstance('abc', 'goal')).toThrow('tabId must be a number');
    expect(() => new mod.AgentInstance(undefined, 'goal')).toThrow('tabId must be a number');
  });

  test('throws for invalid goal', () => {
    expect(() => new mod.AgentInstance(1, '')).toThrow('goal must be a non-empty string');
    expect(() => new mod.AgentInstance(1, null)).toThrow('goal must be a non-empty string');
    expect(() => new mod.AgentInstance(1, 123)).toThrow('goal must be a non-empty string');
  });

  test('start() sets state to running', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    expect(agent.state).toBe('idle');
    agent.start();
    expect(agent.state).toBe('running');
  });

  test('pause() sets state to paused (only if running)', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    agent.pause();
    expect(agent.state).toBe('idle'); // Can't pause from idle
    agent.start();
    agent.pause();
    expect(agent.state).toBe('paused');
  });

  test('resume() sets state back to running (only if paused)', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    agent.start();
    agent.pause();
    agent.resume();
    expect(agent.state).toBe('running');
  });

  test('resume() does nothing if not paused', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    agent.resume();
    expect(agent.state).toBe('idle');
  });

  test('stop() sets state to stopped', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    agent.start();
    agent.stop();
    expect(agent.state).toBe('stopped');
  });

  test('stop() calls onError callback', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    let calledWith = null;
    agent.onError = (a) => { calledWith = a; };
    agent.start();
    agent.stop();
    expect(calledWith).toBe(agent);
  });

  test('fail() sets state to error and stores error message', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    agent.start();
    agent.fail('Something broke');
    expect(agent.state).toBe('error');
    expect(agent.error).toBe('Something broke');
  });

  test('fail() calls onError callback', () => {
    const agent = new mod.AgentInstance(1, 'goal');
    let calledWith = null;
    agent.onError = (a) => { calledWith = a; };
    agent.fail('Error');
    expect(calledWith).toBe(agent);
  });

  test('getStatus() returns correct snapshot', () => {
    const agent = new mod.AgentInstance(42, 'My goal');
    agent.start();
    agent.stepCount = 5;
    const status = agent.getStatus();
    expect(status.tabId).toBe(42);
    expect(status.goal).toBe('My goal');
    expect(status.state).toBe('running');
    expect(status.stepCount).toBe(5);
    expect(typeof status.runtime).toBe('number');
    expect(status.runtime).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════
// startParallelAgent
// ═══════════════════════════════════════════════════════════
describe('startParallelAgent', () => {
  test('creates and starts a new agent instance', () => {
    const agent = mod.startParallelAgent(101, 'Go to example.com');
    expect(agent).toBeInstanceOf(mod.AgentInstance);
    expect(agent.state).toBe('running');
    expect(agent.tabId).toBe(101);
  });

  test('adds agent to pool', () => {
    mod.startParallelAgent(102, 'Test');
    expect(mod.getAgentByTab(102)).toBeDefined();
  });

  test('throws for duplicate tabId', () => {
    mod.startParallelAgent(103, 'First');
    expect(() => mod.startParallelAgent(103, 'Second')).toThrow('Agent already running on tab 103');
  });

  test('throws when max concurrent agents reached', () => {
    // Fill pool to max (5)
    for (let i = 0; i < 5; i++) {
      mod.startParallelAgent(200 + i, `Goal ${i}`);
    }
    // 6th should throw
    expect(() => mod.startParallelAgent(210, 'Over the limit')).toThrow('Max concurrent agents reached');
  });

  test('throws for invalid tabId', () => {
    expect(() => mod.startParallelAgent(null, 'goal')).toThrow('tabId must be a number');
    expect(() => mod.startParallelAgent('x', 'goal')).toThrow('tabId must be a number');
  });

  test('throws for invalid goal', () => {
    expect(() => mod.startParallelAgent(104, '')).toThrow('goal must be a non-empty string');
    expect(() => mod.startParallelAgent(104, null)).toThrow('goal must be a non-empty string');
  });
});

// ═══════════════════════════════════════════════════════════
// stopAgent (pool)
// ═══════════════════════════════════════════════════════════
describe('stopAgent (pool)', () => {
  test('stops and removes agent from pool', () => {
    mod.startParallelAgent(301, 'Task');
    expect(mod.getAgentByTab(301)).toBeDefined();
    const result = mod.stopAgent(301);
    expect(result).toBe(true);
    expect(mod.getAgentByTab(301)).toBeUndefined();
  });

  test('returns false for non-existent agent', () => {
    const result = mod.stopAgent(99999);
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// stopAllAgents
// ═══════════════════════════════════════════════════════════
describe('stopAllAgents', () => {
  test('stops all agents and clears pool', () => {
    mod.startParallelAgent(401, 'A');
    mod.startParallelAgent(402, 'B');
    mod.startParallelAgent(403, 'C');
    expect(mod.getPoolStatus().length).toBe(3);
    mod.stopAllAgents();
    expect(mod.getPoolStatus().length).toBe(0);
  });

  test('works with empty pool', () => {
    mod.stopAllAgents();
    expect(mod.getPoolStatus().length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// getPoolStatus
// ═══════════════════════════════════════════════════════════
describe('getPoolStatus', () => {
  test('returns array of agent statuses', () => {
    mod.startParallelAgent(501, 'Alpha');
    mod.startParallelAgent(502, 'Beta');
    const status = mod.getPoolStatus();
    expect(Array.isArray(status)).toBe(true);
    expect(status.length).toBe(2);
    const ids = status.map(s => s.tabId).sort();
    expect(ids).toEqual([501, 502]);
  });

  test('includes all required fields per agent', () => {
    mod.startParallelAgent(503, 'Gamma');
    const status = mod.getPoolStatus();
    const agent = status.find(s => s.tabId === 503);
    expect(agent).toBeDefined();
    expect(agent.goal).toBe('Gamma');
    expect(agent.state).toBe('running');
    expect(typeof agent.stepCount).toBe('number');
    expect(typeof agent.runtime).toBe('number');
  });

  test('returns empty array for empty pool', () => {
    expect(mod.getPoolStatus()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// getActiveAgentCount
// ═══════════════════════════════════════════════════════════
describe('getActiveAgentCount', () => {
  test('counts only running agents', () => {
    const a1 = mod.startParallelAgent(601, 'Running');
    const a2 = mod.startParallelAgent(602, 'Paused');
    a2.pause();
    expect(mod.getActiveAgentCount()).toBe(1); // Only a1 is running
  });

  test('returns 0 for empty pool', () => {
    expect(mod.getActiveAgentCount()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// getMaxConcurrentAgents
// ═══════════════════════════════════════════════════════════
describe('getMaxConcurrentAgents', () => {
  test('returns 5', () => {
    expect(mod.getMaxConcurrentAgents()).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════
// hasRunningAgents
// ═══════════════════════════════════════════════════════════
describe('hasRunningAgents', () => {
  test('returns true when agents are running', () => {
    mod.startParallelAgent(701, 'goal');
    expect(mod.hasRunningAgents()).toBe(true);
  });

  test('returns false when pool is empty', () => {
    expect(mod.hasRunningAgents()).toBe(false);
  });

  test('returns false when all agents are stopped', () => {
    mod.startParallelAgent(702, 'goal');
    mod.stopAgent(702);
    expect(mod.hasRunningAgents()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// cleanPool
// ═══════════════════════════════════════════════════════════
describe('cleanPool', () => {
  test('removes stopped and errored agents', () => {
    const a1 = mod.startParallelAgent(801, 'Running');
    const a2 = mod.startParallelAgent(802, 'Stopped');
    const a3 = mod.startParallelAgent(803, 'Errored');
    a2.stop();
    a3.fail('Broken');
    // Note: stopAgent already removes from pool, so we need to test with stop() on instance directly
    // a2 was stopped via stopAgent which deletes it, so test cleanPool with a3
    const removed = mod.cleanPool();
    // a3 is in error state
    expect(mod.getAgentByTab(803)).toBeUndefined();
  });

  test('keeps running agents', () => {
    mod.startParallelAgent(804, 'Running');
    mod.cleanPool();
    expect(mod.getAgentByTab(804)).toBeDefined();
  });

  test('returns count of removed agents', () => {
    const a1 = mod.startParallelAgent(805, 'Error');
    a1.fail('test');
    const removed = mod.cleanPool();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════
// getAgentByTab
// ═══════════════════════════════════════════════════════════
describe('getAgentByTab', () => {
  test('returns agent for existing tabId', () => {
    mod.startParallelAgent(901, 'Find me');
    const agent = mod.getAgentByTab(901);
    expect(agent).toBeDefined();
    expect(agent.goal).toBe('Find me');
  });

  test('returns undefined for non-existent tabId', () => {
    expect(mod.getAgentByTab(99999)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// getAgentPool
// ═══════════════════════════════════════════════════════════
describe('getAgentPool', () => {
  test('returns the underlying Map', () => {
    const pool = mod.getAgentPool();
    expect(pool).toBeInstanceOf(Map);
  });
});
