// tests/llm-client-intent-fallback.test.js
// Coverage for background/llm-client.js L2370-L2421:
//   finish_reason='tool_calls' intent detection from content/reasoning_content
//   (smart_navigate, navigate URL, navigate_back, navigate site, finish)
//
// To reach L2370 the text-parsing fallback at L2349-2356 must NOT return.
// Strategy: set data.code=1000 → OpenAI parseResponse throws on the auth-error
// check (before reading content), so the catch block runs and execution falls
// through to the finish_reason==='tool_calls' block. message.content is a
// string so _intentText picks it up via the typeof check at L2372.

import { jest } from '@jest/globals';

let _storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        const result = {};
        if (!keys || typeof keys[Symbol.iterator] !== 'function') return Promise.resolve(result);
        for (const k of keys) {
          if (_storageData[k] !== undefined) result[k] = _storageData[k];
        }
        return Promise.resolve(result);
      },
      set: () => Promise.resolve(),
    },
  },
  runtime: { getURL: () => '', sendMessage: () => Promise.resolve() },
  tabs: {
    query: () => Promise.resolve([]),
    create: () => Promise.resolve({ id: 99 }),
    update: () => Promise.resolve(),
    onUpdated: { addListener: jest.fn() },
  },
};

let _mockFetch = null;
const _originalFetch = globalThis.fetch;

import { callLLMWithRetry, resetLLMRateLimiter } from '../background/llm-client.js';
import { resetAllContexts } from '../background/tab-context.js';

const BASE_CONFIG = {
  maxRetries: 0,
  retryDelay: 0,
  maxRetryDelay: 0,
  fetchTimeout: 5000,
  historyWindow: 5,
  strategyShiftThreshold: 3,
};

function makeAgentState(overrides = {}) {
  return {
    apiCallCount: 0,
    consecutiveFailures: 0,
    currentStrategies: [],
    agentMemory: {},
    agentPlan: null,
    currentPlanStep: 0,
    ...overrides,
  };
}

function setupOpenAI() {
  _storageData = {
    active_provider: 'openai',
    providers: {
      openai: {
        api_key: 'test-key',
        model: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1/chat/completions',
      },
    },
  };
}

// Build a fetch mock with data.code=1000 so parseResponse throws its auth-error
// check immediately (before inspecting content). The choices[0].message.content
// string then becomes _intentText via the L2372 typeof-check, exercising the
// intent detection branches. finish_reason='tool_calls' with no tool_calls array
// means hasToolCalls=false, so the raw tool_calls fallback is also skipped.
function makeFallbackFetch(contentText, finishReason = 'tool_calls') {
  return () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      code: 1000,           // triggers parseResponse auth-error throw immediately
      choices: [{
        finish_reason: finishReason,
        message: {
          content: contentText, // lands in _intentText via typeof===string check
          // no tool_calls → hasToolCalls = false
        },
      }],
    }),
  });
}

beforeEach(() => {
  _storageData = {};
  _mockFetch = null;
  globalThis.fetch = (...args) => _mockFetch ? _mockFetch(...args) : _originalFetch(...args);
  resetAllContexts();
  resetLLMRateLimiter();
});

afterEach(() => {
  globalThis.fetch = _originalFetch;
  resetAllContexts();
});

// ─── smart_navigate intent ────────────────────────────────────────────────────

describe('callLLM intent fallback — smart_navigate', () => {
  test('returns smart_navigate when content contains smart_navigate + FORECAST_QUERY_RE matches (google)', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('use smart_navigate to find info');
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'weather for Boston and more',    // FORECAST_QUERY_RE: captures 'Boston'
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('google');
    expect(result.query).toBe('Boston');
  });

  test('returns smart_navigate via FOR_ABOUT_QUERY_RE when FORECAST_QUERY_RE does not match', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate is the tool');
    // goal has no FORECAST_QUERY_RE keyword but FOR_ABOUT_QUERY_RE catches "for X and"
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'go for pizza in Chicago and more',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('google');
    expect(result.query).toBe('pizza in Chicago');
  });

  test('returns smart_navigate with site=weather.gov when goal contains weather.gov', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate now');
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'weather.gov forecast for Seattle and nearby',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('weather.gov');
    expect(result.query).toBe('Seattle');
  });

  test('returns smart_navigate with site=wikipedia when goal contains wikipedia', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate here');
    // FORECAST_QUERY_RE: "search for <X> and" — site name after the query so it doesn't pollute capture
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'search for Marie Curie and her work on wikipedia',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('wikipedia');
    expect(result.query).toBe('Marie Curie');
  });

  test('returns smart_navigate with site=youtube when goal contains youtube', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate');
    // FOR_ABOUT_QUERY_RE: "youtube for <X> and" — no FORECAST keyword so FOR_ABOUT_QUERY_RE fires
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'youtube for cooking tutorials and more',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('youtube');
    expect(result.query).toBe('cooking tutorials');
  });

  test('returns smart_navigate with site=amazon when goal contains amazon', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate tool call');
    // FOR_ABOUT_QUERY_RE: "amazon for <X> and" — no FORECAST keyword
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'amazon for wireless headphones and reviews',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('amazon');
    expect(result.query).toBe('wireless headphones');
  });

  test('returns smart_navigate with site=reddit when goal contains reddit', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate for search');
    // FOR_ABOUT_QUERY_RE: "reddit for <X> and"
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'reddit for javascript tips and tricks',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('reddit');
    expect(result.query).toBe('javascript tips');
  });

  test('returns smart_navigate with site=twitter when goal contains twitter.com', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate proceed');
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'search twitter.com for news about AI and more',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('twitter');
  });

  test('returns smart_navigate with site=twitter when goal contains x.com', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('smart_navigate to proceed');
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'search x.com for trending topics and news',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('smart_navigate');
    expect(result.site).toBe('twitter');
  });

  test('falls through smart_navigate when no query can be extracted (returns note)', async () => {
    setupOpenAI();
    // smart_navigate detected but goal has no matching query pattern → falls through to note
    _mockFetch = makeFallbackFetch('smart_navigate is the plan');
    const result = await callLLMWithRetry(
      [], 0, 'page', null,
      'do something useful',    // no FORECAST_QUERY_RE or FOR_ABOUT_QUERY_RE match
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('note');
  });
});

// ─── navigate URL intent ──────────────────────────────────────────────────────

describe('callLLM intent fallback — navigate URL', () => {
  test('returns navigate with URL when content contains https URL', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('I will navigate to https://example.com to check the page');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'go to a website',
      [], 1, 'https://start.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://example.com');
  });

  test('returns navigate with full path URL from content', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('navigate the url https://docs.example.org/api/guide now');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'open the docs',
      [], 1, 'https://start.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://docs.example.org/api/guide');
  });
});

// ─── navigate_back intent ─────────────────────────────────────────────────────

describe('callLLM intent fallback — navigate_back', () => {
  test('returns navigate_back for "go back" phrase', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('I should go back to find it');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'undo last navigation',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate_back');
  });

  test('returns navigate_back for "back to" phrase', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('back to the search results listed');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'go back',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate_back');
  });

  test('returns navigate_back for "return to" phrase', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('return to the main page first');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'go back',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate_back');
  });

  test('returns navigate_back for "previous page" phrase', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('load the previous page first');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'go back a step',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate_back');
  });
});

// ─── navigate to named site intent ────────────────────────────────────────────

describe('callLLM intent fallback — navigate to named site', () => {
  test('returns navigate to amazon.com for "go to Amazon." in content', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('go to Amazon. Search there.');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'find a product',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://amazon.com');
  });

  test('returns navigate to reddit.com for "navigate to Reddit," in content', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('navigate to Reddit, the internet front page');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'browse reddit',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://reddit.com');
  });

  test('returns navigate to youtube.com for "go to YouTube " in content', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('go to YouTube to watch the tutorial');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'watch a video',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://youtube.com');
  });

  test('returns navigate to github.com for "navigate to GitHub " in content', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('navigate to GitHub to view the code');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'check the repo',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://github.com');
  });

  test('returns navigate to news.ycombinator.com for "go to hacker news." in content', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('go to hacker news. Check the top stories.');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'read tech news',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://news.ycombinator.com');
  });
});

// ─── finish intent ────────────────────────────────────────────────────────────

describe('callLLM intent fallback — finish intent', () => {
  test('returns finish when content has task-complete + task-result keywords', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('Here is the summary report of all findings.');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'investigate the issue',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('finish');
    expect(typeof result.summary).toBe('string');
  });

  test('returns finish for "done" + "results" combination', async () => {
    setupOpenAI();
    _mockFetch = makeFallbackFetch('The task is done. Here are the results of the check.');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'do the task',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('finish');
  });

  test('does NOT return finish when only the first pattern matches (no task/findings keyword)', async () => {
    setupOpenAI();
    // "summary" matches first regex but nothing from second regex is present
    _mockFetch = makeFallbackFetch('A brief summary of what happened so far in this run.');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'do something',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    expect(result.type).toBe('note');
  });
});

// ─── finish_reason != tool_calls ─────────────────────────────────────────────

describe('callLLM intent fallback — finish_reason not tool_calls', () => {
  test('returns note when finish_reason is stop and content is an intent pattern (L2370 block skipped)', async () => {
    setupOpenAI();
    // Even though content contains smart_navigate, finish_reason=stop → L2370 block skipped
    _mockFetch = makeFallbackFetch('smart_navigate to find weather for Boston and more', 'stop');
    const result = await callLLMWithRetry(
      [], 0, 'page', null, 'weather for Boston and more',
      [], 1, 'https://example.com', 0, BASE_CONFIG, makeAgentState()
    );
    // finish_reason !== 'tool_calls' → none of the intent branches fire → note
    expect(result.type).toBe('note');
  });
});
