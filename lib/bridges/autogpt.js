/**
 * AutoGPT Bridge for Sentinel Override
 * 
 * Integrates Sentinel Override as an AutoGPT command for browser operations.
 * 
 * @version 10.0.0
 * @module lib/bridges/autogpt
 */

/**
 * Sentinel Override Command for AutoGPT
 */
class SentinelAutoGPTCommand {
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
   * Execute browser command
   * 
   * @param {string} command - The command to execute
   * @param {object} params - Command parameters
   * @returns {Promise<object>} Execution result
   */
  async execute(command, params = {}) {
    if (!this.connected) {
      await this.init();
    }

    console.log('[AutoGPT] Executing:', command);

    switch (command) {
      case 'browse':
        return this.browse(params.url, params.goal);
      
      case 'click':
        return this.click(params.element);
      
      case 'type':
        return this.type(params.element, params.text);
      
      case 'read_page':
        return this.readPage(params.url);
      
      case 'extract_data':
        return this.extractData(params.pattern);
      
      case 'screenshot':
        return this.screenshot();
      
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  /**
   * Browse to URL and execute goal
   */
  async browse(url, goal = 'Analyze page content') {
    const fullGoal = `Navigate to ${url} and ${goal}`;
    return this.uapClient.execute(fullGoal);
  }

  /**
   * Click element
   */
  async click(element) {
    const goal = `Click on the ${element}`;
    return this.uapClient.execute(goal);
  }

  /**
   * Type text into element
   */
  async type(element, text) {
    const goal = `Type "${text}" into the ${element}`;
    return this.uapClient.execute(goal);
  }

  /**
   * Read page content
   */
  async readPage(url) {
    const goal = `Navigate to ${url} and read all visible content`;
    return this.uapClient.execute(goal);
  }

  /**
   * Extract data matching pattern
   */
  async extractData(pattern) {
    const goal = `Extract all ${pattern} from the current page`;
    return this.uapClient.execute(goal);
  }

  /**
   * Take screenshot
   */
  async screenshot() {
    const goal = 'Take a screenshot of the current page';
    return this.uapClient.execute(goal);
  }
}

/**
 * Convert to AutoGPT command format
 */
function createAutoGPTCommand(config = {}) {
  const cmd = new SentinelAutoGPTCommand(config);
  
  return {
    name: 'sentinel_browser',
    description: 'Execute browser automation operations with vision AI',
    commands: ['browse', 'click', 'type', 'read_page', 'extract_data', 'screenshot'],
    
    async execute(params) {
      try {
        await cmd.init();
        const result = await cmd.execute(params.command, params);
        return {
          success: true,
          data: result
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Python usage example:
 * 
 * ```python
 * from autogpt.agent import Agent
 * from sentinel_bridge import SentinelCommand
 * 
 * # Create Sentinel browser command
 * sentinel_cmd = SentinelCommand(
 *     server_url='ws://localhost:8765/uap',
 *     auth_token=os.getenv('SENTINEL_TOKEN')
 * )
 * 
 * agent = Agent(
 *     commands=[sentinel_cmd],
 *     config={
 *         'browser_automation': 'enabled'
 *     }
 * )
 * 
 * # Agent can now use browser
 * agent.run('Navigate to admin portal and extract user list')
 * ```
 */

export { SentinelAutoGPTCommand, createAutoGPTCommand };
