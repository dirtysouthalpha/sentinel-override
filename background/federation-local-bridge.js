/**
 * Federation Local Bridge
 *
 * Bridges the FederationController to the local AgentPool.
 * Each local agent slot becomes a "virtual peer" that the federation
 * can assign sub-goals to. When a sub-goal is sent to a local peer,
 * a real agent is started in the agent pool on a dedicated tab.
 *
 * @module background/federation-local-bridge
 * @version 1.0.0
 */

import {federation} from './federation.js';
import {startParallelAgent, stopAgent, getAgentByTab, getMaxConcurrentAgents, stopAllAgents, } from './agent-pool.js';

// ── Slot → TabId mapping ──
const _slotTabs = new Map(); // slot(int) → tabId(int)

// ── Capabilities local agents advertise to the federation ──
const LOCAL_CAPABILITIES = [
  'vision',
  'network',
  'knowledge_graph',
  'browser-automation',
  'navigation',
  'data-extraction',
  'form-filling',
  'm365',
];

/**
 * Register the local agent pool as virtual peers in the federation.
 * Creates one peer per available agent slot (max 5).
 * Called during federation initialization.
 *
 * @returns {Promise<number>} Number of peers registered.
 */
export async function registerLocalPeers() {
  const maxAgents = getMaxConcurrentAgents();

  for (let i = 0; i < maxAgents; i++) {
    const peerId = `local-agent-${i}`;

    // Skip if already registered
    if (federation.peers.has(peerId)) continue;

    await federation.registerPeer({
      peer_id: peerId,
      capabilities: LOCAL_CAPABILITIES,
      max_concurrent_goals: 1, // Each slot handles one sub-goal at a time
      trust_score_baseline: 100, // Local agents have max trust
      signature: 'local-trust-signature',
      type: 'local',
      name: `Local Agent ${i + 1}`,
      slot: i,
    });
  }

  return maxAgents;
}

/**
 * Override sendGoalToPeer for local peers.
 * Starts a real agent in the local agent pool instead of a network call.
 *
 * @param {string} peerId - Peer ID like 'local-agent-0'.
 * @param {object} subGoal - Sub-goal object with description, id, etc.
 * @returns {Promise<{peerId: string, tabId: number, instance: object}>}
 */
export async function sendGoalToLocalPeer(peerId, subGoal) {
  // Extract slot number from peerId: 'local-agent-0' → slot 0
  const slotMatch = peerId.match(/local-agent-(\d+)/);
  if (!slotMatch) throw new Error(`Invalid local peer ID: ${peerId}`);

  const slot = parseInt(slotMatch[1], 10);

  // Get or create a tab for this agent slot
  const tabId = await getOrCreateTabForSlot(slot);

  // Extract goal string from sub-goal
  const goalStr = typeof subGoal === 'string' ? subGoal : subGoal.description;

  // Stop any existing agent on this tab before starting a new one
  const existingAgent = getAgentByTab(tabId);
  if (existingAgent && (existingAgent.state === 'running' || existingAgent.state === 'paused')) {
    stopAgent(tabId);
  }

  // Start the agent on this tab
  const instance = startParallelAgent(tabId, goalStr);

  // Mark sub-goal as running so waitForCompletion tracks it
  if (subGoal && typeof subGoal === 'object') {
    subGoal.status = 'running';
  }

  console.warn(`[Federation-Bridge] Started local agent on slot ${slot} (tab ${tabId}) for: ${goalStr}`);

  return { peerId, tabId, instance };
}

/**
 * Report that a local sub-goal has completed successfully.
 * Updates the federation job so waitForCompletion can resolve.
 *
 * @param {string} subGoalId - The sub-goal ID.
 * @param {string} jobId - The parent job ID.
 * @param {object} [result] - Optional result payload.
 * @returns {boolean} True if the sub-goal was found and updated.
 */
export function reportSubGoalCompletion(subGoalId, jobId, result) {
  const job = federation.activeJobs.get(jobId);
  if (!job) return false;

  const subGoal = job.subGoals.find((sg) => sg.id === subGoalId);
  if (!subGoal) return false;

  subGoal.status = 'complete';
  subGoal.result = result || {
    summary: `Completed: ${subGoal.description}`,
    findings: [],
    evidence: {},
  };

  // Decrement peer load
  const peer = federation.peers.get(subGoal.assignedTo);
  if (peer) {
    peer.load.activeGoals = Math.max(0, peer.load.activeGoals - 1);
    peer.load.lastSeen = Date.now();
  }

  console.warn(`[Federation-Bridge] Sub-goal ${subGoalId} completed`);
  return true;
}

/**
 * Report that a local sub-goal has failed.
 *
 * @param {string} subGoalId - The sub-goal ID.
 * @param {string} jobId - The parent job ID.
 * @param {string} [error] - Optional error message.
 * @returns {boolean} True if the sub-goal was found and updated.
 */
export function reportSubGoalFailure(subGoalId, jobId, error) {
  const job = federation.activeJobs.get(jobId);
  if (!job) return false;

  const subGoal = job.subGoals.find((sg) => sg.id === subGoalId);
  if (!subGoal) return false;

  subGoal.status = 'failed';
  subGoal.error = error || 'Local agent failed';

  // Decrement peer load
  const peer = federation.peers.get(subGoal.assignedTo);
  if (peer) {
    peer.load.activeGoals = Math.max(0, peer.load.activeGoals - 1);
  }

  console.warn(`[Federation-Bridge] Sub-goal ${subGoalId} failed: ${subGoal.error}`);
  return true;
}

/**
 * Get the status of all local peers, mapped from the agent pool.
 *
 * @returns {Array<{peerId: string, tabId: number, goal: string|null, state: string, stepCount: number, runtime: number}>}
 */
export function getLocalPeerStatus() {
  const statuses = [];

  for (const [slot, tabId] of _slotTabs.entries()) {
    const agent = getAgentByTab(tabId);
    statuses.push({
      peerId: `local-agent-${slot}`,
      tabId,
      goal: agent ? agent.goal : null,
      state: agent ? agent.state : 'idle',
      stepCount: agent ? agent.stepCount : 0,
      runtime: agent ? Date.now() - agent.startTime : 0,
    });
  }

  return statuses;
}

/**
 * Get or create a tab for a given agent slot.
 * Uses chrome.tabs.create if available, otherwise falls back to synthetic IDs.
 *
 * @param {number} slot - The agent slot index.
 * @returns {Promise<number>} The tab ID.
 */
async function getOrCreateTabForSlot(slot) {
  if (_slotTabs.has(slot)) {
    return _slotTabs.get(slot);
  }

  // Try real Chrome tab creation
  if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
    const tab = await chrome.tabs.create({ active: slot === 0, url: 'about:blank' });
    _slotTabs.set(slot, tab.id);
    return tab.id;
  }

  // Fallback for testing / non-browser environments
  const syntheticId = 10000 + slot;
  _slotTabs.set(slot, syntheticId);
  return syntheticId;
}

/**
 * Clear all slot-to-tab mappings (for testing).
 */
export function clearLocalPeerSlots() {
  _slotTabs.clear();
}

/**
 * Full teardown — stop all local agents and clear slots.
 */
export function teardownLocalBridge() {
  stopAllAgents();
  _slotTabs.clear();
}

// Export internals for testing
export const _internal = { _slotTabs, LOCAL_CAPABILITIES };
