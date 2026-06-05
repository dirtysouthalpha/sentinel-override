// Comprehensive tests for template-manager.js pure functions
import { jest } from '@jest/globals';

let extractParameters;

beforeAll(async () => {
  const mod = await import('../background/template-manager.js');
  extractParameters = mod.extractParameters;
});

// ============================================================
// extractParameters
// ============================================================
describe('extractParameters', () => {
  // --- Edge cases ---
  test('returns empty for null', () => {
    expect(extractParameters(null)).toEqual([]);
  });
  test('returns empty for undefined', () => {
    expect(extractParameters(undefined)).toEqual([]);
  });
  test('returns empty for empty string', () => {
    expect(extractParameters('')).toEqual([]);
  });
  test('returns empty for number', () => {
    expect(extractParameters(42)).toEqual([]);
  });
  test('returns empty for object', () => {
    expect(extractParameters({})).toEqual([]);
  });
  test('returns empty for boolean', () => {
    expect(extractParameters(true)).toEqual([]);
  });
  test('returns empty for array', () => {
    expect(extractParameters([])).toEqual([]);
  });
  test('returns empty for string with no params', () => {
    expect(extractParameters('click the button')).toEqual([]);
  });

  // --- Single parameter ---
  test('extracts single parameter', () => {
    const params = extractParameters('Check ::url:: for issues');
    expect(params).toHaveLength(1);
    expect(params[0].key).toBe('url');
  });
  test('single param has correct label', () => {
    const params = extractParameters('Navigate to ::target_url::');
    expect(params[0].label).toBe('Target Url');
  });
  test('single param has empty defaultValue', () => {
    const params = extractParameters('Go to ::url::');
    expect(params[0].defaultValue).toBe('');
  });

  // --- Multiple parameters ---
  test('extracts two parameters', () => {
    const params = extractParameters('Check ::url:: for ::username::');
    expect(params).toHaveLength(2);
    expect(params[0].key).toBe('url');
    expect(params[1].key).toBe('username');
  });
  test('extracts three parameters', () => {
    const params = extractParameters('Login to ::url:: with ::user:: and ::pass::');
    expect(params).toHaveLength(3);
    expect(params.map(p => p.key)).toEqual(['url', 'user', 'pass']);
  });
  test('extracts many parameters', () => {
    const params = extractParameters('::a:: ::b:: ::c:: ::d:: ::e::');
    expect(params).toHaveLength(5);
  });

  // --- Deduplication ---
  test('deduplicates same parameter', () => {
    const params = extractParameters('Check ::url:: and then check ::url:: again');
    expect(params).toHaveLength(1);
    expect(params[0].key).toBe('url');
  });
  test('deduplicates three occurrences', () => {
    const params = extractParameters('::url:: ::url:: ::url::');
    expect(params).toHaveLength(1);
  });

  // --- Label formatting ---
  test('underscores become spaces in label', () => {
    const params = extractParameters('Check ::target_url::');
    expect(params[0].label).toBe('Target Url');
  });
  test('title cases the label', () => {
    const params = extractParameters('Use ::client_name::');
    expect(params[0].label).toBe('Client Name');
  });
  test('handles single character key', () => {
    const params = extractParameters('Get ::x::');
    expect(params[0].key).toBe('x');
    expect(params[0].label).toBe('X');
  });
  test('handles uppercase key', () => {
    const params = extractParameters('Get ::URL::');
    expect(params[0].key).toBe('URL');
  });
  test('handles numeric key', () => {
    const params = extractParameters('Get ::123::');
    expect(params[0].key).toBe('123');
  });
  test('handles mixed key', () => {
    const params = extractParameters('Get ::client_id_2::');
    expect(params[0].key).toBe('client_id_2');
    expect(params[0].label).toBe('Client Id 2');
  });

  // --- Whitespace in goal ---
  test('handles extra whitespace', () => {
    const params = extractParameters('  Check ::url::   ');
    expect(params).toHaveLength(1);
  });
  test('handles multiline goal', () => {
    const params = extractParameters('Line 1\nCheck ::url::\nLine 3');
    expect(params).toHaveLength(1);
  });

  // --- Param at boundaries ---
  test('param at start of string', () => {
    const params = extractParameters('::url:: check this');
    expect(params).toHaveLength(1);
  });
  test('param at end of string', () => {
    const params = extractParameters('check ::url::');
    expect(params).toHaveLength(1);
  });
  test('param only content', () => {
    const params = extractParameters('::url::');
    expect(params).toHaveLength(1);
  });

  // --- Invalid patterns ---
  test('single colon does not match', () => {
    expect(extractParameters(':url:')).toEqual([]);
  });
  test('triple colon does not match', () => {
    expect(extractParameters(':::url:::')).toEqual([expect.objectContaining({key:'url'})]);
  });
  test('colon in word does not match', () => {
    expect(extractParameters('client::url')).toEqual([]);
  });

  // --- Complex templates ---
  test('MSP audit template', () => {
    const goal = 'Investigate ::user_email:: in Entra ID for sign-in anomalies from ::ip_address::';
    const params = extractParameters(goal);
    expect(params).toHaveLength(2);
    expect(params[0].key).toBe('user_email');
    expect(params[1].key).toBe('ip_address');
  });
  test('firewall template', () => {
    const goal = 'Block port ::port_number:: from ::source_zone:: to ::dest_zone:: on ::firewall_ip::';
    const params = extractParameters(goal);
    expect(params).toHaveLength(4);
  });
});
