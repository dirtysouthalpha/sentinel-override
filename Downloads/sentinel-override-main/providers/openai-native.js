// OpenAI Native Provider — direct OpenAI API with proper model routing

import { BaseProvider } from './base-provider.js';

export class OpenAINativeProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
  }

  get name() { return 'openai'; }

  detect(endpoint) {
    if (!endpoint) return false;
    const e = endpoint.toLowerCase();
    return e.includes('api.openai.com') ||
           (e.includes('openai.com/v1') && !e.includes('openrouter'));
  }

  getDefaultEndpoint() { return 'https://api.openai.com/v1/chat/completions'; }
  getDefaultModel() { return 'gpt-4o'; }

  getModels() {
    return [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'fast' },
      { id: 'gpt-4o', name: 'GPT-4o', tier: 'balanced' },
      { id: 'gpt-4.1', name: 'GPT-4.1', tier: 'balanced' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', tier: 'fast' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', tier: 'fast' },
      { id: 'o3-mini', name: 'o3 Mini', tier: 'balanced' },
      { id: 'o4-mini', name: 'o4 Mini', tier: 'balanced' }
    ];
  }

  getRateTable() {
    return {
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4.1': { input: 2.00, output: 8.00 },
      'gpt-4.1-mini': { input: 0.40, output: 1.60 },
      'gpt-4.1-nano': { input: 0.10, output: 0.40 },
      'o3-mini': { input: 1.10, output: 4.40 },
      'o4-mini': { input: 1.10, output: 4.40 }
    };
  }

  async chat(messages, opts = {}) {
    const endpoint = this._sanitizeEndpoint(this.endpoint);
    const apiKey = this._sanitizeKey(this.apiKey);
    const model = opts.model || this.model || this.getDefaultModel();

    if (!apiKey) throw new Error('API key not configured');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    };

    // Reasoning models (o3-mini, o4-mini) don't support system messages the same way
    const isReasoning = model.startsWith('o3') || model.startsWith('o4');

    const body = {
      model,
      messages,
      max_tokens: opts.max_tokens || 1024,
      temperature: opts.temperature ?? 0.3
    };

    // Reasoning models use max_completion_tokens instead and don't support temperature
    if (isReasoning) {
      delete body.max_tokens;
      delete body.temperature;
      body.max_completion_tokens = opts.max_tokens || 1024;
    }

    const resp = await this._fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 401) throw new Error('OpenAI API Authentication Failed (401) — check your API key');
      if (resp.status === 429) throw new Error('OpenAI rate limit hit (429) — slow down or upgrade plan');
      if (resp.status === 404) throw new Error('OpenAI model not found (404) — check model name: ' + model);
      throw new Error('OpenAI API Error: ' + resp.status + ' — ' + errText.substring(0, 200));
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
      throw new Error('Invalid OpenAI response structure');
    }
    return data.choices[0].message.content;
  }
}
