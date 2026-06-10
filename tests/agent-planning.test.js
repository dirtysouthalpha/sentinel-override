// tests/agent-planning.test.js
// Tests for agent-planning.js pure functions (COV-03).

import { generateHeuristicPlan, BARE_SITE_MAP } from '../background/agent-planning.js';

describe('generateHeuristicPlan', () => {
  test('returns null for empty goal', () => {
    expect(generateHeuristicPlan('', 'https://example.com')).toBeNull();
    expect(generateHeuristicPlan(null, 'https://example.com')).toBeNull();
  });

  test('generates multi-page plan for "top 5 articles" pattern', () => {
    const plan = generateHeuristicPlan('Find top 5 articles about cybersecurity', 'https://google.com');
    expect(plan).not.toBeNull();
    expect(plan.length).toBeGreaterThan(5);
    expect(plan[0]).toContain('Search');
  });

  test('generates navigation plan when goal has URL', () => {
    const plan = generateHeuristicPlan('Go to https://reddit.com and summarize', 'https://google.com');
    expect(plan).not.toBeNull();
    expect(plan[0]).toContain('reddit.com');
  });

  test('generates search plan for search queries', () => {
    const plan = generateHeuristicPlan('Search for best practices for SonicWall firewall configuration', 'https://google.com');
    expect(plan).not.toBeNull();
    expect(plan.length).toBeGreaterThan(2);
  });

  test('generates generic fallback for vague goals', () => {
    const plan = generateHeuristicPlan('do something useful', 'https://example.com');
    expect(plan).not.toBeNull();
    expect(plan.length).toBeGreaterThan(0);
  });

  test('skips navigation when already on target site', () => {
    const plan = generateHeuristicPlan('Go to https://reddit.com and find info', 'https://reddit.com/r/test');
    expect(plan).not.toBeNull();
    expect(plan[0]).not.toContain('Navigate to https://reddit.com');
  });
});

describe('BARE_SITE_MAP', () => {
  test('maps common sites to domains', () => {
    expect(BARE_SITE_MAP.reddit).toBe('reddit.com');
    expect(BARE_SITE_MAP.amazon).toBe('amazon.com');
    expect(BARE_SITE_MAP.github).toBe('github.com');
  });
});
