// Sentinel Override v3 -- Provider Registry
// Multi-provider LLM support: Anthropic and OpenAI-compatible APIs.
// Centralizes provider definitions, API format handling, and settings migration.

// ========== Provider Definitions ==========
// Each provider defines how to build headers, request bodies, parse responses,
// and handle vision (base64 image) content for its specific API format.

export const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001',

    /** Build HTTP headers for Anthropic Messages API. */
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }),

    /** Build request body for Anthropic Messages API. */
    buildBody: (model, systemPrompt, userContent, opts = {}) => ({
      model,
      max_tokens: opts.maxTokens || 8000,
      temperature: opts.temperature || 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    }),

    /** Parse Anthropic Messages API response and extract text content. */
    parseResponse: (data) => {
      const block = data.content && data.content.find(b => b.type === 'text');
      if (!block) throw new Error(`Anthropic API returned no text block: ${JSON.stringify(data).slice(0, 500)}`);
      return block.text;
    },

    /** Build vision content array for Anthropic Messages API. */
    buildVisionContent: (text, base64Image) => [
      { type: 'text', text },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } }
    ],

    /** System prompt for Anthropic provider. */
    systemPromptTweak: 'You are Sentinel Override, a precise web automation agent. Return ONLY valid JSON.'
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',

    /** Build HTTP headers for OpenAI-compatible API. */
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),

    /** Build request body for OpenAI Chat Completions API. */
    buildBody: (model, systemPrompt, userContent, opts = {}) => ({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: opts.temperature || 0.3,
      max_tokens: opts.maxTokens || 8000
    }),

    /** Parse OpenAI Chat Completions response and extract text content. */
    parseResponse: (data) => {
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error(`API returned no valid response: ${data.error?.message || JSON.stringify(data).slice(0, 500)}`);
      }
      return data.choices[0].message.content;
    },

    /** Build vision content array for OpenAI Chat Completions API. */
    buildVisionContent: (text, base64Image) => [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
    ],

    /** System prompt for OpenAI provider. */
    systemPromptTweak: 'You are Sentinel Override, a precise web automation agent. Return ONLY valid JSON.'
  }
};

// ========== Provider Resolution ==========

/**
 * Detect which provider to use based on endpoint URL.
 * Only direct api.anthropic.com calls use Anthropic format;
 * all other endpoints (including OpenRouter proxies) use OpenAI format.
 *
 * @param {string} endpoint - API endpoint URL
 * @returns {object} Provider definition from PROVIDERS
 */
export function resolveProvider(endpoint) {
  return (endpoint && endpoint.includes('api.anthropic.com'))
    ? PROVIDERS.anthropic
    : PROVIDERS.openai;
}

/**
 * Synchronous replacement for the legacy isAnthropicEndpoint function.
 * Returns 'anthropic' or 'openai'.
 *
 * @param {string} endpoint - API endpoint URL
 * @returns {string} Provider ID
 */
export function detectProviderFromEndpoint(endpoint) {
  return (endpoint && endpoint.includes('api.anthropic.com')) ? 'anthropic' : 'openai';
}

// ========== Active Provider Configuration ==========

/**
 * Read the active provider configuration from chrome.storage.local.
 * Supports both the new per-provider structure and legacy single-provider keys.
 *
 * @returns {Promise<object>} Provider config with id, endpoint, apiKey, model, etc.
 */
export async function getActiveProvider() {
  const stored = await chrome.storage.local.get(['active_provider', 'providers', 'api_endpoint', 'api_key', 'model']);

  // If new provider structure exists, use it
  if (stored.active_provider && stored.providers && stored.providers[stored.active_provider]) {
    const p = stored.providers[stored.active_provider];
    const provider = PROVIDERS[stored.active_provider] || PROVIDERS.openai;
    return {
      id: stored.active_provider,
      ...provider,
      endpoint: p.endpoint || provider.defaultEndpoint,
      apiKey: p.api_key,
      model: p.model || provider.defaultModel,
      maxTokens: p.max_tokens || 8000,
      temperature: p.temperature || 0.3
    };
  }

  // Fallback to legacy single-provider keys
  const endpoint = stored.api_endpoint || '';
  const apiKey = stored.api_key || '';
  const model = stored.model || '';
  const provider = resolveProvider(endpoint);
  return {
    id: provider.id,
    ...provider,
    endpoint: endpoint || provider.defaultEndpoint,
    apiKey,
    model: model || provider.defaultModel,
    maxTokens: 8000,
    temperature: 0.3
  };
}

// ========== Legacy Settings Migration ==========

/**
 * Migrate legacy single-provider settings (api_endpoint, api_key, model)
 * to the new per-provider structure (active_provider, providers).
 * Removes old keys after migration to prevent stale data confusion.
 *
 * This is idempotent: if the new structure already exists, it does nothing.
 */
export async function migrateLegacySettings() {
  const stored = await chrome.storage.local.get(['providers', 'api_endpoint', 'api_key', 'model']);
  if (stored.providers) return; // already migrated

  const endpoint = stored.api_endpoint || '';
  const apiKey = stored.api_key || '';
  const model = stored.model || '';
  const providerId = endpoint.includes('api.anthropic.com') ? 'anthropic' : 'openai';
  const providerDefaults = PROVIDERS[providerId];

  await chrome.storage.local.set({
    active_provider: providerId,
    providers: {
      anthropic: {
        api_key: providerId === 'anthropic' ? apiKey : '',
        model: 'claude-haiku-4-5-20251001',
        endpoint: 'https://api.anthropic.com/v1/messages',
        max_tokens: 8000,
        temperature: 0.3
      },
      openai: {
        api_key: providerId === 'openai' ? apiKey : '',
        model: model || 'gpt-4o',
        endpoint: endpoint || 'https://api.openai.com/v1/chat/completions',
        max_tokens: 8000,
        temperature: 0.3
      }
    }
  });

  // CRITICAL: Remove old keys so stale values cannot cause confusion
  // callLLM() and other readers now use getActiveProvider() which reads the new structure
  await chrome.storage.local.remove(['api_endpoint', 'api_key', 'model']);
}
