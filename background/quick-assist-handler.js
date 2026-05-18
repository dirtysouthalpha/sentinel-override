// background/quick-assist-handler.js
// Quick Assist LLM handler — single completion call, no agent loop.
// Reuses the provider registry for endpoint/auth detection.

import { getActiveProvider, resolveProvider } from './provider-registry.js';

/**
 * Call the active LLM provider with a simple completion prompt.
 * Returns the response text string.
 */
export async function handleQuickAssist(prompt, pageInfo) {
  const providerConfig = await getActiveProvider();
  if (!providerConfig) {
    throw new Error('No provider configured. Open Sentinel settings to set one up.');
  }
  const { endpoint, apiKey, model } = providerConfig;
  if (!apiKey) {
    throw new Error('API key not configured. Open Sentinel settings.');
  }

  const provider = resolveProvider(endpoint);
  const isAnthropic = provider && provider.id === 'anthropic';

  let url = endpoint;
  let headers = { 'Content-Type': 'application/json' };
  let body;

  if (isAnthropic) {
    // Anthropic format
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    if (!url.includes('/messages')) {
      url = url.replace(/\/+$/, '') + '/messages';
    }
    body = JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });
  } else {
    // OpenAI-compatible (Z.AI, OpenAI, etc.)
    headers['Authorization'] = 'Bearer ' + apiKey;
    if (!url.includes('/chat/completions')) {
      url = url.replace(/\/+$/, '') + '/chat/completions';
    }
    body = JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });
  }

  const response = await fetch(url, { method: 'POST', headers, body });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LLM ${response.status}: ${text.substring(0, 200)}`);
  }

  const data = await response.json();

  // Parse response based on provider format
  if (isAnthropic) {
    return data.content?.[0]?.text || data.completion || '[no response]';
  } else {
    return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '[no response]';
  }
}
