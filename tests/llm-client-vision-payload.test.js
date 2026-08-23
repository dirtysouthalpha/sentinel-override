// tests/llm-client-vision-payload.test.js
//
// Two defects found by running the real agent loop against a live model
// (tests/live/agent-live-smoke.test.js) and recording every HTTP request:
//
//   1. THE SCREENSHOT WAS RE-SENT AFTER THE ENDPOINT REJECTED IT.
//      `_useVision` was `!!base64Image && provider.buildVisionContent` — it never
//      consulted `agentState.visionDegraded`, the flag the 400-handler sets three
//      dozen lines below to "mark the run blind". Against a text-only model the
//      live wire log showed this on EVERY step:
//         400   2ms  model=LongCat-2.0-nonthink image=true  promptChars=57967
//         200 2994ms model=LongCat-2.0-nonthink image=false promptChars=20471
//      i.e. ~57KB of base64 uploaded, rejected, and paid for again — two requests,
//      two rate-limiter slots and two apiCallCount increments per step, all run.
//
//   2. supportsVision() SAID NO TO REAL VISION MODELS.
//      /\bqwen[\w.-]*-vl\b/ needs a dash before "vl", so `qwen2.5vl:7b` — the
//      stock ollama tag — was classed text-only, as was `vl-7b-dspark`. Those
//      models were told in their own system prompt that they could not see.

import { jest } from '@jest/globals';

let _storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        const result = {};
        if (!keys || typeof keys[Symbol.iterator] !== 'function') return Promise.resolve(result);
        for (const k of keys) if (_storageData[k] !== undefined) result[k] = _storageData[k];
        return Promise.resolve(result);
      },
      set: () => Promise.resolve(),
    },
  },
  runtime: { getURL: () => '', sendMessage: () => Promise.resolve() },
  tabs: { query: () => Promise.resolve([]), create: () => Promise.resolve({ id: 9 }), update: () => Promise.resolve() },
};

const _originalFetch = globalThis.fetch;
let _mockFetch = null;

const { callLLMWithRetry, supportsVision, resetLLMRateLimiter } =
  await import('../background/llm-client.js');

const CONFIG = {
  maxRetries: 1,
  retryDelay: 1,
  maxRetryDelay: 5,
  fetchTimeout: 30000,
  historyWindow: 10,
  strategyShiftThreshold: 3,
  streaming: false,
};

/** Every request body the client sent, parsed. */
let requests = [];

function agentState(overrides = {}) {
  return {
    apiCallCount: 0,
    consecutiveFailures: 0,
    currentStrategies: [],
    agentMemory: {},
    agentPlan: null,
    currentPlanStep: 0,
    model: 'gpt-4o',
    ...overrides,
  };
}

function useProvider(model = 'gpt-4o') {
  _storageData = {
    active_provider: 'openai',
    providers: {
      openai: { api_key: 'test-key', model, endpoint: 'https://api.openai.com/v1/chat/completions' },
    },
  };
}

const okBody = { choices: [{ message: { content: '{"type":"note","text":"ok"}' } }] };
const okResponse = () => ({ ok: true, status: 200, json: () => Promise.resolve(okBody) });

/** True when this request body carried an image part. */
function hasImage(body) {
  return JSON.stringify(body.messages || []).includes('image_url');
}

const IMAGE = 'iVBORw0KGgoAAAANSUhEUg==';

async function call(state, image = IMAGE) {
  return callLLMWithRetry(
    [], 0, 'page content', image, 'read the page', [], 1, 'https://example.com',
    0, CONFIG, state
  );
}

beforeEach(() => {
  _storageData = {};
  requests = [];
  resetLLMRateLimiter();
  _mockFetch = null;
  globalThis.fetch = jest.fn(async (url, init) => {
    let body = {};
    try { body = JSON.parse(init.body); } catch { /* not JSON */ }
    requests.push(body);
    if (_mockFetch) return _mockFetch(body, requests.length);
    return okResponse();
  });
});

afterEach(() => { globalThis.fetch = _originalFetch; });

// ═══════════════════════════════════════════════════════════════════════════
describe('vision payload is not re-sent after the endpoint rejects it', () => {
  test('the first call attaches the screenshot (optimistic probe)', async () => {
    useProvider();
    await call(agentState());
    expect(requests).toHaveLength(1);
    expect(hasImage(requests[0])).toBe(true);
  });

  test('a 400 on the image call falls back text-only and marks the run degraded', async () => {
    useProvider();
    _mockFetch = async (body) => hasImage(body)
      ? { ok: false, status: 400, text: () => Promise.resolve('image_url not supported') }
      : okResponse();

    const state = agentState();
    const result = await call(state);

    expect(result.type).toBe('note');
    expect(requests).toHaveLength(2);
    expect(hasImage(requests[0])).toBe(true);
    expect(hasImage(requests[1])).toBe(false);
    expect(state.visionDegraded).toBe(true);
  });

  test('once degraded, a later call sends NO image — one probe per run, not one per step', async () => {
    useProvider();
    const state = agentState({ visionDegraded: true });
    await call(state);

    // The regression: this used to be 2 requests (image → 400 → text retry)
    // on every single step for the rest of the run.
    expect(requests).toHaveLength(1);
    expect(hasImage(requests[0])).toBe(false);
  });

  test('the degraded request is materially smaller (that is the point)', async () => {
    useProvider();
    const big = 'A'.repeat(40000);

    await call(agentState(), big);
    const withImage = JSON.stringify(requests[0]).length;

    requests = [];
    resetLLMRateLimiter();
    await call(agentState({ visionDegraded: true }), big);
    const without = JSON.stringify(requests[0]).length;

    expect(withImage - without).toBeGreaterThan(35000);
  });

  test('no image argument at all still works and sends no image', async () => {
    useProvider();
    await call(agentState(), null);
    expect(requests).toHaveLength(1);
    expect(hasImage(requests[0])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('supportsVision recognises self-hosted VL builds', () => {
  const VISION = [
    'qwen2.5vl:7b',    // stock ollama tag — the dash-less form the old regex missed
    'qwen2.5vl:3b',
    'qwen3-vl:4b',
    'vl-7b-dspark',    // leading "vl-" segment — matched neither /-vl-/ nor /-vl$/
    'llava:13b',
    'internvl2-8b',
    'InternVL2_5-8B',
    'minicpm-v-2.6',
    'pixtral-12b',
    'moondream2',
    'glm-4.6v',
    'gpt-4o',
    'gemini-2.5-pro',
  ];

  const TEXT_ONLY = [
    'LongCat-2.0-nonthink',
    'LongCat-2.0',
    'llama3.2',
    'deepseek-chat',
    'gpt-3.5-turbo',
    'claude-2.1',
    'qwen2.5-coder:32b',
    'mistral-7b',
    'gemma3-12b',
    'gpt-4o-text-only',
    'nomic-embed-text',
    'phi4',
  ];

  test.each(VISION)('%s is vision-capable', (m) => {
    expect(supportsVision(m)).toBe(true);
  });

  test.each(TEXT_ONLY)('%s is not vision-capable', (m) => {
    expect(supportsVision(m)).toBe(false);
  });

  test('empty and nullish model ids are not vision-capable', () => {
    expect(supportsVision('')).toBe(false);
    expect(supportsVision(null)).toBe(false);
    expect(supportsVision(undefined)).toBe(false);
  });

  test('the -text-only deny suffix still overrides a positive match', () => {
    expect(supportsVision('qwen2.5vl:7b')).toBe(true);
    expect(supportsVision('qwen2.5-vl-text-only')).toBe(false);
  });
});
