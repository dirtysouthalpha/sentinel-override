/**
 * Sentinel Override v3.46.0 — Quick Assist LLM Handler
 * Handles single-shot LLM completion requests from the Quick Assist panel.
 * No agent loop, no tools — just a direct prompt → response call.
 */

import { getActiveProvider, resolveProviderForConfig } from './provider-registry.js';
import { scrubForEgress } from './egress-scrub.js';
import { API_TIMEOUT_MS } from './constants.js';

/**
 * Build and send a single chat completion request for Quick Assist.
 * Reuses the provider registry's format detection (Anthropic vs OpenAI-compatible).
 *
 * @param {string} prompt - The fully constructed prompt (system instruction + page context + selected text)
 * @returns {Promise<string>} The LLM response text
 */
export async function handleQuickAssist(rawPrompt) {
  const config = await getActiveProvider();
  if (!config || !config.apiKey) {
    throw new Error('No API key configured. Open Sentinel Override settings to set up an LLM provider.');
  }

  // Quick Assist is a SECOND full LLM path: its prompt is page context plus the
  // technician's selected text, sent straight to the configured provider. It
  // never touched the scrubber, so every secret and every client detail the
  // agent loop was carefully masking went out unmasked through this door — the
  // Settings promise was false here in exactly the way the shouldScrub host
  // rule was false before it was fixed. Fails closed: a scrub error must not
  // fall through to sending the raw prompt.
  const prompt = await scrubForEgress(rawPrompt, {
    endpoint: config.endpoint, model: config.model, kind: 'quick-assist'
  });

  const provider = resolveProviderForConfig(config);
  const headers = provider.buildHeaders(config.apiKey);

  let body;
  if (config.id === 'anthropic') {
    const userPart = (prompt && prompt.includes('\n---\n')) ? prompt.split('\n---\n').slice(1).join('\n---\n') : prompt;
    body = {
      model: config.model,
      max_tokens: 2000,
      temperature: 0.3,
      system: [{ type: 'text', text: 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Be concise, actionable, and professional.' }],
      messages: [{ role: 'user', content: userPart || prompt }]
    };
  } else {
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorText = '';
      try { errorText = await response.text(); } catch (_) { errorText = '(unable to read error response)'; }
      throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data) throw new Error('Quick Assist API returned null response body');
    return provider.parseResponse(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}