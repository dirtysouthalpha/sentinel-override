// tests/provider-registry-new-providers.test.js
// Tests for the 4 new free OpenRouter providers: nexn2, gemma4, nemotron, poolside

import { PROVIDERS, PROVIDER_CATALOG, getCatalogProvider } from '../background/provider-registry.js';

const NEW_PROVIDER_IDS = ['nexn2', 'gemma4', 'nemotron', 'poolside'];

describe('new free OpenRouter providers — presence', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`PROVIDERS.${id} is defined`, () => {
      expect(PROVIDERS[id]).toBeDefined();
    });

    test(`PROVIDERS.${id} has correct id`, () => {
      expect(PROVIDERS[id].id).toBe(id);
    });

    test(`PROVIDERS.${id} has a name`, () => {
      expect(typeof PROVIDERS[id].name).toBe('string');
      expect(PROVIDERS[id].name.length).toBeGreaterThan(0);
    });

    test(`PROVIDERS.${id} targets OpenRouter endpoint`, () => {
      expect(PROVIDERS[id].defaultEndpoint).toContain('openrouter.ai');
    });

    test(`PROVIDERS.${id} default model ends with :free`, () => {
      expect(PROVIDERS[id].defaultModel).toMatch(/:free$/);
    });

    test(`PROVIDERS.${id} supportsToolUse is true`, () => {
      expect(PROVIDERS[id].supportsToolUse).toBe(true);
    });
  }
});

describe('new providers — buildHeaders', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`${id}.buildHeaders includes Authorization bearer`, () => {
      const headers = PROVIDERS[id].buildHeaders('test-key-123');
      expect(headers['Authorization']).toBe('Bearer test-key-123');
    });

    test(`${id}.buildHeaders includes HTTP-Referer`, () => {
      const headers = PROVIDERS[id].buildHeaders('key');
      expect(headers['HTTP-Referer']).toBeDefined();
    });

    test(`${id}.buildHeaders includes X-Title`, () => {
      const headers = PROVIDERS[id].buildHeaders('key');
      expect(headers['X-Title']).toBe('Sentinel Override');
    });
  }
});

describe('new providers — buildBody', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`${id}.buildBody returns messages array with system+user`, () => {
      const body = PROVIDERS[id].buildBody('my-model', 'system prompt', 'user content');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
    });

    test(`${id}.buildBody uses provided model`, () => {
      const body = PROVIDERS[id].buildBody('test-model', 'sys', 'usr');
      expect(body.model).toBe('test-model');
    });

    test(`${id}.buildBody defaults max_tokens to 8000`, () => {
      const body = PROVIDERS[id].buildBody('m', 's', 'u');
      expect(body.max_tokens).toBe(8000);
    });

    test(`${id}.buildBody respects maxTokens override`, () => {
      const body = PROVIDERS[id].buildBody('m', 's', 'u', { maxTokens: 4096 });
      expect(body.max_tokens).toBe(4096);
    });

    test(`${id}.buildBody sets json_object response_format when jsonMode=true`, () => {
      const body = PROVIDERS[id].buildBody('m', 's', 'u', { jsonMode: true });
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    test(`${id}.buildBody does not set response_format when jsonMode is false`, () => {
      const body = PROVIDERS[id].buildBody('m', 's', 'u', { jsonMode: false });
      expect(body.response_format).toBeUndefined();
    });
  }
});

describe('new providers — parseResponse', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`${id}.parseResponse returns content from valid response`, () => {
      const data = { choices: [{ message: { content: 'Hello from model' } }] };
      expect(PROVIDERS[id].parseResponse(data)).toBe('Hello from model');
    });

    test(`${id}.parseResponse returns empty string for null content`, () => {
      const data = { choices: [{ message: { content: null } }] };
      expect(PROVIDERS[id].parseResponse(data)).toBe('');
    });

    test(`${id}.parseResponse throws when no choices`, () => {
      expect(() => PROVIDERS[id].parseResponse({ choices: [] }))
        .toThrow(/no choices/i);
    });

    test(`${id}.parseResponse throws when choices is undefined`, () => {
      expect(() => PROVIDERS[id].parseResponse({}))
        .toThrow(/no choices/i);
    });
  }
});

describe('new providers — buildBodyWithTools', () => {
  const tools = [{ type: 'function', function: { name: 'click', parameters: {} } }];

  for (const id of NEW_PROVIDER_IDS) {
    test(`${id}.buildBodyWithTools includes tools array`, () => {
      const body = PROVIDERS[id].buildBodyWithTools('m', 'sys', 'usr', tools);
      expect(body.tools).toBe(tools);
    });

    test(`${id}.buildBodyWithTools sets tool_choice auto`, () => {
      const body = PROVIDERS[id].buildBodyWithTools('m', 'sys', 'usr', tools);
      expect(body.tool_choice).toEqual({ type: 'auto' });
    });

    test(`${id}.buildBodyWithTools uses lower temperature by default`, () => {
      const body = PROVIDERS[id].buildBodyWithTools('m', 'sys', 'usr', tools);
      expect(body.temperature).toBeLessThanOrEqual(0.2);
    });
  }
});

describe('new providers — parseToolUseResponse', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`${id}.parseToolUseResponse returns null when no tool_calls`, () => {
      const data = { choices: [{ message: { content: 'text only' } }] };
      expect(PROVIDERS[id].parseToolUseResponse(data)).toBeNull();
    });

    test(`${id}.parseToolUseResponse parses tool call with string arguments`, () => {
      const data = {
        choices: [{
          message: {
            tool_calls: [{
              function: { name: 'click', arguments: '{"selector":"#btn"}' }
            }]
          }
        }]
      };
      const result = PROVIDERS[id].parseToolUseResponse(data);
      expect(result.type).toBe('click');
      expect(result.selector).toBe('#btn');
    });

    test(`${id}.parseToolUseResponse parses tool call with object arguments`, () => {
      const data = {
        choices: [{
          message: {
            tool_calls: [{
              function: { name: 'navigate', arguments: { url: 'https://example.com' } }
            }]
          }
        }]
      };
      const result = PROVIDERS[id].parseToolUseResponse(data);
      expect(result.type).toBe('navigate');
      expect(result.url).toBe('https://example.com');
    });

    test(`${id}.parseToolUseResponse throws when no choices`, () => {
      expect(() => PROVIDERS[id].parseToolUseResponse({ choices: [] }))
        .toThrow(/no choices/i);
    });
  }
});

describe('new providers — buildVisionContent', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`${id}.buildVisionContent returns array with text and image_url`, () => {
      const content = PROVIDERS[id].buildVisionContent('Describe this', 'base64data==');
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe('text');
      expect(content[0].text).toBe('Describe this');
      expect(content[1].type).toBe('image_url');
      expect(content[1].image_url.url).toContain('base64data==');
    });
  }
});

describe('new providers — PROVIDER_CATALOG entries', () => {
  for (const id of NEW_PROVIDER_IDS) {
    test(`PROVIDER_CATALOG has entry for ${id}`, () => {
      const entry = getCatalogProvider(id);
      expect(entry).not.toBeNull();
    });

    test(`PROVIDER_CATALOG.${id} has kind=openai`, () => {
      const entry = getCatalogProvider(id);
      if (entry) expect(entry.kind).toBe('openai');
    });

    test(`PROVIDER_CATALOG.${id} endpoint points to openrouter`, () => {
      const entry = getCatalogProvider(id);
      if (entry) expect(entry.endpoint).toContain('openrouter.ai');
    });
  }
});
