// Provider Factory — auto-detects and instantiates the correct provider

import { OpenAICompatProvider } from './openai-compat.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAINativeProvider } from './openai-native.js';

const PROVIDERS = [
  AnthropicProvider,
  OpenAINativeProvider,
  OpenAICompatProvider  // Last — catches anything with /v1/chat/completions
];

export class ProviderFactory {
  // Detect and create provider from stored config
  static create(config = {}) {
    const endpoint = config.endpoint || '';
    const apiKey = config.apiKey || '';

    for (const ProviderClass of PROVIDERS) {
      const instance = new ProviderClass(config);
      if (instance.detect(endpoint)) {
        return instance;
      }
    }

    // Default to OpenAI-compatible if nothing matched
    return new OpenAICompatProvider(config);
  }

  // Get provider by explicit name (for settings UI)
  static getByName(name, config = {}) {
    switch (name) {
      case 'anthropic': return new AnthropicProvider(config);
      case 'openai': return new OpenAINativeProvider(config);
      case 'zai': return new OpenAICompatProvider({ ...config, subProvider: 'zai' });
      case 'openrouter': return new OpenAICompatProvider({ ...config, subProvider: 'openrouter' });
      case 'venice': return new OpenAICompatProvider({ ...config, subProvider: 'venice' });
      case 'poolside': return new OpenAICompatProvider({ ...config, subProvider: 'poolside' });
      case 'mimo': return new OpenAICompatProvider({ ...config, subProvider: 'mimo' });
      default: return new OpenAICompatProvider(config);
    }
  }

  // List all available providers for settings UI
  static listProviders() {
    return [
      { id: 'zai', name: 'z.ai', description: 'Primary provider — GLM models' },
      { id: 'anthropic', name: 'Anthropic Claude', description: 'Native Messages API — Claude models' },
      { id: 'openai', name: 'OpenAI', description: 'Native API — GPT models' },
      { id: 'openrouter', name: 'OpenRouter', description: 'Multi-model gateway' },
      { id: 'venice', name: 'Venice', description: 'Privacy-first inference' },
      { id: 'poolside', name: 'Poolside', description: 'Code-focused models' },
      { id: 'mimo', name: 'MiMo (Xiaomi)', description: 'MiMo reasoning models' }
    ];
  }

  // Auto-detect provider name from endpoint URL
  static detectProviderName(endpoint) {
    if (!endpoint) return 'zai';
    const e = endpoint.toLowerCase();
    if (e.includes('anthropic.com') || e.includes('/v1/messages')) return 'anthropic';
    if (e.includes('api.openai.com')) return 'openai';
    if (e.includes('openrouter.ai')) return 'openrouter';
    if (e.includes('venice.ai')) return 'venice';
    if (e.includes('poolside.ai')) return 'poolside';
    if (e.includes('mimo.xiaomi.com')) return 'mimo';
    if (e.includes('z.ai')) return 'zai';
    return 'openai-compat';
  }
}
