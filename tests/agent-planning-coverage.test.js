/**
 * Branch coverage for agent-planning.js uncovered paths:
 *   170-172  _generateInitialPlan — quickMode early return
 *   177-179  _generateInitialPlan — no provider configured
 *   210-212  _generateInitialPlan — bias detected (log + warn)
 *   222-223  _generateInitialPlan — direct mode (both plans null)
 *   322-324  _applyAdaptivePrompts — approval mode, approved decision → adaptedGoal
 */

import { jest } from '@jest/globals';

// ── Module mocks (must appear before any import of the module under test) ──

jest.unstable_mockModule('../background/llm-client.js', () => ({
  generatePlan: jest.fn(async () => null),
  getPlatformContext: jest.fn(() => null),
  getRelevantPatterns: jest.fn(async () => []),
}));

jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: jest.fn(async () => null),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getTextProvider: jest.fn(async () => null),
  getActiveProvider: jest.fn(async () => ({
    endpoint: 'http://llm.internal',
    apiKey: 'test-key',
    model: 'test-model',
  })),
}));

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getTabContext: jest.fn(async () => ({ url: 'https://example.com', title: 'Test Page' })),
}));

jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(),
  sendAgentStatus: jest.fn(),
}));

jest.unstable_mockModule('../background/reasoning-trace.js', () => ({
  captureReasoningStep: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/bias-detector.js', () => ({
  analyzeForBias: jest.fn(() => ({ hasBias: false })),
  shouldTriggerBiasWarning: jest.fn(() => false),
  logBiasDetection: jest.fn(),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  startSwKeepalive: jest.fn(),
  stopSwKeepalive: jest.fn(),
}));

jest.unstable_mockModule('../background/constants.js', () => ({
  FIVE_MINUTES_MS: 300000,
}));

jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e && e.message) || String(e)),
}));

// ── Chrome global ──

let capturedOnMessageListener = null;

globalThis.chrome = {
  runtime: {
    sendMessage: jest.fn(async () => ({})),
    onMessage: {
      addListener: jest.fn((fn) => { capturedOnMessageListener = fn; }),
      removeListener: jest.fn(),
    },
    lastError: null,
  },
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
    },
  },
};

globalThis.crypto = {
  randomUUID: jest.fn(() => 'test-uuid-planning'),
};

// ── Import module under test and mocks (after unstable_mockModule calls) ──

const {
  _generateInitialPlan,
  _applyAdaptivePrompts,
} = await import('../background/agent-planning.js');

const { generatePlan } = await import('../background/llm-client.js');
const { getActiveProvider } = await import('../background/provider-registry.js');
const { sendSilentUpdate } = await import('../background/message-protocol.js');
const { analyzeForBias, shouldTriggerBiasWarning, logBiasDetection } = await import('../background/bias-detector.js');
const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

beforeEach(() => {
  jest.clearAllMocks();
  capturedOnMessageListener = null;
  chrome.runtime.sendMessage.mockResolvedValue({});
  chrome.storage.local.get.mockResolvedValue({});
  chrome.storage.local.set.mockResolvedValue(undefined);
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { capturedOnMessageListener = fn; });
});

// ── _generateInitialPlan ──

describe('_generateInitialPlan — quickMode path (lines 170-172)', () => {
  test('returns null immediately and sends Quick Mode status', async () => {
    const result = await _generateInitialPlan('do something', 1, { quickMode: true });
    expect(result).toBeNull();
    expect(sendSilentUpdate).toHaveBeenCalledWith(expect.stringContaining('Quick Mode'));
    expect(getActiveProvider).not.toHaveBeenCalled();
  });
});

describe('_generateInitialPlan — no provider path (lines 177-179)', () => {
  test('returns null and notifies when no provider is configured', async () => {
    getActiveProvider.mockResolvedValueOnce(null);
    const result = await _generateInitialPlan('do something', 1, { quickMode: false });
    expect(result).toBeNull();
    expect(sendSilentUpdate).toHaveBeenCalledWith(
      expect.stringContaining('No provider')
    );
  });
});

describe('_generateInitialPlan — bias detection path (lines 210-212)', () => {
  test('logs bias when analyzeForBias detects bias and shouldTriggerBiasWarning is true', async () => {
    generatePlan.mockResolvedValueOnce(['Step 1', 'Step 2']);
    analyzeForBias.mockReturnValueOnce({ hasBias: true, reasons: ['loaded_language'] });
    shouldTriggerBiasWarning.mockReturnValueOnce(true);

    const result = await _generateInitialPlan('do something biased', 1, { quickMode: false });

    expect(result).toEqual(['Step 1', 'Step 2']);
    expect(logBiasDetection).toHaveBeenCalledWith(
      expect.objectContaining({ hasBias: true }),
      'plan_generation'
    );
  });
});

describe('_generateInitialPlan — direct mode path (lines 222-223)', () => {
  test('sends "Running in direct mode" when LLM plan is null and heuristic plan is also null', async () => {
    // generatePlan returns null → falls through to heuristic
    generatePlan.mockResolvedValueOnce(null);
    // Empty goal → generateHeuristicPlan(goal, ...) returns null (line 66: if (!goal) return null)
    const result = await _generateInitialPlan('', 1, { quickMode: false });

    expect(result).toBeNull();
    expect(sendSilentUpdate).toHaveBeenCalledWith('Running in direct mode');
  });
});

// ── _applyAdaptivePrompts ──

describe('_applyAdaptivePrompts — approval mode, approved decision (lines 322-324)', () => {
  test('returns adaptedGoal when decision is approved (useOriginal=false, edited=false)', async () => {
    // Return approval mode from storage
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'approval' });

    // rewriteGoalForPlatform returns an adapted result
    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'test-platform' },
      summary: 'Adapted for test platform',
      mismatchHints: [],
      originalGoal: 'original goal text',
      adaptedGoal: 'adapted goal text',
      durationMs: 42,
    });

    // When sendMessage fires for 'adapted_goal_available', schedule the approval response.
    // By the time setTimeout(0) fires, onMessage.addListener has already been called
    // synchronously so capturedOnMessageListener is set — and clearTimeout is called
    // inside the listener, preventing any leaked timer.
    chrome.runtime.sendMessage.mockImplementationOnce(async (msg) => {
      if (msg.action === 'adapted_goal_available' && msg.mode === 'approval') {
        setTimeout(() => {
          if (capturedOnMessageListener) {
            capturedOnMessageListener({
              action: 'adapted_goal_response',
              requestId: msg.requestId,
              approved: true,
              useOriginal: false,
              edited: false,
            });
          }
        }, 0);
      }
      return {};
    });

    const result = await _applyAdaptivePrompts(
      'original goal text',
      { url: 'https://example.com' },
      1,
      null,
      []
    );

    expect(result).toBe('adapted goal text');
  });

  test('sendMessage rejection logs error and flow continues via onMessage (covers L252)', async () => {
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'approval' });
    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'test-send-fail' },
      summary: 'Test',
      mismatchHints: [],
      originalGoal: 'orig',
      adaptedGoal: 'adapted-result',
      durationMs: 1,
    });

    // Make sendMessage reject — triggers the .catch at L252.
    // Also schedule firing the onMessage listener so the inner Promise resolves.
    chrome.runtime.sendMessage.mockImplementationOnce(async (msg) => {
      if (msg.action === 'adapted_goal_available') {
        setTimeout(() => {
          if (capturedOnMessageListener) {
            capturedOnMessageListener({
              action: 'adapted_goal_response',
              requestId: msg.requestId,
              approved: true,
              useOriginal: false,
              edited: false,
            });
          }
        }, 0);
        throw new Error('sendMessage failed');
      }
      return {};
    });

    const result = await _applyAdaptivePrompts('orig', { url: 'https://example.com' }, 1, null, []);
    console.error = origError;

    expect(errors.some(e => e.includes('[finish] Unhandled rejection:'))).toBe(true);
    expect(result).toBe('adapted-result');
  });
});

describe('_generateInitialPlan — LLM returns plan (happy path)', () => {
  test('returns plan array when generatePlan succeeds', async () => {
    generatePlan.mockResolvedValueOnce(['Step 1', 'Step 2', 'Step 3']);
    const result = await _generateInitialPlan('do the thing', 1, { quickMode: false });
    expect(result).toEqual(['Step 1', 'Step 2', 'Step 3']);
    expect(sendSilentUpdate).toHaveBeenCalledWith(expect.stringContaining('Plan ready'));
  });
});

describe('_generateInitialPlan — LLM null, heuristic returns plan', () => {
  test('returns heuristic plan when LLM returns null but heuristic succeeds', async () => {
    generatePlan.mockResolvedValueOnce(null);
    // A non-empty goal with a URL triggers heuristic navigation plan
    const result = await _generateInitialPlan('go to https://example.com and click submit', 1, { quickMode: false });
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(sendSilentUpdate).toHaveBeenCalledWith(expect.stringContaining('Basic plan'));
  });
});

describe('_applyAdaptivePrompts — mode off', () => {
  test('returns original goal immediately when mode is off', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'off' });
    const result = await _applyAdaptivePrompts('my goal', { url: 'https://example.com' }, 1, null, []);
    expect(result).toBe('my goal');
    expect(rewriteGoalForPlatform).not.toHaveBeenCalled();
  });
});

describe('_applyAdaptivePrompts — result.adapted is false', () => {
  test('returns original goal when rewriteGoalForPlatform returns adapted=false', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'auto' });
    rewriteGoalForPlatform.mockResolvedValueOnce({ adapted: false, adaptedGoal: 'ignored' });
    const result = await _applyAdaptivePrompts('my goal', { url: 'https://example.com' }, 1, null, []);
    expect(result).toBe('my goal');
  });
});

describe('_applyAdaptivePrompts — result is null', () => {
  test('returns original goal when rewriteGoalForPlatform returns null', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'auto' });
    rewriteGoalForPlatform.mockResolvedValueOnce(null);
    const result = await _applyAdaptivePrompts('my goal', { url: 'https://example.com' }, 1, null, []);
    expect(result).toBe('my goal');
  });
});

describe('_applyAdaptivePrompts — auto mode', () => {
  test('returns adaptedGoal and broadcasts card in auto mode', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'auto' });
    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'jira' },
      summary: 'Adapted for Jira',
      mismatchHints: [],
      originalGoal: 'my goal',
      adaptedGoal: 'my jira-adapted goal',
      durationMs: 10,
    });
    const result = await _applyAdaptivePrompts('my goal', { url: 'https://jira.example.com' }, 1, null, []);
    expect(result).toBe('my jira-adapted goal');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'adapted_goal_available', mode: 'auto' })
    );
  });
});

describe('_applyAdaptivePrompts — approval: useOriginal=true', () => {
  test('returns original goal when user selects useOriginal', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'approval' });
    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'salesforce' },
      summary: 'Adapted',
      mismatchHints: [],
      originalGoal: 'original',
      adaptedGoal: 'adapted',
      durationMs: 5,
    });
    chrome.runtime.sendMessage.mockImplementationOnce(async (msg) => {
      if (msg.action === 'adapted_goal_available') {
        setTimeout(() => {
          if (capturedOnMessageListener) {
            capturedOnMessageListener({
              action: 'adapted_goal_response',
              requestId: msg.requestId,
              approved: false,
              useOriginal: true,
              edited: false,
            });
          }
        }, 0);
      }
      return {};
    });
    const result = await _applyAdaptivePrompts('original', { url: 'https://salesforce.com' }, 1, null, []);
    expect(result).toBe('original');
  });
});

describe('_applyAdaptivePrompts — approval: edited goal', () => {
  test('returns editedGoal when user edits the adapted goal', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'approval' });
    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'salesforce' },
      summary: 'Adapted',
      mismatchHints: [],
      originalGoal: 'original',
      adaptedGoal: 'adapted',
      durationMs: 5,
    });
    chrome.runtime.sendMessage.mockImplementationOnce(async (msg) => {
      if (msg.action === 'adapted_goal_available') {
        setTimeout(() => {
          if (capturedOnMessageListener) {
            capturedOnMessageListener({
              action: 'adapted_goal_response',
              requestId: msg.requestId,
              approved: false,
              useOriginal: false,
              edited: true,
              editedGoal: 'user-custom goal text here',
            });
          }
        }, 0);
      }
      return {};
    });
    const result = await _applyAdaptivePrompts('original', { url: 'https://salesforce.com' }, 1, null, []);
    expect(result).toBe('user-custom goal text here');
  });
});

describe('_applyAdaptivePrompts — outer catch', () => {
  test('returns original goal when rewriteGoalForPlatform throws', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({ adaptivePromptsMode: 'auto' });
    rewriteGoalForPlatform.mockRejectedValueOnce(new Error('LLM service unavailable'));
    const result = await _applyAdaptivePrompts('my goal', { url: 'https://example.com' }, 1, null, []);
    expect(result).toBe('my goal');
  });
});
