// tests/credit-protection.test.js
// Unit tests for credit protection logic mirroring background/index.js
// record_credit_usage and check_credit_limit message handlers.

// ---- Mirror the handler logic as pure functions ----

function recordCreditUsage(existingUsage, today, inputTokens, outputTokens, model) {
  const usage = { ...existingUsage };
  if (!usage[today]) usage[today] = { tokens: 0, cost: 0, calls: 0 };

  const isFree = (model || '').includes(':free');
  const costPerToken = isFree ? 0 : 0.000003;
  const addedCost = (inputTokens + outputTokens) * costPerToken;

  usage[today] = {
    tokens: usage[today].tokens + inputTokens + outputTokens,
    cost: usage[today].cost + addedCost,
    calls: usage[today].calls + 1,
  };

  // Keep only last 7 days — cutoff = 7 days ago
  const cutoffMs = 7 * 86400000;
  for (const key of Object.keys(usage)) {
    if (key < today && Date.now() - new Date(key).getTime() > cutoffMs) {
      delete usage[key];
    }
  }

  return usage;
}

function checkCreditLimit(usage, today, limit) {
  const todayUsage = usage[today] || { tokens: 0, cost: 0, calls: 0 };
  const effectiveLimit = limit || 5.00;
  return { allowed: todayUsage.cost < effectiveLimit, usage: todayUsage, limit: effectiveLimit };
}

// ---- Tests ----

describe('recordCreditUsage', () => {
  const TODAY = '2026-06-11';

  test('creates today entry when none exists', () => {
    const result = recordCreditUsage({}, TODAY, 100, 50, 'gpt-4o');
    expect(result[TODAY]).toBeDefined();
  });

  test('accumulates tokens for paid model', () => {
    const result = recordCreditUsage({}, TODAY, 100, 50, 'gpt-4o');
    expect(result[TODAY].tokens).toBe(150);
  });

  test('accumulates cost for paid model', () => {
    const result = recordCreditUsage({}, TODAY, 1000, 500, 'gpt-4o');
    expect(result[TODAY].cost).toBeCloseTo(0.0045, 6);
  });

  test('records zero cost for free model', () => {
    const result = recordCreditUsage({}, TODAY, 1000, 500, 'nex-agi/nex-n2-pro:free');
    expect(result[TODAY].cost).toBe(0);
  });

  test('still tracks tokens for free model', () => {
    const result = recordCreditUsage({}, TODAY, 1000, 500, 'google/gemma-4-31b-it:free');
    expect(result[TODAY].tokens).toBe(1500);
  });

  test('increments call counter', () => {
    const result = recordCreditUsage({}, TODAY, 100, 50, 'gpt-4o');
    expect(result[TODAY].calls).toBe(1);
  });

  test('accumulates across multiple calls', () => {
    let usage = recordCreditUsage({}, TODAY, 100, 50, 'gpt-4o');
    usage = recordCreditUsage(usage, TODAY, 200, 100, 'gpt-4o');
    expect(usage[TODAY].tokens).toBe(450);
    expect(usage[TODAY].calls).toBe(2);
  });

  test('handles zero input and output tokens', () => {
    const result = recordCreditUsage({}, TODAY, 0, 0, 'gpt-4o');
    expect(result[TODAY].tokens).toBe(0);
    expect(result[TODAY].cost).toBe(0);
    expect(result[TODAY].calls).toBe(1);
  });

  test('handles null model as paid (not free)', () => {
    const result = recordCreditUsage({}, TODAY, 1000, 0, null);
    expect(result[TODAY].cost).toBeGreaterThan(0);
  });

  test('preserves existing usage for other days', () => {
    const existing = { '2026-06-10': { tokens: 999, cost: 1.5, calls: 10 } };
    const result = recordCreditUsage(existing, TODAY, 100, 50, 'gpt-4o');
    expect(result['2026-06-10']).toBeDefined();
    expect(result['2026-06-10'].tokens).toBe(999);
  });
});

describe('checkCreditLimit', () => {
  const TODAY = '2026-06-11';

  test('allows when no usage yet', () => {
    const result = checkCreditLimit({}, TODAY, 5.00);
    expect(result.allowed).toBe(true);
  });

  test('allows when cost is under the limit', () => {
    const usage = { [TODAY]: { tokens: 1000, cost: 1.00, calls: 5 } };
    const result = checkCreditLimit(usage, TODAY, 5.00);
    expect(result.allowed).toBe(true);
  });

  test('blocks when cost equals limit', () => {
    const usage = { [TODAY]: { tokens: 5000, cost: 5.00, calls: 20 } };
    const result = checkCreditLimit(usage, TODAY, 5.00);
    expect(result.allowed).toBe(false);
  });

  test('blocks when cost exceeds limit', () => {
    const usage = { [TODAY]: { tokens: 10000, cost: 7.50, calls: 30 } };
    const result = checkCreditLimit(usage, TODAY, 5.00);
    expect(result.allowed).toBe(false);
  });

  test('returns todayUsage in response', () => {
    const todayData = { tokens: 500, cost: 0.50, calls: 3 };
    const usage = { [TODAY]: todayData };
    const result = checkCreditLimit(usage, TODAY, 5.00);
    expect(result.usage.tokens).toBe(500);
    expect(result.usage.cost).toBe(0.50);
  });

  test('returns limit in response', () => {
    const result = checkCreditLimit({}, TODAY, 3.00);
    expect(result.limit).toBe(3.00);
  });

  test('defaults limit to 5.00 when not provided', () => {
    const result = checkCreditLimit({}, TODAY, null);
    expect(result.limit).toBe(5.00);
  });

  test('defaults limit to 5.00 when zero passed', () => {
    // 0 is falsy — coerces to 5.00
    const result = checkCreditLimit({}, TODAY, 0);
    expect(result.limit).toBe(5.00);
  });

  test('allows when no usage for today even with other days present', () => {
    const usage = { '2026-06-10': { tokens: 9999, cost: 99.0, calls: 100 } };
    const result = checkCreditLimit(usage, TODAY, 5.00);
    expect(result.allowed).toBe(true);
  });

  test('todayUsage defaults to zero when no entry for today', () => {
    const result = checkCreditLimit({}, TODAY, 5.00);
    expect(result.usage.tokens).toBe(0);
    expect(result.usage.cost).toBe(0);
    expect(result.usage.calls).toBe(0);
  });
});

describe('credit protection — integration: record then check', () => {
  const TODAY = '2026-06-11';
  const LIMIT = 5.00;

  test('stays under limit for a few paid calls', () => {
    let usage = {};
    // 3 small calls, each ~$0.001
    for (let i = 0; i < 3; i++) {
      usage = recordCreditUsage(usage, TODAY, 100, 100, 'gpt-4o');
    }
    const check = checkCreditLimit(usage, TODAY, LIMIT);
    expect(check.allowed).toBe(true);
  });

  test('unlimited calls on free model never hit limit', () => {
    let usage = {};
    for (let i = 0; i < 1000; i++) {
      usage = recordCreditUsage(usage, TODAY, 10000, 10000, 'nex-agi/nex-n2-pro:free');
    }
    const check = checkCreditLimit(usage, TODAY, LIMIT);
    expect(check.allowed).toBe(true);
    expect(check.usage.cost).toBe(0);
    expect(check.usage.calls).toBe(1000);
  });

  test('eventually blocks when many paid calls accumulate', () => {
    let usage = {};
    // Each call costs 0.000003 * 200000 tokens = $0.60
    // 9 calls = $5.40 > $5.00 limit
    for (let i = 0; i < 9; i++) {
      usage = recordCreditUsage(usage, TODAY, 100000, 100000, 'gpt-4o');
    }
    const check = checkCreditLimit(usage, TODAY, LIMIT);
    expect(check.allowed).toBe(false);
  });
});
