/**
 * v5.0 Distributed Intelligence Mesh
 *
 * Multi-node coordination, state synchronization, and distributed consensus.
 * Enables multiple Sentinel Override instances to work together.
 * Part of v10.0 upgrade - Phase 3 implementation.
 *
 * @module distributed-mesh
 * @version 10.0.0
 */

/* globals module */

class DistributedMesh {
  constructor(config = {}) {
    this.nodeId = config.nodeId || this.generateNodeId();
    this.nodes = new Map(); // nodeId -> node info
    this.meshState = new Map(); // key -> value with versioning
    this.consensusLog = [];
    this.resourceMarket = new Map(); // resource -> market data
    
    this.isCoordinator = false;
    this.coordinatorId = null;
    this.electionTimer = null;
    
    // Configuration
    this.config = {
      syncInterval: config.syncInterval || 5000,
      consensusTimeout: config.consensusTimeout || 10000,
      electionTimeout: config.electionTimeout || 30000,
      resourceUpdateInterval: config.resourceUpdateInterval || 10000
    };
    
    // Event emitters
    this.onNodeJoined = null;
    this.onNodeLeft = null;
    this.onStateSynced = null;
    this.onConsensusReached = null;
    this.onCoordinatorChanged = null;
  }

  /**
   * Generate unique node ID
   */
  generateNodeId() {
    return `node-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Initialize mesh and start coordination
   */
  async initialize() {
    // Start coordinator election
    await this.startElection();
    
    // Start periodic sync
    this.startSyncLoop();
    
    // Start resource market updates
    this.startResourceMarketLoop();
    
    return this.nodeId;
  }

  /**
   * Join mesh network
   * @param {string} discoveryAddress 
   */
  async joinMesh(discoveryAddress) {
    // Discover existing nodes
    const existingNodes = await this.discoverNodes(discoveryAddress);
    
    // Register with each node
    for (const node of existingNodes) {
      await this.registerWithNode(node);
    }
    
    // Sync state
    await this.syncState();
  }

  /**
   * Discover nodes in mesh
   * @param {string} address
   */
  async discoverNodes(_address) {
    // Placeholder for node discovery
    // In reality, this would use mDNS, DHT, or service discovery
    return [];
  }

  /**
   * Register with a node
   * @param {Object} node 
   */
  async registerWithNode(node) {
    const nodeInfo = {
      id: this.nodeId,
      address: this.getLocalAddress(),
      capabilities: this.getCapabilities(),
      resources: this.getResources(),
      joinedAt: Date.now()
    };
    
    await this.sendToNode(node.id, 'register', nodeInfo);
    
    // Add node to our registry
    this.nodes.set(node.id, {
      id: node.id,
      address: node.address,
      capabilities: node.capabilities || [],
      resources: node.resources || {},
      lastSeen: Date.now()
    });
  }

  /**
   * Synchronize state across mesh
   */
  async syncState() {
    const stateDigest = this.computeStateDigest();
    
    // Send digest to all nodes
    const promises = Array.from(this.nodes.keys()).map(nodeId =>
      this.sendToNode(nodeId, 'sync', { stateDigest })
    );
    
    await Promise.allSettled(promises);
    
    // Request missing state
    await this.requestMissingState();
  }

  /**
   * Compute state digest for comparison
   */
  computeStateDigest() {
    const digest = {};
    for (const [key, value] of this.meshState.entries()) {
      digest[key] = value.version;
    }
    return digest;
  }

  /**
   * Request missing state from nodes
   */
  async requestMissingState() {
    // Identify missing or stale state
    // Request updates from nodes
    // Merge incoming state with conflict resolution
  }

  /**
   * Start coordinator election
   */
  async startElection() {
    if (this.isCoordinator) return;
    
    // Simple election: lowest node ID wins
    const allNodes = [this.nodeId, ...Array.from(this.nodes.keys())];
    const sortedNodes = allNodes.sort();
    const newCoordinator = sortedNodes[0];
    
    if (this.coordinatorId !== newCoordinator) {
      this.coordinatorId = newCoordinator;
      this.isCoordinator = (newCoordinator === this.nodeId);
      
      if (this.onCoordinatorChanged) {
        this.onCoordinatorChanged(newCoordinator);
      }
    }
  }

  /**
   * Propose state change for consensus
   * @param {string} key 
   * @param {any} value 
   */
  async proposeStateChange(key, value) {
    const proposal = {
      id: this.generateProposalId(),
      nodeId: this.nodeId,
      key,
      value,
      version: Date.now(),
      timestamp: Date.now()
    };
    
    // Broadcast proposal
    await this.broadcast('propose', proposal);
    
    // Wait for consensus
    const consensus = await this.waitForConsensus(proposal);
    
    if (consensus.reached) {
      // Apply state change
      this.meshState.set(key, {
        value,
        version: proposal.version,
        proposer: proposal.nodeId
      });
      
      if (this.onConsensusReached) {
        this.onConsensusReached(proposal);
      }
    }
    
    return consensus;
  }

  /**
   * Wait for consensus on proposal
   * @param {Object} proposal 
   */
  async waitForConsensus(proposal) {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // Check if we have enough agreements
        const agreements = this.countAgreements(proposal.id);
        const requiredVotes = Math.floor((this.nodes.size + 1) / 2) + 1;
        
        if (agreements >= requiredVotes) {
          clearInterval(checkInterval);
          resolve({ reached: true, proposal });
        } else if (Date.now() - startTime > this.config.consensusTimeout) {
          clearInterval(checkInterval);
          resolve({ reached: false, reason: 'timeout' });
        }
      }, 1000);
    });
  }

  /**
   * Count agreements for proposal
   * @param {string} proposalId 
   */
  countAgreements(proposalId) {
    let count = 1; // Count self
    for (const node of this.nodes.values()) {
      if (node.agreements && node.agreements.has(proposalId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Start periodic sync loop
   */
  startSyncLoop() {
    setInterval(() => {
      this.syncState();
    }, this.config.syncInterval);
  }

  /**
   * Start resource market loop
   */
  startResourceMarketLoop() {
    setInterval(() => {
      this.updateResourceMarket();
    }, this.config.resourceUpdateInterval);
  }

  /**
   * Update resource market
   */
  updateResourceMarket() {
    const myResources = this.getResources();
    
    // Publish my resources
    for (const [resource, amount] of Object.entries(myResources)) {
      this.resourceMarket.set(`${this.nodeId}-${resource}`, {
        node: this.nodeId,
        resource,
        amount,
        price: this.calculateResourcePrice(resource),
        timestamp: Date.now()
      });
    }
    
    // Broadcast market update
    this.broadcast('market-update', this.getMarketData());
  }

  /**
   * Calculate resource price based on supply/demand
   * @param {string} resource 
   */
  calculateResourcePrice(resource) {
    // Simple supply-demand pricing
    const supply = this.getTotalSupply(resource);
    const demand = this.getTotalDemand(resource);
    
    if (supply === 0) return 1.0;
    return Math.max(0.1, Math.min(10.0, demand / supply));
  }

  /**
   * Get total supply of resource
   * @param {string} resource 
   */
  getTotalSupply(resource) {
    let total = 0;
    for (const [_key, data] of this.resourceMarket.entries()) {
      if (data.resource === resource) {
        total += data.amount;
      }
    }
    return total;
  }

  /**
   * Get total demand for resource
   * @param {string} resource
   */
  getTotalDemand(_resource) {
    // Placeholder - would track actual demand
    return 1.0;
  }

  /**
   * Get market data
   */
  getMarketData() {
    return Array.from(this.resourceMarket.values());
  }

  /**
   * Broadcast message to all nodes
   * @param {string} type 
   * @param {Object} data 
   */
  async broadcast(type, data) {
    const promises = Array.from(this.nodes.keys()).map(nodeId =>
      this.sendToNode(nodeId, type, data)
    );
    
    await Promise.allSettled(promises);
  }

  /**
   * Send message to specific node
   * @param {string} nodeId 
   * @param {string} type 
   * @param {Object} data 
   */
  async sendToNode(nodeId, type, data) {
    // Placeholder for node communication
    // In reality, this would use WebRTC, WebSocket, or HTTP
    console.log(`[Mesh] Sending to ${nodeId}:`, { type, data });
  }

  /**
   * Get local address
   */
  getLocalAddress() {
    return `ws://localhost:8080`;
  }

  /**
   * Get capabilities
   */
  getCapabilities() {
    return ['browser-automation', 'llm-execution', 'state-management'];
  }

  /**
   * Get resources
   */
  getResources() {
    return {
      cpu: 0.8,
      memory: 0.6,
      bandwidth: 1.0
    };
  }

  /**
   * Generate proposal ID
   */
  generateProposalId() {
    return `proposal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get mesh status
   */
  getMeshStatus() {
    return {
      nodeId: this.nodeId,
      isCoordinator: this.isCoordinator,
      coordinatorId: this.coordinatorId,
      nodeCount: this.nodes.size,
      stateCount: this.meshState.size,
      marketEntries: this.resourceMarket.size
    };
  }

  /**
   * Shutdown mesh
   */
  async shutdown() {
    // Unregister from coordinator
    if (!this.isCoordinator && this.coordinatorId) {
      await this.sendToNode(this.coordinatorId, 'unregister', {
        nodeId: this.nodeId
      });
    }
    
    // Clear timers
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DistributedMesh;
}