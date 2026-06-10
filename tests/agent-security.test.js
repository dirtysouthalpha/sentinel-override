// tests/agent-security.test.js
// Tests for agent-security.js pure functions (COV-05).

import {
  _tenantsMatch,
  detectMfaInText,
  evaluateHallucinationRisk,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags
} from '../background/agent-security.js';

describe('_tenantsMatch', () => {
  test('returns true when no expected tenant', () => {
    expect(_tenantsMatch({ chipText: 'Contoso' }, '')).toBe(true);
    expect(_tenantsMatch({ chipText: 'Contoso' }, null)).toBe(true);
  });

  test('returns false when expected but nothing detected', () => {
    expect(_tenantsMatch(null, 'contoso')).toBe(false);
    expect(_tenantsMatch({}, 'contoso')).toBe(false);
  });

  test('matches on chipText', () => {
    expect(_tenantsMatch({ chipText: 'Contoso Tenant' }, 'contoso')).toBe(true);
  });

  test('matches on onmicrosoft', () => {
    expect(_tenantsMatch({ onmicrosoft: 'contoso.onmicrosoft.com' }, 'contoso')).toBe(true);
  });

  test('no match for different tenant', () => {
    expect(_tenantsMatch({ chipText: 'Fabrikam' }, 'contoso')).toBe(false);
  });
});

describe('detectMfaInText', () => {
  test('returns null for empty text', () => {
    expect(detectMfaInText('', 'https://example.com')).toBeNull();
  });

  test('detects tier-1 MFA pattern', () => {
    expect(detectMfaInText('Please approve the sign-in request on your phone', 'https://login.microsoftonline.com/')).toBeTruthy();
  });

  test('detects tier-2 plus auth URL', () => {
    expect(detectMfaInText('Verify your identity to continue', 'https://login.microsoftonline.com/')).toBeTruthy();
  });

  test('returns null for excluded domain', () => {
    expect(detectMfaInText('Please verify your identity with two-factor authentication', 'https://www.amazon.com/s?k=security')).toBeNull();
  });

  test('returns null for non-MFA text', () => {
    expect(detectMfaInText('Welcome to our website', 'https://example.com')).toBeNull();
  });
});

describe('evaluateHallucinationRisk', () => {
  test('flags risky: 3+ claims with 0 evidence', () => {
    const summary = '1. Found A\n2. Found B\n3. Found C';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
  });

  test('passes: claims with evidence', () => {
    const summary = '1. Found A\n2. Found B';
    const result = evaluateHallucinationRisk(summary, { key1: 'val1', key2: 'val2' }, []);
    expect(result.risky).toBe(false);
  });

  test('passes: no summary', () => {
    const result = evaluateHallucinationRisk('', {}, []);
    expect(result.risky).toBe(false);
  });
});

describe('_countSummaryClaims', () => {
  test('counts numbered items', () => {
    expect(_countSummaryClaims('1. A\n2. B\n3. C')).toBe(3);
  });

  test('counts bullets', () => {
    expect(_countSummaryClaims('- A\n- B\n- C')).toBe(3);
  });

  test('returns 0 for empty', () => {
    expect(_countSummaryClaims('')).toBe(0);
    expect(_countSummaryClaims(null)).toBe(0);
  });
});

describe('_countSpecificClaims', () => {
  test('counts percentages', () => {
    expect(_countSpecificClaims('Grew 47% and 15.5%')).toBe(2);
  });

  test('counts dollar amounts', () => {
    expect(_countSpecificClaims('Cost: 5M dollars and 12,345')).toBeGreaterThanOrEqual(1);
  });
});

describe('_countSourceTags', () => {
  test('counts src tags', () => {
    expect(_countSourceTags('Claim [src:firewall_data] and [src:vpn_config]')).toBe(2);
  });

  test('counts unverified tags', () => {
    expect(_countSourceTags('Claim [unverified] and [unverified]')).toBe(2);
  });
});
