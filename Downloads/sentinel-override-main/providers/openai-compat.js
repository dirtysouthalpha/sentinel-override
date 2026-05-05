// OpenAI-Compatible Provider — works with z.ai, OpenRouter, Venice, Poolside, MiMo, and any /v1/chat/completions endpoint

import { BaseProvider } from './base-provider.js';

export class OpenAICompatProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.subProvider = config.subProvider || this._detectSub(config.endpoint);
  }

  get name() { return this.subProvider || 'openai-compat'; }

  detect(endpoint) {
    if (!endpoint) return false;
    const e = endpoint.toLowerCase();
    return e.includes('z.ai') ||
           e.includes('openrouter.ai') ||
           e.includes('venice.ai') ||
           e.includes('poolside.ai') ||
           e.includes('mimo.xiaomi.com') ||
           e.includes('/v1/chat/completions');
  }

  getDefaultEndpoint() { return 'https://api.z.ai/v1/chat/completions'; }
  getDefaultModel() { return 'zai-org-glm-4.7-flash'; }

  getModels() {
    if (this.subProvider === 'venice') return this._veniceModels();
    if (this.subProvider === 'openrouter') return this._openrouterModels();
    if (this.subProvider === 'poolside') return this._poolsideModels();
    if (this.subProvider === 'mimo') return this._mimoModels();
    return this._zaiModels();
  }

  getRateTable() {
    if (this.subProvider === 'venice') return this._veniceRates();
    if (this.subProvider === 'openrouter') return this._openrouterRates();
    if (this.subProvider === 'poolside') return this._poolsideRates();
    if (this.subProvider === 'mimo') return this._mimoRates();
    return this._zaiRates();
  }

  _detectSub(endpoint) {
    if (!endpoint) return 'zai';
    const e = endpoint.toLowerCase();
    if (e.includes('venice.ai')) return 'venice';
    if (e.includes('openrouter.ai')) return 'openrouter';
    if (e.includes('poolside.ai')) return 'poolside';
    if (e.includes('mimo.xiaomi.com')) return 'mimo';
    return 'zai';
  }

  async chat(messages, opts = {}) {
    const endpoint = this._sanitizeEndpoint(this.endpoint);
    const apiKey = this._sanitizeKey(this.apiKey);
    const model = opts.model || this.model || this.getDefaultModel();

    if (!apiKey) throw new Error('API key not configured');

    this._validateModel(model);

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    };
    if (this.subProvider === 'zai') {
      headers['User-Agent'] = 'Mozilla/5.0 (Chrome Extension)';
    }
    if (this.subProvider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://sentineloverride.com';
      headers['X-Title'] = 'Sentinel Override';
    }

    const resp = await this._fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.max_tokens || 1024,
        temperature: opts.temperature ?? 0.3
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 401) throw new Error('API Authentication Failed (401) — check your API key');
      throw new Error('API Error: ' + resp.status + ' — ' + errText.substring(0, 200));
    }

    const data = await resp.json();
    return {
      content: this._parseContent(data),
      usage: this._parseUsage(data)
    };
  }

  async chatWithVision(textPrompt, base64Image, opts = {}) {
    const messages = [
      ...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
      {
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64Image } }
        ]
      }
    ];
    return this.chat(messages, { ...opts, max_tokens: opts.max_tokens || 500 });
  }

  _parseContent(data) {
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid API response structure');
    }
    return data.choices[0].message.content;
  }

  _validateModel(model) {
    if (this.subProvider === 'venice') {
      const allowed = this._veniceModels().map(m => m.id);
      if (!allowed.includes(model)) {
        throw new Error('Model "' + model + '" not in Venice whitelist. Allowed: ' + allowed.join(', '));
      }
    }
  }

  // --- Model Lists ---

  _zaiModels() {
    return [
      { id: 'zai-org-glm-4.7-flash', name: 'GLM-4.7 Flash', tier: 'fast' },
      { id: 'zai-org-glm-5.1', name: 'GLM-5.1', tier: 'quality' },
      { id: 'zai-org-glm-4.7', name: 'GLM-4.7', tier: 'balanced' }
    ];
  }
  _zaiRates() {
    return {
      'zai-org-glm-4.7-flash': { input: 0.13, output: 0.50 },
      'zai-org-glm-5.1': { input: 0.50, output: 2.00 },
      'zai-org-glm-4.7': { input: 0.30, output: 1.00 }
    };
  }

  _veniceModels() {
    return [
      { id: 'gemma-4-uncensored', name: 'Gemma 4 Uncensored', tier: 'fast' },
      { id: 'grok-41-fast', name: 'Grok 41 Fast', tier: 'fast' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tier: 'fast' },
      { id: 'google-gemma-4-31b-it', name: 'Gemma 4 31B', tier: 'balanced' },
      { id: 'google-gemma-3-27b-it', name: 'Gemma 3 27B', tier: 'balanced' },
      { id: 'mistral-small-3-2-24b-instruct', name: 'Mistral Small 3', tier: 'balanced' },
      { id: 'qwen3-5-9b', name: 'Qwen 3.5 9B', tier: 'fast' },
      { id: 'zai-org-glm-4.7-flash', name: 'GLM-4.7 Flash', tier: 'fast' },
      { id: 'openai-gpt-oss-120b', name: 'GPT OSS 120B', tier: 'balanced' },
      { id: 'nvidia-nemotron-3-nano-30b-a3b', name: 'Nemotron 3 Nano', tier: 'balanced' },
      { id: 'e2ee-qwen-2-5-7b-p', name: 'E2EE Qwen 2.5 7B', tier: 'fast' },
      { id: 'e2ee-gpt-oss-20b-p', name: 'E2EE GPT OSS 20B', tier: 'balanced' },
      { id: 'google-gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B', tier: 'balanced' }
    ];
  }
  _veniceRates() {
    return {
      'gemma-4-uncensored': { input: 0.16, output: 0.50 },
      'grok-41-fast': { input: 0.23, output: 0.57 },
      'google-gemma-4-31b-it': { input: 0.17, output: 0.50 },
      'google-gemma-4-26b-a4b-it': { input: 0.16, output: 0.50 },
      'deepseek-v4-flash': { input: 0.17, output: 0.35 },
      'google-gemma-3-27b-it': { input: 0.12, output: 0.20 },
      'mistral-small-3-2-24b-instruct': { input: 0.09, output: 0.25 },
      'qwen3-5-9b': { input: 0.10, output: 0.15 },
      'e2ee-qwen-2-5-7b-p': { input: 0.05, output: 0.13 },
      'e2ee-gpt-oss-20b-p': { input: 0.05, output: 0.19 },
      'openai-gpt-oss-120b': { input: 0.07, output: 0.30 },
      'nvidia-nemotron-3-nano-30b-a3b': { input: 0.07, output: 0.30 },
      'zai-org-glm-4.7-flash': { input: 0.13, output: 0.50 }
    };
  }

  _openrouterModels() {
    return [
      { id: 'mistralai/mistral-7b-instruct-v0.2', name: 'Mistral 7B', tier: 'fast' },
      { id: 'meta-llama/llama-3.2-1b-instruct', name: 'Llama 3.2 1B', tier: 'fast' },
      { id: 'cohere/command-r-plus', name: 'Command R+', tier: 'balanced' },
      { id: 'anthropic/claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6', tier: 'quality' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', tier: 'balanced' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'balanced' }
    ];
  }
  _openrouterRates() {
    return {
      'mistralai/mistral-7b-instruct-v0.2': { input: 0.10, output: 0.10 },
      'meta-llama/llama-3.2-1b-instruct': { input: 0.06, output: 0.06 },
      'cohere/command-r-plus': { input: 0.25, output: 0.25 },
      'anthropic/claude-sonnet-4-6-20250514': { input: 3.00, output: 15.00 },
      'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
      'google/gemini-2.5-flash': { input: 0.15, output: 0.60 }
    };
  }

  _poolsideModels() {
    return [
      { id: 'poolside/mistral-small-3-24b-instruct', name: 'Poolside Mistral Small', tier: 'fast' },
      { id: 'poolside/llama-3.3-70b-instruct', name: 'Poolside Llama 3.3 70B', tier: 'balanced' },
      { id: 'poolside/qwen2.5-72b-instruct', name: 'Poolside Qwen 2.5 72B', tier: 'balanced' },
      { id: 'poolside/gemma-3-27b-instruct', name: 'Poolside Gemma 3 27B', tier: 'fast' },
      { id: 'poolside/phi-4', name: 'Poolside Phi-4', tier: 'fast' }
    ];
  }
  _poolsideRates() {
    return {
      'poolside/mistral-small-3-24b-instruct': { input: 0.10, output: 0.10 },
      'poolside/llama-3.3-70b-instruct': { input: 0.15, output: 0.15 },
      'poolside/qwen2.5-72b-instruct': { input: 0.12, output: 0.12 },
      'poolside/gemma-3-27b-instruct': { input: 0.08, output: 0.08 },
      'poolside/phi-4': { input: 0.10, output: 0.10 }
    };
  }

  _mimoModels() {
    return [
      { id: 'MiMo-V2.5', name: 'MiMo V2.5', tier: 'balanced' },
      { id: 'MiMo-V2.5-Pro', name: 'MiMo V2.5 Pro', tier: 'quality' }
    ];
  }
  _mimoRates() {
    return {
      'MiMo-V2.5': { input: 0.10, output: 0.30 },
      'MiMo-V2.5-Pro': { input: 0.20, output: 0.60 }
    };
  }
}
