// Sentinel Override v3 -- Integration test for agent-engine.js
// Exercises the agent loop with ALL external dependencies mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

// Mock ALL dependencies of agent-engine before importing it
vi.mock('../../background/llm-client.js', () => ({
  callLLMWithRetry: vi.fn(),
  generatePlan: vi.fn(() => Promise.resolve(null)),
  supportsVision: vi.fn(() => false),
  getPlatformContext: vi.fn(() => ''),
  getRelevantPatterns: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../background/tab-manager.js', () => ({
  waitForPageLoad: vi.fn(() => Promise.resolve()),
  injectContentScript: vi.fn(() => Promise.resolve(true)),
  sendMessageWithRetry: vi.fn(() => Promise.resolve({ ok: true, data: { elements: [], content: '' } })),
  takeScreenshot: vi.fn(() => Promise.resolve(null)),
  isValidUrl: vi.fn((url) => {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }),
  getTabInfo: vi.fn(() => Promise.resolve({
    id: 1, url: 'https://example.com', title: 'Test Page', status: 'complete', windowId: 1,
  })),
  setPageLoadConfig: vi.fn(),
}));

vi.mock('../../background/message-protocol.js', () => ({
  sendSilentUpdate: vi.fn(),
  sendActionMessage: vi.fn(),
  sendActionResult: vi.fn(),
  sendReportUpdate: vi.fn(),
  sendTabStateUpdate: vi.fn(),
}));

vi.mock('../../background/report-generator.js', () => ({
  generateReport: vi.fn(() => Promise.resolve({
    summary: 'Test summary',
    fullReport: '### Goal\nTest goal completed.',
    goal: 'Test goal',
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../background/provider-registry.js', () => ({
  getActiveProvider: vi.fn(() => Promise.resolve({
    id: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKey: 'sk-ant-test',
    model: 'claude-haiku-4-5-20251001',
  })),
  migrateLegacySettings: vi.fn(() => Promise.resolve()),
  resolveProvider: vi.fn(() => ({
    id: 'anthropic',
    buildHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (m, s, u) => ({ model: m, system: s, messages: [{ role: 'user', content: u }] }),
    parseResponse: (d) => d.text || 'parsed',
  })),
  PROVIDERS: {},
}));

vi.mock('../../background/shared-state.js', () => ({
  setSPATransitionPending: vi.fn(),
  isSPATransitionPending: vi.fn(() => false),
  clearSPATransition: vi.fn(),
}));

vi.mock('../../background/tab-context.js', () => ({
  getActiveTabId: vi.fn(() => 1),
  setActiveTab: vi.fn(() => true),
  getTabContext: vi.fn(() => ({
    tabId: 1, label: 'Main Task Tab', url: 'https://example.com',
    isActive: true, snapshot: null,
    screenshotCache: { cachedBase64Image: null, lastScreenshotUrl: null },
  })),
  getAllTabContexts: vi.fn(() => []),
  getTabCount: vi.fn(() => 1),
  openTab: vi.fn(() => Promise.resolve({ tabId: 2, label: 'New Tab' })),
  switchToTab: vi.fn(() => Promise.resolve(true)),
  closeTab: vi.fn(() => Promise.resolve()),
  closeAllAgentTabs: vi.fn(() => Promise.resolve()),
  updateSnapshot: vi.fn(),
  resetAllContexts: vi.fn(),
  findTabByLabel: vi.fn(() => null),
  registerInitialTab: vi.fn(),
  handleTabRemoved: vi.fn(),
  TAB_LIMIT: 5,
}));

vi.mock('../../background/frame-router.js', () => ({
  enumerateFrames: vi.fn(() => Promise.resolve([])),
  resolveFrameForSelector: vi.fn(() => Promise.resolve(null)),
  executeInFrame: vi.fn(() => Promise.resolve({ ok: true })),
}));

// Import mocked modules
import { startAgent, stopAgent, resetAgentState } from '../../background/agent-engine.js';
import { callLLMWithRetry } from '../../background/llm-client.js';
import { sendSilentUpdate, sendActionMessage, sendReportUpdate } from '../../background/message-protocol.js';
import { injectContentScript, sendMessageWithRetry, getTabInfo } from '../../background/tab-manager.js';

describe('agent-engine (integration)', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
    // Reset agent state between tests
    try { resetAgentState(); } catch (e) {}
    // Clear mock call history (but NOT implementations)
    vi.clearAllTimers();

    // Override chrome methods with vi.fn() spies for storage
    chromeMock.storage.local.get = vi.fn(async () => ({}));
    chromeMock.storage.local.set = vi.fn(async () => undefined);
    chromeMock.storage.local.remove = vi.fn(async () => undefined);

    // Default: LLM returns finish immediately
    callLLMWithRetry.mockResolvedValue({
      type: 'finish',
      summary: 'Task completed successfully.',
    });
  });

  afterEach(async () => {
    // Wait for any running agent loop to complete, then stop
    // The agent loop sets agentRunning = false when done
    try { await stopAgent(); } catch (e) { /* ignore */ }
    try { resetAgentState(); } catch (e) { /* ignore */ }
    // Give the event loop time to process pending promises
    await new Promise(r => setTimeout(r, 100));
    vi.restoreAllMocks();
  });

  it('startAgent returns "Agent started in background"', async () => {
    const result = await startAgent('Test goal', { tab: { id: 1 } });
    expect(result).toBe('Agent started in background');

    // Wait for the agent loop to complete
    await vi.waitFor(() => {
      expect(callLLMWithRetry).toHaveBeenCalled();
    }, { timeout: 10000 });
  });

  it('agent loop calls key lifecycle functions', async () => {
    const result = await startAgent('Test goal', { tab: { id: 1 } });
    expect(result).toBe('Agent started in background');

    // Wait for the loop to make at least one LLM call
    await vi.waitFor(() => {
      expect(callLLMWithRetry).toHaveBeenCalled();
    }, { timeout: 10000 });

    // Verify key lifecycle calls were made
    expect(getTabInfo).toHaveBeenCalled();
    expect(injectContentScript).toHaveBeenCalled();
    expect(sendMessageWithRetry).toHaveBeenCalled();
  });

  it('agent processes a note command', async () => {
    callLLMWithRetry.mockResolvedValueOnce({
      type: 'note',
      text: 'Found interesting data.',
    }).mockResolvedValueOnce({
      type: 'finish',
      summary: 'Done with notes.',
    });

    await startAgent('Investigate page', { tab: { id: 1 } });

    await vi.waitFor(() => {
      expect(sendSilentUpdate).toHaveBeenCalledWith(
        expect.stringContaining('Found interesting data'),
        expect.any(Number)
      );
    }, { timeout: 10000 });
  });

  it('agent processes navigate and finish commands', async () => {
    // Set specific mock behavior for this test (override default)
    callLLMWithRetry.mockResolvedValue(
      { type: 'navigate', url: 'https://example.com/page' },
      { type: 'finish', summary: 'Navigated and done.' }
    );

    await startAgent('Navigate to page', { tab: { id: 1 } });

    // Wait for the agent loop to make LLM calls
    await vi.waitFor(() => {
      expect(callLLMWithRetry).toHaveBeenCalled();
    }, { timeout: 15000 });

    // Agent should have called LLM at least twice (navigate + finish)
    expect(callLLMWithRetry.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 20000);

  it('agent handles LLM errors and continues', async () => {
    let callNum = 0;
    callLLMWithRetry.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) throw new Error('API Error: 502');
      return { type: 'finish', summary: 'Recovered and finished.' };
    });

    await startAgent('Handle errors', { tab: { id: 1 } });

    await vi.waitFor(() => {
      expect(callLLMWithRetry.mock.calls.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 15000 });
  }, 20000);

  it('agent generates report on finish', async () => {
    callLLMWithRetry.mockResolvedValue({
      type: 'finish',
      summary: 'Task done.',
    });

    await startAgent('Generate report', { tab: { id: 1 } });

    await vi.waitFor(() => {
      expect(sendReportUpdate).toHaveBeenCalledWith('generating');
    }, { timeout: 10000 });
  });

  it('agent reads page and processes observation', async () => {
    callLLMWithRetry.mockResolvedValueOnce({
      type: 'read_page',
    }).mockResolvedValueOnce({
      type: 'finish',
      summary: 'Read complete.',
    });

    await startAgent('Read the page', { tab: { id: 1 } });

    await vi.waitFor(() => {
      // Should have called sendMessageWithRetry for observe_page, read_page
      expect(sendMessageWithRetry).toHaveBeenCalled();
    }, { timeout: 10000 });
  });

  it('rejects startAgent when already running', async () => {
    // First call starts the agent
    callLLMWithRetry.mockImplementation(() => new Promise(() => {})); // Never resolves

    await startAgent('First goal', { tab: { id: 1 } });

    // Second call should throw
    await expect(startAgent('Second goal', { tab: { id: 1 } }))
      .rejects.toThrow('already running');
  });

  it('stopAgent can be called', async () => {
    callLLMWithRetry.mockImplementation(() => new Promise(() => {})); // Never resolves

    await startAgent('Long task', { tab: { id: 1 } });

    const result = await stopAgent();
    expect(result).toBe('Agent stopped');
  });
});
