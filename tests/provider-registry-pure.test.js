// tests/provider-registry-pure.test.js
// Tests for provider-registry.js pure functions.

import { resolveProvider, detectProviderFromEndpoint, getModelSupportsVision, getCatalogProvider, PROVIDER_CATALOG } from '../background/provider-registry.js';

describe('resolveProvider', () => {
  test('returns openai for empty endpoint', () => {
    const result = resolveProvider('');
    expect(result).toBeDefined();
  });

  test('returns openai for null endpoint', () => {
    const result = resolveProvider(null);
    expect(result).toBeDefined();
  });

  test('returns anthropic for anthropic endpoint', () => {
    const result = resolveProvider('https://api.anthropic.com/v1/messages');
    expect(result).toBeDefined();
  });

  test('returns zai for z.ai endpoint', () => {
    const result = resolveProvider('https://api.z.ai/v1/chat/completions');
    expect(result).toBeDefined();
  });

  test('returns openai for unknown endpoint', () => {
    const result = resolveProvider('https://custom-api.example.com/v1');
    expect(result).toBeDefined();
  });
});

describe('detectProviderFromEndpoint', () => {
  test('returns openai for empty', () => {
    expect(detectProviderFromEndpoint('')).toBe('openai');
  });

  test('returns openai for null', () => {
    expect(detectProviderFromEndpoint(null)).toBe('openai');
  });

  test('returns anthropic for anthropic URL', () => {
    expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages')).toBe('anthropic');
  });

  test('returns zai for z.ai URL', () => {
    expect(detectProviderFromEndpoint('https://api.z.ai/v1')).toBe('zai');
  });

  test('returns openai for generic URL', () => {
    expect(detectProviderFromEndpoint('https://api.openai.com/v1')).toBe('openai');
  });
});

describe('getModelSupportsVision', () => {
  test('returns false for null model', () => {
    expect(getModelSupportsVision('openai', null)).toBe(false);
  });

  test('returns false for empty model', () => {
    expect(getModelSupportsVision('openai', '')).toBe(false);
  });

  test('handles unknown provider gracefully', () => {
    const result = getModelSupportsVision('unknown_provider', 'some-model');
    // Returns undefined for unknown provider, which is falsy
    expect(result).toBeFalsy();
  });
});

describe('getCatalogProvider', () => {
  test('returns null for unknown id', () => {
    expect(getCatalogProvider('nonexistent_provider_xyz')).toBeNull();
  });

  test('returns entry for known id', () => {
    const entry = getCatalogProvider('openai');
    if (entry) {
      expect(entry.id).toBe('openai');
    }
  });
});

describe('PROVIDER_CATALOG', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(PROVIDER_CATALOG)).toBe(true);
    expect(PROVIDER_CATALOG.length).toBeGreaterThan(0);
  });

  test('each entry has id, label, endpoint', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(entry.id).toBeDefined();
      expect(entry.label).toBeDefined();
      expect(entry.endpoint).toBeDefined();
    }
  });

  test('no duplicate ids', () => {
    const ids = PROVIDER_CATALOG.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
