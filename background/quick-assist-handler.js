/**
 * Sentinel Override v3.46.0 — Quick Assist LLM Handler
 * Handles single-shot LLM completion requests from the Quick Assist panel.
 * No agent loop, no tools — just a direct prompt → response call.
 */

import { getActiveProvider, resolveProvider } from './provider-registry.js';

/**
 * Build and send a single chat completion request for Quick Assist.
 * Reuses the provider registry's format detection (Anthropic vs OpenAI-compatible).
 *
 * @param {string} prompt - The fully constructed prompt (system instruction + page context + selected text)
 * @returns {Promise<string>} The LLM response text
 */
export async function handleQuickAssist(prompt) {
  const config = await getActiveProvider();

  if (!config.apiKey) {
    throw new Error('No API key configured. Open Sentinel Override settings to set up an LLM provider.');
  }

  const provider = resolveProvider(config.endpoint);
  const headers = provider.buildHeaders(config.apiKey);

  // Build the request body. For Quick Assist we want a simple single-turn
  // completion — no system prompt separation needed since the prompt already
  // contains the system instruction as part of the user message.
  let body;

  if (config.id === 'anthropic') {
    // Anthropic uses system field + messages array
    const systemPart = prompt.split('\n---\n')[0] || prompt.substring(0, 500);
    const userPart = prompt.includes('\n---\n') ? prompt.split('\n---\n').slice(1).join('\n---\n') : prompt;
    body = {
      model: config.model,
      max_tokens: 2000,
      temperature: 0.3,
      system: [{ type: 'text', text: 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Be concise, actionable, and professional.' }],
      messages: [{ role: 'user', content: userPart || prompt }]
    };
  } else {
    // OpenAI-compatible: system message + user message
    body = {
      model: config.model,
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Be concise, actionable, and professional.' },
        { role: 'user', content: prompt }
      ]
    };
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  return provider.parseResponse(data);
}
