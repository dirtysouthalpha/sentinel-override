/**
 * LangChain Bridge for Sentinel Override
 * 
 * Integrates Sentinel Override as a LangChain tool for browser automation.
 * 
 * @version 10.0.0
 * @module lib/bridges/langchain
 */

/**
 * Sentinel Override Tool for LangChain
 */
class SentinelLangChainTool {
  constructor(config = {}) {
    this.uapClient = config.uapClient;
    this.serverUrl = config.serverUrl || 'ws://localhost:8765/uap';
    this.authToken = config.authToken;
    this.timeout = config.timeout || 300000;
    this.connected = false;
  }

  /**
   * Initialize connection
   */
  async init() {
    if (this.uapClient) {
      this.connected = true;
      return;
    }

    // Import UAP client
    const { UAPClient } = await import('../uap-client.js');
    this.uapClient = new UAPClient({
      serverUrl: this.serverUrl,
      authToken: this.authToken,
      timeout: this.timeout
    });

    await this.uapClient.connect();
    this.connected = true;
  }

  /**
   * Execute browser automation goal
   * 
   * @param {string} goal - The goal to execute
   * @param {object} context - Optional context (tenant, budget, mode)
   * @returns {Promise<object>} Execution result
   */
  async execute(goal, context = {}) {
    if (!this.connected) {
      await this.init();
    }

    console.log('[LangChain] Executing goal:', goal);

    const result = await this.uapClient.execute(goal, {
      context,
      onStep: (step) => {
        console.log(`[LangChain] Step ${step.step}/${step.total}: ${step.action}`);
      }
    });

    return result;
  }

  /**
   * Convert to LangChain Tool format
   */
  toLangChainTool() {
    return {
      name: 'sentinel_browser',
      description: `Execute browser automation goals with vision-based AI agent. 
        Input should be a clear goal string describing what to do in the browser.
        Examples: "Login to admin portal and check dashboard", "Extract user list from page".
        Returns execution result with findings and evidence citations.`,
      func: async (goal) => {
        try {
          const result = await this.execute(goal);
          
          // Format result for LangChain
          return JSON.stringify({
            success: true,
            summary: result.summary,
            findings: result.findings || [],
            evidence: result.evidence || {},
            trust_score: result.trust_score || 0
          }, null, 2);
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error.message,
            recoverable: error.recoverable || false
          }, null, 2);
        }
      }
    };
  }
}

/**
 * Create Sentinel Override tool for LangChain
 * 
 * @param {object} config - Configuration
 * @returns {object} LangChain Tool
 */
function createSentinelTool(config = {}) {
  const tool = new SentinelLangChainTool(config);
  return tool.toLangChainTool();
}

// Example usage for Python/LangChain interop
/**
 * Python usage example:
 * 
 * ```python
 * from langchain.agents import AgentExecutor
 * from langchain.tools import Tool
 * 
 * # Sentinel Override tool (via HTTP bridge)
 * sentinel_tool = Tool(
 *     name="sentinel_browser",
 *     description="Execute browser automation with vision AI. Input: goal string.",
 *     func=lambda goal: sentinel_execute(goal)
 * )
 * 
 * def sentinel_execute(goal):
 *     # Make request to UAP server via HTTP
 *     response = requests.post(
 *         'http://localhost:8000/api/execute',
 *         json={
 *             'goal': goal,
 *             'context': {'tenant': 'acme.onmicrosoft.com'}
 *         },
 *         headers={'Authorization': f'Bearer {API_TOKEN}'}
 *     )
 *     return response.json()
 * 
 * agent = AgentExecutor.from_agent_and_tools(
 *     agent=llm_agent,
 *     tools=[sentinel_tool, search_tool, calculator],
 *     verbose=True
 * )
 * 
 * result = agent.invoke({
 *     "input": "Investigate the Entra sign-in logs and report anomalies"
 * })
 * ```
 */

export { SentinelLangChainTool, createSentinelTool };
