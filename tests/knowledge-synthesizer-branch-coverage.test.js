// tests/knowledge-synthesizer-branch-coverage.test.js
// Covers remaining uncovered branches in background/knowledge-synthesizer.js.
// Branch IDs and line numbers reference coverage_test/coverage-final.json.

import { jest } from '@jest/globals';
import {
  synthesizeKnowledge,
  storeSynthesis,
  getSynthesisStatistics,
} from '../background/knowledge-synthesizer.js';

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
});

// ─── mergeSimilarItems / clusterSimilarItems / mergeCluster ───────────────────

describe('knowledge-synthesizer branch coverage — mergeSimilarItems', () => {
  test('b13[1] L138: single item without confidence uses 0.5 fallback', async () => {
    // No confidence field → cluster.items[0].confidence || 0.5 fires
    const result = await synthesizeKnowledge([
      { type: 'action', content: 'click the submit button', source: 's1' }
    ]);
    const item = result.synthesized.find(i => i.type === 'action');
    expect(item).toBeDefined();
    expect(item.confidence).toBe(0.5);
  });

  test('b15[1] L176: two dissimilar same-type items produce two separate clusters', async () => {
    // areItemsSimilar(item2, cluster.items[0]) returns false → new cluster created
    // 'click the submit button' vs 'type email address field' → zero word overlap
    const result = await synthesizeKnowledge([
      { type: 'action', content: 'click the submit button', source: 's1', confidence: 0.9 },
      { type: 'action', content: 'type email address field', source: 's2', confidence: 0.8 }
    ]);
    const actionItems = result.synthesized.filter(i => i.type === 'action');
    expect(actionItems.length).toBe(2);
  });

  test('b17[1]+b18[1]+b20[1]+b21[1]+b22[1]+b23[1]: two no-content/confidence/source items cluster together', async () => {
    // Both items have empty content → areItemsSimilar gives similarity=1.0 (both produce Set{''})
    // → b17[1] and b18[1] fire (content||'' for each argument)
    // → items cluster together → mergeCluster runs
    // → item.content||'' fires b20[1], item.confidence||0.5 fires b21[1]+b23[1], item.source||'unknown' fires b22[1]
    const result = await synthesizeKnowledge([
      { type: 'action' },
      { type: 'action' }
    ]);
    expect(result.synthesized.length).toBeGreaterThanOrEqual(1);
    // The merged item's sources should have the 'unknown' fallback applied
    const merged = result.synthesized[0];
    expect(merged.sources).toEqual(['unknown', 'unknown']);
  });
});

// ─── groupBySemanticSimilarity inner j-continue ───────────────────────────────

describe('knowledge-synthesizer branch coverage — groupBySemanticSimilarity b31[0]', () => {
  test('b31[0] L346: inner j-continue fires when item[j] was already assigned by an earlier i', async () => {
    // items[0] and items[2] share identical content → semantically similar → grouped at i=0
    // items[1] has completely different content → not grouped with items[0]
    // At i=1: j=2 is already assigned (from i=0) → assigned.has(j)=true → inner continue fires
    const sharedContent = 'server database backend running latest version';
    const result = await synthesizeKnowledge([
      { type: 'action',      content: sharedContent,                                  source: 's1', confidence: 0.8 },
      { type: 'decision',    content: 'user interface button click action completed', source: 's2', confidence: 0.7 },
      { type: 'observation', content: sharedContent,                                  source: 's3', confidence: 0.9 }
    ]);
    // items[0] and items[2] form one cross-type group → 1 cross_type item
    const crossItems = result.synthesized.filter(i => i.type === 'cross_type');
    expect(crossItems.length).toBe(1);
  });
});

// ─── areSemanticallySimilar content fallbacks ─────────────────────────────────

describe('knowledge-synthesizer branch coverage — areSemanticallySimilar b34[1]+b35[1]', () => {
  test('b34[1]+b35[1] L369-370: content||"" fallback fires when synthesized items have undefined content', async () => {
    // Two different-type sources with no content → after synthesizeByType, each merged item has content=undefined
    // crossTypeSynthesis calls areSemanticallySimilar(m0, m1):
    //   content1 = m0.content || '' → undefined → '' → b34[1] fires
    //   content2 = m1.content || '' → undefined → '' → b35[1] fires
    //   words1=[], words2=[] → return false → no cross_type group formed
    const result = await synthesizeKnowledge([
      { type: 'action',      source: 's1' },
      { type: 'observation', source: 's2' }
    ]);
    const crossItems = result.synthesized.filter(i => i.type === 'cross_type');
    expect(crossItems.length).toBe(0);
  });
});

// ─── areContradictory empty statement and sharedWords < 2 ────────────────────

describe('knowledge-synthesizer branch coverage — areContradictory b42[1]+b43[1]+b45[1]', () => {
  test('b42[1]+b43[1]+b45[1]: trailing period creates empty statement; single shared word stays below threshold', async () => {
    // content='click.' → split by /[.;]/ → ['click', '']
    //   'click'.trim() = 'click', length>0 → pushed
    //   ''.trim()      = '',     length=0 → NOT pushed → b42[1] (item1) and b43[1] (item2) fire
    // statements=['click'] for each item → stmt1='click', stmt2='click'
    //   sharedWords=['click'] (5>=3, in both) → length=1 < 2 → b45[1] fires (if not entered)
    //   → no contradiction detected
    // Both items are semantically similar (shared 4-char word 'click.') → cross_type item created
    const result = await synthesizeKnowledge([
      { type: 'action',      content: 'click.', source: 's1', confidence: 0.8 },
      { type: 'observation', content: 'click.', source: 's2', confidence: 0.8 }
    ]);
    const crossItems = result.synthesized.filter(i => i.type === 'cross_type');
    expect(crossItems.length).toBe(1);
    const conflicts = (result.conflicts || []).filter(c => c.type === 'cross_type');
    expect(conflicts.length).toBe(0);
  });
});

// ─── getSynthesisStatistics fallbacks ────────────────────────────────────────

describe('knowledge-synthesizer branch coverage — getSynthesisStatistics', () => {
  test('b50[1] L503: synthesis.entries||[] fires when stored object has no entries key', async () => {
    // getSynthesis() returns the stored object as-is when it is truthy
    // If it has no entries key, synthesis.entries is undefined → || [] fires → entries=[] → early return
    storageMock['synthesized_knowledge_current'] = { no_entries_key: true };
    const stats = await getSynthesisStatistics();
    expect(stats.totalSyntheses).toBe(0);
    expect(stats.totalSynthesized).toBe(0);
  });

  test('b52[1]+b53[1]+b54[1]+b55[1]: entries missing synthesized/conflicts/gaps fields use [] fallback', async () => {
    // storeSynthesis with a bare object (no synthesized, conflicts, gaps arrays)
    // getSynthesisStatistics iterates entries:
    //   entry.synthesized || []  → undefined → [] → b52[1] fires
    //   entry.conflicts  || []  → undefined → [] → b53[1] fires
    //   entry.gaps       || []  → undefined → [] → b54[1] fires
    //   (entry.synthesized || []) in for-of loop → undefined → [] → b55[1] fires
    await storeSynthesis({ summary: 'run finished', goal: 'test goal' });
    const stats = await getSynthesisStatistics();
    expect(stats.totalSyntheses).toBe(1);
    expect(stats.totalSynthesized).toBe(0);
    expect(stats.totalConflicts).toBe(0);
    expect(stats.totalGaps).toBe(0);
  });
});
