// tests/model-capabilities.test.js
// (v20.3) Capability-aware Anthropic request building: the default model is now
// Opus 4.8, which REJECTS temperature/top_p and budget_tokens (400). These tests
// lock in that the builders emit valid bodies across the Claude model range and
// degrade correctly for older models.

import {
  PROVIDERS,
  isAdaptiveThinkingModel,
  rejectsSamplingParams,
  supportsEffort,
} from '../background/provider-registry.js';

const A = PROVIDERS.anthropic;
const TOOLS = [{ name: 'note', description: 'note', input_schema: { type: 'object', properties: {} } }];

describe('capability predicates', () => {
  test('adaptive thinking: Claude 4.5 family and newer', () => {
    for (const m of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
      'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5', 'claude-mythos-5',
      'anthropic/claude-opus-4.8']) {
      expect(isAdaptiveThinkingModel(m)).toBe(true);
    }
  });

  test('adaptive thinking: false for legacy / non-Claude', () => {
    for (const m of ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-3-5-sonnet',
      'gpt-4o', 'glm-5', 'nex-agi/nex-n2-pro:free', '']) {
      expect(isAdaptiveThinkingModel(m)).toBe(false);
    }
  });

  test('rejectsSamplingParams: only Opus 4.7/4.8 + Fable/Mythos 5', () => {
    for (const m of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-fable-5', 'claude-mythos-5']) {
      expect(rejectsSamplingParams(m)).toBe(true);
    }
    for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'gpt-4o']) {
      expect(rejectsSamplingParams(m)).toBe(false);
    }
  });

  test('supportsEffort: Opus 4.5+ and Sonnet 4.6, not Haiku/Sonnet 4.5', () => {
    expect(supportsEffort('claude-opus-4-8')).toBe(true);
    expect(supportsEffort('claude-sonnet-4-6')).toBe(true);
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);
    expect(supportsEffort('claude-sonnet-4-5')).toBe(false);
  });
});

describe('Opus 4.8 builders never send 400-triggering params', () => {
  const M = 'claude-opus-4-8';

  test('buildBody omits temperature', () => {
    const b = A.buildBody(M, 'sys', 'hi', { temperature: 0.3 });
    expect(b.temperature).toBeUndefined();
    expect(b.top_p).toBeUndefined();
  });

  test('buildBodyWithTools omits temperature, forces tool choice', () => {
    const b = A.buildBodyWithTools(M, 'sys', 'hi', TOOLS, { temperature: 0.1 });
    expect(b.temperature).toBeUndefined();
    expect(b.tool_choice).toEqual({ type: 'any' });
  });

  test('buildBodyWithThinking uses adaptive + effort + auto tool choice, no budget/temperature', () => {
    const b = A.buildBodyWithThinking(M, 'sys', 'hi', TOOLS, 8000, { maxTokens: 8000 });
    expect(b.thinking).toEqual({ type: 'adaptive' });
    expect(b.output_config).toEqual({ effort: 'high' });
    expect(b.temperature).toBeUndefined();
    expect(b.max_tokens).toBe(8000); // adaptive does NOT add the budget
    expect(b.tool_choice).toEqual({ type: 'auto' });
  });

  test('buildBodyTextWithThinking uses adaptive, no budget/temperature', () => {
    const b = A.buildBodyTextWithThinking(M, 'sys', 'hi', 5000, { maxTokens: 4000 });
    expect(b.thinking).toEqual({ type: 'adaptive' });
    expect(b.temperature).toBeUndefined();
    expect(b.max_tokens).toBe(4000);
  });
});

describe('legacy Claude keeps the budget+temperature path', () => {
  const M = 'claude-opus-4-1';

  test('buildBody keeps temperature on models that accept it', () => {
    const b = A.buildBody(M, 'sys', 'hi', { temperature: 0.3 });
    expect(b.temperature).toBe(0.3);
  });

  test('buildBodyWithThinking uses enabled+budget_tokens+temperature:1', () => {
    const b = A.buildBodyWithThinking(M, 'sys', 'hi', TOOLS, 8000, { maxTokens: 8000 });
    expect(b.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    expect(b.temperature).toBe(1);
    expect(b.max_tokens).toBe(16000); // legacy adds the budget to max_tokens
    expect(b.output_config).toBeUndefined();
  });
});
