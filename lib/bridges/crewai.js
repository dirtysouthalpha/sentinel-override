/**
 * CrewAI Bridge for Sentinel Override
 *
 * Integrates Sentinel Override as a CrewAI tool for multi-agent workflows.
 *
 * @version 10.0.0
 * @module lib/bridges/crewai
 */

/**
 * Sentinel Override Tool for CrewAI
 */
class SentinelCrewAITool {
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
   * Execute browser automation task
   * 
   * @param {string} task - The task description
   * @param {object} context - Task context
   * @returns {Promise<object>} Task result
   */
  async execute(task, context = {}) {
    if (!this.connected) {
      await this.init();
    }

    console.log('[CrewAI] Executing task:', task);

    const result = await this.uapClient.execute(task, {
      context,
      onComplete: (result, metrics) => {
        console.log('[CrewAI] Task complete:', result.summary);
        console.log('[CrewAI] Trust score:', metrics.trust_score);
      }
    });

    return result;
  }

  /**
   * Convert to CrewAI Tool format
   */
  toCrewAITool() {
    return {
      name: 'sentinel_browser',
      description: `Vision-powered browser automation agent. 
        Capabilities:
        - Navigate to URLs and analyze pages
        - Click elements, type text, fill forms
        - Extract data and generate reports
        - Multi-portal investigations (M365, AWS, etc.)
        
        Input: Clear task description of what to do in the browser.
        Output: Structured result with findings and evidence citations.`,
      parameters: {
        task: {
          type: 'string',
          description: 'The browser automation task to execute'
        },
        tenant: {
          type: 'string',
          description: 'Optional tenant for M365 work (e.g., acme.onmicrosoft.com)',
          required: false
        },
        budget: {
          type: 'number',
          description: 'Maximum steps to execute (default: 100)',
          required: false
        }
      },
      
      func: async function(task, tenant = null, budget = 100) {
        try {
          const context = {};
          if (tenant) context.tenant = tenant;
          if (budget) context.budget = budget;

          const result = await this.execute(task, context);

          return {
            success: true,
            summary: result.summary,
            findings: result.findings || [],
            evidence: result.evidence || {},
            trust_score: result.trust_score || 0,
            metadata: {
              steps: result.stepCount || 0,
              duration: result.duration || 0
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
            recoverable: error.recoverable || false
          };
        }
      }.bind(this)
    };
  }
}

/**
 * Create Sentinel Override tool for CrewAI
 * 
 * @param {object} config - Configuration
 * @returns {object} CrewAI Tool
 */
function createCrewAITool(config = {}) {
  const tool = new SentinelCrewAITool(config);
  return tool.toCrewAITool();
}

/**
 * Python usage example:
 * 
 * ```python
 * from crewai import Agent, Task, Crew
 * from sentinel_crewai import create_sentinel_tool
 * 
 * # Create Sentinel browser tool
 * sentinel_tool = create_sentinel_tool({
 *     'server_url': 'ws://localhost:8765/uap',
 *     'auth_token': os.getenv('SENTINEL_TOKEN')
 * })
 * 
 * # Define agents with browser capabilities
 * researcher = Agent(
 *     role='Web Researcher',
 *     goal='Gather intelligence from web portals',
 *     tools=[sentinel_tool, search_tool],
 *     llm=llm,
 *     backstory='Expert in extracting structured data from web applications'
 * )
 * 
 * analyst = Agent(
 *     role='Data Analyst',
 *     goal='Analyze findings and generate reports',
 *     tools=[sentinel_tool, analysis_tool],
 *     llm=llm,
 *     backstory='Skilled at identifying patterns in web data'
 * )
 * 
 * # Define tasks
 * investigation = Task(
 *     description='Investigate the admin portal and extract all user accounts',
 *     agent=researcher,
 *     expected_output='Structured list of users with roles and permissions'
 * )
 * 
 * analysis = Task(
 *     description='Analyze user list for security anomalies',
 *     agent=analyst,
 *     expected_output='Report identifying suspicious accounts or patterns'
 * )
 * 
 * # Create crew and execute
 * crew = Crew(
 *     agents=[researcher, analyst],
 *     tasks=[investigation, analysis],
 *     verbose=True
 * )
 * 
 * result = crew.kickoff()
 * print(result)
 * ```
 */

export { SentinelCrewAITool, createCrewAITool };
