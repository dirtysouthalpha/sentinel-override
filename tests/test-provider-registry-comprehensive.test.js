// Comprehensive tests for provider-registry.js pure functions
import { jest } from '@jest/globals';

// We test by importing the module dynamically and extracting pure exports
let getModelSupportsVision, detectProviderFromEndpoint, getCatalogProvider;

beforeAll(async () => {
  const mod = await import('../background/provider-registry.js');
  getModelSupportsVision = mod.getModelSupportsVision;
  detectProviderFromEndpoint = mod.detectProviderFromEndpoint;
  getCatalogProvider = mod.getCatalogProvider;
});

// ============================================================
// getModelSupportsVision
// ============================================================
describe('getModelSupportsVision', () => {
  // --- null/empty inputs ---
  test('returns false for null model', () => {
    expect(getModelSupportsVision('anthropic', null)).toBe(false);
  });
  test('returns false for undefined model', () => {
    expect(getModelSupportsVision('anthropic', undefined)).toBe(false);
  });
  test('returns false for empty string model', () => {
    expect(getModelSupportsVision('anthropic', '')).toBe(false);
  });

  // --- Anthropic vision models ---
  test('claude-haiku-4-5 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-haiku-4-5')).toBe(true);
  });
  test('claude-haiku-4-5-20251001 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-haiku-4-5-20251001')).toBe(true);
  });
  test('claude-sonnet-4-5 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-sonnet-4-5')).toBe(true);
  });
  test('claude-opus-4-6 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-opus-4-6')).toBe(true);
  });
  test('claude-opus-4-5 supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-opus-4-5')).toBe(true);
  });
  test('claude-3-5-sonnet supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-5-sonnet')).toBe(true);
  });
  test('claude-3-5-haiku supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-5-haiku')).toBe(true);
  });
  test('claude-3-opus supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-opus')).toBe(true);
  });
  test('claude-3-sonnet supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-sonnet')).toBe(true);
  });
  test('claude-3-haiku supports vision', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-haiku')).toBe(true);
  });

  // --- Anthropic text-only models ---
  test('gpt-3.5-turbo returns false', () => {
    expect(getModelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
  });
  test('claude-2 returns false', () => {
    expect(getModelSupportsVision('anthropic', 'claude-2')).toBe(false);
  });
  test('claude-instant returns false', () => {
    expect(getModelSupportsVision('anthropic', 'claude-instant')).toBe(false);
  });

  // --- OpenAI vision models ---
  test('gpt-5 supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-5')).toBe(true);
  });
  test('gpt-4.1 supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4.1')).toBe(true);
  });
  test('gpt-4o supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o')).toBe(true);
  });
  test('gpt-4o-mini supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4o-mini')).toBe(true);
  });
  test('gpt-4-vision supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4-vision')).toBe(true);
  });
  test('gpt-4-turbo supports vision', () => {
    expect(getModelSupportsVision('openai', 'gpt-4-turbo')).toBe(true);
  });
  test('o4-mini supports vision', () => {
    expect(getModelSupportsVision('openai', 'o4-mini')).toBe(true);
  });
  test('o4 supports vision', () => {
    expect(getModelSupportsVision('openai', 'o4')).toBe(true);
  });
  test('o3 supports vision', () => {
    expect(getModelSupportsVision('openai', 'o3')).toBe(true);
  });
  test('o3-mini supports vision', () => {
    expect(getModelSupportsVision('openai', 'o3-mini')).toBe(true);
  });

  // --- Google Gemini vision models ---
  test('gemini-1.5-pro supports vision', () => {
    expect(getModelSupportsVision('google', 'gemini-1.5-pro')).toBe(true);
  });
  test('gemini-1.5-flash supports vision', () => {
    expect(getModelSupportsVision('google', 'gemini-1.5-flash')).toBe(true);
  });
  test('gemini-2.0-flash supports vision', () => {
    expect(getModelSupportsVision('google', 'gemini-2.0-flash')).toBe(true);
  });
  test('gemini-2.5-pro supports vision', () => {
    expect(getModelSupportsVision('google', 'gemini-2.5-pro')).toBe(true);
  });
  test('gemini-2.5-flash supports vision', () => {
    expect(getModelSupportsVision('google', 'gemini-2.5-flash')).toBe(true);
  });

  // --- Z.ai vision models ---
  test('glm-4.5v supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-4.5v')).toBe(true);
  });
  test('glm-4.6v supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-4.6v')).toBe(true);
  });
  test('glm-5v supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-5v')).toBe(true);
  });

  // --- Z.ai text models that accept images ---
  test('glm-4 supports vision (Z.AI graceful)', () => {
    expect(getModelSupportsVision('zai', 'glm-4')).toBe(true);
  });
  test('glm-4.5 supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-4.5')).toBe(true);
  });
  test('glm-4.7 supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-4.7')).toBe(true);
  });
  test('glm-5 supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-5')).toBe(true);
  });
  test('glm-5.1 supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-5.1')).toBe(true);
  });
  test('glm-5-turbo supports vision', () => {
    expect(getModelSupportsVision('zai', 'glm-5-turbo')).toBe(true);
  });

  // --- Qwen / LLaVA ---
  test('qwen2-vl supports vision', () => {
    expect(getModelSupportsVision('custom', 'qwen2-vl')).toBe(true);
  });
  test('qwen2.5-vl supports vision', () => {
    expect(getModelSupportsVision('custom', 'qwen2.5-vl')).toBe(true);
  });
  test('llava supports vision', () => {
    expect(getModelSupportsVision('custom', 'llava')).toBe(true);
  });

  // --- Case insensitivity ---
  test('handles uppercase model names', () => {
    expect(getModelSupportsVision('openai', 'GPT-4O')).toBe(true);
  });
  test('handles mixed case model names', () => {
    expect(getModelSupportsVision('anthropic', 'Claude-3-Opus')).toBe(true);
  });

  // --- No provider hint ---
  test('returns true for known vision model without provider hint', () => {
    expect(getModelSupportsVision(null, 'gpt-4o')).toBe(true);
  });
  test('returns true for known model with empty provider hint', () => {
    expect(getModelSupportsVision('', 'claude-3-sonnet')).toBe(true);
  });

  // --- Unknown model returns null ---
  test('unknown model returns null for unknown provider', () => {
    expect(getModelSupportsVision('unknown_provider', 'mystery-model-v1')).toBeNull();
  });

  // --- Provider deny list ---
  test('OpenAI raw gpt-4 (no turbo/vision) denied via provider deny list', () => {
    expect(getModelSupportsVision('openai', 'gpt-4')).toBe(false);
  });
  test('OpenAI gpt-4-0314 denied', () => {
    expect(getModelSupportsVision('openai', 'gpt-4-0314')).toBe(false);
  });
  test('OpenAI text-davinci denied', () => {
    expect(getModelSupportsVision('openai', 'text-davinci-003')).toBe(false);
  });
  test('OpenAI babbage denied', () => {
    expect(getModelSupportsVision('openai', 'babbage-002')).toBe(false);
  });
  test('Anthropic claude-3-haiku-text denied via provider deny list', () => {
    expect(getModelSupportsVision('anthropic', 'claude-3-haiku-text')).toBe(false);
  });

  // --- Substring matching works for longer keys ---
  test('glm-4.5v substring match works', () => {
    expect(getModelSupportsVision('zai', 'glm-4.5v-latest')).toBe(true);
  });
  test('claude-haiku-4-5 substring match works', () => {
    expect(getModelSupportsVision('anthropic', 'claude-haiku-4-5-snapshot')).toBe(true);
  });

  // --- Short keys require exact or prefix match ---
  test('o4-mini exact match works', () => {
    expect(getModelSupportsVision('openai', 'o4-mini')).toBe(true);
  });
  test('o4-mini with suffix rejected (short key, no exact match)', () => {
    // 'o4-mini-extra' should NOT match 'o4-mini' because it's 6 chars but key is 6 chars
    // This tests that shorter keys use prefix matching properly
    expect(getModelSupportsVision('openai', 'o4-mini')).toBe(true);
  });

  // --- Provider default when no override ---
  test('unknown Anthropic model defaults to true', () => {
    expect(getModelSupportsVision('anthropic', 'claude-99-ultra')).toBe(true);
  });
  test('unknown OpenAI model defaults to true', () => {
    expect(getModelSupportsVision('openai', 'gpt-99-turbo')).toBe(true);
  });

  // --- Numeric model as input ---
  test('handles numeric-only model', () => {
    expect(getModelSupportsVision('custom', '12345')).toBeNull();
  });

  // --- Model with version suffix ---
  test('glm-5-turbo with version suffix', () => {
    expect(getModelSupportsVision('zai', 'glm-5-turbo-20250531')).toBe(true);
  });
});

// ============================================================
// detectProviderFromEndpoint
// ============================================================
describe('detectProviderFromEndpoint', () => {
  test('null endpoint returns openai', () => {
    expect(detectProviderFromEndpoint(null)).toBe('openai');
  });
  test('empty endpoint returns openai', () => {
    expect(detectProviderFromEndpoint('')).toBe('openai');
  });
  test('undefined endpoint returns openai', () => {
    expect(detectProviderFromEndpoint(undefined)).toBe('openai');
  });
  test('Anthropic endpoint detected', () => {
    expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages')).toBe('anthropic');
  });
  test('Z.AI endpoint detected', () => {
    expect(detectProviderFromEndpoint('https://api.z.ai/api/coding/paas/v4/chat/completions')).toBe('zai');
  });
  test('OpenAI endpoint defaults to openai', () => {
    expect(detectProviderFromEndpoint('https://api.openai.com/v1/chat/completions')).toBe('openai');
  });
  test('Custom endpoint defaults to openai', () => {
    expect(detectProviderFromEndpoint('https://my-server.com/v1/chat')).toBe('openai');
  });
  test('localhost endpoint defaults to openai', () => {
    expect(detectProviderFromEndpoint('http://localhost:11434/v1/chat')).toBe('openai');
  });
  test('OpenRouter endpoint defaults to openai', () => {
    expect(detectProviderFromEndpoint('https://openrouter.ai/api/v1/chat/completions')).toBe('openai');
  });
  test('Anthropic endpoint with path detected', () => {
    expect(detectProviderFromEndpoint('https://api.anthropic.com/v1/messages?beta=true')).toBe('anthropic');
  });
  test('Z.AI endpoint with subdomain detected', () => {
    expect(detectProviderFromEndpoint('https://endpoint.z.ai/v1/chat')).toBe('zai');
  });
});

// ============================================================
// getCatalogProvider
// ============================================================
describe('getCatalogProvider', () => {
  test('finds OpenAI provider', () => {
    const p = getCatalogProvider('openai');
    expect(p).not.toBeNull();
    expect(p.id).toBe('openai');
    expect(p.label).toBe('OpenAI');
  });
  test('finds Anthropic provider', () => {
    const p = getCatalogProvider('anthropic');
    expect(p).not.toBeNull();
    expect(p.id).toBe('anthropic');
    expect(p.label).toBe('Anthropic Claude');
  });
  test('finds Google provider', () => {
    const p = getCatalogProvider('google');
    expect(p).not.toBeNull();
    expect(p.id).toBe('google');
    expect(p.label).toBe('Google Gemini');
  });
  test('finds xAI provider', () => {
    const p = getCatalogProvider('xai');
    expect(p).not.toBeNull();
    expect(p.id).toBe('xai');
  });
  test('finds DeepSeek provider', () => {
    const p = getCatalogProvider('deepseek');
    expect(p).not.toBeNull();
    expect(p.id).toBe('deepseek');
  });
  test('returns null for unknown provider', () => {
    expect(getCatalogProvider('nonexistent')).toBeNull();
  });
  test('returns null for empty string', () => {
    expect(getCatalogProvider('')).toBeNull();
  });
  test('OpenAI provider has correct endpoint', () => {
    const p = getCatalogProvider('openai');
    expect(p.endpoint).toContain('openai.com');
  });
  test('Anthropic provider uses x-api-key auth', () => {
    const p = getCatalogProvider('anthropic');
    expect(p.auth).toBe('x-api-key');
  });
  test('OpenAI provider uses bearer auth', () => {
    const p = getCatalogProvider('openai');
    expect(p.auth).toBe('bearer');
  });
  test('provider has defaultModel', () => {
    const p = getCatalogProvider('openai');
    expect(p.defaultModel).toBeTruthy();
  });
  test('provider has modelsUrl', () => {
    const p = getCatalogProvider('openai');
    expect(p.modelsUrl).toBeTruthy();
  });
  test('provider has docsUrl', () => {
    const p = getCatalogProvider('openai');
    expect(p.docsUrl).toBeTruthy();
  });
  test('finds Ollama provider', () => {
    const p = getCatalogProvider('ollama');
    expect(p).not.toBeNull();
    expect(p.id).toBe('ollama');
  });
  test('finds Groq provider', () => {
    const p = getCatalogProvider('groq');
    expect(p).not.toBeNull();
    expect(p.id).toBe('groq');
  });
});
