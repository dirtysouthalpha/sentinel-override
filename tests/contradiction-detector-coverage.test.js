/**
 * Contradiction-detector branch coverage tests.
 * Targets paths not hit by contradiction-detector.test.js.
 */

import { jest } from '@jest/globals';
import {
  analyzeForContradictions,
  compareResponsesForContradictions,
  logContradictionDetection,
  getContradictionLog,
  getContradictionStatistics,
  clearContradictionLog,
} from '../background/contradiction-detector.js';

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
      remove: jest.fn(async (key) => { delete storageMock[key]; })
    }
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
});

// ── findDirectNegationContradictions: partial term inclusion ──────────────────

describe('findDirectNegationContradictions — partial term match', () => {
  test('term1.includes(term2): "active and ready" includes "active" → contradiction detected', () => {
    // IS_PATTERN_RE captures "active and ready" in sent1
    // NOT_PATTERN_RE captures "active" in sent2
    // "active and ready".includes("active") → true
    const text = 'The server is active and ready. The server is not active.';
    const result = analyzeForContradictions(text);
    const direct = result.contradictions.filter(c => c.type === 'direct_negation');
    expect(direct.length).toBeGreaterThan(0);
  });

  test('term2.includes(term1): "active" in sent1, "active and running" in sent2 → contradiction detected', () => {
    // IS_PATTERN_RE captures "active" in sent1
    // NOT_PATTERN_RE captures "active and running" in sent2
    // "active and running".includes("active") → true
    const text = 'The service is active. The service is not active and running.';
    const result = analyzeForContradictions(text);
    const direct = result.contradictions.filter(c => c.type === 'direct_negation');
    expect(direct.length).toBeGreaterThan(0);
  });
});

// ── findConditionalContradictions: cond1.includes(cond2) and cond2.includes(cond1) ──

describe('findConditionalContradictions — partial condition overlap', () => {
  test('cond1.includes(cond2): longer condition contains shorter → detected as contradiction', () => {
    // "the user is logged in and active" contains "the user is logged in"
    const text = 'If the user is logged in then access is granted. ' +
      'If the user is logged in and active then access is not granted.';
    const result = analyzeForContradictions(text);
    const conds = result.contradictions.filter(c => c.type === 'conditional');
    expect(conds.length).toBeGreaterThan(0);
  });

  test('cond2.includes(cond1): shorter condition contained in longer → detected', () => {
    const text = 'If the flag is set then the process will start. ' +
      'If the flag is set and verified then the process will not start.';
    const result = analyzeForContradictions(text);
    const conds = result.contradictions.filter(c => c.type === 'conditional');
    expect(conds.length).toBeGreaterThan(0);
  });
});

// ── areContradictoryStatements: different verbs → return false ────────────────

describe('areContradictoryStatements — mismatched verbs → no cross-response contradiction', () => {
  test('same subject but different verbs → no cross-response contradiction', () => {
    // Response1: "The server is running" → verb: "is", obj: "running"
    // Response2: "The server has stopped" → verb: "has", obj: "stopped"
    // verb1 ("is") !== verb2 ("has") and neither includes the other → return false
    const result = compareResponsesForContradictions(
      'The server is running without issues.',
      'The server has stopped unexpectedly.'
    );
    // Cross-response contradictions should be empty (verbs differ)
    expect(result.crossResponseContradictions.length).toBe(0);
  });
});

// ── areContradictoryStatements: cleanObj partial match → return true ──────────

describe('areContradictoryStatements — partial object match → cross-response contradiction', () => {
  test('cleanObj1.includes(cleanObj2): broader obj contains negated base → contradiction', () => {
    // stmt1: "The cache is valid and working" → obj: "valid and working", no negation → cleanObj1: "valid and working"
    // stmt2: "The cache is not valid" → obj: "not valid" → cleanObj2: "valid"
    // "valid and working".includes("valid") → true → contradiction detected
    const result = compareResponsesForContradictions(
      'The cache is valid and working.',
      'The cache is not valid.'
    );
    expect(result.crossResponseContradictions.length).toBeGreaterThan(0);
  });

  test('cleanObj2.includes(cleanObj1): negated narrower phrase → contradiction', () => {
    // stmt1: "The token is expired" → obj: "expired"
    // stmt2: "The token is not expired and still valid" → cleanObj: "expired and still valid"
    // "expired and still valid".includes("expired") → true → contradiction detected
    const result = compareResponsesForContradictions(
      'The token is expired.',
      'The token is not expired and still valid.'
    );
    expect(result.crossResponseContradictions.length).toBeGreaterThan(0);
  });
});

// ── getContradictionStatistics: low severity path ────────────────────────────

describe('getContradictionStatistics — low severity branch', () => {
  test('bySeverity.low is incremented when a low-severity contradiction is logged', async () => {
    // logContradictionDetection only stores what we pass — we can pass a manual analysis
    await logContradictionDetection({
      hasContradictions: true,
      contradictions: [
        { type: 'numerical', severity: 'low' },
        { type: 'temporal', severity: 'medium' }
      ],
      totalScore: 2
    });

    const stats = await getContradictionStatistics();
    expect(stats.bySeverity.low).toBe(1);
    expect(stats.bySeverity.medium).toBe(1);
    expect(stats.totalDetections).toBe(1);
  });
});

// ── logContradictionDetection: default step=0 ────────────────────────────────

describe('logContradictionDetection — default step parameter', () => {
  test('step defaults to 0 when not provided', async () => {
    await logContradictionDetection({
      hasContradictions: true,
      contradictions: [{ type: 'direct_negation', severity: 'high' }],
      totalScore: 1
    });
    // No step argument → step=0 in the stored entry
    const log = await getContradictionLog();
    expect(log.length).toBe(1);
    expect(log[0].step).toBe(0);
  });
});

// ── findQuantifierContradictions: match1 && match2 same subject ───────────────

describe('findQuantifierContradictions — same subject triggers detection', () => {
  test('universal and existential about same subject in separate sentences', () => {
    // "result is always correct" matches subjectPattern for 'always'
    // "result is sometimes wrong" matches subjectPattern for 'sometimes' with subject 'result'
    // → match1[1] === match2[1] → contradiction
    const text = 'result is always correct in this system. result is sometimes wrong in edge cases.';
    const result = analyzeForContradictions(text);
    const quant = result.contradictions.filter(c => c.type === 'quantifier');
    expect(quant.length).toBeGreaterThan(0);
    expect(quant[0].subject).toBeDefined();
  });
});

// ── analyzeForContradictions: falsy inputs ────────────────────────────────────

describe('analyzeForContradictions — falsy input guard', () => {
  test('empty string returns no contradictions', () => {
    const result = analyzeForContradictions('');
    expect(result.hasContradictions).toBe(false);
    expect(result.contradictions).toEqual([]);
  });

  test('null returns no contradictions', () => {
    const result = analyzeForContradictions(null);
    expect(result.hasContradictions).toBe(false);
  });

  test('number input returns no contradictions', () => {
    const result = analyzeForContradictions(42);
    expect(result.hasContradictions).toBe(false);
  });
});

// ── clearContradictionLog: covers the try path ───────────────────────────────

describe('clearContradictionLog — with populated log', () => {
  test('clears existing log entries', async () => {
    await logContradictionDetection({
      hasContradictions: true,
      contradictions: [{ type: 'temporal', severity: 'medium' }],
      totalScore: 1
    });
    let log = await getContradictionLog();
    expect(log.length).toBe(1);

    await clearContradictionLog();
    log = await getContradictionLog();
    expect(log.length).toBe(0);
  });
});

// ── findTemporalContradictions: push + break (lines 111, 117) ────────────────

describe('findTemporalContradictions — before+after in same sentence (lines 111, 117)', () => {
  test('sentence containing both a before-word and an after-word triggers temporal contradiction', () => {
    // "before" is in markerGroup[0].before, "after" is in markerGroup[0].after
    // Both appear in the same sentence → contradictions.push() (line 111) and break (line 117)
    const text = 'The task was completed before the deadline, but after the review it was flagged.';
    const result = analyzeForContradictions(text);
    const temporal = result.contradictions.filter(c => c.type === 'temporal');
    expect(temporal.length).toBeGreaterThan(0);
    expect(temporal[0].markers).toContain('before');
    expect(temporal[0].markers).toContain('after');
    expect(temporal[0].severity).toBe('medium');
  });

  test('sentence with "previously" and "not yet" triggers temporal group 2', () => {
    // "previously" is in markerGroup[1].before, "not yet" is in markerGroup[1].after
    const text = 'The system was previously configured but is not yet fully deployed.';
    const result = analyzeForContradictions(text);
    const temporal = result.contradictions.filter(c => c.type === 'temporal');
    expect(temporal.length).toBeGreaterThan(0);
    expect(temporal[0].markers).toContain('previously');
    expect(temporal[0].markers).toContain('not yet');
  });
});

// ── findQuantifierContradictions: match1 or match2 null → if(match1 && match2) false (line 157) ──

describe('findQuantifierContradictions — no "X is always" pattern → if(match1 && match2) false (line 157)', () => {
  test('universal/existential words present but sentence lacks is/are → match null → no contradiction', () => {
    // "always" in sent1, "sometimes" in sent2, but subjectPattern needs \b[word]\s+is/are\s+always
    // "dogs always run" has no is/are before "always" → match1 = null → branch 10 false
    const text = 'Dogs always run fast out there. Cats sometimes walk slowly.';
    const result = analyzeForContradictions(text);
    expect(result.contradictions.filter(c => c.type === 'quantifier')).toHaveLength(0);
  });
});

// ── findNumericalContradictions: same unit same number → condition false (line 201) ──────────────

describe('findNumericalContradictions — same unit same number → branch 12 false (line 201)', () => {
  test('two occurrences of same number with same unit → no numerical contradiction', () => {
    // matches[i].number === matches[j].number → second part of && is false → branch 12 false
    const text = 'We have 5 cats. We also have 5 cats.';
    const result = analyzeForContradictions(text);
    expect(result.contradictions.filter(c => c.type === 'numerical')).toHaveLength(0);
  });
});

// ── findConditionalContradictions: unrelated conditions → outer if false (branches 14 + 15[2]) ──

describe('findConditionalContradictions — unrelated conditions → outer if false (line 248 branches 14 + 15[2])', () => {
  test('independent conditions: neither includes the other, not equal → no conditional contradiction', () => {
    // cond1="it rains", cond2="the sun shines"
    // cond1.includes(cond2)=false (branch 15[0] evaluated, false) →
    // cond2.includes(cond1)=false (branch 15[1] evaluated, false) →
    // cond1===cond2=false (branch 15[2] evaluated, false) → whole if false (branch 14 false)
    const text = 'If it rains then carry an umbrella. If the sun shines then wear sunglasses.';
    const result = analyzeForContradictions(text);
    expect(result.contradictions.filter(c => c.type === 'conditional')).toHaveLength(0);
  });
});

// ── findConditionalContradictions: both consequences negated → inner if false (branch 16) ────────

describe('findConditionalContradictions — both consequences negated → inner if false (line 254 branch 16)', () => {
  test('same condition, both consequences contain "not" → (h1&&!h2)||(... false, no contradiction', () => {
    // cond1 === cond2 = "it rains" → outer if true; enters block
    // cons1 = "do not go out" → hasNegation1=true; cons2 = "do not forget your coat" → hasNegation2=true
    // (true && false) || (false && true) = false → branch 16 false → no contradiction pushed
    const text = 'If it rains then do not go out. If it rains then do not forget your coat.';
    const result = analyzeForContradictions(text);
    expect(result.contradictions.filter(c => c.type === 'conditional')).toHaveLength(0);
  });
});

// ── findConditionalContradictions: only cons2 negated → (!h1 && h2) branch (branch 17[1]) ───────

describe('findConditionalContradictions — only second consequence negated → branch 17[1] (!h1&&h2)', () => {
  test('same condition, only cons2 has negation → A false so B evaluated and true → contradiction', () => {
    // cond1===cond2="it rains" → outer if true
    // cons1="go inside" → hasNegation1=false; cons2="do not go outside" → hasNegation2=true
    // A=(false&&true)=false → B evaluated: (true&&true)=true → branch 17[1] covered → push contradiction
    const text = 'If it rains then go inside. If it rains then do not go outside.';
    const result = analyzeForContradictions(text);
    expect(result.contradictions.filter(c => c.type === 'conditional').length).toBeGreaterThan(0);
  });
});

// ── areContradictoryStatements: negation mismatch, objects unrelated → if false (branch 26) ─────

describe('areContradictoryStatements — negation mismatch but objects unrelated → if false (line 373 branch 26)', () => {
  test('one object negated, other not, cleaned objects share no overlap → return false', () => {
    // stmt1: "The system is not available" → cleanObj1="available"
    // stmt2: "The system is reliable" → cleanObj2="reliable"
    // hasNegation1=true !== hasNegation2=false → enters block
    // "available"!=="reliable", no includes match → branch 26 false → return false
    const result = compareResponsesForContradictions(
      'The system is not available for requests.',
      'The system is reliable under load.'
    );
    expect(result.crossResponseContradictions.length).toBe(0);
  });
});

// ── areContradictoryStatements: same negation state → return false (line 378) ─

describe('areContradictoryStatements — same negation state falls through to return false (line 378)', () => {
  test('same subject and verb but both objects without negation → no cross-response contradiction', () => {
    // stmt1: "The server is running fine" — obj: "running fine", no negation
    // stmt2: "The server is working properly" — obj: "working properly", no negation
    // hasNegation1 === hasNegation2 (both false) → skips the if block → return false (line 378)
    const result = compareResponsesForContradictions(
      'The server is running fine.',
      'The server is working properly.'
    );
    expect(result.crossResponseContradictions.length).toBe(0);
  });

  test('same subject and verb but both objects with negation → no cross-response contradiction', () => {
    // stmt1: "The service is not ready" — obj: "not ready", hasNegation=true
    // stmt2: "The service is not available" — obj: "not available", hasNegation=true
    // hasNegation1 === hasNegation2 (both true) → cleanObj check skipped → return false (line 378)
    const result = compareResponsesForContradictions(
      'The service is not ready for deployment.',
      'The service is not available right now.'
    );
    expect(result.crossResponseContradictions.length).toBe(0);
  });
});

// ── analyzeForContradictions early-return includes totalScore: 0 ──────────────

describe('analyzeForContradictions — early return includes totalScore', () => {
  test('returns totalScore: 0 for null input', () => {
    const result = analyzeForContradictions(null);
    expect(result.totalScore).toBe(0);
  });

  test('returns totalScore: 0 for empty string input', () => {
    const result = analyzeForContradictions('');
    expect(result.totalScore).toBe(0);
  });

  test('compareResponsesForContradictions gives numeric totalContradictions when both inputs are empty', () => {
    const result = compareResponsesForContradictions('', '');
    expect(typeof result.totalContradictions).toBe('number');
    expect(Number.isNaN(result.totalContradictions)).toBe(false);
    expect(result.totalContradictions).toBe(0);
  });

  test('compareResponsesForContradictions gives numeric totalContradictions when inputs are null', () => {
    const result = compareResponsesForContradictions(null, null);
    expect(typeof result.totalContradictions).toBe('number');
    expect(Number.isNaN(result.totalContradictions)).toBe(false);
    expect(result.totalContradictions).toBe(0);
  });
});

// ── getContradictionStatistics: unknown/undefined severity is silently ignored ─

describe('getContradictionStatistics — unknown severity values are ignored', () => {
  beforeEach(async () => { await clearContradictionLog(); });

  test('undefined severity does not create a junk key in bySeverity', async () => {
    await logContradictionDetection({
      hasContradictions: true,
      contradictions: [{ type: 'direct_negation', severity: undefined }],
      totalScore: 1
    });
    const stats = await getContradictionStatistics();
    // The known keys must still be zero (no valid severity to increment)
    expect(stats.bySeverity.high).toBe(0);
    expect(stats.bySeverity.medium).toBe(0);
    expect(stats.bySeverity.low).toBe(0);
    // No extra keys polluted into bySeverity
    expect(Object.keys(stats.bySeverity)).toEqual(['high', 'medium', 'low']);
  });

  test('unknown string severity does not pollute bySeverity', async () => {
    await logContradictionDetection({
      hasContradictions: true,
      contradictions: [{ type: 'temporal', severity: 'critical' }],
      totalScore: 1
    });
    const stats = await getContradictionStatistics();
    expect(Object.keys(stats.bySeverity)).toEqual(['high', 'medium', 'low']);
    expect(stats.bySeverity.high).toBe(0);
  });
});
