// Anthropic Claude Provider — native Messages API (/v1/messages)

import { BaseProvider } from './base-provider.js';

export class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
  }

  get name() { return 'anthropic'; }

  detect(endpoint) {
    if (!endpoint) return false;
    const e = endpoint.toLowerCase();
    return e.includes('anthropic.com') ||
           e.includes('anthropic') ||
           (e.includes('/v1/messages') && !e.includes('openai'));
  }

  getDefaultEndpoint() { return 'https://api.anthropic.com/v1/messages'; }
  getDefaultModel() { return 'claude-sonnet-4-6-20250514'; }

  getModels() {
    return [
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'fast' },
      { id: 'claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6', tier: 'balanced' },
      { id: 'claude-opus-4-7-20250605', name: 'Claude Opus 4.7', tier: 'quality' }
    ];
  }

  getRateTable() {
    return {
      'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
      'claude-sonnet-4-6-20250514': { input: 3.00, output: 15.00 },
      'claude-opus-4-7-20250605': { input: 15.00, output: 75.00 }
    };
  }

  async chat(messages, opts = {}) {
    const endpoint = this._sanitizeEndpoint(this.endpoint);
    const apiKey = this._sanitizeKey(this.apiKey);
    const model = opts.model || this.model || this.getDefaultModel();

    if (!apiKey) throw new Error('API key not configured');

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    // Anthropic uses separate system prompt, not in messages array
    let systemPrompt = opts.systemPrompt || '';
    const filteredMessages = messages.filter(m => {
      if (m.role === 'system') {
        systemPrompt = systemPrompt || m.content;
        return false;
      }
      return true;
    });

    const body = {
      model,
      max_tokens: opts.max_tokens || 1024,
      messages: filteredMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : { temperature: 0.3 })
    };

    const resp = await this._fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 401) throw new Error('Anthropic API Authentication Failed (401) — check your API key');
      if (resp.status === 429) throw new Error('Anthropic rate limit hit (429) — slow down or upgrade plan');
      if (resp.status === 529) throw new Error('Anthropic overloaded (529) — retry in a moment');
      throw new Error('Anthropic API Error: ' + resp.status + ' — ' + errText.substring(0, 200));
    }

    const data = await resp.json();
    return {
      content: this._parseContent(data),
      usage: this._parseUsage(data)
    };
  }

  async chatWithVision(textPrompt, base64Image, opts = {}) {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          }
        ]
      }
    ];
    return this.chat(messages, { ...opts, max_tokens: opts.max_tokens || 500 });
  }

  _parseContent(data) {
    if (!data.content || !data.content[0]) {
      throw new Error('Invalid Anthropic response structure');
    }
    // Anthropic returns content blocks — find the text one
    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text content in Anthropic response');
    return textBlock.text;
  }

  _parseUsage(data) {
    return {
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0
    };
  }
}
