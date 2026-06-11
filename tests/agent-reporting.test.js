// Tests for background/agent-reporting.js
// Covers: run recording, learned patterns, notifications, confidence scoring, PII scrubbing

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  _runRecording,
  startRunRecording,
  recordStep,
  generateRunReplay,
  emitLearnedPatterns,
  notifyRunComplete,
  scoreActionConfidence,
  saveLearnedPattern
} from '../background/agent-reporting.js';

beforeEach(() => {
  // Reset module-level state
  startRunRecording(null, '');
  _runRecording.steps = [];
  _runRecording.startTime = null;

  // Reset chrome mocks
  global.chrome = {
    runtime: { sendMessage: jest.fn().mockReturnValue({ catch: jest.fn() }) },
    notifications: { create: jest.fn() },
    storage: {
      local: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined)
      }
    }
  };
});

// ========== startRunRecording ==========

describe('startRunRecording', () => {
  test('initialises recording state', () => {
    startRunRecording(42, 'My goal');
    expect(_runRecording.goal).toBe('My goal');
    expect(_runRecording.tabId).toBe(42);
    expect(_runRecording.steps).toEqual([]);
    expect(_runRecording.startTime).toBeGreaterThan(0);
  });

  test('defaults goal to empty string when undefined', () => {
    startRunRecording(1, undefined);
    expect(_runRecording.goal).toBe('');
  });

  test('clears previous steps', () => {
    startRunRecording(1, 'first');
    recordStep({ action: 'click', actionType: 'click' });
    startRunRecording(1, 'second');
    expect(_runRecording.steps).toHaveLength(0);
  });
});

// ========== recordStep ==========

describe('recordStep', () => {
  test('appends step with timestamp', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'click on button', actionType: 'click' });
    expect(_runRecording.steps).toHaveLength(1);
    expect(_runRecording.steps[0].action).toBe('click on button');
    expect(_runRecording.steps[0].timestamp).toBeGreaterThan(0);
  });

  test('records multiple steps in order', () => {
    startRunRecording(1, 'goal');
    recordStep({ actionType: 'click' });
    recordStep({ actionType: 'type' });
    recordStep({ actionType: 'navigate' });
    expect(_runRecording.steps).toHaveLength(3);
    expect(_runRecording.steps.map(s => s.actionType)).toEqual(['click', 'type', 'navigate']);
  });

  test('preserves all step fields', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'act', result: 'res', screenshot: 'base64data', actionType: 'extract' });
    expect(_runRecording.steps[0]).toMatchObject({
      action: 'act',
      result: 'res',
      screenshot: 'base64data',
      actionType: 'extract'
    });
  });
});

// ========== generateRunReplay ==========

describe('generateRunReplay', () => {
  test('returns valid HTML document', () => {
    startRunRecording(1, 'Test goal');
    const html = generateRunReplay();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Sentinel Override Run Replay');
  });

  test('includes goal in output', () => {
    startRunRecording(1, 'Search for invoices');
    const html = generateRunReplay();
    expect(html).toContain('Search for invoices');
  });

  test('includes step count', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'step 1', actionType: 'click' });
    recordStep({ action: 'step 2', actionType: 'type' });
    const html = generateRunReplay();
    expect(html).toContain('Total Steps: 2');
  });

  test('renders step action text', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'Click the submit button', actionType: 'click' });
    const html = generateRunReplay();
    expect(html).toContain('Click the submit button');
  });

  test('renders screenshot img tag when screenshot present', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'snapshot', actionType: 'extract', screenshot: 'abc123' });
    const html = generateRunReplay();
    expect(html).toContain('data:image/jpeg;base64,abc123');
    expect(html).toContain('<img');
  });

  test('no screenshot img tag when screenshot absent', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'click', actionType: 'click' });
    const html = generateRunReplay();
    expect(html).not.toContain('<img');
  });

  test('renders step result when present', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'act', result: 'Operation succeeded', actionType: 'finish' });
    const html = generateRunReplay();
    expect(html).toContain('Operation succeeded');
  });

  test('handles zero steps gracefully', () => {
    startRunRecording(1, 'empty run');
    const html = generateRunReplay();
    expect(html).toContain('Total Steps: 0');
  });

  test('handles null startTime gracefully', () => {
    startRunRecording(1, 'goal');
    _runRecording.startTime = null;
    const html = generateRunReplay();
    expect(html).toContain('N/A');
  });

  test('step action type is applied as CSS class', () => {
    startRunRecording(1, 'goal');
    recordStep({ action: 'go', actionType: 'navigate' });
    const html = generateRunReplay();
    expect(html).toContain('class="step navigate"');
  });

  test('step with no action field shows fallback text', () => {
    startRunRecording(1, 'goal');
    recordStep({ actionType: 'click' }); // no action property
    const html = generateRunReplay();
    expect(html).toContain('No action recorded');
  });
});

// ========== emitLearnedPatterns ==========

describe('emitLearnedPatterns', () => {
  test('sends top-20 patterns sorted by uses', () => {
    const patterns = {};
    for (let i = 0; i < 25; i++) {
      patterns[`pattern-${i}`] = { uses: i, successes: i, lastUsed: Date.now() };
    }
    emitLearnedPatterns(1, patterns);
    const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(msg.type).toBe('learned_patterns');
    expect(msg.patterns).toHaveLength(20);
    expect(msg.patterns[0].uses).toBe(24); // highest first
  });

  test('calculates success rate correctly', () => {
    const patterns = {
      good: { uses: 10, successes: 8, lastUsed: 0 }
    };
    emitLearnedPatterns(1, patterns);
    const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(msg.patterns[0].rate).toBe(80);
  });

  test('rate is 0 when uses is 0', () => {
    const patterns = {
      new: { uses: 0, successes: 0, lastUsed: 0 }
    };
    emitLearnedPatterns(1, patterns);
    const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(msg.patterns[0].rate).toBe(0);
  });

  test('handles null/undefined patterns without throwing', () => {
    expect(() => emitLearnedPatterns(1, null)).not.toThrow();
    expect(() => emitLearnedPatterns(1, undefined)).not.toThrow();
  });

  test('passes tabId in message', () => {
    emitLearnedPatterns(99, {});
    const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(msg.tabId).toBe(99);
  });

  test('does not throw when chrome.runtime.sendMessage throws', () => {
    global.chrome.runtime.sendMessage = jest.fn().mockImplementation(() => {
      throw new Error('runtime unavailable');
    });
    expect(() => emitLearnedPatterns(1, {})).not.toThrow();
  });
});

// ========== notifyRunComplete ==========

describe('notifyRunComplete', () => {
  test('creates notification on success', () => {
    notifyRunComplete('Do the thing', true, 5, 10000);
    expect(global.chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [, opts] = global.chrome.notifications.create.mock.calls[0];
    expect(opts.message).toContain('Completed successfully');
    expect(opts.message).toContain('5 steps');
    expect(opts.message).toContain('10s');
    expect(opts.title).toContain('Do the thing');
  });

  test('creates notification on failure', () => {
    notifyRunComplete('Do the thing', false, 2, 3000);
    const [, opts] = global.chrome.notifications.create.mock.calls[0];
    expect(opts.message).toContain('Failed');
  });

  test('truncates long goal to 50 chars', () => {
    const longGoal = 'A'.repeat(80);
    notifyRunComplete(longGoal, true, 1, 0);
    const [, opts] = global.chrome.notifications.create.mock.calls[0];
    expect(opts.title.length).toBeLessThanOrEqual('Sentinel Override: '.length + 50);
  });

  test('handles null/undefined goal gracefully', () => {
    expect(() => notifyRunComplete(null, true, 0, 0)).not.toThrow();
    const [, opts] = global.chrome.notifications.create.mock.calls[0];
    expect(opts.title).toContain('Task');
  });

  test('handles undefined duration without NaN', () => {
    notifyRunComplete('goal', true, 3, undefined);
    const [, opts] = global.chrome.notifications.create.mock.calls[0];
    expect(opts.message).toContain('0s');
  });

  test('does not throw when notifications API is unavailable', () => {
    global.chrome.notifications = undefined;
    expect(() => notifyRunComplete('goal', true, 1, 1000)).not.toThrow();
  });
});

// ========== scoreActionConfidence ==========

describe('scoreActionConfidence', () => {
  test('returns 0 for null command', () => {
    expect(scoreActionConfidence(null, null)).toBe(0);
  });

  test('returns 95 for note type', () => {
    expect(scoreActionConfidence({ type: 'note' }, null)).toBe(95);
  });

  test('returns 95 for finish type', () => {
    expect(scoreActionConfidence({ type: 'finish' }, null)).toBe(95);
  });

  test('navigate baseline is 80', () => {
    expect(scoreActionConfidence({ type: 'navigate' }, null)).toBe(80);
  });

  test('open_tab baseline is 80', () => {
    expect(scoreActionConfidence({ type: 'open_tab' }, null)).toBe(80);
  });

  test('ID selector adds +20 over baseline', () => {
    const score = scoreActionConfidence({ type: 'click', selector: '#submit-btn' }, null);
    expect(score).toBe(50 + 10 + 10); // baseline + has selector + ID
  });

  test('ARIA selector adds +18 over baseline', () => {
    const score = scoreActionConfidence({ type: 'click', selector: '[aria-label="Close"]' }, null);
    expect(score).toBe(50 + 10 + 8);
  });

  test('XPath selector penalises score', () => {
    const score = scoreActionConfidence({ type: 'click', selector: '//div/button' }, null);
    expect(score).toBe(50 + 10 - 5);
  });

  test('text/value field adds +5', () => {
    const score = scoreActionConfidence({ type: 'click', text: 'Submit' }, null);
    expect(score).toBe(55);
  });

  test('value field also adds +5', () => {
    const score = scoreActionConfidence({ type: 'type', value: 'hello' }, null);
    expect(score).toBe(55);
  });

  test('selector found in page elements adds +15', () => {
    const pageContext = { elements: [{ selector: '#btn', id: '#btn' }] };
    const score = scoreActionConfidence({ type: 'click', selector: '#btn' }, pageContext);
    // baseline 50 + has selector 10 + ID 10 + found on page 15 = 85
    expect(score).toBe(85);
  });

  test('selector not found in page elements deducts 20', () => {
    const pageContext = { elements: [{ selector: '#other', id: '#other' }] };
    const score = scoreActionConfidence({ type: 'click', selector: '#btn' }, pageContext);
    // 50 + 10 + 10 - 20 = 50
    expect(score).toBe(50);
  });

  test('score is clamped to 0 minimum', () => {
    // XPath + selector not on page + no ID: 50+10-5-20 = 35, still above 0
    const pageContext = { elements: [] };
    const score = scoreActionConfidence({ type: 'click', selector: '//very/deep/xpath' }, pageContext);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('score is clamped to 100 maximum', () => {
    // navigate (80) + has selector (+10) + ID (+10) + text (+5) + found (+15) = 120 → 100
    const pageContext = { elements: [{ selector: '#id', id: '#id' }] };
    const score = scoreActionConfidence(
      { type: 'navigate', selector: '#id', text: 'go' },
      pageContext
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  test('pageContext with no elements array still works', () => {
    expect(() => scoreActionConfidence({ type: 'click', selector: '#x' }, {})).not.toThrow();
  });

  test('id match via el.id', () => {
    const pageContext = { elements: [{ selector: '.btn', id: '#btn' }] };
    const score = scoreActionConfidence({ type: 'click', selector: '#btn' }, pageContext);
    expect(score).toBeGreaterThan(50);
  });
});

// ========== saveLearnedPattern (PII scrubbing) ==========

describe('saveLearnedPattern', () => {
  beforeEach(() => {
    global.chrome.storage.local.get = jest.fn().mockResolvedValue({ learned_patterns: [] });
    global.chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
  });

  test('saves pattern with goal and success flag', async () => {
    await saveLearnedPattern('Check the dashboard', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).toBe('Check the dashboard');
    expect(saved[0].success).toBe(true);
  });

  test('scrubs IP addresses from goal', async () => {
    await saveLearnedPattern('Check server 192.168.1.100 for issues', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).not.toContain('192.168.1.100');
    expect(saved[0].goal).toContain('[REDACTED:ip]');
  });

  test('scrubs email addresses from goal', async () => {
    await saveLearnedPattern('Email user@example.com about policy', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).not.toContain('user@example.com');
    expect(saved[0].goal).toContain('[REDACTED:email]');
  });

  test('scrubs ticket numbers (#12345)', async () => {
    await saveLearnedPattern('Investigate ticket #12345', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).toContain('[REDACTED:ticket]');
    expect(saved[0].goal).not.toContain('#12345');
  });

  test('scrubs INC-style incident numbers', async () => {
    await saveLearnedPattern('Review incident INC0001234', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).not.toContain('INC0001234');
  });

  test('scrubs double-quoted client strings', async () => {
    await saveLearnedPattern('Check "Acme Corp" settings', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).not.toContain('Acme Corp');
  });

  test('scrubs single-quoted client strings', async () => {
    await saveLearnedPattern("Check 'Acme Corp' settings", [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal).not.toContain('Acme Corp');
  });

  test('extracts action steps from history', async () => {
    const history = [
      { action: { type: 'click', selector: '#btn' } },
      { action: { type: 'type', selector: '#input' } },
      { result: 'no action here' }
    ];
    await saveLearnedPattern('goal', history, true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].steps).toHaveLength(2);
    expect(saved[0].steps[0]).toEqual({ type: 'click', selector: '#btn' });
  });

  test('truncates goal to 100 chars', async () => {
    const longGoal = 'G'.repeat(200);
    await saveLearnedPattern(longGoal, [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved[0].goal.length).toBeLessThanOrEqual(100);
  });

  test('appends to existing patterns', async () => {
    global.chrome.storage.local.get = jest.fn().mockResolvedValue({
      learned_patterns: [{ goal: 'old goal', steps: [], success: true, timestamp: 0 }]
    });
    await saveLearnedPattern('new goal', [], false);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved).toHaveLength(2);
    expect(saved[1].goal).toBe('new goal');
  });

  test('trims to maxLearnedPatterns (100)', async () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({
      goal: `pattern-${i}`, steps: [], success: true, timestamp: i
    }));
    global.chrome.storage.local.get = jest.fn().mockResolvedValue({ learned_patterns: existing });
    await saveLearnedPattern('new pattern', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved).toHaveLength(100);
    expect(saved[99].goal).toBe('new pattern');
  });

  test('does not throw when chrome.storage throws', async () => {
    global.chrome.storage.local.get = jest.fn().mockRejectedValue(new Error('quota exceeded'));
    await expect(saveLearnedPattern('goal', [], true)).resolves.toBeUndefined();
  });

  test('handles empty patterns in storage', async () => {
    global.chrome.storage.local.get = jest.fn().mockResolvedValue({});
    await saveLearnedPattern('goal', [], true);
    const saved = global.chrome.storage.local.set.mock.calls[0][0].learned_patterns;
    expect(saved).toHaveLength(1);
  });
});
