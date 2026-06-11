// tests/agent-errors.test.js
// Unit tests for AgentError class and recovery policy (ERR-01-04).

import { AgentError, ERROR_CODES, isAgentError, isRetryable, wrapError, fromApiResponse } from '../background/agent-errors.js';

describe('AgentError', () => {
  test('constructs with all fields', () => {
    const err = new AgentError({
      code: ERROR_CODES.TAB_CLOSED,
      message: 'Tab was closed',
      suggestion: 'Reopen the tab and try again',
      retryable: true,
      context: { tabId: 42, goal: 'check firewall' }
    });
    expect(err.name).toBe('AgentError');
    expect(err.code).toBe('TAB_CLOSED');
    expect(err.message).toBe('Tab was closed');
    expect(err.suggestion).toBe('Reopen the tab and try again');
    expect(err.retryable).toBe(true);
    expect(err.context.tabId).toBe(42);
    expect(err.timestamp).toBeGreaterThan(0);
  });

  test('toJSON serializes all fields', () => {
    const err = new AgentError({ code: 'LLM_ERROR', message: 'Timeout', retryable: false });
    const json = err.toJSON();
    expect(json.name).toBe('AgentError');
    expect(json.code).toBe('LLM_ERROR');
    expect(json.retryable).toBe(false);
    expect(json.timestamp).toBeGreaterThan(0);
  });

  test('defaults unknown code when not provided', () => {
    const err = new AgentError({ message: 'oops' });
    expect(err.code).toBe('UNKNOWN');
  });
});

describe('Error helpers', () => {
  test('isAgentError returns true for AgentError', () => {
    const err = new AgentError({ code: 'TEST', message: 'test' });
    expect(isAgentError(err)).toBe(true);
    expect(isAgentError(new Error('plain'))).toBe(false);
  });

  test('isRetryable works', () => {
    const retryable = new AgentError({ code: 'TEST', message: 'test', retryable: true });
    const notRetryable = new AgentError({ code: 'TEST', message: 'test', retryable: false });
    expect(isRetryable(retryable)).toBe(true);
    expect(isRetryable(notRetryable)).toBe(false);
    expect(isRetryable(new Error('plain'))).toBe(false);
  });

  test('wrapError converts plain errors', () => {
    const plain = new Error('network fail');
    const wrapped = wrapError(plain, ERROR_CODES.NETWORK_ERROR, 'Check internet', true, { url: 'https://example.com' });
    expect(wrapped instanceof AgentError).toBe(true);
    expect(wrapped.code).toBe('NETWORK_ERROR');
    expect(wrapped.retryable).toBe(true);
    expect(wrapped.context.url).toBe('https://example.com');
  });

  test('wrapError passes through existing AgentError', () => {
    const agent = new AgentError({ code: 'TEST', message: 'test' });
    const result = wrapError(agent, 'OTHER');
    expect(result).toBe(agent);
  });

  test('fromApiResponse reconstructs AgentError', () => {
    const json = { code: 'LLM_TIMEOUT', message: 'Timeout', retryable: true, context: { step: 5 } };
    const err = fromApiResponse(json);
    expect(err instanceof AgentError).toBe(true);
    expect(err.code).toBe('LLM_TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.context.step).toBe(5);
  });

  test('fromApiResponse handles null/invalid', () => {
    const err = fromApiResponse(null);
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('Invalid error payload');
  });
});

describe('ERROR_CODES', () => {
  test('all expected codes are defined', () => {
    const expected = ['TAB_CLOSED', 'TAB_NOT_FOUND', 'LLM_TIMEOUT', 'LLM_ERROR', 'LLM_RATE_LIMITED',
      'SELECTOR_MISS', 'EXECUTE_JS_FAILED', 'AUTH_REQUIRED', 'CAPTCHA_DETECTED',
      'NETWORK_ERROR', 'STORAGE_ERROR', 'PLUGIN_ERROR', 'MAX_RETRIES_EXCEEDED',
      'USER_ABORTED', 'UNKNOWN'];
    for (const code of expected) {
      expect(ERROR_CODES[code]).toBe(code);
    }
  });
});
