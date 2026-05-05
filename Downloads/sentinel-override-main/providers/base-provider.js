// Base Provider — abstract interface for all LLM providers
// Each provider must implement: chat(), chatWithVision(), detect(), getModels()

export class BaseProvider {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || '';
    this.endpoint = config.endpoint || '';
    this.timeout = config.timeout || 60000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 5000;
  }

  get name() { return 'base'; }

  detect(endpoint) { return false; }

  getModels() { return []; }

  getRateTable() { return {}; }

  getDefaultModel() { return ''; }

  getDefaultEndpoint() { return ''; }

  // Simple text chat — returns string response
  async chat(messages, opts = {}) {
    throw new Error('chat() not implemented');
  }

  // Vision chat — returns string response (for agent loop)
  async chatWithVision(textPrompt, base64Image, opts = {}) {
    throw new Error('chatWithVision() not implemented');
  }

  // Shared helpers
  async _fetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('API request timed out');
      throw new Error('Network error: ' + err.message);
    }
  }

  _sanitizeKey(key) {
    if (!key) return '';
    return String(key).replace(/\s+/g, '').replace(/[^\x20-\x7E]/g, '');
  }

  _sanitizeEndpoint(url) {
    if (!url) return this.getDefaultEndpoint();
    return String(url).replace(/[\s\n\r\t]/g, '').replace(/[^\x20-\x7E]/g, '');
  }

  // Parse response based on provider format
  _parseContent(data) {
    throw new Error('_parseContent() not implemented');
  }

  _parseUsage(data) {
    return {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0
    };
  }

  // Build vision content block based on provider format
  _buildVisionContent(text, base64Image) {
    throw new Error('_buildVisionContent() not implemented');
  }

  // Calculate cost for a call
  calculateCost(model, inputTokens, outputTokens) {
    const rates = this.getRateTable()[model];
    if (!rates) return 0;
    return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  }
}
