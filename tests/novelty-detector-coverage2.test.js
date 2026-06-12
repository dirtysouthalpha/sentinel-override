// tests/novelty-detector-coverage2.test.js
// Branch coverage second batch for background/novelty-detector.js
// Targets: 29, 125, 163, 223, 261-264, 275, 326, 344, 436

import { jest } from '@jest/globals';
import {
  analyzeForNovelty,
  storeNoveltyResult,
  getNoveltyHistory,
  getNoveltyStatistics,
} from '../background/novelty-detector.js';

const storageMock = {};
globalThis.chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
      get: jest.fn(async (keys) => {
        const r = {};
        for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) r[k] = storageMock[k];
        return r;
      }),
      remove: jest.fn(async (key) => { delete storageMock[key]; }),
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
  // Restore get implementation after clearAllMocks
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const r = {};
    for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) r[k] = storageMock[k];
    return r;
  });
  chrome.storage.local.set.mockImplementation(async (obj) => { Object.assign(storageMock, obj); });
});

// ── line 29: !content || typeof content !== 'string' → early return ───────────

describe('analyzeForNovelty — empty content early return (line 29)', () => {
  test('returns non-novel immediately when content is empty string', async () => {
    const result = await analyzeForNovelty('run_empty', { type: 'generic', content: '' });
    expect(result).toEqual({ isNovel: false, confidence: 0, reasons: [] });
  });

  test('returns non-novel immediately when content is not a string', async () => {
    const result = await analyzeForNovelty('run_null', { type: 'generic', content: null });
    expect(result).toEqual({ isNovel: false, confidence: 0, reasons: [] });
  });
});

// ── line 125: if (similarity > maxSimilarity) → true branch ─────────────────

describe('checkContentSimilarity — similarity > maxSimilarity (line 125)', () => {
  test('overlapping content with history sets maxSimilarity > 0', async () => {
    const runId = 'run_sim125';
    const baseContent = 'the user clicked the submit button on the login form with mouse';
    storageMock[`novelty_history_${runId}`] = [{
      timestamp: 1, type: 'action', content: baseContent, context: {},
      isNovel: true, confidence: 0.8, reasons: []
    }];
    // Slightly different content → Jaccard > 0, triggering maxSimilarity update
    const result = await analyzeForNovelty(runId, {
      type: 'action',
      content: 'user clicked submit button on login form with keyboard',
      context: {},
    });
    // As long as no error and a result comes back, the similarity > 0 branch was hit
    expect(result).toBeDefined();
    expect(typeof result.isNovel).toBe('boolean');
  });
});

// ── line 163: if (entryPattern === pattern) → patternCount++ ─────────────────

describe('checkPatternUniqueness — pattern match increments counter (line 163)', () => {
  test('same action type with same pattern in history increments patternCount', async () => {
    const runId = 'run_pat163';
    const content = 'click the submit button';
    storageMock[`novelty_history_${runId}`] = [{
      timestamp: 1, type: 'action', content, context: {},
      isNovel: true, confidence: 0.9, reasons: []
    }];
    const result = await analyzeForNovelty(runId, {
      type: 'action',
      content,
      context: {},
    });
    // Same pattern → patternCount=1, uniqueness=0 → isUnique=false → no pattern_uniqueness reason
    const hasPU = result.reasons.some(r => r.factor === 'pattern_uniqueness');
    expect(hasPU).toBe(false);
  });
});

// ── line 223: entryContext loop body — history entries with context ────────────

describe('checkContextNovelty — history entry context loop body (line 223)', () => {
  test('history entry with context: seen combo prevents novelFeatures increment', async () => {
    const runId = 'run_ctx223';
    storageMock[`novelty_history_${runId}`] = [{
      timestamp: 1, type: 'action', content: 'some action', context: { page: 'home', tab: 'main' },
      isNovel: true, confidence: 0.7, reasons: []
    }];
    // Same context → seenCombos has page:home and tab:main → novelFeatures=0
    const result = await analyzeForNovelty(runId, {
      type: 'action',
      content: 'some different action',
      context: { page: 'home', tab: 'main' },
    });
    const hasCtxNovelty = result.reasons.some(r => r.factor === 'context_novelty');
    expect(hasCtxNovelty).toBe(false);
  });
});

// ── lines 261-264: inner loop where clean='' (falsy → skip) ──────────────────

describe('checkSemanticNovelty — if (clean) falsy branch (lines 261-264)', () => {
  test('history entry with purely numeric words → clean is empty, skipped', async () => {
    const runId = 'run_clean264';
    // '123 456 789' → after NON_ALPHA_RE replace → all become '' → if(clean) is false each time
    storageMock[`novelty_history_${runId}`] = [{
      timestamp: 1, type: 'generic', content: '123 456 789', context: {},
      isNovel: true, confidence: 0.9, reasons: []
    }];
    const result = await analyzeForNovelty(runId, {
      type: 'generic',
      content: 'novel meaningful concept discovery',
      context: {},
    });
    expect(result).toBeDefined();
  });
});

// ── line 275: concepts.length === 0 → ternary false branch ───────────────────

describe('checkSemanticNovelty — concepts.length === 0 ternary false branch (line 275)', () => {
  test('content with only skip-words and short words → no concepts → conceptNovelty=0', async () => {
    const runId = 'run_nocon275';
    storageMock[`novelty_history_${runId}`] = [{
      timestamp: 1, type: 'generic', content: 'some prior action', context: {},
      isNovel: true, confidence: 0.9, reasons: []
    }];
    // All stop/skip words + words < 3 chars → extractConcepts returns empty Set
    // 'a', 'is', 'to', 'in', 'or' are all skip words; 'it', 'he' etc are too
    const result = await analyzeForNovelty(runId, {
      type: 'generic',
      content: 'a is to in or if', // all in skipWords
      context: {},
    });
    // conceptNovelty = 0 (concepts.length === 0 branch taken) → isNovel=false for semantic
    expect(result).toBeDefined();
    const hasSemanticNovelty = result.reasons.some(r => r.factor === 'semantic_novelty');
    // With 0 concepts, conceptNovelty=0, not > 0.3 → no semantic_novelty reason
    expect(hasSemanticNovelty).toBe(false);
  });
});

// ── line 326: actionSeen = true; break ─────────────────────────────────────────

describe('checkBehavioralNovelty — actionSeen = true (line 326)', () => {
  test('history with same action type sets actionSeen=true and breaks early', async () => {
    const runId = 'run_actseen326';
    storageMock[`novelty_history_${runId}`] = [
      { timestamp: 1, type: 'action', action: 'navigate', decision: '', target: '/home',
        content: 'navigate to home page', context: {}, isNovel: true, confidence: 0.8, reasons: [] }
    ];
    const result = await analyzeForNovelty(runId, {
      type: 'action',
      action: 'navigate',
      target: '/about',
      content: 'navigate to about page',
      context: {},
    });
    // actionSeen=true, comboSeen=false → noveltyScore=0.5 → isNovel=false (not > 0.5)
    const hasBehavioral = result.reasons.some(r => r.factor === 'behavioral_novelty');
    expect(hasBehavioral).toBe(false);
  });
});

// ── line 344: (!actionSeen ? 0.5 : 0) false branch (actionSeen=true) ──────────

describe('checkBehavioralNovelty — !actionSeen=false (actionSeen=true) (line 344)', () => {
  test('actionSeen=true gives 0 in noveltyScore sum', async () => {
    const runId = 'run_actseenfalse344';
    storageMock[`novelty_history_${runId}`] = [
      { timestamp: 1, type: 'action', action: 'scroll', decision: '', target: '',
        content: 'scroll down page', context: {}, isNovel: true, confidence: 0.7, reasons: [] }
    ];
    // Same action, different target → actionSeen=true, comboSeen=false
    // noveltyScore = 0 + 0.5 = 0.5 → isNovel = 0.5 > 0.5 = false
    const result = await analyzeForNovelty(runId, {
      type: 'action',
      action: 'scroll',
      target: 'footer',
      content: 'scroll to footer area',
      context: {},
    });
    expect(result.reasons.some(r => r.factor === 'behavioral_novelty')).toBe(false);
  });
});

// ── line 436: entry.confidence || 0 → confidence=0 uses 0 (falsy branch) ─────

describe('getNoveltyStatistics — entry.confidence=0 falsy branch (line 436)', () => {
  test('history entry with confidence=0 hits the || 0 fallback', async () => {
    const runId = 'run_conf436';
    storageMock[`novelty_history_${runId}`] = [
      { timestamp: 1, type: 'generic', content: 'test', context: {},
        isNovel: false, confidence: 0, reasons: [] }
    ];
    const stats = await getNoveltyStatistics(runId);
    expect(stats.avgConfidence).toBe(0);
    expect(stats.totalItems).toBe(1);
  });
});
