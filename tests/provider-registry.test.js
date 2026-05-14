// tests/provider-registry.test.js
// Unit tests for background/provider-registry.js pure functions.
// resolveProvider, detectProviderFromEndpoint, getModelSupportsVision have no chrome.* deps.

import {
  PROVIDERS,
  resolveProvider,
  detectProviderFromEndpoint,
  getModelSupportsVision,
  getCatalogProvider,
  PROVIDER_CATALOG,
} from '../background/provider-registry.js';

// ========== resolveProvider ==========

describe('resolveProvider', () => {
  test('returns anthropic provider for api.anthropic.com endpoint', () => {
    const provider = resolveProvider('https://api.anthropic.com/v1/messages');
    expect(provider.id).toBe('anthropic');
  });

  test('returns openai provider for api.openai.com endpoint', () => {
    const provider = resolveProvider('https://api.openai.com/v1/chat/completions');
    expect(provider.id).toBe('openai');
  });

  test('returns openai for OpenRouter endpoint (not api.anthropic.com)', () => {
    const provider = resolveProvider('https://openrouter.ai/api/v1/chat/completions');
    expect(provider.id).toBe('openai');
  });

  test('returns openai for local Ollama endpoint', () => {
    const provider = resolveProvider('http://localhost:11434/v1/chat/completions');
    expect(provider.id).toBe('openai');
  });

  test('returns openai for null endpoint', () => {
    const provider = resolveProvider(null);
    expect(provider.id).toBe('openai');
  });

  test('returns openai for empty string endpoint', () => {
    const provider = resolveProvider('');
    expect(provider.id).toBe('openai');
  });
});

// ========== detectProviderFromEndpoint ==========

describe('detectProviderFromEndpoint', () => {
  test('detects anthropic', () => {
    expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages')).toBe('anthropic');
  });

  test('detects openai for non-anthropic endpoints', () => {
    expect(detectProviderFromEndpoint('https://api.openai.com/v1/chat/completions')).toBe('openai');
    expect(detectProviderFromEndpoint('https://openrouter.ai/api/v1/chat/completions')).toBe('openai');
    expect(detectProviderFromEndpoint('http://localhost:11434/v1/chat/completions')).toBe('openai');
  });

  test('detects openai for null', () => {
    expect(detectProviderFromEndpoint(null)).toBe('openai');
  });
});

// ========== getModelSupportsVision ==========

describe('getModelSupportsVision', () => {
  test('returns true for known vision models (claude)', () => {
    expect(getModelSupportsVision('anthropic', 'claude-sonnet-4-6')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-3-5-sonnet')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'claude-opus-4-6')).toBe(true);
  });

  test('returns true for known vision models (openai)', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-4o-mini')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-4-turbo')).toBe(true);
    expect(getModelSupportsVision('openai', 'gpt-5')).toBe(true);
  });

  test('returns true for known vision models (gemini)', () => {
    expect(getModelSupportsVision('google', 'gemini-2.5-flash')).toBe(true);
    expect(getModelSupportsVision('google', 'gemini-1.5-pro')).toBe(true);
  });

  test('returns false for known non-vision models', () => {
    expect(getModelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
    expect(getModelSupportsVision('anthropic', 'claude-2')).toBe(false);
    expect(getModelSupportsVision('anthropic', 'claude-instant')).toBe(false);
  });

  test('returns false for null model', () => {
    expect(getModelSupportsVision('anthropic', null)).toBe(false);
    expect(getModelSupportsVision('openai', null)).toBe(false);
  });

  test('returns false for empty model', () => {
    expect(getModelSupportsVision('anthropic', '')).toBe(false);
  });

  test('returns null for unknown provider with unknown model', () => {
    expect(getModelSupportsVision('unknown', 'some-model')).toBeNull();
  });

  test('is case-insensitive on model names', () => {
    expect(getModelSupportsVision('openai', 'GPT-4O')).toBe(true);
    expect(getModelSupportsVision('anthropic', 'CLAUDE-SONNET-4-6')).toBe(true);
  });
});

// ========== PROVIDERS object shape ==========

describe('PROVIDERS', () => {
  test('has anthropic and openai entries', () => {
    expect(PROVIDERS.anthropic).toBeDefined();
    expect(PROVIDERS.openai).toBeDefined();
  });

  test('each provider has required builder functions', () => {
    for (const [, provider] of Object.entries(PROVIDERS)) {
      expect(typeof provider.buildHeaders).toBe('function');
      expect(typeof provider.buildBody).toBe('function');
      expect(typeof provider.parseResponse).toBe('function');
      expect(typeof provider.buildVisionContent).toBe('function');
    }
  });

  test('anthropic provider supports tool use', () => {
    expect(PROVIDERS.anthropic.supportsToolUse).toBe(true);
    expect(typeof PROVIDERS.anthropic.buildBodyWithTools).toBe('function');
    expect(typeof PROVIDERS.anthropic.parseToolUseResponse).toBe('function');
  });

  test('buildHeaders returns correct content type', () => {
    const anthHeaders = PROVIDERS.anthropic.buildHeaders('test-key');
    expect(anthHeaders['Content-Type']).toBe('application/json');
    expect(anthHeaders['x-api-key']).toBe('test-key');

    const oaiHeaders = PROVIDERS.openai.buildHeaders('test-key');
    expect(oaiHeaders['Content-Type']).toBe('application/json');
    expect(oaiHeaders['Authorization']).toBe('Bearer test-key');
  });
});

// ========== getCatalogProvider ==========

describe('getCatalogProvider', () => {
  test('returns provider by id', () => {
    const openai = getCatalogProvider('openai');
    expect(openai).not.toBeNull();
    expect(openai.id).toBe('openai');
  });

  test('returns null for unknown id', () => {
    expect(getCatalogProvider('nonexistent')).toBeNull();
  });

  test('all catalog entries have required fields', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.kind).toBe('string');
      expect(typeof entry.endpoint).toBe('string');
      expect(typeof entry.auth).toBe('string');
    }
  });
});
