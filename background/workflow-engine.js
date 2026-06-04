/**
 * v4.0 Multi-Agent System - Workflow Engine
 * 
 * Orchestrates complex multi-step tasks across multiple agents.
 * Handles task decomposition, dependency management, and agent coordination.
 * Part of v10.0 upgrade - Phase 2 implementation.
 * 
 * @module workflow-engine
 * @version 10.0.0
 */

class WorkflowEngine {
  constructor(agentRegistry) {
    this.agentRegistry = agentRegistry;
    this.workflows = new Map(); // workflowId -> workflow
    this.activeWorkflows = new Map(); // workflowId -> execution state
    this.nextWorkflowId = 1;
    
    // Event emitters
    this.onWorkflowStarted = null;
    this.onWorkflowCompleted = null;
    this.onWorkflowFailed = null;
    this.onStepCompleted = null;
  }

  /**
   * Create a new workflow
   * @param {Object} workflowDef - Workflow definition
   * @returns {string} workflowId
   */
  createWorkflow(workflowDef) {
    const workflowId = `workflow-${this.nextWorkflowId++}`;
    
    const workflow = {
      id: workflowId,
      name: workflowDef.name || `Workflow ${workflowId}`,
      description: workflowDef.description || '',
      steps: this.normalizeSteps(workflowDef.steps || []),
      dependencies: workflowDef.dependencies || {},
      config: workflowDef.config || {},
      createdAt: Date.now()
    };

    this.workflows.set(workflowId, workflow);
    return workflowId;
  }

  /**
   * Normalize step definitions
   * @param {Array} steps 
   */
  normalizeSteps(steps) {
    return steps.map((step, index) => ({
      id: step.id || `step-${index}`,
      name: step.name || `Step ${index}`,
      type: step.type || 'task',
      agentType: step.agentType || 'generic',
      capabilities: step.capabilities || [],
      input: step.input || {},
      dependencies: step.dependencies || [],
      config: step.config || {},
      retryPolicy: step.retryPolicy || { maxAttempts: 3, backoff: 'exponential' }
    }));
  }

  /**
   * Execute a workflow
   * @param {string} workflowId 
   * @param {Object} context - Initial context data
   */
  async executeWorkflow(workflowId, context = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const executionState = {
      workflowId,
      status: 'running',
      currentStep: 0,
      completedSteps: new Set(),
      failedSteps: new Set(),
      stepResults: new Map(),
      context,
      startedAt: Date.now()
    };

    this.activeWorkflows.set(workflowId, executionState);

    if (this.onWorkflowStarted) {
      this.onWorkflowStarted(workflowId, workflow);
    }

    try {
      const result = await this.executeSteps(workflow, executionState);
      
      executionState.status = 'completed';
      executionState.completedAt = Date.now();
      
      if (this.onWorkflowCompleted) {
        this.onWorkflowCompleted(workflowId, result);
      }
      
      return result;
    } catch (error) {
      executionState.status = 'failed';
      executionState.error = error.message;
      executionState.failedAt = Date.now();
      
      if (this.onWorkflowFailed) {
        this.onWorkflowFailed(workflowId, error);
      }
      
      throw error;
    }
  }

  /**
   * Execute workflow steps with dependency resolution
   * @param {Object} workflow 
   * @param {Object} executionState 
   */
  async executeSteps(workflow, executionState) {
    const remainingSteps = new Set(workflow.steps.map(s => s.id));
    const stepOrder = this.topologicalSort(workflow.steps);

    for (const stepId of stepOrder) {
      if (executionState.failedSteps.has(stepId)) {
        continue; // Skip failed steps
      }

      const step = workflow.steps.find(s => s.id === stepId);
      if (!step) continue;

      // Check dependencies
      const depsMet = step.dependencies.every(depId => 
        executionState.completedSteps.has(depId)
      );

      if (!depsMet) {
        continue; // Dependencies not met, skip for now
      }

      try {
        const result = await this.executeStep(step, executionState);
        executionState.stepResults.set(stepId, result);
        executionState.completedSteps.add(stepId);
        remainingSteps.delete(stepId);

        if (this.onStepCompleted) {
          this.onStepCompleted(workflow.id, stepId, result);
        }
      } catch (error) {
        executionState.failedSteps.add(stepId);
        
        // Check retry policy
        if (this.shouldRetryStep(step, executionState)) {
          // Re-add to queue for retry
          continue;
        } else {
          throw new Error(`Step ${stepId} failed: ${error.message}`);
        }
      }
    }

    return executionState.stepResults;
  }

  /**
   * Execute a single step
   * @param {Object} step 
   * @param {Object} executionState 
   */
  async executeStep(step, executionState) {
    // Find suitable agents
    const agents = this.agentRegistry.findAvailableAgents(step.capabilities);
    if (agents.length === 0) {
      throw new Error(`No available agents with capabilities: ${step.capabilities.join(', ')}`);
    }

    // Select best agent (simple round-robin for now)
    const agent = agents[0];

    // Update agent status
    this.agentRegistry.updateAgentStatus(agent.id, 'active');

    try {
      // Prepare step input with context
      const stepInput = {
        ...step.input,
        ...executionState.context,
        _step: step,
        _workflowId: executionState.workflowId
      };

      // Execute step (this would delegate to agent execution)
      const result = await this.executeAgentTask(agent, stepInput);

      // Update context with results
      Object.assign(executionState.context, result);

      return result;
    } finally {
      this.agentRegistry.updateAgentStatus(agent.id, 'idle');
    }
  }

  /**
   * Execute task on agent
   * @param {Object} agent 
   * @param {Object} taskInput 
   */
  async executeAgentTask(agent, taskInput) {
    // This is a placeholder - in reality, this would communicate with the agent
    // For now, simulate execution
    return {
      agentId: agent.id,
      taskType: taskInput._step?.type,
      result: 'Task completed',
      executedAt: Date.now()
    };
  }

  /**
   * Topological sort for dependency resolution
   * @param {Array} steps 
   */
  topologicalSort(steps) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (stepId) => {
      if (visited.has(stepId)) return;
      if (visiting.has(stepId)) {
        throw new Error(`Circular dependency detected involving ${stepId}`);
      }

      visiting.add(stepId);

      const step = steps.find(s => s.id === stepId);
      if (step) {
        for (const dep of step.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(stepId);
      visited.add(stepId);
      sorted.push(stepId);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return sorted;
  }

  /**
   * Check if step should be retried
   * @param {Object} step 
   * @param {Object} executionState 
   */
  shouldRetryStep(step, executionState) {
    // Simple retry logic - can be enhanced
    const attempts = (executionState._retryAttempts || new Map()).get(step.id) || 0;
    return attempts < (step.retryPolicy?.maxAttempts || 3);
  }

  /**
   * Get workflow status
   * @param {string} workflowId 
   */
  getWorkflowStatus(workflowId) {
    const workflow = this.workflows.get(workflowId);
    const execution = this.activeWorkflows.get(workflowId);
    
    if (!workflow) return null;
    
    return {
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description
      },
      execution: execution ? {
        status: execution.status,
        currentStep: execution.currentStep,
        completedSteps: Array.from(execution.completedSteps),
        failedSteps: Array.from(execution.failedSteps),
        startedAt: execution.startedAt,
        completedAt: execution.completedAt
      } : null
    };
  }

  /**
   * Cancel a running workflow
   * @param {string} workflowId 
   */
  cancelWorkflow(workflowId) {
    const execution = this.activeWorkflows.get(workflowId);
    if (!execution || execution.status !== 'running') {
      return false;
    }

    execution.status = 'cancelled';
    execution.cancelledAt = Date.now();
    
    return true;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkflowEngine;
}