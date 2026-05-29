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
export function handleQuickAssist(prompt) {
  return new Promise((resolve, reject) => {
    try {
      const config = getActiveProvider();
      if (!config || !config.apiKey) {
        reject(new Error('No API key configured. Open Sentinel Override settings to set up an LLM provider.'));
        return;
      }

      const provider = resolveProvider(config.endpoint);
      const headers = provider.buildHeaders(config.apiKey);

      // Constants for request configuration
      const MAX_TOKENS = 2000;
      const TEMPERATURE = 0.3;
      const SYSTEM_PROMPT = 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Be concise, actionable, and professional.';
      
      let requestBody;

      if (config.id === 'anthropic') {
        // Split prompt into system and user parts
        const splitIndex = prompt.indexOf('\n---\n');
        const systemPart = splitIndex !== -1 ? prompt.substring(0, splitIndex) : prompt.substring(0, 500);
        const userPart = splitIndex !== -1 ? prompt.substring(splitIndex + 4) : prompt;

        requestBody = {
          model: config.model,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          system: [{ type: 'text', text: SYSTEM_PROMPT }],
          messages: [{ role: 'user', content: userPart || prompt }]
        };
      } else {
        // OpenAI-compatible format
        requestBody = {
          model: config.model,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ]
        };
      }

      fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }).then(response => {
        if (!response.ok) {
          response.text().then(errorText => {
            reject(new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`));
          }).catch(() => {
            reject(new Error(`API error ${response.status}`));
          });
        } else {
          response.json().then(data => {
            resolve(provider.parseResponse(data));
          }).catch(() => {
            reject(new Error('Failed to parse API response'));
          });
        }
      }).catch(error => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}