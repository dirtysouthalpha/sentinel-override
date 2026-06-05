/**
 * v4.0 Multi-Agent System - Agent Registry
 *
 * Manages agent lifecycle, registration, and coordination for multi-agent orchestration.
 * Part of v10.0 upgrade - Phase 2 implementation.
 *
 * @module agent-registry
 * @version 10.0.0
 */

/* globals module */

class AgentRegistry {
  constructor() {
    this.agents = new Map(); // agentId -> agent instance
    this.agentTypes = new Map(); // agentType -> agentId[]
    this.agentStatus = new Map(); // agentId -> status
    this.agentCapabilities = new Map(); // agentId -> capabilities[]
    this.nextAgentId = 1;
    
    // Event emitters
    this.onAgentRegistered = null;
    this.onAgentUnregistered = null;
    this.onAgentStatusChanged = null;
  }

  /**
   * Register a new agent
   * @param {Object} agentConfig - Agent configuration
   * @returns {string} agentId
   */
  registerAgent(agentConfig) {
    const agentId = `agent-${this.nextAgentId++}`;
    
    const agent = {
      id: agentId,
      type: agentConfig.type || 'generic',
      name: agentConfig.name || `Agent ${agentId}`,
      capabilities: agentConfig.capabilities || [],
      config: agentConfig.config || {},
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stats: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalExecutionTime: 0
      }
    };

    this.agents.set(agentId, agent);
    this.agentStatus.set(agentId, 'idle');
    
    // Track by type
    if (!this.agentTypes.has(agent.type)) {
      this.agentTypes.set(agent.type, []);
    }
    this.agentTypes.get(agent.type).push(agentId);
    
    // Track capabilities
    this.agentCapabilities.set(agentId, agent.capabilities);

    // Emit event
    if (this.onAgentRegistered) {
      this.onAgentRegistered(agent);
    }

    return agentId;
  }

  /**
   * Unregister an agent
   * @param {string} agentId 
   */
  unregisterAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    // Remove from type tracking
    const typeAgents = this.agentTypes.get(agent.type);
    if (typeAgents) {
      const idx = typeAgents.indexOf(agentId);
      if (idx !== -1) typeAgents.splice(idx, 1);
    }

    this.agents.delete(agentId);
    this.agentStatus.delete(agentId);
    this.agentCapabilities.delete(agentId);

    // Emit event
    if (this.onAgentUnregistered) {
      this.onAgentUnregistered(agentId);
    }

    return true;
  }

  /**
   * Update agent status
   * @param {string} agentId 
   * @param {string} status 
   */
  updateAgentStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = status;
    agent.lastActivity = Date.now();
    this.agentStatus.set(agentId, status);

    // Emit event
    if (this.onAgentStatusChanged) {
      this.onAgentStatusChanged(agentId, status);
    }

    return true;
  }

  /**
   * Get agent by ID
   * @param {string} agentId 
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   * @param {string} type 
   */
  getAgentsByType(type) {
    const agentIds = this.agentTypes.get(type) || [];
    const result = [];
    for (const id of agentIds) {
      const agent = this.agents.get(id);
      if (agent) result.push(agent);
    }
    return result;
  }

  /**
   * Get agents by capability
   * @param {string} capability 
   */
  getAgentsByCapability(capability) {
    return Array.from(this.agents.values()).filter(agent => 
      agent.capabilities.includes(capability)
    );
  }

  /**
   * Find available agents for a task
   * @param {Array} requiredCapabilities 
   */
  findAvailableAgents(requiredCapabilities = []) {
    return Array.from(this.agents.values()).filter(agent => 
      agent.status === 'idle' && 
      requiredCapabilities.every(cap => agent.capabilities.includes(cap))
    );
  }

  /**
   * Get agent statistics
   * @param {string} agentId 
   */
  getAgentStats(agentId) {
    const agent = this.agents.get(agentId);
    return agent ? agent.stats : null;
  }

  /**
   * Update agent statistics
   * @param {string} agentId 
   * @param {Object} statsUpdate 
   */
  updateAgentStats(agentId, statsUpdate) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    Object.assign(agent.stats, statsUpdate);
    return true;
  }

  /**
   * Get registry statistics
   */
  getRegistryStats() {
    const statusValues = Array.from(this.agentStatus.values());
    let activeCount = 0;
    let idleCount = 0;
    for (let i = 0, len = statusValues.length; i < len; i++) {
      if (statusValues[i] === 'active') activeCount++;
      else if (statusValues[i] === 'idle') idleCount++;
    }
    return {
      totalAgents: this.agents.size,
      activeAgents: activeCount,
      idleAgents: idleCount,
      agentsByType: Object.fromEntries(
        Array.from(this.agentTypes.entries()).map(([type, ids]) => [type, ids.length])
      )
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AgentRegistry;
}