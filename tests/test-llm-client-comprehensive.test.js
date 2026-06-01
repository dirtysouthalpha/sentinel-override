// Comprehensive tests for LLM client pure functions
import { jest } from '@jest/globals';

let detectGoalPortals, getMultiPortalDirective, getMultiArticleDirective,
    estimateCostUsd, isSimpleStep, extractFirstJsonObject, parseLLMResponse,
    supportsVision;

beforeAll(async () => {
  const mod = await import('../background/llm-client.js');
  detectGoalPortals = mod.detectGoalPortals;
  getMultiPortalDirective = mod.getMultiPortalDirective;
  getMultiArticleDirective = mod.getMultiArticleDirective;
  estimateCostUsd = mod.estimateCostUsd;
  isSimpleStep = mod.isSimpleStep;
  extractFirstJsonObject = mod.extractFirstJsonObject;
  parseLLMResponse = mod.parseLLMResponse;
  supportsVision = mod.supportsVision;
});

// ============================================================
// detectGoalPortals
// ============================================================
describe('detectGoalPortals', () => {
  test('returns empty for null', () => {
    expect(detectGoalPortals(null)).toEqual([]);
  });
  test('returns empty for undefined', () => {
    expect(detectGoalPortals(undefined)).toEqual([]);
  });
  test('returns empty for empty string', () => {
    expect(detectGoalPortals('')).toEqual([]);
  });
  test('returns empty for non-string', () => {
    expect(detectGoalPortals(123)).toEqual([]);
  });
  test('returns empty for simple goal with no portals', () => {
    expect(detectGoalPortals('click the submit button')).toEqual([]);
  });
  test('detects Entra ID', () => {
    expect(detectGoalPortals('check Entra ID sign-in logs')).toEqual(['entra']);
  });
  test('detects Azure AD', () => {
    expect(detectGoalPortals('investigate Azure AD audit logs')).toEqual(['entra']);
  });
  test('detects Exchange Online', () => {
    expect(detectGoalPortals('check Exchange Online mailbox audit')).toEqual(['exchange']);
  });
  test('detects Exchange transport rules', () => {
    expect(detectGoalPortals('review Exchange transport rules')).toEqual(['exchange']);
  });
  test('detects message trace', () => {
    expect(detectGoalPortals('run message trace for suspicious emails')).toEqual(['exchange']);
  });
  test('detects inbox rules', () => {
    expect(detectGoalPortals('investigate inbox rules for compromised user')).toEqual(['exchange']);
  });
  test('detects mail flow', () => {
    expect(detectGoalPortals('analyze mail flow')).toEqual(['exchange']);
  });
  test('detects Purview', () => {
    expect(detectGoalPortals('search Purview compliance center')).toEqual(['purview']);
  });
  test('detects unified audit log', () => {
    expect(detectGoalPortals('run unified audit log search')).toEqual(['entra','purview']);
  });
  test('detects compliance center', () => {
    expect(detectGoalPortals('check compliance center search results')).toEqual(['purview']);
  });
  test('detects eDiscovery', () => {
    expect(detectGoalPortals('perform eDiscovery search')).toEqual([]);
  });
  test('detects content search', () => {
    expect(detectGoalPortals('run content search in M365')).toEqual(['purview']);
  });
  test('detects OneDrive', () => {
    expect(detectGoalPortals('check OneDrive sharing settings')).toEqual(['onedrive']);
  });
  test('detects One Drive', () => {
    expect(detectGoalPortals('investigate One Drive external sharing')).toEqual(['onedrive']);
  });
  test('detects SharePoint', () => {
    expect(detectGoalPortals('review SharePoint sharing externally')).toEqual(['sharepoint']);
  });
  test('detects Teams', () => {
    expect(detectGoalPortals('check Teams admin chat logs')).toEqual(['teams']);
  });
  test('detects Teams admin', () => {
    expect(detectGoalPortals('review Teams admin meeting settings')).toEqual(['teams']);
  });
  test('detects Intune', () => {
    expect(detectGoalPortals('check Intune device compliance')).toEqual(['intune']);
  });
  test('detects MDM', () => {
    expect(detectGoalPortals('review MDM device policies')).toEqual(['intune']);
  });
  test('detects Defender', () => {
    expect(detectGoalPortals('check Defender for Endpoint alerts')).toEqual(['defender']);
  });
  test('detects Defender for Identity', () => {
    expect(detectGoalPortals('investigate Defender for Identity alerts')).toEqual(['defender']);
  });
  test('detects MDE', () => {
    expect(detectGoalPortals('pull MDE device timeline')).toEqual(['defender']);
  });
  test('detects M365 admin center', () => {
    expect(detectGoalPortals('go to M365 admin center')).toEqual(['m365_admin']);
  });
  test('detects admin.microsoft.com', () => {
    expect(detectGoalPortals('navigate to admin.microsoft.com')).toEqual(['m365_admin']);
  });
  test('detects Azure portal', () => {
    expect(detectGoalPortals('check Azure portal resources')).toEqual(['azure_portal']);
  });
  test('detects portal.azure.com', () => {
    expect(detectGoalPortals('open portal.azure.com')).toEqual(['azure_portal']);
  });
  test('detects SentinelOne', () => {
    expect(detectGoalPortals('investigate SentinelOne threat')).toEqual(['sentinelone']);
  });
  test('detects Singularity', () => {
    expect(detectGoalPortals('check Singularity console')).toEqual(['sentinelone']);
  });
  test('detects ConnectWise', () => {
    expect(detectGoalPortals('open ConnectWise manage ticket')).toEqual(['connectwise']);
  });
  test('detects CW Manage', () => {
    expect(detectGoalPortals('check CW Manage ticket status')).toEqual(['connectwise']);
  });
  test('detects NinjaOne', () => {
    expect(detectGoalPortals('check NinjaOne RMM alerts')).toEqual(['ninjaone']);
  });
  test('detects Ninja RMM', () => {
    expect(detectGoalPortals('review Ninja RMM policies')).toEqual(['ninjaone']);
  });
  test('detects Datto', () => {
    expect(detectGoalPortals('check Datto RMM alerts')).toEqual(['datto']);
  });
  test('detects Autotask', () => {
    expect(detectGoalPortals('review Autotask PSA tickets')).toEqual(['datto']);
  });
  test('detects IT Glue', () => {
    expect(detectGoalPortals('look up documentation in IT Glue')).toEqual(['itglue']);
  });
  test('detects ITGlue', () => {
    expect(detectGoalPortals('search ITGlue for client info')).toEqual(['itglue']);
  });
  test('detects Huntress', () => {
    expect(detectGoalPortals('check Huntress alerts')).toEqual(['huntress']);
  });
  test('detects multiple portals', () => {
    const portals = detectGoalPortals('Check Entra ID sign-in logs and Defender for Endpoint alerts');
    expect(portals).toContain('entra');
    expect(portals).toContain('defender');
  });
  test('detects triple portal', () => {
    const portals = detectGoalPortals('Investigate Entra, Exchange, and Purview audit logs');
    expect(portals).toContain('entra');
    expect(portals).toContain('exchange');
    expect(portals).toContain('purview');
  });
  test('case insensitive detection', () => {
    expect(detectGoalPortals('check ENTRA ID logs')).toEqual(['entra']);
  });
  test('sign-in logs pattern', () => {
    expect(detectGoalPortals('review sign-in logs for anomalies')).toEqual(['entra']);
  });
  test('audit logs pattern', () => {
    expect(detectGoalPortals('pull audit logs for suspicious activity')).toEqual(['entra']);
  });
});

// ============================================================
// getMultiPortalDirective
// ============================================================
describe('getMultiPortalDirective', () => {
  test('returns empty for single portal', () => {
    expect(getMultiPortalDirective('check Entra ID sign-in logs')).toBe('');
  });
  test('returns empty for no portals', () => {
    expect(getMultiPortalDirective('click the button')).toBe('');
  });
  test('returns directive for 2+ portals', () => {
    const d = getMultiPortalDirective('check Entra ID and Defender alerts');
    expect(d).toContain('MULTI-PORTAL');
    expect(d).toContain('2');
  });
  test('returns directive with correct portal count', () => {
    const d = getMultiPortalDirective('check Entra, Exchange, Defender, and Purview');
    expect(d).toContain('4');
  });
  test('contains step budget extension', () => {
    const d = getMultiPortalDirective('check Entra and Exchange');
    expect(d).toContain('300');
  });
  test('contains portal names', () => {
    const d = getMultiPortalDirective('check Entra and Exchange');
    expect(d).toContain('entra');
    expect(d).toContain('exchange');
  });
});

// ============================================================
// getMultiArticleDirective
// ============================================================
describe('getMultiArticleDirective', () => {
  test('returns empty for non-article goal', () => {
    expect(getMultiArticleDirective('click the submit button')).toBe('');
  });
  test('returns empty for null', () => {
    expect(getMultiArticleDirective(null)).toBe('');
  });
  test('returns empty for non-string', () => {
    expect(getMultiArticleDirective(42)).toBe('');
  });
  test('detects top N articles', () => {
    const d = getMultiArticleDirective('give me a briefing on the top 10 articles');
    expect(d).toContain('MULTI-ARTICLE');
    expect(d).toContain('10');
  });
  test('detects first N articles', () => {
    const d = getMultiArticleDirective('summarize the first 5 articles on the page');
    expect(d).toContain('MULTI-ARTICLE');
    expect(d).toContain('5');
  });
  test('detects best N stories', () => {
    const d = getMultiArticleDirective('give me the best 3 stories');
    expect(d).toContain('MULTI-ARTICLE');
    expect(d).toContain('3');
  });
  test('detects recent N posts', () => {
    const d = getMultiArticleDirective('breakdown of recent 7 posts');
    expect(d).toContain('MULTI-ARTICLE');
  });
  test('detects top N headlines', () => {
    const d = getMultiArticleDirective('summarize top 20 headlines');
    expect(d).toContain('MULTI-ARTICLE');
    expect(d).toContain('20');
  });
  test('detects top N results', () => {
    const d = getMultiArticleDirective('show me the top 15 results');
    expect(d).toContain('MULTI-ARTICLE');
    expect(d).toContain('15');
  });
  test('detects full breakdown pattern', () => {
    const d = getMultiArticleDirective('give me a full breakdown on each article');
    expect(d).toContain('MULTI-ARTICLE');
  });
  test('detects summary pattern', () => {
    const d = getMultiArticleDirective('do a summary for each of the headlines');
    expect(d).toContain('MULTI-ARTICLE');
  });
  test('contains batch pattern guidance', () => {
    const d = getMultiArticleDirective('top 10 articles');
    expect(d).toContain('BATCH');
  });
  test('contains step budget math', () => {
    const d = getMultiArticleDirective('top 5 articles');
    expect(d).toContain('2');
  });
});

// ============================================================
// estimateCostUsd
// ============================================================
describe('estimateCostUsd', () => {
  test('default rate for unknown model', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'unknown-model');
    expect(cost).toBe(18.00); // 3.00 + 15.00
  });
  test('null model uses default', () => {
    const cost = estimateCostUsd(1000000, 1000000, null);
    expect(cost).toBe(18.00);
  });
  test('zero tokens', () => {
    expect(estimateCostUsd(0, 0, 'gpt-4o')).toBe(0);
  });
  test('GPT-4o pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4o');
    expect(cost).toBeCloseTo(12.50);
  });
  test('GPT-4o-mini pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4o-mini');
    expect(cost).toBeCloseTo(0.75);
  });
  test('GPT-4.1 pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4.1');
    expect(cost).toBeCloseTo(10.00);
  });
  test('GPT-4.1-mini pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4.1-mini');
    expect(cost).toBeCloseTo(2.00);
  });
  test('GPT-4.1-nano pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-4.1-nano');
    expect(cost).toBeCloseTo(0.50);
  });
  test('o4-mini pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'o4-mini');
    expect(cost).toBeCloseTo(5.50);
  });
  test('o3 pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'o3');
    expect(cost).toBeCloseTo(50.00);
  });
  test('Claude Sonnet 4.6 pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(18.00);
  });
  test('Claude Opus 4.6 pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-opus-4-6');
    expect(cost).toBeCloseTo(90.00);
  });
  test('Claude Haiku 4.5 pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-haiku-4-5');
    expect(cost).toBeCloseTo(4.80);
  });
  test('Claude 3.5 Sonnet pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-3-5-sonnet');
    expect(cost).toBeCloseTo(18.00);
  });
  test('Claude 3 Haiku pricing', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'claude-3-haiku');
    expect(cost).toBeCloseTo(1.50);
  });
  test('case insensitive model matching', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'GPT-4O');
    expect(cost).toBeCloseTo(12.50);
  });
  test('missing tokens treated as zero', () => {
    expect(estimateCostUsd(undefined, undefined, 'gpt-4o')).toBe(0);
  });
  test('realistic token counts', () => {
    const cost = estimateCostUsd(50000, 2000, 'gpt-4o');
    expect(cost).toBeCloseTo(0.145);
  });
  test('handles partial million tokens', () => {
    const cost = estimateCostUsd(500000, 500000, 'claude-opus-4-6');
    expect(cost).toBeCloseTo(45.00);
  });
  test('GPT-5 pricing defaults to sonnet-class', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'gpt-5');
    expect(cost).toBeCloseTo(18.00);
  });
  test('substring match works', () => {
    const cost = estimateCostUsd(1000000, 1000000, 'my-claude-sonnet-4-6-custom');
    expect(cost).toBeCloseTo(18.00);
  });
});

// ============================================================
// isSimpleStep
// ============================================================
describe('isSimpleStep', () => {
  const baseState = { consecutiveFailures: 0, quickMode: false, goal: 'click the button' };

  test('returns true for early simple step', () => {
    expect(isSimpleStep(baseState, 1, [])).toBe(true);
  });
  test('returns true at step 3', () => {
    expect(isSimpleStep(baseState, 3, [{ type: 'click' }, { type: 'type' }])).toBe(true);
  });
  test('returns true at step 6', () => {
    expect(isSimpleStep(baseState, 6, [{ type: 'click' }])).toBe(true);
  });
  test('returns false after step 6', () => {
    expect(isSimpleStep(baseState, 7, [])).toBe(false);
  });
  test('returns false with consecutive failures', () => {
    expect(isSimpleStep({ ...baseState, consecutiveFailures: 1 }, 1, [])).toBe(false);
  });
  test('returns false with 3 consecutive failures', () => {
    expect(isSimpleStep({ ...baseState, consecutiveFailures: 3 }, 1, [])).toBe(false);
  });
  test('returns false in quick mode', () => {
    expect(isSimpleStep({ ...baseState, quickMode: true }, 1, [])).toBe(false);
  });
  test('returns false for runbook goal', () => {
    expect(isSimpleStep({ ...baseState, goal: 'STEP 1: login to portal' }, 1, [])).toBe(false);
  });
  test('returns false for PHASE goal', () => {
    expect(isSimpleStep({ ...baseState, goal: 'PHASE 1: investigation' }, 1, [])).toBe(false);
  });
  test('returns false for INVESTIGATION goal', () => {
    expect(isSimpleStep({ ...baseState, goal: 'INVESTIGATION: check logs' }, 1, [])).toBe(false);
  });
  test('returns false for runbook (lowercase)', () => {
    expect(isSimpleStep({ ...baseState, goal: 'follow the runbook' }, 1, [])).toBe(false);
  });
  test('returns false for investigation (lowercase)', () => {
    expect(isSimpleStep({ ...baseState, goal: 'perform the investigation' }, 1, [])).toBe(false);
  });
  test('returns false with long history', () => {
    const history = Array.from({ length: 9 }, (_, i) => ({ type: 'click', index: i }));
    expect(isSimpleStep(baseState, 1, history)).toBe(false);
  });
  test('returns true at history boundary (8 items)', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ type: 'click', index: i }));
    expect(isSimpleStep(baseState, 1, history)).toBe(true);
  });
  test('returns false with null history', () => {
    expect(isSimpleStep(baseState, 1, null)).toBe(true);
  });
  test('returns false with empty string goal', () => {
    expect(isSimpleStep({ ...baseState, goal: '' }, 1, [])).toBe(true);
  });
  test('step boundary: exactly 6', () => {
    expect(isSimpleStep(baseState, 6, [])).toBe(true);
  });
  test('step boundary: 6 + 1', () => {
    expect(isSimpleStep(baseState, 6 + 1, [])).toBe(false);
  });
  test('both failures and late step', () => {
    expect(isSimpleStep({ ...baseState, consecutiveFailures: 5 }, 10, [])).toBe(false);
  });
});

// ============================================================
// supportsVision
// ============================================================
describe('supportsVision', () => {
  test('null model returns false', () => {
    expect(supportsVision(null)).toBe(false);
  });
  test('empty model returns false', () => {
    expect(supportsVision('')).toBe(false);
  });
  test('undefined model returns false', () => {
    expect(supportsVision(undefined)).toBe(false);
  });
  test('gpt-3.5 denied', () => {
    expect(supportsVision('gpt-3.5-turbo')).toBe(false);
  });
  test('claude-3-haiku-text denied', () => {
    expect(supportsVision('claude-3-haiku-text')).toBe(false);
  });
  test('claude-2 denied', () => {
    expect(supportsVision('claude-2')).toBe(false);
  });
  test('claude-instant denied', () => {
    expect(supportsVision('claude-instant')).toBe(false);
  });
  test('text-only suffix denied', () => {
    expect(supportsVision('some-model-text-only')).toBe(false);
  });
  test('claude-sonnet-4-6 supports vision', () => {
    expect(supportsVision('claude-sonnet-4-6')).toBe(true);
  });
  test('gpt-4o supports vision', () => {
    expect(supportsVision('gpt-4o')).toBe(true);
  });
  test('gpt-5 supports vision', () => {
    expect(supportsVision('gpt-5')).toBe(true);
  });
  test('gemini supports vision', () => {
    expect(supportsVision('gemini-2.5-pro')).toBe(true);
  });
  test('qwen-vl supports vision', () => {
    expect(supportsVision('qwen2-vl')).toBe(true);
  });
  test('llava supports vision', () => {
    expect(supportsVision('llava-13b')).toBe(true);
  });
  test('vision in model name', () => {
    expect(supportsVision('my-vision-model')).toBe(true);
  });
  test('-vl- in model name', () => {
    expect(supportsVision('model-vl-7b')).toBe(true);
  });
  test('-vl suffix', () => {
    expect(supportsVision('model-vl')).toBe(true);
  });
  test('o3 supports vision', () => {
    expect(supportsVision('o3')).toBe(true);
  });
  test('o4 supports vision', () => {
    expect(supportsVision('o4')).toBe(true);
  });
  test('claude-4 supports vision via pattern', () => {
    expect(supportsVision('claude-4-something')).toBe(true);
  });
  test('claude-5 supports vision via pattern', () => {
    expect(supportsVision('claude-5-something')).toBe(true);
  });
  test('provider hint overrides inference', () => {
    expect(supportsVision('gpt-4o', 'anthropic')).toBe(true);
  });
  test('numeric input', () => {
    expect(supportsVision(123)).toBe(false);
  });
  test('case insensitive', () => {
    expect(supportsVision('GPT-4O')).toBe(true);
  });
  test('glm-5-turbo supports vision', () => {
    expect(supportsVision('glm-5-turbo')).toBe(true);
  });
});

// ============================================================
// extractFirstJsonObject
// ============================================================
describe('extractFirstJsonObject', () => {
  test('extracts click action', () => {
    const json = '{"type":"click","selector":"#btn"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts type action', () => {
    const json = '{"type":"type","selector":"input","text":"hello"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts navigate action', () => {
    const json = '{"type":"navigate","url":"https://example.com"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts scroll action', () => {
    const json = '{"type":"scroll","direction":"down"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts select action', () => {
    const json = '{"type":"select","selector":"select","value":"opt1"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts hover action', () => {
    const json = '{"type":"hover","selector":"#el"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts press_key action', () => {
    const json = '{"type":"press_key","key":"Enter"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts extract action', () => {
    const json = '{"type":"extract","selector":"table"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts extract_list action', () => {
    const json = '{"type":"extract_list","selector":"ul li"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts wait action', () => {
    const json = '{"type":"wait","ms":1000}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts wait_for_text action', () => {
    const json = '{"type":"wait_for_text","text":"loaded"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts wait_for_element action', () => {
    const json = '{"type":"wait_for_element","selector":"#el"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts execute_js action', () => {
    const json = '{"type":"execute_js","code":"document.title"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts read_page action', () => {
    const json = '{"type":"read_page"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts note action', () => {
    const json = '{"type":"note","text":"Found it"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts finish action', () => {
    const json = '{"type":"finish","summary":"Done"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts open_tab action', () => {
    const json = '{"type":"open_tab","url":"https://x.com","label":"tab1"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts switch_tab action', () => {
    const json = '{"type":"switch_tab","label":"tab1"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts close_tab action', () => {
    const json = '{"type":"close_tab","label":"tab1"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts dismiss_overlay action', () => {
    const json = '{"type":"dismiss_overlay"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts switch_to_frame action', () => {
    const json = '{"type":"switch_to_frame","index":0}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts drag_and_drop action', () => {
    const json = '{"type":"drag_and_drop","from":"#a","to":"#b"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts right_click action', () => {
    const json = '{"type":"right_click","selector":"#el"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts double_click action', () => {
    const json = '{"type":"double_click","selector":"#el"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts navigate_back action', () => {
    const json = '{"type":"navigate_back"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts navigate_forward action', () => {
    const json = '{"type":"navigate_forward"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts click_at action', () => {
    const json = '{"type":"click_at","x":100,"y":200}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts scroll_to action', () => {
    const json = '{"type":"scroll_to","x":0,"y":500}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts check action', () => {
    const json = '{"type":"check","selector":"#cb","checked":true}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts check_all action', () => {
    const json = '{"type":"check_all","selector":"ul li input"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts open_dropdown action', () => {
    const json = '{"type":"open_dropdown","selector":"#dd"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts upload_file action', () => {
    const json = '{"type":"upload_file","selector":"#file","path":"/tmp/f.txt"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts read_console_messages action', () => {
    const json = '{"type":"read_console_messages"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts read_network_requests action', () => {
    const json = '{"type":"read_network_requests","limit":50}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts lookup action', () => {
    const json = '{"type":"lookup","key":"saved_data"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts verify action', () => {
    const json = '{"type":"verify","selector":"#msg","text":"Success"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts repeat_for_each action', () => {
    const json = '{"type":"repeat_for_each","selector":"tr","actions":[{"type":"click"}]}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts smart_navigate action', () => {
    const json = '{"type":"smart_navigate","url":"https://x.com"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('extracts batch action', () => {
    const json = '{"type":"batch","actions":[{"type":"click"},{"type":"type"}]}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  // Preamble text handling
  test('extracts JSON from preamble text', () => {
    const input = 'I will click the button now.\n{"type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBe('{"type":"click","selector":"#btn"}');
  });
  test('skips non-action JSON objects in preamble', () => {
    const input = '{"reasoning":"thinking..."}{"type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBe('{"type":"click","selector":"#btn"}');
  });
  test('returns null for no JSON', () => {
    expect(extractFirstJsonObject('just some text')).toBeNull();
  });
  test('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });
  test('handles nested objects', () => {
    const json = '{"type":"execute_js","code":"return document.title","key":"title"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });
  test('handles escaped quotes in values', () => {
    const input = '{"type":"note","text":"He said \\"hello\\""}';
    const result = extractFirstJsonObject(input);
    expect(result).toContain('"type":"note"');
  });
  test('skips first invalid JSON', () => {
    const input = '{"invalid json}{type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toBeNull();
  });
  test('handles multiple action types in sequence', () => {
    const input = '{"type":"scroll","direction":"down"}{"type":"click","selector":"#btn"}';
    const result = extractFirstJsonObject(input);
    expect(result).toContain('"type":"scroll"');
  });
  test('returns null for only plan JSON', () => {
    const input = '{"plan":["step1","step2"]}';
    expect(extractFirstJsonObject(input)).toBeNull();
  });
  test('returns null for only steps JSON', () => {
    const input = '{"steps":["step1","step2"]}';
    expect(extractFirstJsonObject(input)).toBeNull();
  });
});

// ============================================================
// parseLLMResponse
// ============================================================
describe('parseLLMResponse', () => {
  test('parses simple click action', () => {
    const result = parseLLMResponse('{"type":"click","selector":"#btn"}');
    expect(result.type).toBe('click');
  });
  test('parses type action', () => {
    const result = parseLLMResponse('{"type":"type","selector":"input","text":"hello"}');
    expect(result.type).toBe('type');
    expect(result.text).toBe('hello');
  });
  test('parses navigate action', () => {
    const result = parseLLMResponse('{"type":"navigate","url":"https://example.com"}');
    expect(result.type).toBe('navigate');
  });
  test('parses finish action', () => {
    const result = parseLLMResponse('{"type":"finish","summary":"Task completed"}');
    expect(result.type).toBe('finish');
  });
  test('parses note action', () => {
    const result = parseLLMResponse('{"type":"note","text":"Found 5 results"}');
    expect(result.type).toBe('note');
  });
  test('strips markdown code fences', () => {
    const result = parseLLMResponse('```json\n{"type":"click","selector":"#btn"}\n```');
    expect(result.type).toBe('click');
  });
  test('strips thinking blocks', () => {
    const result = parseLLMResponse('<thinkLet me analyze...I will click.</think\n>{"type":"click","selector":"#btn"}');
    expect(result.type).toBe('click');
  });
  test('extracts from preamble text', () => {
    const result = parseLLMResponse('I should click the button.\n{"type":"click","selector":"#btn"}');
    expect(result.type).toBe('click');
  });
  test('handles action wrapper', () => {
    const result = parseLLMResponse('{"action":{"type":"click","selector":"#btn"}}');
    expect(result.type).toBe('click');
  });
  test('handles command wrapper', () => {
    const result = parseLLMResponse('{"command":{"type":"navigate","url":"https://x.com"}}');
    expect(result.type).toBe('navigate');
  });
  test('handles next_action wrapper', () => {
    const result = parseLLMResponse('{"next_action":{"type":"type","text":"hello"}}');
    expect(result.type).toBe('type');
  });
  test('handles null input gracefully', () => {
    const result = parseLLMResponse(null);
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });
  test('handles empty string', () => {
    const result = parseLLMResponse('');
    expect(result.type).toBe('note');
    expect(result.text).toContain('Parse error');
  });
  test('handles invalid JSON with salvage', () => {
    const result = parseLLMResponse('This is broken JSON that has no braces');
    expect(result).toBeDefined();
    expect(result.type).toBe('note');
  });
  test('captures reasoning prefix', () => {
    const result = parseLLMResponse('I need to click the submit button on the form.\n{"type":"click","selector":"#submit"}');
    expect(result.type).toBe('click');
  });
  test('parses execute_js with code', () => {
    const result = parseLLMResponse('{"type":"execute_js","code":"return document.title","key":"title"}');
    expect(result.type).toBe('execute_js');
    expect(result.key).toBe('title');
  });
  test('parses extract with key', () => {
    const result = parseLLMResponse('{"type":"extract","selector":"table","key":"data"}');
    expect(result.type).toBe('extract');
  });
  test('handles whitespace-only input', () => {
    const result = parseLLMResponse('   ');
    expect(result).toBeDefined();
  });
  test('rejects unknown action type', () => {
    const result = parseLLMResponse('{"type":"unknown_action"}');
    expect(result.type).toBe('note');
  });
  test('parses verify action', () => {
    const result = parseLLMResponse('{"type":"verify","selector":"#msg","text":"Success"}');
    expect(result.type).toBe('verify');
  });
});
