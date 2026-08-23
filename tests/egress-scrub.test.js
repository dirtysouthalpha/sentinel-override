// tests/egress-scrub.test.js
//
// Sentinel Override is an MSP tool: it reads whole pages — a client's ticket
// system, billing portal, RMM or admin console — and ships that text to a cloud
// model. Before background/egress-scrub.js the LLM path was unprotected.
// `_sanitizeHistory()` only strips screenshot blobs, and the redaction in
// telemetry.js is module-private and only ran on telemetry payloads. A page
// containing an API key or a client's personal details went to the provider
// verbatim.
//
// These tests assert BOTH directions, because over-masking is an outage rather
// than a safety win:
//   1. nothing sensitive reaches the wire, on every provider path;
//   2. ordinary technical text — git SHAs, UUIDs, semver, ports, timestamps,
//      order ids — survives byte-identical.

import { jest } from '@jest/globals';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const out = {};
        const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of list) if (storageData[k] !== undefined) out[k] = storageData[k];
        return out;
      }),
      set: jest.fn(async (o) => { Object.assign(storageData, o); }),
    },
  },
  runtime: { getURL: () => '', sendMessage: () => Promise.resolve() },
  tabs: { query: () => Promise.resolve([]), create: () => Promise.resolve({ id: 9 }), update: () => Promise.resolve() },
};

const {
  createScrubber, shouldScrub, SCRUB_MODE, SCRUB_KIND,
  getEgressScrubber, resetEgressScrubber,
} = await import('../background/egress-scrub.js');

const { callLLMWithRetry, resetLLMRateLimiter } = await import('../background/llm-client.js');

const _originalFetch = globalThis.fetch;

// ═══════════════════════════════════════════════════════════════════════════
describe('credential masking', () => {
  let s;
  beforeEach(() => { s = createScrubber(); });

  // Fixtures are ASSEMBLED AT RUNTIME from fragments, never written as literals.
  // A test file full of credential-shaped strings trips every secret scanner
  // that looks at this repo — including the pre-commit hook here and GitHub's
  // own scanning on the public mirror — and the noise trains people to wave
  // those alerts through. `X.repeat(n)` produces something that matches the
  // pattern under test without ever being a plausible key.
  const F = (prefix, body) => prefix + body;
  const SECRETS = [
    ['anthropic', F('sk-' + 'ant-', 'api03-' + 'E'.repeat(28))],
    ['openai', F('sk-' + 'proj-', 'E'.repeat(32))],
    ['openai-classic', F('sk-', 'E'.repeat(34))],
    ['aws', F('AKIA', 'EXAMPLEEXAMPLE00')],
    ['google', F('AIza', 'E'.repeat(35))],
    ['github', F('gh' + 'p_', 'E'.repeat(30))],
    ['github-pat', F('github' + '_pat_', 'E'.repeat(30))],
    ['slack', F('xo' + 'xb-', '000000000000-000000000000-' + 'E'.repeat(16))],
    ['stripe', F('sk' + '_live_', 'E'.repeat(24))],
  ];

  test.each(SECRETS)('%s key is masked', (_label, secret) => {
    const out = s.scrub(`config: ${secret} end`);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[\[SECRET-\d+\]\]/);
  });

  test('a JWT is masked', () => {
    const jwt = ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0', 'E'.repeat(32)].join('.');
    const out = s.scrub(`token=${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toMatch(/\[\[JWT-1\]\]/);
  });

  test('a bearer token is masked but the scheme survives', () => {
    const out = s.scrub('Authorization: Bearer abcdef1234567890ABCDEF');
    expect(out).toContain('Bearer');
    expect(out).not.toContain('abcdef1234567890ABCDEF');
    expect(out).toMatch(/\[\[AUTH-1\]\]/);
  });

  test('a cookie header value is masked', () => {
    const out = s.scrub('Cookie: session=abc123def456ghi; other=1');
    expect(out).not.toContain('abc123def456ghi');
  });

  test('a PEM private key block is masked whole', () => {
    const _b = '-----' + 'BEGIN RSA PRIVATE KEY' + '-----';
    const _e = '-----' + 'END RSA PRIVATE KEY' + '-----';
    const pem = `${_b}\nMIIEowIBAAKCAQEA\nsecretmaterial\n${_e}`;
    const out = s.scrub(`key:\n${pem}\ndone`);
    expect(out).not.toContain('secretmaterial');
    expect(out).not.toContain('MIIEowIBAAKCAQEA');
    expect(out).toMatch(/\[\[KEY-1\]\]/);
  });

  test.each([
    'password: hunter2trombone',
    'api_key=ABCDEF123456',
    'client_secret: "s3cr3t-value-here"',
    'access_token=zzzzzzzzzzzz',
  ])('secret-shaped assignment %s is masked', (line) => {
    const out = s.scrub(line);
    expect(out).toMatch(/\[\[PASSWORD-\d+\]\]/);
  });

  test('the field NAME survives so the model still knows what it is', () => {
    const out = s.scrub('password: hunter2trombone');
    expect(out).toContain('password');
    expect(out).not.toContain('hunter2trombone');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PII masking', () => {
  let s;
  beforeEach(() => { s = createScrubber(); });

  test('email addresses are masked', () => {
    const out = s.scrub('Reported by helpdesk@contoso.example and cc bob.smith+tag@sub.domain.co.uk');
    expect(out).not.toContain('helpdesk@contoso.example');
    expect(out).not.toContain('bob.smith+tag@sub.domain.co.uk');
    expect(out).toMatch(/\[\[EMAIL-1\]\]/);
    expect(out).toMatch(/\[\[EMAIL-2\]\]/);
  });

  test.each([
    '(617) 555-0142',
    '617-555-0142',
    '617.555.0142',
    '+1 617 555 0142',
    '+447700900123',
  ])('phone number %s is masked', (phone) => {
    const out = s.scrub(`Call ${phone} today`);
    expect(out).not.toContain(phone);
    expect(out).toMatch(/\[\[PHONE-\d+\]\]/);
  });

  test('an SSN is masked', () => {
    const out = s.scrub('SSN 123-45-6789 on file');
    expect(out).not.toContain('123-45-6789');
    expect(out).toMatch(/\[\[SSN-1\]\]/);
  });

  test('a Luhn-valid credit card is masked', () => {
    for (const card of ['4111 1111 1111 1111', '4111111111111111', '5500-0000-0000-0004']) {
      const fresh = createScrubber();
      const out = fresh.scrub(`card ${card} exp 12/29`);
      expect(out).not.toContain(card);
      expect(out).toMatch(/\[\[CARD-1\]\]/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The other half of the contract. A prior fleet incident took a service down by
// masking git SHAs; over-masking is an outage nobody notices until a customer
// complains.
describe('does NOT over-mask ordinary technical text', () => {
  let s;
  beforeEach(() => { s = createScrubber(); });

  const MUST_SURVIVE = [
    ['git sha (full)', 'commit 5b290e8bc1aab922d334be7a85a20eb5cc169569 landed'],
    ['git sha (short)', 'reverted 5b290e8 yesterday'],
    ['uuid', 'run id 3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['semver', 'upgraded to v21.6.76 from 21.6.75'],
    ['ISO timestamp', 'at 2026-08-23 20:47 UTC the job ran'],
    ['port + host', 'listening on 127.0.0.1:8766 and 192.168.1.50:9090'],
    ['byte counts', 'transferred 128000 bytes in 1234567 ms'],
    ['sha256 digest', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['order id', 'Order 1234567890123 shipped'],
    ['ticket ids', 'TKT-4488 and INC0012345 and #4471'],
    ['ip ranges', 'route 10.0.0.0/8 via 172.16.4.1'],
    ['error codes', 'HTTP 429 after 3 retries, code 1301'],
    ['file paths', '/home/dad/workspace/sentinel-override/background/llm-client.js:1518'],
    ['css/selectors', 'div#main > .row:nth-of-type(3) [data-sentinel-index="12"]'],
  ];

  test.each(MUST_SURVIVE)('%s survives byte-identical', (_label, text) => {
    expect(s.scrub(text)).toBe(text);
  });

  test('a 16-digit non-Luhn number is NOT treated as a card', () => {
    const text = 'reference 1234567812345678 recorded';
    expect(s.scrub(text)).toBe(text);
  });

  test('a digit run inside a longer token is not a phone', () => {
    const text = 'build-6175550142-artifact.tar.gz';
    expect(s.scrub(text)).toBe(text);
  });

  test('an ordinary MSP paragraph is untouched', () => {
    const text = 'TKT-4488 — Exchange mail flow stopped. Priority: P1. Status: Open. '
      + 'Assigned to: UNASSIGNED. SLA: BREACHED 11 minutes ago. '
      + 'Last note: transport queue is backing up on EX01.';
    expect(s.scrub(text)).toBe(text);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('placeholder-and-restore round trip', () => {
  test('the same value gets the same token every time in a run', () => {
    const s = createScrubber();
    const out = s.scrub('a@b.example ... later a@b.example again');
    const tokens = out.match(/\[\[EMAIL-\d+\]\]/g);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toBe(tokens[1]);
    expect(s.count()).toBe(1);
  });

  test('restore returns the original text exactly', () => {
    const s = createScrubber();
    const key = 'sk-' + 'ant-' + 'api03-' + 'E'.repeat(28);
    const original = `Email helpdesk@contoso.example or call (617) 555-0142. Key ${key}.`;
    const masked = s.scrub(original);
    expect(masked).not.toContain('helpdesk@contoso.example');
    expect(s.restore(masked)).toBe(original);
  });

  test('restoreDeep walks the command object the model returns', () => {
    const s = createScrubber();
    s.scrub('contact helpdesk@contoso.example');
    const cmd = { type: 'type', selector: '#to', text: '[[EMAIL-1]]', nested: { list: ['[[EMAIL-1]]'] } };
    const restored = s.restoreDeep(cmd);
    expect(restored.text).toBe('helpdesk@contoso.example');
    expect(restored.nested.list[0]).toBe('helpdesk@contoso.example');
    // non-mutating
    expect(cmd.text).toBe('[[EMAIL-1]]');
  });

  test('restore is a no-op when nothing was masked', () => {
    const s = createScrubber();
    expect(s.restore('plain text')).toBe('plain text');
  });

  test('summary counts by kind without exposing values', () => {
    const s = createScrubber();
    s.scrub('a@b.example c@d.example ' + 'sk-' + 'ant-' + 'api03-' + 'E'.repeat(28));
    expect(s.summary()).toEqual({ EMAIL: 2, SECRET: 1 });
    expect(JSON.stringify(s.entries())).not.toContain('a@b.example');
  });

  test('reset clears mappings so tokens never cross runs', () => {
    const s = createScrubber();
    s.scrub('a@b.example');
    s.reset();
    expect(s.count()).toBe(0);
    expect(s.restore('[[EMAIL-1]]')).toBe('[[EMAIL-1]]');
  });

  test('the run-scoped singleton is replaced by resetEgressScrubber', () => {
    resetEgressScrubber();
    const a = getEgressScrubber();
    a.scrub('a@b.example');
    expect(a.count()).toBe(1);
    resetEgressScrubber();
    expect(getEgressScrubber().count()).toBe(0);
  });

  test('scrubbing handles non-strings and deep structures safely', () => {
    const s = createScrubber();
    expect(s.scrub(null)).toBeNull();
    expect(s.scrub(42)).toBe(42);
    expect(() => s.scrubDeep({ a: [{ b: 'x@y.example' }] })).not.toThrow();
    expect(s.scrubDeep({ a: [{ b: 'x@y.example' }] }).a[0].b).toMatch(/\[\[EMAIL-\d+\]\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('destination policy', () => {
  test('cloud endpoints are scrubbed in the default mode', () => {
    for (const url of [
      'https://api.openai.com/v1/chat/completions',
      'https://api.anthropic.com/v1/messages',
      'https://api.z.ai/api/paas/v4/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
    ]) {
      expect(shouldScrub(url, SCRUB_MODE.CLOUD)).toBe(true);
    }
  });

  test('local and tailnet endpoints are exempt in the default mode', () => {
    for (const url of [
      'http://localhost:11434/v1/chat/completions',
      'http://127.0.0.1:8800/v1/chat/completions',
      'http://192.168.1.50:9090/v1',
      'http://10.0.0.9:8080/v1',
      'http://100.70.240.55:9090/v1',
      'http://nuke.local:8083/v1',
    ]) {
      expect(shouldScrub(url, SCRUB_MODE.CLOUD)).toBe(false);
    }
  });

  test('ALWAYS scrubs local too', () => {
    expect(shouldScrub('http://localhost:11434/v1', SCRUB_MODE.ALWAYS)).toBe(true);
  });

  test('OFF disables scrubbing entirely', () => {
    expect(shouldScrub('https://api.openai.com/v1', SCRUB_MODE.OFF)).toBe(false);
  });

  test('an unknown or unparseable destination fails SAFE (scrubs)', () => {
    expect(shouldScrub('', SCRUB_MODE.CLOUD)).toBe(true);
    expect(shouldScrub('not a url', SCRUB_MODE.CLOUD)).toBe(true);
    expect(shouldScrub(undefined, SCRUB_MODE.CLOUD)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The deliverable the coordinator asked for: prove a planted key and a planted
// email do not appear in the outbound request body, for each provider path.
describe('WIRE TEST: planted secrets never reach the request body', () => {
  const PLANTED_KEY = 'sk-' + 'ant-' + 'api03-' + 'P'.repeat(30);
  const PLANTED_EMAIL = 'victim.client@confidential.example';
  const PLANTED_PHONE = '(617) 555-0142';
  const PLANTED_CARD = '4111 1111 1111 1111';

  const PAGE = `Ticket TKT-4488 opened by ${PLANTED_EMAIL}, callback ${PLANTED_PHONE}. `
    + `Integration key ${PLANTED_KEY}. Card on file ${PLANTED_CARD}. `
    + 'Commit 5b290e8bc1aab922d334be7a85a20eb5cc169569 deployed at 2026-08-23 20:47 UTC.';

  let bodies = [];

  const PROVIDERS = [
    ['openai', 'https://api.openai.com/v1/chat/completions', 'gpt-4o'],
    ['anthropic', 'https://api.anthropic.com/v1/messages', 'claude-sonnet-4'],
    ['zai', 'https://api.z.ai/api/paas/v4/chat/completions', 'glm-4.6'],
  ];

  beforeEach(() => {
    bodies = [];
    storageData = {};
    resetEgressScrubber();
    resetLLMRateLimiter();
    globalThis.fetch = jest.fn(async (url, init) => {
      bodies.push(String(init && init.body || ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"type":"note","text":"ok"}' } }],
          content: [{ type: 'text', text: '{"type":"note","text":"ok"}' }],
        }),
      };
    });
  });

  afterEach(() => { globalThis.fetch = _originalFetch; });

  async function run(endpoint, model, providerId) {
    storageData.active_provider = providerId;
    storageData.providers = { [providerId]: { api_key: 'test-key', model, endpoint } };
    return callLLMWithRetry(
      [], 0, PAGE, null, `Investigate the ticket and email ${PLANTED_EMAIL}`,
      [{ step: 1, action: { type: 'read_page' }, result: PAGE }],
      1, 'https://helpdesk.example/t/4488', 0,
      { maxRetries: 1, retryDelay: 1, maxRetryDelay: 5, fetchTimeout: 30000, historyWindow: 10, strategyShiftThreshold: 3, streaming: false },
      { apiCallCount: 0, consecutiveFailures: 0, currentStrategies: [], agentMemory: { page: PAGE }, agentPlan: null, currentPlanStep: 0, model }
    );
  }

  test.each(PROVIDERS)('%s: no planted secret or PII in the body', async (providerId, endpoint, model) => {
    await run(endpoint, model, providerId);
    expect(bodies.length).toBeGreaterThan(0);
    const wire = bodies.join('\n');

    expect(wire).not.toContain(PLANTED_KEY);
    expect(wire).not.toContain(PLANTED_EMAIL);
    expect(wire).not.toContain(PLANTED_PHONE);
    expect(wire).not.toContain('4111 1111 1111 1111');

    // …and the placeholders ARE there, so the model still has something to reason about.
    expect(wire).toMatch(/\[\[SECRET-\d+\]\]/);
    expect(wire).toMatch(/\[\[EMAIL-\d+\]\]/);
  });

  test.each(PROVIDERS)('%s: legitimate technical detail still reaches the model', async (providerId, endpoint, model) => {
    await run(endpoint, model, providerId);
    const wire = bodies.join('\n');
    expect(wire).toContain('TKT-4488');
    expect(wire).toContain('5b290e8bc1aab922d334be7a85a20eb5cc169569');
    expect(wire).toContain('2026-08-23 20:47 UTC');
  });

  test('a LOCAL endpoint is not scrubbed in the default mode', async () => {
    await run('http://127.0.0.1:8800/v1/chat/completions', 'LongCat-2.0-nonthink', 'custom');
    const wire = bodies.join('\n');
    expect(wire).toContain(PLANTED_EMAIL);
    expect(wire).not.toMatch(/\[\[EMAIL-\d+\]\]/);
  });

  test('egressScrubMode=always scrubs the local endpoint too', async () => {
    storageData.egressScrubMode = SCRUB_MODE.ALWAYS;
    await run('http://127.0.0.1:8800/v1/chat/completions', 'LongCat-2.0-nonthink', 'custom');
    const wire = bodies.join('\n');
    expect(wire).not.toContain(PLANTED_EMAIL);
    expect(wire).toMatch(/\[\[EMAIL-\d+\]\]/);
  });

  test('the command coming back has placeholders restored', async () => {
    storageData.active_provider = 'openai';
    storageData.providers = { openai: { api_key: 'k', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1/chat/completions' } };
    globalThis.fetch = jest.fn(async (url, init) => {
      bodies.push(String(init && init.body || ''));
      // The model echoes the placeholder it was shown.
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"type":"type","selector":"#to","text":"[[EMAIL-1]]"}' } }] }),
      };
    });
    const cmd = await callLLMWithRetry(
      [], 0, PAGE, null, 'email the reporter',
      [], 1, 'https://helpdesk.example/t/4488', 0,
      { maxRetries: 1, retryDelay: 1, maxRetryDelay: 5, fetchTimeout: 30000, historyWindow: 10, strategyShiftThreshold: 3, streaming: false },
      { apiCallCount: 0, consecutiveFailures: 0, currentStrategies: [], agentMemory: {}, agentPlan: null, currentPlanStep: 0, model: 'gpt-4o' }
    );
    // The agent must type the REAL address, not the token.
    expect(cmd.text).toBe(PLANTED_EMAIL);
  });
});
