// tests/agent-engine-pure-functions.test.js
// Comprehensive tests for pure functions in agent-engine.js:
// detectMfaInText, evaluateHallucinationRisk, detectCaptcha, _describeTarget, describeAction
// No complex mocking — all pure function tests.

import {
  detectMfaInText,
  evaluateHallucinationRisk,
  detectCaptcha,
  describeAction,
  _describeTarget,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
} from '../background/agent-engine.js';

// ═══════════════════════════════════════════════════════════════════
// _describeTarget
// ═══════════════════════════════════════════════════════════════════
describe('_describeTarget', () => {
  test('returns (no target) for null/undefined', () => {
    expect(_describeTarget(null)).toBe('(no target)');
    expect(_describeTarget(undefined)).toBe('(no target)');
  });

  test('prefers ariaLabel over other fields', () => {
    const cmd = { ariaLabel: 'MyLabel', elementText: 'Text', label: 'Label', selector: '#x' };
    expect(_describeTarget(cmd)).toBe('"MyLabel"');
  });

  test('prefers elementText over label/selector', () => {
    const cmd = { elementText: 'ElText', label: 'Label', selector: '#x' };
    expect(_describeTarget(cmd)).toBe('"ElText"');
  });

  test('prefers label over selector/ref', () => {
    const cmd = { label: 'MyLabel', selector: '#x', ref: 'ref1' };
    expect(_describeTarget(cmd)).toBe('"MyLabel"');
  });

  test('falls back to selector', () => {
    expect(_describeTarget({ selector: '#my-btn' })).toBe('#my-btn');
  });

  test('falls back to ref', () => {
    expect(_describeTarget({ ref: 'ref42' })).toBe('ref:ref42');
  });

  test('falls back to coordinates', () => {
    expect(_describeTarget({ x: 10, y: 20 })).toBe('(10,20)');
  });

  test('returns (no target) for empty object', () => {
    expect(_describeTarget({})).toBe('(no target)');
  });

  test('truncates ariaLabel to 80 chars', () => {
    const long = 'A'.repeat(100);
    expect(_describeTarget({ ariaLabel: long })).toBe('"' + 'A'.repeat(80) + '"');
  });

  test('truncates elementText to 80 chars', () => {
    const long = 'B'.repeat(100);
    expect(_describeTarget({ elementText: long })).toBe('"' + 'B'.repeat(80) + '"');
  });

  test('truncates label to 80 chars', () => {
    const long = 'C'.repeat(100);
    expect(_describeTarget({ label: long })).toBe('"' + 'C'.repeat(80) + '"');
  });
});

// ═══════════════════════════════════════════════════════════════════
// describeAction — missing command types
// ═══════════════════════════════════════════════════════════════════
describe('describeAction — uncovered types', () => {
  test('navigate_back', () => {
    expect(describeAction({ type: 'navigate_back' })).toBe('Navigate back');
  });

  test('navigate_forward', () => {
    expect(describeAction({ type: 'navigate_forward' })).toBe('Navigate forward');
  });

  test('right_click with ariaLabel', () => {
    expect(describeAction({ type: 'right_click', ariaLabel: 'Menu' })).toBe('Right-click: "Menu"');
  });

  test('double_click with selector', () => {
    expect(describeAction({ type: 'double_click', selector: '.row' })).toBe('Double-click: .row');
  });

  test('drag_and_drop', () => {
    expect(describeAction({
      type: 'drag_and_drop',
      source_label: 'Source',
      target_label: 'Target',
    })).toBe('Drag "Source" → "Target"');
  });

  test('drag_and_drop with refs', () => {
    expect(describeAction({
      type: 'drag_and_drop',
      source_ref: 'ref1',
      target_ref: 'ref2',
    })).toBe('Drag ref:ref1 → ref:ref2');
  });

  test('drag_and_drop with selectors', () => {
    expect(describeAction({
      type: 'drag_and_drop',
      source_selector: '.src',
      target_selector: '.tgt',
    })).toBe('Drag .src → .tgt');
  });

  test('run_remote_command defaults to powershell type', () => {
    expect(describeAction({ type: 'run_remote_command', command: 'Get-Service' }))
      .toBe('Remote cmd (powershell): Get-Service');
  });

  test('run_remote_command with bash type', () => {
    expect(describeAction({ type: 'run_remote_command', command_type: 'bash', command: 'ls' }))
      .toBe('Remote cmd (bash): ls');
  });

  test('default case for unknown type', () => {
    const result = describeAction({ type: 'custom', foo: 'bar' });
    expect(result).toContain('custom:');
    expect(result).toContain('"foo":"bar"');
  });

  test('scroll with amount 0', () => {
    expect(describeAction({ type: 'scroll', amount: 0 })).toBe('Scroll down');
  });

  test('type truncates long text to 80 chars', () => {
    const long = 'A'.repeat(200);
    const result = describeAction({ type: 'type', selector: '#i', text: long });
    // "Type into #i: '" + text.slice(0,80) + "'"
    expect(result).toBe("Type into #i: '" + 'A'.repeat(80) + "'");
    expect(result.length).toBeLessThan(200);
  });

  test('note prefers text over summary', () => {
    expect(describeAction({ type: 'note', text: 'text note', summary: 'summary note' }))
      .toBe('Note: text note');
  });

  test('note uses summary when text is absent', () => {
    expect(describeAction({ type: 'note', summary: 'summary note' }))
      .toBe('Note: summary note');
  });

  test('lookup defaults to A record type', () => {
    expect(describeAction({ type: 'lookup', domain: 'example.com' }))
      .toBe('DNS lookup: example.com (A)');
  });

  test('open_tab prefers label over url', () => {
    expect(describeAction({ type: 'open_tab', label: 'MyTab', url: 'https://test.com' }))
      .toBe('Open tab: MyTab');
  });

  test('open_tab uses url when no label', () => {
    expect(describeAction({ type: 'open_tab', url: 'https://test.com' }))
      .toBe('Open tab: https://test.com');
  });

  test('open_tab with neither returns (no url)', () => {
    expect(describeAction({ type: 'open_tab' })).toBe('Open tab: (no url)');
  });

  test('switch_tab uses label over tab_id', () => {
    expect(describeAction({ type: 'switch_tab', label: 'Tab1', tab_id: 5 }))
      .toBe('Switch to: Tab1');
  });

  test('switch_tab uses tab_id when no label', () => {
    expect(describeAction({ type: 'switch_tab', tab_id: 5 }))
      .toBe('Switch to: 5');
  });

  test('close_tab uses label over tab_id', () => {
    expect(describeAction({ type: 'close_tab', label: 'Old', tab_id: 3 }))
      .toBe('Close tab: Old');
  });
});

// ═══════════════════════════════════════════════════════════════════
// _countSummaryClaims
// ═══════════════════════════════════════════════════════════════════
describe('_countSummaryClaims', () => {
  test('returns 0 for null/undefined/empty', () => {
    expect(_countSummaryClaims(null)).toBe(0);
    expect(_countSummaryClaims(undefined)).toBe(0);
    expect(_countSummaryClaims('')).toBe(0);
    expect(_countSummaryClaims(123)).toBe(0);
  });

  test('counts numbered list entries', () => {
    const summary = '1. Item one\n2. Item two\n3. Item three';
    expect(_countSummaryClaims(summary)).toBe(3);
  });

  test('counts numbered with closing paren', () => {
    const summary = '1) First\n2) Second';
    expect(_countSummaryClaims(summary)).toBe(2);
  });

  test('counts markdown table rows (minus header + separator)', () => {
    const summary = '| Header1 | Header2 |\n| --- | --- |\n| row1a | row1b |\n| row2a | row2b |\n| row3a | row3b |';
    // 5 lines starting with |, minus 2 = 3
    expect(_countSummaryClaims(summary)).toBe(3);
  });

  test('counts top-level bullets', () => {
    const summary = '- Bullet 1\n- Bullet 2\n- Bullet 3\n- Bullet 4';
    expect(_countSummaryClaims(summary)).toBe(4);
  });

  test('uses densest grouping — bullets > numbered', () => {
    const summary = '1. Item\n- A\n- B\n- C\n- D\n- E';
    expect(_countSummaryClaims(summary)).toBe(5); // bullets win
  });

  test('counts indented bullets too (regex allows leading whitespace)', () => {
    // The regex ^\s*[-*]\s allows leading whitespace
    const summary = '  - indented\n  - also indented';
    expect(_countSummaryClaims(summary)).toBe(2);
  });

  test('handles mixed format with headers', () => {
    const summary = '## 1. First item\n## 2. Second item\n## 3. Third item';
    expect(_countSummaryClaims(summary)).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// _countSpecificClaims
// ═══════════════════════════════════════════════════════════════════
describe('_countSpecificClaims', () => {
  test('returns 0 for null/undefined', () => {
    expect(_countSpecificClaims(null)).toBe(0);
    expect(_countSpecificClaims(undefined)).toBe(0);
  });

  test('counts large numbers (4+ digits)', () => {
    const s = 'Found 1,234 items and 5678 records';
    expect(_countSpecificClaims(s)).toBe(2);
  });

  test('counts percentages', () => {
    const s = 'CPU at 85% and RAM at 92.5%';
    expect(_countSpecificClaims(s)).toBe(2);
  });

  test('counts dollar amounts', () => {
    // $5M matches dollar regex. $12,345 matches dollar regex AND large-number regex (12,345 is 5 digits)
    // So: $5M(1) + $12,345-dollar(1) + 12,345-large(1) = 3
    const s = 'Cost is $5M and budget is $12,345';
    expect(_countSpecificClaims(s)).toBe(3);
  });

  test('counts ISO dates', () => {
    // 2024-01-15 matches date regex. Also 2024 matches 4-digit regex, 0115 matches 4-digit regex.
    // 2024-06-30 similarly. So 2 dates + 4 four-digit numbers = 4
    const s = 'Created 2024-01-15 and updated 2024-06-30';
    expect(_countSpecificClaims(s)).toBe(4);
  });

  test('counts month+date patterns', () => {
    // January 15 (1), February 3, 2025 (1), 2025 as 4-digit number (1) = 3
    const s = 'On January 15 and February 3, 2025';
    expect(_countSpecificClaims(s)).toBe(3);
  });

  test('counts dollar amounts with million/billion', () => {
    const s = 'Revenue $50million and expense $2billion';
    expect(_countSpecificClaims(s)).toBe(2);
  });

  test('ignores small numbers (less than 4 digits)', () => {
    const s = 'Found 3 items and 12 records';
    expect(_countSpecificClaims(s)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// _countSourceTags
// ═══════════════════════════════════════════════════════════════════
describe('_countSourceTags', () => {
  test('returns 0 for null/undefined', () => {
    expect(_countSourceTags(null)).toBe(0);
    expect(_countSourceTags(undefined)).toBe(0);
  });

  test('counts [src:key] tags', () => {
    const s = 'Found [src:scan] and [src:memory_1]';
    expect(_countSourceTags(s)).toBe(2);
  });

  test('counts [unverified] tags', () => {
    const s = 'This claim is [unverified] and that is [unverified]';
    expect(_countSourceTags(s)).toBe(2);
  });

  test('counts mixed source tags and unverified', () => {
    const s = 'Data [src:scan] and claim [unverified]';
    expect(_countSourceTags(s)).toBe(2);
  });

  test('returns 0 when no tags present', () => {
    expect(_countSourceTags('Just some plain text')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// evaluateHallucinationRisk — additional coverage
// ═══════════════════════════════════════════════════════════════════
describe('evaluateHallucinationRisk — additional paths', () => {
  test('safe when 2 claims with 0 evidence (below threshold)', () => {
    const summary = '1. Item one\n2. Item two';
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(false);
  });

  test('safe when 4 claims with 2 evidence and caveats present', () => {
    const summary = '1. A\n2. B\n3. C\n4. D\nNote: not read in this run';
    // 4 claims, 2 evidence, but has caveats so the claims > 2x evidence rule doesn't fire
    expect(evaluateHallucinationRisk(summary, { k1: 'v1', k2: 'v2' }, []).risky).toBe(false);
  });

  test('safe when 4 claims with 3 evidence (claims <= 2x evidence)', () => {
    const summary = '1. A\n2. B\n3. C\n4. D';
    // 4 claims, 3 evidence. 4 > 3*2=6? No. So safe.
    expect(evaluateHallucinationRisk(summary, { k1: 'v1', k2: 'v2', k3: 'v3' }, []).risky).toBe(false);
  });

  test('safe with specific claims < 5 and 0 source tags', () => {
    const summary = 'Found 1,234 items, CPU 85%';
    // 2 specific claims, threshold is 5
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(false);
  });

  test('safe when specific claims <= 3x source tags', () => {
    // 8 specific claims, 3 source tags → 8 > 3*3=9? No. Safe.
    const summary = 'A: 1,234 B: 5,678 C: 9,012 D: 3,456 E: 7,890 F: 2,345 G: 6,789 H: 1,111 [src:a] [src:b] [src:c]';
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(false);
  });

  test('risky when 9+ specific claims with only 1 source tag', () => {
    // 9 specific claims, 1 source tag → 9 > 1*3=3? Yes. Risky.
    const summary = 'A: 1,234 B: 5,678 C: 9,012 D: 3,456 E: 7,890 F: 2,345 G: 6,789 H: 1,111 I: 4,444 [src:x]';
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(true);
  });

  test('returns claim/evidence counts when safe', () => {
    const summary = '1. Found data';
    const result = evaluateHallucinationRisk(summary, { k1: 'v1' }, []);
    expect(result.risky).toBe(false);
    expect(result.claims).toBe(1);
    expect(result.evidence).toBe(1);
    expect(result.specificClaims).toBe(0);
    expect(result.sourceTags).toBe(0);
  });

  test('handles table-style claims with no evidence', () => {
    const summary = '| Metric | Value |\n| --- | --- |\n| CPU | 85% |\n| RAM | 92% |\n| Disk | 60% |';
    // 3 table rows = 3 claims, 0 evidence → risky
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(true);
  });

  test('handles bullet-style claims with no evidence', () => {
    const summary = '- First point\n- Second point\n- Third point';
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(true);
  });

  test('various caveat patterns are detected', () => {
    const caveats = [
      'headline only',
      'not read in this run',
      'not actually read',
      'not yet read',
      'could not read',
      'could not extract',
      'could not verify',
      'unverified',
      'extraction failed',
      'skipped reading',
      'did not read',
      'not visited',
      'not opened',
      'listed by headline',
      'based on headline',
    ];
    for (const caveat of caveats) {
      const result = evaluateHallucinationRisk('text with ' + caveat, {}, []);
      expect(result.hasCaveats).toBe(true);
    }
  });

  test('empty string summary is not risky', () => {
    expect(evaluateHallucinationRisk('', {}, []).risky).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectMfaInText — comprehensive coverage
// ═══════════════════════════════════════════════════════════════════
describe('detectMfaInText — domain exclusions', () => {
  test('excludes Amazon product pages', () => {
    expect(detectMfaInText('Please verify your identity', 'https://www.amazon.com/dp/B08N5WRWNW'))
      .toBeNull();
  });

  test('excludes Amazon search pages', () => {
    expect(detectMfaInText('Two-factor authentication required', 'https://www.amazon.com/s?k=laptop'))
      .toBeNull();
  });

  test('excludes Amazon cart/checkout', () => {
    expect(detectMfaInText('Enter verification code', 'https://www.amazon.com/checkout'))
      .toBeNull();
  });

  test('excludes eBay product pages', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.ebay.com/itm/123456'))
      .toBeNull();
  });

  test('excludes YouTube', () => {
    expect(detectMfaInText('Two-factor verification', 'https://www.youtube.com/watch?v=abc'))
      .toBeNull();
  });

  test('excludes Reddit', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.reddit.com/r/technology'))
      .toBeNull();
  });

  test('excludes Twitter/X.com', () => {
    expect(detectMfaInText('Verify your identity', 'https://x.com/someuser'))
      .toBeNull();
  });

  test('excludes Facebook', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.facebook.com/somepage'))
      .toBeNull();
  });

  test('excludes blog pages', () => {
    expect(detectMfaInText('Verify your identity', 'https://example.com/blog/mfa-article'))
      .toBeNull();
  });

  test('excludes news pages', () => {
    expect(detectMfaInText('Verify your identity', 'https://example.com/news/security'))
      .toBeNull();
  });

  test('excludes product pages', () => {
    expect(detectMfaInText('Verify your identity', 'https://example.com/products/widget'))
      .toBeNull();
  });

  test('excludes shop/store pages', () => {
    expect(detectMfaInText('Verify your identity', 'https://example.com/store/item'))
      .toBeNull();
  });

  test('excludes GitHub repos', () => {
    expect(detectMfaInText('Verify your identity', 'https://github.com/user/repo'))
      .toBeNull();
  });
});

describe('detectMfaInText — tier-1 patterns', () => {
  test('approve sign-in request', () => {
    expect(detectMfaInText('Please approve the sign-in request')).toBeTruthy();
    expect(detectMfaInText('Approve this sign in request')).toBeTruthy();
  });

  test('tap the number you see (Microsoft MFA)', () => {
    expect(detectMfaInText('Tap the number you see to sign in')).toBeTruthy();
  });

  test('push notification sent', () => {
    // Regex: \bpush\s+(?:notification|approval)\s+sent\b — must be exact
    expect(detectMfaInText('Push notification sent to your device')).toBeTruthy();
  });

  test('push approval sent', () => {
    expect(detectMfaInText('Push approval sent')).toBeTruthy();
  });

  test('enter verification code from/sent to', () => {
    expect(detectMfaInText('Enter the verification code sent to your phone')).toBeTruthy();
  });

  test('waiting for approval', () => {
    expect(detectMfaInText('Waiting for approval from administrator')).toBeTruthy();
  });

  test('security key connected', () => {
    // Regex: security\s+key\s+(?:plugged\s+in|connected|inserted)
    expect(detectMfaInText('Security key connected successfully')).toBeTruthy();
  });

  test('security key plugged in', () => {
    expect(detectMfaInText('Security key plugged in')).toBeTruthy();
  });

  test('returns the matched text', () => {
    const result = detectMfaInText("We've sent a verification code to your email");
    expect(result).toBe("We've sent a verification code to");
  });
});

describe('detectMfaInText — tier-2 + auth URL combinations', () => {
  test('auth URL + single tier-2 cue fires', () => {
    // login.microsoftonline.com is an auth URL
    const result = detectMfaInText('Please verify your identity', 'https://login.microsoftonline.com/common/oauth2/authorize');
    expect(result).toBeTruthy();
  });

  test('auth URL + OTP fires', () => {
    const result = detectMfaInText('Enter your OTP', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });

  test('auth URL + two-factor fires', () => {
    const result = detectMfaInText('Two-factor authentication required', 'https://accounts.google.com/signin');
    expect(result).toBeTruthy();
  });

  test('non-auth URL + single tier-2 cue does NOT fire', () => {
    // Need 2+ tier-2 cues or auth URL
    const result = detectMfaInText('Verify your identity', 'https://example.com/page');
    expect(result).toBeNull();
  });

  test('non-auth URL + 2 tier-2 cues fires', () => {
    const result = detectMfaInText('Verify your identity using two-factor authentication', 'https://example.com/mfa');
    expect(result).toBeTruthy();
  });

  test('non-auth URL + 2 tier-2 cues fires (OTP + 6-digit)', () => {
    const result = detectMfaInText('Enter your OTP and 6-digit code', 'https://randomsite.com/secure');
    expect(result).toBeTruthy();
  });
});

describe('detectMfaInText — edge cases', () => {
  test('non-string text returns null', () => {
    expect(detectMfaInText(123)).toBeNull();
    expect(detectMfaInText({})).toBeNull();
    expect(detectMfaInText([])).toBeNull();
  });

  test('undefined url treated as empty string', () => {
    // With no url, domain exclusions don't match, tier-1 can still fire
    const result = detectMfaInText("We've sent a verification code to");
    expect(result).toBeTruthy();
  });

  test('url case insensitivity for exclusions', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.YOUTUBE.com/watch?v=abc'))
      .toBeNull();
  });

  test('text sample limited to 5000 chars', () => {
    // Generate text with tier-1 cue past 5000 chars
    const padding = 'A'.repeat(6000);
    const text = padding + "We've sent a verification code to your email";
    // The cue is after 5000 chars, should not be detected
    const result = detectMfaInText(text, 'https://login.microsoftonline.com/');
    // Auth URL + tier-1? No, tier-1 is scanned separately from the sample
    // The cue is past the 5000-char sample limit
    expect(result).toBeNull();
  });

  test('auth URL patterns detect various providers', () => {
    const authUrls = [
      'https://login.live.com/',
      'https://login.okta.com/',
      'https://company.okta.com/signin',
      'https://company.duosecurity.com/',
      'https://sts.company.com/',
      'https://auth.company.com/',
      'https://example.com/mfa/',
      'https://example.com/2fa/',
      'https://example.com/verify/',
    ];
    for (const url of authUrls) {
      // Auth URL + a tier-2 cue should fire
      const result = detectMfaInText('Verify your identity', url);
      expect(result).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectCaptcha — additional edge cases
// ═══════════════════════════════════════════════════════════════════
describe('detectCaptcha — additional edge cases', () => {
  test('captcha. hostname pattern', () => {
    expect(detectCaptcha('https://captcha.site.com/page', 'Welcome', 50)).toBeTruthy();
  });

  test('verify path pattern', () => {
    expect(detectCaptcha('https://site.com/verify?token=x', 'Welcome', 50)).toBeTruthy();
  });

  test('challenge path pattern', () => {
    expect(detectCaptcha('https://site.com/challenge?id=1', 'Welcome', 50)).toBeTruthy();
  });

  test('bot-detect path pattern', () => {
    expect(detectCaptcha('https://site.com/bot-detect', 'Welcome', 50)).toBeTruthy();
  });

  test('URL hit with text confirmation yields confidence 0.9', () => {
    const r = detectCaptcha('https://site.com/captcha/', 'not a robot', 10);
    expect(r.confidence).toBe(0.9);
    expect(r.textConfirm).toBe(true);
  });

  test('URL hit with no text and low elements yields confidence 0.1', () => {
    const r = detectCaptcha('https://site.com/captcha/', '', 3);
    expect(r.confidence).toBe(0.1);
    expect(r.lowElements).toBe(true);
  });

  test('URL hit with text AND low elements yields confidence 1.0', () => {
    const r = detectCaptcha('https://site.com/captcha/', 'not a robot', 3);
    expect(r.confidence).toBe(1.0);
  });

  test('content-based detection with elementsCount exactly 10 fires', () => {
    const r = detectCaptcha('https://safe.com/', 'not a robot', 10);
    expect(r).toBeTruthy();
    expect(r.type).toBe('captcha_text');
  });

  test('content-based detection with elementsCount 11 does NOT fire', () => {
    const r = detectCaptcha('https://safe.com/', 'not a robot', 11);
    expect(r).toBeNull();
  });

  test('content-based detection returns null when no text', () => {
    expect(detectCaptcha('https://safe.com/', null, 5)).toBeNull();
  });

  test('returns correct pattern in URL-based detection', () => {
    const r = detectCaptcha('https://site.com/recaptcha/api', '', 50);
    expect(r.pattern).toBeTruthy();
    expect(r.type).toBe('captcha_url');
  });

  test('no pageText and elementsCount undefined still detects URL hit', () => {
    const r = detectCaptcha('https://site.com/captcha/', undefined, undefined);
    expect(r).toBeTruthy();
    expect(r.textConfirm).toBe(false);
    expect(r.lowElements).toBe(false);
    expect(r.confidence).toBe(0.0);
  });
});
