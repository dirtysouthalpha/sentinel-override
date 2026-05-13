// tests/llm-client.test.js
// Unit tests for pure utility functions exported from background/llm-client.js.
// These have no chrome.* or DOM dependencies.

// llm-client.js imports chrome APIs at module scope, so we stub the global
// before importing to avoid reference errors in Node.
globalThis.chrome = {
  storage: { local: { get: () => {}, set: () => {} } },
  runtime: { getURL: () => '' }
};

import { extractFirstJsonObject } from '../background/llm-client.js';

// extractFirstJsonObject returns the raw JSON string (not a parsed object)
// for the first valid command object found in the input.
describe('extractFirstJsonObject', () => {
  test('extracts a valid action JSON string from clean input', () => {
    const result = extractFirstJsonObject('{"type":"click","selector":"#btn"}');
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('click');
  });

  test('extracts JSON string from text with leading prose', () => {
    const result = extractFirstJsonObject(
      'I will now click the button. {"type":"navigate","url":"https://example.com"}'
    );
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('navigate');
    expect(parsed.url).toBe('https://example.com');
  });

  test('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  test('returns null for plain text with no JSON', () => {
    expect(extractFirstJsonObject('no json here at all')).toBeNull();
  });

  test('returns null for JSON without a valid type field', () => {
    expect(extractFirstJsonObject('{"foo":"bar"}')).toBeNull();
  });

  test('handles JSON with nested object values without crashing', () => {
    const nested = '{"type":"execute_js","code":"var x=1;","key":"result"}';
    const result = extractFirstJsonObject(nested);
    expect(result).toBeTruthy();
    expect(JSON.parse(result).type).toBe('execute_js');
  });

  test('picks first valid object when multiple JSON objects present', () => {
    const input = '{"type":"note","text":"first"} and {"type":"finish","summary":"done"}';
    const result = extractFirstJsonObject(input);
    expect(JSON.parse(result).type).toBe('note');
  });
});
