// background/agent-pool.js
// Multi-Tab Parallel Agents — manages multiple concurrent agent instances.
// Each agent runs in its own tab with independent state.
//
// Dependencies: sharedState from agent-shared-state.js

import { sharedState as _sharedStateTemplate } from './agent-shared-state.js';

// Maximum number of agents that can run simultaneously
const MAX_CONCURRENT = 5;

// Pool of active agents, keyed by tabId
const _agentPool = new Map(); // tabId -> AgentInstance

/**
 * Represents a single agent instance running on a specific tab.
 * Each instance has independent state, history, and lifecycle.
 */
export class AgentInstance {
  constructor(tabId, goal) {
    if (typeof tabId !== 'number') throw new Error('AgentInstance: tabId must be a number');
    if (typeof goal !== 'string' || !goal.trim()) throw new Error('AgentInstance: goal must be a non-empty string');
    this.tabId = tabId;
    this.goal = goal;
    this.state = 'idle'; // idle, running, paused, stopped, error
    this.stepCount = 0;
    this.startTime = Date.now();
    this.history = [];
    this.agentState = {}; // LLM state, plan, etc.
    // Independent copy of shared state so multiple agents don't clash
    this.sharedState = JSON.parse(JSON.stringify(_sharedStateTemplate));
    // Ensure reset method exists on the copy
    if (typeof this.sharedState.reset !== 'function') {
      this.sharedState.reset = _sharedStateTemplate.reset.bind(this.sharedState);
    }
    this.onError = null;
    this.error = null;
  }

  /**
   * Start this agent instance.
   */
  start() {
    this.state = 'running';
    this.startTime = Date.now();
    this.stepCount = 0;
  }

  /**
   * Pause this agent instance.
   */
  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
    }
  }

  /**
   * Resume this agent instance from pause.
   */
  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
    }
  }

  /**
   * Stop this agent instance.
   */
  stop() {
    this.state = 'stopped';
    if (this.onError) {
      try { this.onError(this); } catch (_e) { /* callback failed */ }
    }
  }

  /**
   * Mark this instance as having errored.
   */
  fail(errorMessage) {
    this.state = 'error';
    this.error = errorMessage || 'Unknown error';
    if (this.onError) {
      try { this.onError(this); } catch (_e) { /* callback failed */ }
    }
  }

  /**
   * Get a status snapshot for this instance.
   * @returns {{tabId, goal, state, stepCount, runtime}}
   */
  getStatus() {
    return {
      tabId: this.tabId,
      goal: this.goal,
      state: this.state,
      stepCount: this.stepCount,
      runtime: Date.now() - this.startTime,
    };
  }
}

/**
 * Get the underlying agent pool Map.
 * @returns {Map<number, AgentInstance>}
 */
export function getAgentPool() {
  return _agentPool;
}

/**
 * Get an agent instance by tabId.
 * @param {number} tabId
 * @returns {AgentInstance|undefined}
 */
export function getAgentByTab(tabId) {
  return _agentPool.get(tabId);
}

/**
 * Get count of currently running agents.
 * @returns {number}
 */
export function getActiveAgentCount() {
  let count = 0;
  for (const agent of _agentPool.values()) {
    if (agent.state === 'running') count++;
  }
  return count;
}

/**
 * Get the maximum number of concurrent agents allowed.
 * @returns {number}
 */
export function getMaxConcurrentAgents() {
  return MAX_CONCURRENT;
}

/**
 * Start a new parallel agent instance.
 * Throws if max concurrent reached or agent already running on this tab.
 *
 * @param {number} tabId - The tab to run the agent on.
 * @param {string} goal - The goal string for the agent.
 * @returns {AgentInstance} The created agent instance.
 * @throws {Error} If max concurrent agents reached or agent already exists for tab.
 */
export function startParallelAgent(tabId, goal) {
  if (typeof tabId !== 'number') throw new Error('startParallelAgent: tabId must be a number');
  if (typeof goal !== 'string' || !goal.trim()) throw new Error('startParallelAgent: goal must be a non-empty string');

  // Check concurrent limit (count active + this new one)
  const activeCount = getActiveAgentCount();
  if (activeCount >= getMaxConcurrentAgents()) {
    throw new Error(`Max concurrent agents reached (${getMaxConcurrentAgents()})`);
  }

  // Clean up stale (stopped/errored) agents before checking for duplicates
  cleanPool();

  // Check for duplicate tab
  if (_agentPool.has(tabId)) {
    throw new Error(`Agent already running on tab ${tabId}`);
  }

  const instance = new AgentInstance(tabId, goal);
  instance.start();
  _agentPool.set(tabId, instance);
  return instance;
}

/**
 * Stop a specific agent by tabId and remove from pool.
 * @param {number} tabId
 * @returns {boolean} True if agent was found and stopped.
 */
export function stopAgent(tabId) {
  const agent = _agentPool.get(tabId);
  if (!agent) return false;
  agent.stop();
  _agentPool.delete(tabId);
  return true;
}

/**
 * Stop all active agents and clear the pool.
 */
export function stopAllAgents() {
  for (const agent of _agentPool.values()) {
    agent.stop();
  }
  _agentPool.clear();
}

/**
 * Get a status snapshot for all agents in the pool.
 * @returns {Array<{tabId:number, goal:string, state:string, stepCount:number, runtime:number}>}
 */
export function getPoolStatus() {
  const result = [];
  for (const [tabId, agent] of _agentPool.entries()) {
    result.push({
      tabId,
      goal: agent.goal,
      state: agent.state,
      stepCount: agent.stepCount,
      runtime: Date.now() - agent.startTime,
    });
  }
  return result;
}

/**
 * Check if any agent is currently running in the pool.
 * @returns {boolean}
 */
export function hasRunningAgents() {
  for (const agent of _agentPool.values()) {
    if (agent.state === 'running' || agent.state === 'paused') return true;
  }
  return false;
}

/**
 * Clear stopped/errored agents from the pool.
 * Keeps only running/paused agents.
 */
export function cleanPool() {
  const toRemove = [];
  for (const [tabId, agent] of _agentPool.entries()) {
    if (agent.state === 'stopped' || agent.state === 'error') {
      toRemove.push(tabId);
    }
  }
  for (const tabId of toRemove) {
    _agentPool.delete(tabId);
  }
  return toRemove.length;
}

// Export for testing
export const _internal = { _agentPool, MAX_CONCURRENT };
