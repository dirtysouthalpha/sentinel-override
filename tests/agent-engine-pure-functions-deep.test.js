// tests/agent-engine-pure-functions-deep.test.js
// Deep coverage of exported pure functions that still have gaps.
// Focuses on detectCaptcha, detectMfaInText, detectSignInWall,
// evaluateHallucinationRisk edge cases, _countSummaryClaims, _countSpecificClaims,
// _countSourceTags, _isUnproductiveJsResult, _generateSmartRecovery, describeAction.

import { jest } from '@jest/globals';

// Minimal chrome mock for agent-engine module
globalThis.chrome = {
  storage: { local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) } },
  runtime: {
    id: 'test',
    getURL: jest.fn((p) => p),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  tabs: { query: jest.fn(async () => []), get: jest.fn(async () => ({})) },
  scripting: { executeScript: jest.fn() },
  alarms: { create: jest.fn(), clear: jest.fn() },
  notifications: { create: jest.fn() },
};
globalThis.fetch = jest.fn();
globalThis.URL = URL;
globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random() };

const mod = await import('../background/agent-engine.js');

describe('detectCaptcha — deep edge cases', () => {
  const { detectCaptcha } = mod;

  test('cf-chl URL pattern', () => {
    const result = detectCaptcha('https://example.com/cf-chl/challenge');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
  });

  test('bot-detect URL pattern', () => {
    const result = detectCaptcha('https://example.com/bot-detect/page');
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_url');
  });

  test('verify URL pattern', () => {
    const result = detectCaptcha('https://example.com/verify?token=abc');
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_url');
  });

  test('captcha. subdomain pattern', () => {
    const result = detectCaptcha('https://captcha.example.com/challenge');
    expect(result).toBeTruthy();
  });

  test('content-based detection with strong text signal and low elements', () => {
    const result = detectCaptcha('https://example.com/page', 'verify that you are human', 5);
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_text');
    expect(result.confidence).toBe(0.85);
  });

  test('content-based detection rejected when too many elements', () => {
    const result = detectCaptcha('https://example.com/page', 'are you a robot', 50);
    expect(result).toBeNull();
  });

  test('content-based detection with elementsCount=10 (boundary)', () => {
    const result = detectCaptcha('https://example.com/page', 'please complete this challenge', 10);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(false);
  });

  test('content-based detection with elementsCount=5 (boundary for lowElements)', () => {
    const result = detectCaptcha('https://example.com/page', 'our systems have detected unusual traffic', 5);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(true);
  });

  test('null pageText with URL pattern still detects', () => {
    const result = detectCaptcha('https://example.com/recaptcha/test');
    expect(result).toBeTruthy();
    expect(result.textConfirm).toBe(false);
  });

  test('URL detection with text confirmation', () => {
    const result = detectCaptcha('https://example.com/turnstile/check', 'checking your browser before we proceed');
    expect(result).toBeTruthy();
    expect(result.textConfirm).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('URL detection with low elements boosts confidence', () => {
    const result = detectCaptcha('https://example.com/errors/?errorId=abc', null, 3);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });

  test('non-matching URL and non-matching text returns null', () => {
    const result = detectCaptcha('https://example.com/about', 'Welcome to our website', 100);
    expect(result).toBeNull();
  });

  test('text patterns: "sorry we just need" triggers', () => {
    const result = detectCaptcha('https://example.com/page', 'sorry we just need to make sure you are not a robot', 4);
    expect(result).toBeTruthy();
  });

  test('text patterns: "automated access" triggers', () => {
    const result = detectCaptcha('https://example.com/page', 'automated access has been detected', 4);
    expect(result).toBeTruthy();
  });

  test('text patterns: "human verification" triggers', () => {
    const result = detectCaptcha('https://example.com/page', 'human verification required', 4);
    expect(result).toBeTruthy();
  });
});

describe('detectMfaInText — deep edge cases', () => {
  const { detectMfaInText } = mod;

  test('approve this sign-in request (tier-1)', () => {
    const result = detectMfaInText('Please approve this sign-in request on your device', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });

  test('we\'ve sent a verification code (tier-1)', () => {
    const result = detectMfaInText('We\'ve sent a verification code to your email', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });

  test('open your authenticator app (tier-1)', () => {
    const result = detectMfaInText('Open your authenticator app and enter the code', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });

  test('tap the number you see (tier-1 - Microsoft number matching)', () => {
    const result = detectMfaInText('Tap the number you see on your screen: 42', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });

  test('duo push (tier-1)', () => {
    const result = detectMfaInText('Send a Duo push to your device', 'https://login.duosecurity.com/');
    expect(result).toBeTruthy();
  });

  test('security key plugged in (tier-1)', () => {
    const result = detectMfaInText('Make sure your security key plugged in to continue', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });

  test('two tier-2 cues without auth URL triggers', () => {
    const result = detectMfaInText('Verify your identity using two-factor authentication. Check your phone for the code.', 'https://example.com/login');
    expect(result).toBeTruthy();
  });

  test('single tier-2 cue without auth URL returns null', () => {
    const result = detectMfaInText('Please verify your identity to continue', 'https://example.com/page');
    expect(result).toBeNull();
  });

  test('excluded domain: YouTube', () => {
    const result = detectMfaInText('Two-factor authentication is important', 'https://www.youtube.com/watch?v=abc');
    expect(result).toBeNull();
  });

  test('excluded domain: Facebook', () => {
    const result = detectMfaInText('Enter your verification code', 'https://www.facebook.com/post/123');
    expect(result).toBeNull();
  });

  test('excluded domain: Twitter/X', () => {
    const result = detectMfaInText('Authenticator app recommended', 'https://x.com/user/status/123');
    expect(result).toBeNull();
  });

  test('excluded domain: product page', () => {
    const result = detectMfaInText('One-time passcode verification', 'https://example.com/products/security-key');
    expect(result).toBeNull();
  });

  test('non-string text returns null', () => {
    expect(detectMfaInText(123, 'https://example.com')).toBeNull();
    expect(detectMfaInText(false, 'https://example.com')).toBeNull();
  });

  test('empty URL still works for tier-1', () => {
    const result = detectMfaInText('Waiting for approval from your device', '');
    expect(result).toBeTruthy();
  });

  test('auth URL + single tier-2 cue fires', () => {
    const result = detectMfaInText('Enter the verification code sent to your phone', 'https://login.okta.com/');
    expect(result).toBeTruthy();
  });

  test('STS URL is recognized as auth URL', () => {
    const result = detectMfaInText('Enter the verification code', 'https://sts.example.com/adfs');
    expect(result).toBeTruthy();
  });

  test('enter verification code sent (tier-2)', () => {
    const result = detectMfaInText('Enter the verification code that was sent to your email', 'https://login.microsoftonline.com/');
    expect(result).toBeTruthy();
  });
});

describe('detectSignInWall — deep edge cases', () => {
  const { detectSignInWall } = mod;

  test('password type element triggers on Microsoft login', () => {
    const elements = [
      { type: 'text', selector: '#email' },
      { type: 'password', selector: '#passwordInput' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', '');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain('password input');
  });

  test('selector containing "passwd" triggers password path', () => {
    const elements = [
      { type: 'text', selector: '#i0116' },
      { type: 'text', selector: '#passwd-field' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', '');
    expect(result).toBeTruthy();
  });

  test('selector containing "passwordinput" triggers', () => {
    const elements = [
      { selector: '#passwordinput-1', type: 'text' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', '');
    expect(result).toBeTruthy();
  });

  test('email field with sign-in text on auth host', () => {
    const elements = [
      { type: 'email', selector: '#email-field' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Enter your email to sign in');
    expect(result).toBeTruthy();
    expect(result.evidence).toContain('email/username');
  });

  test('selector containing "loginfmt" triggers email path', () => {
    const elements = [
      { type: 'text', selector: '#loginfmt' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Sign in to your account');
    expect(result).toBeTruthy();
  });

  test('selector containing "username" triggers email path', () => {
    const elements = [
      { type: 'text', selector: '#username-input' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Please sign in');
    expect(result).toBeTruthy();
  });

  test('selector containing "user_name" triggers email path', () => {
    const elements = [
      { type: 'text', selector: '#user_name' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Log in to continue');
    expect(result).toBeTruthy();
  });

  test('selector containing "signin" triggers email path', () => {
    const elements = [
      { type: 'text', selector: '#signin-email' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Enter your email');
    expect(result).toBeTruthy();
  });

  test('non-auth host returns null', () => {
    const elements = [
      { type: 'password', selector: '#pass' },
    ];
    const result = detectSignInWall(elements, 'https://www.example.com/login', '');
    expect(result).toBeNull();
  });

  test('null elements array does not crash', () => {
    const result = detectSignInWall(null, 'https://login.microsoftonline.com/', '');
    expect(result).toBeNull();
  });

  test('non-array elements does not crash', () => {
    const result = detectSignInWall('not-array', 'https://login.microsoftonline.com/', '');
    expect(result).toBeNull();
  });

  test('text cue without matching elements returns null', () => {
    const elements = [
      { type: 'text', selector: '#search' },
    ];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Please sign in');
    expect(result).toBeNull();
  });

  test('GitLab sign_in URL matches', () => {
    const elements = [{ type: 'password', selector: '#password' }];
    const result = detectSignInWall(elements, 'https://gitlab.com/users/sign_in', '');
    expect(result).toBeTruthy();
  });

  test('GitHub login URL matches', () => {
    const elements = [{ type: 'password', selector: '#password' }];
    const result = detectSignInWall(elements, 'https://github.com/login', '');
    expect(result).toBeTruthy();
  });

  test('Salesforce login URL matches', () => {
    const elements = [{ type: 'password', selector: '#pw' }];
    const result = detectSignInWall(elements, 'https://login.salesforce.com/', '');
    expect(result).toBeTruthy();
  });

  test('Okta preview URL matches', () => {
    const elements = [{ type: 'password', selector: '#okta-password' }];
    const result = detectSignInWall(elements, 'https://example.oktapreview.com/', '');
    expect(result).toBeTruthy();
  });

  test('Auth0 URL matches', () => {
    const elements = [{ type: 'password', selector: '#pass' }];
    const result = detectSignInWall(elements, 'https://example.auth0.com/', '');
    expect(result).toBeTruthy();
  });

  test('AWS signin URL matches', () => {
    const elements = [{ type: 'password', selector: '#password' }];
    const result = detectSignInWall(elements, 'https://signin.aws.amazon.com/', '');
    expect(result).toBeTruthy();
  });

  test('invalid URL returns null', () => {
    const result = detectSignInWall([], 'not-a-url', '');
    expect(result).toBeNull();
  });

  test('null elements in array are skipped', () => {
    const elements = [null, undefined, { type: 'password', selector: '#pw' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', '');
    expect(result).toBeTruthy();
  });
});

describe('evaluateHallucinationRisk — additional edge cases', () => {
  const { evaluateHallucinationRisk } = mod;

  test('safe summary with balanced evidence', () => {
    const summary = '1. Found server\n2. Checked config';
    const result = evaluateHallucinationRisk(summary, { k1: 'v1', k2: 'v2' }, []);
    expect(result.risky).toBe(false);
    expect(result.claims).toBe(2);
    expect(result.evidence).toBe(2);
  });

  test('risky: many claims zero evidence', () => {
    const summary = '1. A\n2. B\n3. C';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('3 items');
    expect(result.reason).toContain('no data');
  });

  test('risky: claims > 2x evidence', () => {
    const summary = '1. A\n2. B\n3. C\n4. D';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('4 items');
    expect(result.reason).toContain('1 evidence');
  });

  test('risky: many specific claims no source tags', () => {
    const summary = 'Revenue is $5M with 47% growth on January 15, 2024. Total users: 1,234,567.';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('specific claims');
    expect(result.reason).toContain('[src:');
  });

  test('risky: specific claims > 3x source tags', () => {
    const summary = 'Sales $5M, growth 47%, users 110,000, date 2024-01-15, $12M revenue, $3B market, $500K investment, 99.9% uptime, [src:revenue]';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('source tags');
  });

  test('safe: specific claims with source tags', () => {
    const summary = 'Revenue $5M [src:rev]. Growth 47% [src:growth]. Users 1,234 [src:users].';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    expect(result.risky).toBe(false);
  });

  test('null summary returns safe', () => {
    const result = evaluateHallucinationRisk(null, {}, []);
    expect(result.risky).toBe(false);
  });

  test('notes in history count as evidence', () => {
    const summary = '1. A\n2. B\n3. C';
    const history = [
      { action: { type: 'note' } },
      { action: { type: 'click' } },
      { action: { type: 'note' } },
    ];
    const result = evaluateHallucinationRisk(summary, {}, history);
    // With 3 claims and 2 evidence sources, claims >= 3 and evidence > 0
    // but claims (3) > evidence (2) * 2? No: 3 > 4 is false
    expect(result.risky).toBe(false);
    expect(result.evidence).toBe(2);
  });

  test('caveats prevent claims > evidence risk', () => {
    const summary = '1. A (headline only / not read)\n2. B\n3. C\n4. D';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    // claims=4, evidence=1, hasCaveats=true
    // Condition: claims >= 4 && evidence > 0 && claims > evidence*2 && !hasCaveats
    // hasCaveats is true, so this condition is false
    expect(result.risky).toBe(false);
    expect(result.hasCaveats).toBe(true);
  });
});

describe('_countSummaryClaims — additional edge cases', () => {
  const { _countSummaryClaims } = mod;

  test('numbered list with # prefix: ## 1.', () => {
    expect(_countSummaryClaims('## 1. First\n## 2. Second')).toBe(2);
  });

  test('mixed numbered and bullets returns max', () => {
    const text = '1. A\n2. B\n- X\n- Y\n- Z';
    // numbered=2, bullets=3, max=3
    expect(_countSummaryClaims(text)).toBe(3);
  });

  test('table rows minus header and separator', () => {
    const text = '| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |';
    // 4 rows minus 2 = 2
    expect(_countSummaryClaims(text)).toBe(2);
  });

  test('boolean true ignored', () => {
    expect(_countSummaryClaims(true)).toBe(0);
  });

  test('number ignored', () => {
    expect(_countSummaryClaims(42)).toBe(0);
  });
});

describe('_countSpecificClaims — additional edge cases', () => {
  const { _countSpecificClaims } = mod;

  test('multiple dollar patterns', () => {
    const text = 'Revenue: $5M. Budget: $12,345. Total: $1.5B.';
    const count = _countSpecificClaims(text);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('multiple ISO dates', () => {
    const text = 'Start: 2024-01-15. End: 2024-12-31.';
    const count = _countSpecificClaims(text);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('percentage and number combo', () => {
    const text = '47% of 1,234 users';
    const count = _countSpecificClaims(text);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('month date without year', () => {
    const text = 'Deadline is March 3';
    const count = _countSpecificClaims(text);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('null returns 0', () => {
    expect(_countSpecificClaims(null)).toBe(0);
  });

  test('undefined returns 0', () => {
    expect(_countSpecificClaims(undefined)).toBe(0);
  });
});

describe('_countSourceTags — additional edge cases', () => {
  const { _countSourceTags } = mod;

  test('mixed src and unverified tags', () => {
    expect(_countSourceTags('[src:a] [unverified] [src:b]')).toBe(3);
  });

  test('source tag with hyphens and underscores', () => {
    expect(_countSourceTags('[src:my-data_key-1]')).toBe(1);
  });

  test('case insensitive source tags', () => {
    expect(_countSourceTags('[SRC:KEY] [Src:Another]')).toBe(2);
  });

  test('null returns 0', () => {
    expect(_countSourceTags(null)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSourceTags('')).toBe(0);
  });
});

describe('_isUnproductiveJsResult — additional edge cases', () => {
  const { _isUnproductiveJsResult } = mod;

  test('null is unproductive', () => {
    expect(_isUnproductiveJsResult(null)).toBe(true);
  });

  test('undefined is unproductive', () => {
    expect(_isUnproductiveJsResult(undefined)).toBe(true);
  });

  test('empty string is unproductive', () => {
    expect(_isUnproductiveJsResult('')).toBe(true);
  });

  test('"Done" is unproductive', () => {
    expect(_isUnproductiveJsResult('Done')).toBe(true);
  });

  test('JS Error prefix is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Error: element not found')).toBe(true);
  });

  test('timeout prefix is unproductive', () => {
    expect(_isUnproductiveJsResult('Code execution timed out after 5s')).toBe(true);
  });

  test('Execution error prefix is unproductive', () => {
    expect(_isUnproductiveJsResult('Execution error: something broke')).toBe(true);
  });

  test('[object HTMLElement] is unproductive', () => {
    expect(_isUnproductiveJsResult('[object HTMLElement]')).toBe(true);
  });

  test('"undefined" is unproductive', () => {
    expect(_isUnproductiveJsResult('undefined')).toBe(true);
  });

  test('"null" is unproductive', () => {
    expect(_isUnproductiveJsResult('null')).toBe(true);
  });

  test('short string is unproductive', () => {
    expect(_isUnproductiveJsResult('ab')).toBe(true);
  });

  test('empty array JSON is unproductive', () => {
    expect(_isUnproductiveJsResult('[]')).toBe(true);
  });

  test('empty object JSON is unproductive', () => {
    expect(_isUnproductiveJsResult('{}')).toBe(true);
  });

  test('JSON null is unproductive', () => {
    expect(_isUnproductiveJsResult('null')).toBe(true);
  });

  test('JS Result with good content is productive', () => {
    expect(_isUnproductiveJsResult('JS Result: prices found: $12, $15, $20')).toBe(false);
  });

  test('JS Result with empty value is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: ')).toBe(true);
  });

  test('non-string converted to string - short is unproductive', () => {
    expect(_isUnproductiveJsResult(123)).toBe(true);
  });

  test('normal string is productive', () => {
    expect(_isUnproductiveJsResult('The quick brown fox jumps over the lazy dog')).toBe(false);
  });

  test('JS Result with undefined value is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: undefined')).toBe(true);
  });

  test('JS Result with null value is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: null')).toBe(true);
  });

  test('JS Result with empty array is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: []')).toBe(true);
  });

  test('JS Result with real data is productive', () => {
    expect(_isUnproductiveJsResult('JS Result: {"name":"test","count":5}')).toBe(false);
  });
});

describe('_generateSmartRecovery — additional edge cases', () => {
  const { _generateSmartRecovery } = mod;

  test('Amazon product page generates strategies', () => {
    const strategies = _generateSmartRecovery('find items', 'https://www.amazon.com/product/ABC123', '', {}, [], 3);
    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies.some(s => s.includes('execute_js'))).toBe(true);
  });

  test('Amazon search with no sort params gets sort suggestions', () => {
    const strategies = _generateSmartRecovery('find products', 'https://www.amazon.com/s?k=laptop', '', {}, [], 5);
    expect(strategies.some(s => s.includes('review-rank'))).toBe(true);
    expect(strategies.some(s => s.includes('price-asc'))).toBe(true);
    expect(strategies.some(s => s.includes('date-desc'))).toBe(true);
  });

  test('Reddit search gets sort suggestion', () => {
    const strategies = _generateSmartRecovery('find posts', 'https://www.reddit.com/search/?q=test', '', {}, [], 3);
    expect(strategies.some(s => s.includes('sort=top') || s.includes('sort=relevance'))).toBe(true);
  });

  test('Google search gets execute_js strategy', () => {
    const strategies = _generateSmartRecovery('search google', 'https://www.google.com/search?q=test', '', {}, [], 3);
    expect(strategies.some(s => s.includes('execute_js') && s.includes('.g'))).toBe(true);
  });

  test('YouTube gets execute_js strategy', () => {
    const strategies = _generateSmartRecovery('find videos', 'https://www.youtube.com/results?q=test', '', {}, [], 3);
    expect(strategies.some(s => s.includes('ytd-video-renderer'))).toBe(true);
  });

  test('News site gets article extraction strategy', () => {
    const strategies = _generateSmartRecovery('read news', 'https://www.cnn.com/world/article', '', {}, [], 3);
    expect(strategies.some(s => s.includes('article'))).toBe(true);
  });

  test('BBC gets article extraction strategy', () => {
    const strategies = _generateSmartRecovery('read news', 'https://www.bbc.com/news/tech', '', {}, [], 3);
    expect(strategies.some(s => s.includes('article') || s.includes('headline'))).toBe(true);
  });

  test('Goal with "top N" gets extract strategy', () => {
    const strategies = _generateSmartRecovery('find top 10 laptops', 'https://example.com', '', {}, [], 3);
    expect(strategies.some(s => s.includes('execute_js') && s.includes('extract'))).toBe(true);
  });

  test('Goal with "find N" gets extract strategy', () => {
    const strategies = _generateSmartRecovery('find 5 best phones', 'https://example.com', '', {}, [], 3);
    expect(strategies.some(s => s.includes('extract'))).toBe(true);
  });

  test('Goal with "then go to" gets direct URL strategy', () => {
    const strategies = _generateSmartRecovery('search google then go to amazon', 'https://example.com', '', {}, [], 3);
    expect(strategies.some(s => s.includes('navigate with direct URL'))).toBe(true);
  });

  test('Goal with "also check" gets direct URL strategy', () => {
    const strategies = _generateSmartRecovery('check amazon also check reddit for reviews', 'https://example.com', '', {}, [], 3);
    expect(strategies.some(s => s.includes('navigate with direct URL'))).toBe(true);
  });

  test('Goal mentioning site not in URL constructs direct URL', () => {
    const strategies = _generateSmartRecovery('search for laptops on amazon', 'https://www.google.com', '', {}, [], 3);
    expect(strategies.some(s => s.includes('amazon.com/s?k='))).toBe(true);
  });

  test('Long page text suggests reading', () => {
    const longText = 'x'.repeat(1500);
    const strategies = _generateSmartRecovery('find info', 'https://example.com', longText, {}, [], 3);
    expect(strategies.some(s => s.includes('Read the page text'))).toBe(true);
  });

  test('Empty context gives fallback strategies', () => {
    const strategies = _generateSmartRecovery('do something', 'https://example.com', 'short', {}, [], 3);
    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies.some(s => s.includes('execute_js') || s.includes('read_page') || s.includes('navigate_back'))).toBe(true);
  });

  test('null inputs return fallback strategies', () => {
    const strategies = _generateSmartRecovery(null, null, null, null, null, null);
    expect(strategies.length).toBeGreaterThan(0);
  });

  test('Reuters gets article extraction', () => {
    const strategies = _generateSmartRecovery('read news', 'https://www.reuters.com/article/xyz', '', {}, [], 3);
    expect(strategies.some(s => s.includes('article'))).toBe(true);
  });
});

describe('describeAction — additional edge cases', () => {
  const { describeAction } = mod;

  test('default case for unknown action type', () => {
    const result = describeAction({ type: 'custom_unknown_action', data: 42 });
    expect(result).toContain('custom_unknown_action');
  });

  test('drag_and_drop with source and target', () => {
    const result = describeAction({
      type: 'drag_and_drop',
      source_ref: 'ref_1',
      source_selector: '#item',
      source_label: 'Drag me',
      target_ref: 'ref_2',
      target_selector: '#drop',
      target_label: 'Drop zone',
    });
    expect(result).toContain('Drag');
    expect(result).toContain('Drop zone');
  });

  test('type with long text truncates', () => {
    const longText = 'a'.repeat(200);
    const result = describeAction({ type: 'type', selector: '#input', text: longText });
    expect(result).toContain('Type into');
    expect(result.length).toBeLessThan(200);
  });

  test('execute_js with key shows key', () => {
    const result = describeAction({ type: 'execute_js', code: 'return data', key: 'result' });
    expect(result).toContain('result');
  });

  test('note with summary field', () => {
    const result = describeAction({ type: 'note', summary: 'Brief summary of findings' });
    expect(result).toContain('Brief summary');
  });

  test('note with text field', () => {
    const result = describeAction({ type: 'note', text: 'Found something interesting' });
    expect(result).toContain('Found something');
  });

  test('finish with long summary truncates', () => {
    const longSummary = 's'.repeat(200);
    const result = describeAction({ type: 'finish', summary: longSummary });
    expect(result).toContain('Finish:');
    expect(result.length).toBeLessThan(200);
  });

  test('wait_for_text with long text truncates', () => {
    const longText = 't'.repeat(200);
    const result = describeAction({ type: 'wait_for_text', text: longText });
    expect(result).toContain('Wait for text:');
  });

  test('lookup without domain shows (no domain)', () => {
    const result = describeAction({ type: 'lookup' });
    expect(result).toContain('(no domain)');
  });

  test('lookup with record_type', () => {
    const result = describeAction({ type: 'lookup', domain: 'example.com', record_type: 'MX' });
    expect(result).toContain('MX');
  });

  test('open_tab without url or label shows (no url)', () => {
    const result = describeAction({ type: 'open_tab' });
    expect(result).toContain('(no url)');
  });

  test('switch_tab with tab_id', () => {
    const result = describeAction({ type: 'switch_tab', tab_id: 42 });
    expect(result).toContain('42');
  });

  test('close_tab with tab_id', () => {
    const result = describeAction({ type: 'close_tab', tab_id: 99 });
    expect(result).toContain('99');
  });
});

describe('_describeTarget — additional edge cases', () => {
  const { _describeTarget } = mod;

  test('undefined returns (no target)', () => {
    expect(_describeTarget(undefined)).toBe('(no target)');
  });

  test('empty object returns (no target)', () => {
    expect(_describeTarget({})).toBe('(no target)');
  });

  test('ariaLabel takes precedence', () => {
    const result = _describeTarget({ ariaLabel: 'Submit', selector: '#btn', ref: 'ref_1' });
    expect(result).toBe('"Submit"');
  });

  test('elementText takes second precedence', () => {
    const result = _describeTarget({ elementText: 'Click me', selector: '#btn', ref: 'ref_1' });
    expect(result).toBe('"Click me"');
  });

  test('label takes third precedence', () => {
    const result = _describeTarget({ label: 'Search', selector: '#search', ref: 'ref_1' });
    expect(result).toBe('"Search"');
  });

  test('selector takes fourth precedence', () => {
    const result = _describeTarget({ selector: '#submit-btn', ref: 'ref_1' });
    expect(result).toBe('#submit-btn');
  });

  test('ref takes fifth precedence', () => {
    const result = _describeTarget({ ref: 'ref_42' });
    expect(result).toBe('ref:ref_42');
  });

  test('x/y coordinates', () => {
    const result = _describeTarget({ x: 150, y: 250 });
    expect(result).toBe('(150,250)');
  });

  test('long ariaLabel is truncated', () => {
    const longLabel = 'a'.repeat(200);
    const result = _describeTarget({ ariaLabel: longLabel });
    expect(result.length).toBeLessThan(200);
    expect(result.startsWith('"')).toBe(true);
  });

  test('string x/y does not match (needs numbers)', () => {
    const result = _describeTarget({ x: '100', y: '200' });
    expect(result).toBe('(no target)');
  });
});
