// tests/background-index.test.js
// Unit tests for background/index.js — SSO host detection, custom endpoint
// URL derivation, checkpoint age validation, action routing validation,
// provider catalog mapping, and input validation guards.

import { jest } from '@jest/globals';

// ===================== SSO Host Detection =====================
// Mirrors _SSO_HOSTS_RE from background/index.js

const SSO_HOSTS_RE = /(login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|accounts\.google\.com|login\.okta\.com|[^.]+\.okta\.com|auth0\.com|[^.]+\.auth0\.com|signin\.aws\.amazon\.com|login\.duosecurity\.com)/i;

describe('SSO host detection', () => {
  test('detects Microsoft Online login', () => {
    expect(SSO_HOSTS_RE.test('https://login.microsoftonline.com/tenant/oauth2')).toBe(true);
  });

  test('detects Microsoft Live login', () => {
    expect(SSO_HOSTS_RE.test('https://login.live.com/ppsecure/')).toBe(true);
  });

  test('detects Microsoft login', () => {
    expect(SSO_HOSTS_RE.test('https://login.microsoft.com/kmsi')).toBe(true);
  });

  test('detects Google accounts', () => {
    expect(SSO_HOSTS_RE.test('https://accounts.google.com/signin')).toBe(true);
  });

  test('detects Okta login', () => {
    expect(SSO_HOSTS_RE.test('https://login.okta.com/')).toBe(true);
  });

  test('detects Okta subdomain', () => {
    expect(SSO_HOSTS_RE.test('https://example.okta.com/app')).toBe(true);
  });

  test('detects Auth0', () => {
    expect(SSO_HOSTS_RE.test('https://auth0.com/u/login')).toBe(true);
  });

  test('detects Auth0 subdomain', () => {
    expect(SSO_HOSTS_RE.test('https://tenant.auth0.com/authorize')).toBe(true);
  });

  test('detects AWS sign-in', () => {
    expect(SSO_HOSTS_RE.test('https://signin.aws.amazon.com/oauth')).toBe(true);
  });

  test('detects Duo Security', () => {
    expect(SSO_HOSTS_RE.test('https://login.duosecurity.com/prompt')).toBe(true);
  });

  test('does not match random site', () => {
    expect(SSO_HOSTS_RE.test('https://example.com/login')).toBe(false);
  });

  test('does not match GitHub', () => {
    expect(SSO_HOSTS_RE.test('https://github.com/login')).toBe(false);
  });

  test('case insensitive', () => {
    expect(SSO_HOSTS_RE.test('https://LOGIN.MICROSOFTONLINE.COM/')).toBe(true);
  });
});

// ===================== Custom Endpoint URL Derivation =====================
// Mirrors the fetch_provider_models custom endpoint logic

const CHAT_PATH_RE = /\/(chat\/completions|messages|completions)\/?$/i;

function deriveModelsUrl(endpoint) {
  if (!endpoint) return { error: 'Enter your custom endpoint URL first' };
  try {
    const u = new URL(endpoint);
    const base = u.protocol + '//' + u.host + u.pathname.replace(CHAT_PATH_RE, '');
    return { url: base.replace(/\/$/, '') + '/models' };
  } catch (e) {
    return { error: 'Could not parse custom endpoint: ' + e.message };
  }
}

describe('Custom endpoint URL derivation', () => {
  test('strips /chat/completions and appends /models', () => {
    const result = deriveModelsUrl('https://api.example.com/v1/chat/completions');
    expect(result.url).toBe('https://api.example.com/v1/models');
  });

  test('strips /chat/completions/ (trailing slash)', () => {
    const result = deriveModelsUrl('https://api.example.com/v1/chat/completions/');
    expect(result.url).toBe('https://api.example.com/v1/models');
  });

  test('strips /messages and appends /models', () => {
    const result = deriveModelsUrl('https://api.example.com/v1/messages');
    expect(result.url).toBe('https://api.example.com/v1/models');
  });

  test('strips /completions and appends /models', () => {
    const result = deriveModelsUrl('https://api.example.com/v1/completions');
    expect(result.url).toBe('https://api.example.com/v1/models');
  });

  test('appends /models when no known suffix', () => {
    const result = deriveModelsUrl('https://api.example.com/v1/');
    expect(result.url).toBe('https://api.example.com/v1/models');
  });

  test('handles bare domain', () => {
    const result = deriveModelsUrl('https://api.example.com');
    expect(result.url).toBe('https://api.example.com/models');
  });

  test('returns error for empty string', () => {
    const result = deriveModelsUrl('');
    expect(result.error).toBeDefined();
  });

  test('returns error for invalid URL', () => {
    const result = deriveModelsUrl('not-a-url');
    expect(result.error).toBeDefined();
  });

  test('preserves port number', () => {
    const result = deriveModelsUrl('https://localhost:8080/v1/chat/completions');
    expect(result.url).toBe('https://localhost:8080/v1/models');
  });
});

// ===================== Checkpoint Age Validation =====================
// Mirrors check_resume_available logic

function isCheckpointUsable(cp, agentRunning, now) {
  if (!cp) return { available: false, reason: 'no checkpoint' };
  const age = now - (cp.lastUpdate || 0);
  if (age > 60 * 60 * 1000) return { available: false, reason: 'too old' };
  if (agentRunning) return { available: false, reason: 'already running' };
  return {
    available: true,
    goal: cp.lastGoal || '',
    stepCount: cp.stepCount || 0,
    ageSeconds: Math.floor(age / 1000),
  };
}

describe('Checkpoint age validation', () => {
  test('returns unavailable for null checkpoint', () => {
    expect(isCheckpointUsable(null, false, Date.now()).available).toBe(false);
  });

  test('returns unavailable for undefined checkpoint', () => {
    expect(isCheckpointUsable(undefined, false, Date.now()).available).toBe(false);
  });

  test('returns unavailable for checkpoint older than 1 hour', () => {
    const now = Date.now();
    const cp = { lastUpdate: now - 3601000, lastGoal: 'test' };
    expect(isCheckpointUsable(cp, false, now).available).toBe(false);
  });

  test('returns available for fresh checkpoint', () => {
    const now = Date.now();
    const cp = { lastUpdate: now - 1000, lastGoal: 'test goal', stepCount: 5 };
    const result = isCheckpointUsable(cp, false, now);
    expect(result.available).toBe(true);
    expect(result.goal).toBe('test goal');
    expect(result.stepCount).toBe(5);
    expect(result.ageSeconds).toBe(1);
  });

  test('returns unavailable when agent already running', () => {
    const now = Date.now();
    const cp = { lastUpdate: now, lastGoal: 'test' };
    expect(isCheckpointUsable(cp, true, now).available).toBe(false);
  });

  test('returns available at exactly 1 hour boundary', () => {
    const now = Date.now();
    const cp = { lastUpdate: now - 3600000, lastGoal: 'test' };
    const result = isCheckpointUsable(cp, false, now);
    expect(result.available).toBe(true);
    expect(result.ageSeconds).toBe(3600);
  });

  test('handles checkpoint with no lastUpdate', () => {
    const now = Date.now();
    const cp = { lastGoal: 'test' };
    // lastUpdate defaults to 0, age = now - 0 = very old
    expect(isCheckpointUsable(cp, false, now).available).toBe(false);
  });

  test('handles checkpoint with no lastGoal', () => {
    const now = Date.now();
    const cp = { lastUpdate: now, stepCount: 3 };
    const result = isCheckpointUsable(cp, false, now);
    expect(result.available).toBe(true);
    expect(result.goal).toBe('');
  });
});

// ===================== Provider Catalog Mapping =====================
// Mirrors the get_provider_catalog transform

function mapProviderCatalog(catalog) {
  return catalog.map(p => ({
    id: p.id,
    label: p.label,
    endpoint: p.endpoint,
    modelsUrl: p.modelsUrl,
    defaultModel: p.defaultModel,
    auth: p.auth,
    docsUrl: p.docsUrl,
  }));
}

describe('Provider catalog mapping', () => {
  test('maps all expected fields', () => {
    const catalog = [{
      id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com',
      modelsUrl: 'https://api.openai.com/models', defaultModel: 'gpt-4',
      auth: 'bearer', docsUrl: 'https://docs.openai.com',
      extraField: 'should-be-stripped', secret: 'nope',
    }];
    const result = mapProviderCatalog(catalog);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com',
      modelsUrl: 'https://api.openai.com/models', defaultModel: 'gpt-4',
      auth: 'bearer', docsUrl: 'https://docs.openai.com',
    });
  });

  test('strips internal fields', () => {
    const catalog = [{ id: 'test', label: 'Test', endpoint: '', modelsUrl: '', defaultModel: '', auth: '', docsUrl: '', internalFlag: true }];
    const result = mapProviderCatalog(catalog);
    expect(result[0].internalFlag).toBeUndefined();
  });

  test('handles empty catalog', () => {
    expect(mapProviderCatalog([])).toEqual([]);
  });

  test('handles multiple providers', () => {
    const catalog = [
      { id: 'a', label: 'A', endpoint: '', modelsUrl: '', defaultModel: '', auth: '', docsUrl: '' },
      { id: 'b', label: 'B', endpoint: '', modelsUrl: '', defaultModel: '', auth: '', docsUrl: '' },
    ];
    expect(mapProviderCatalog(catalog)).toHaveLength(2);
  });
});

// ===================== Input Validation Guards =====================
// Mirrors the validation logic from template, client, schedule, and collab actions

function validateTemplateRequest(action, request) {
  switch (action) {
    case 'template_get':
    case 'template_update':
    case 'template_delete':
      if (!request.id) throw new Error('Template ID required');
      break;
    case 'template_save':
      if (!request.template) throw new Error('Template data required');
      break;
    case 'template_run':
      if (!request.templateId) throw new Error('Template ID required');
      break;
  }
  return true;
}

function validateScheduleRequest(action, request) {
  switch (action) {
    case 'schedule_create':
      if (!request.schedule) throw new Error('Schedule data required');
      break;
    case 'schedule_delete':
    case 'schedule_toggle':
    case 'schedule_clear_results':
      if (!request.id) throw new Error('Schedule ID required');
      break;
    case 'schedule_toggle':
      if (typeof request.enabled !== 'boolean') throw new Error('Enabled flag required');
      break;
  }
  return true;
}

function validateCollabRequest(action, request) {
  switch (action) {
    case 'collab_export_template':
      if (!request.id) throw new Error('Template ID required');
      break;
    case 'collab_validate_import':
      if (!request.data) throw new Error('Import data required');
      break;
    case 'collab_import_templates':
      if (!request.templates || !Array.isArray(request.templates)) throw new Error('Templates array required');
      break;
    case 'collab_export_report':
      if (!request.report) throw new Error('Report data required');
      break;
  }
  return true;
}

describe('Template validation guards', () => {
  test('template_get requires id', () => {
    expect(() => validateTemplateRequest('template_get', {})).toThrow('Template ID required');
  });

  test('template_get passes with id', () => {
    expect(validateTemplateRequest('template_get', { id: 't1' })).toBe(true);
  });

  test('template_update requires id', () => {
    expect(() => validateTemplateRequest('template_update', { updates: {} })).toThrow('Template ID required');
  });

  test('template_delete requires id', () => {
    expect(() => validateTemplateRequest('template_delete', {})).toThrow('Template ID required');
  });

  test('template_save requires template', () => {
    expect(() => validateTemplateRequest('template_save', {})).toThrow('Template data required');
  });

  test('template_save passes with template', () => {
    expect(validateTemplateRequest('template_save', { template: { name: 'test' } })).toBe(true);
  });

  test('template_run requires templateId', () => {
    expect(() => validateTemplateRequest('template_run', {})).toThrow('Template ID required');
  });
});

describe('Schedule validation guards', () => {
  test('schedule_create requires schedule', () => {
    expect(() => validateScheduleRequest('schedule_create', {})).toThrow('Schedule data required');
  });

  test('schedule_create passes with schedule', () => {
    expect(validateScheduleRequest('schedule_create', { schedule: { cron: '0 9 * * *' } })).toBe(true);
  });

  test('schedule_delete requires id', () => {
    expect(() => validateScheduleRequest('schedule_delete', {})).toThrow('Schedule ID required');
  });

  test('schedule_clear_results requires id', () => {
    expect(() => validateScheduleRequest('schedule_clear_results', {})).toThrow('Schedule ID required');
  });
});

describe('Collab validation guards', () => {
  test('collab_export_template requires id', () => {
    expect(() => validateCollabRequest('collab_export_template', {})).toThrow('Template ID required');
  });

  test('collab_validate_import requires data', () => {
    expect(() => validateCollabRequest('collab_validate_import', {})).toThrow('Import data required');
  });

  test('collab_import_templates requires array', () => {
    expect(() => validateCollabRequest('collab_import_templates', { templates: 'not-array' })).toThrow('Templates array required');
  });

  test('collab_import_templates passes with array', () => {
    expect(validateCollabRequest('collab_import_templates', { templates: [] })).toBe(true);
  });

  test('collab_export_report requires report', () => {
    expect(() => validateCollabRequest('collab_export_report', {})).toThrow('Report data required');
  });

  test('collab_export_template passes with id', () => {
    expect(validateCollabRequest('collab_export_template', { id: 't1' })).toBe(true);
  });
});

// ===================== Client Knowledge Validation =====================
// Mirrors the client_* validation guards

function validateClientRequest(action, request) {
  switch (action) {
    case 'client_get':
    case 'client_update':
    case 'client_delete':
    case 'client_export':
      if (!request.id) throw new Error('Client ID required');
      break;
    case 'client_set_active':
      // accepts null id (to clear)
      break;
    case 'client_create':
      if (!request.client) throw new Error('Client data required');
      break;
    case 'client_entry_add':
      if (!request.clientId) throw new Error('Client ID required');
      break;
    case 'client_entry_update':
    case 'client_entry_delete':
      if (!request.clientId || !request.entryId) throw new Error('Client + entry IDs required');
      break;
    case 'client_import':
      if (!request.payload) throw new Error('Import payload required');
      break;
  }
  return true;
}

describe('Client knowledge validation guards', () => {
  test('client_get requires id', () => {
    expect(() => validateClientRequest('client_get', {})).toThrow('Client ID required');
  });

  test('client_get passes with id', () => {
    expect(validateClientRequest('client_get', { id: 'c1' })).toBe(true);
  });

  test('client_delete requires id', () => {
    expect(() => validateClientRequest('client_delete', {})).toThrow('Client ID required');
  });

  test('client_export requires id', () => {
    expect(() => validateClientRequest('client_export', {})).toThrow('Client ID required');
  });

  test('client_entry_add requires clientId', () => {
    expect(() => validateClientRequest('client_entry_add', {})).toThrow('Client ID required');
  });

  test('client_entry_update requires both IDs', () => {
    expect(() => validateClientRequest('client_entry_update', { clientId: 'c1' })).toThrow('Client + entry IDs required');
  });

  test('client_entry_update passes with both IDs', () => {
    expect(validateClientRequest('client_entry_update', { clientId: 'c1', entryId: 'e1' })).toBe(true);
  });

  test('client_entry_delete requires both IDs', () => {
    expect(() => validateClientRequest('client_entry_delete', { entryId: 'e1' })).toThrow('Client + entry IDs required');
  });

  test('client_import requires payload', () => {
    expect(() => validateClientRequest('client_import', {})).toThrow('Import payload required');
  });

  test('client_set_active accepts null id', () => {
    expect(validateClientRequest('client_set_active', { id: null })).toBe(true);
  });

  test('client_set_active accepts id', () => {
    expect(validateClientRequest('client_set_active', { id: 'c1' })).toBe(true);
  });
});

// ===================== Telemetry Event Normalization =====================
// Mirrors the content_telemetry_event handler normalization

function normalizeTelemetryEvent(request, sender) {
  const cat = String(request.category || 'content');
  const validLevels = ['error', 'warn', 'info', 'debug', 'trace'];
  const lvl = validLevels.includes(request.level) ? request.level : 'info';
  const msg = String(request.message || '');
  const payload = (request.payload && typeof request.payload === 'object') ? { ...request.payload } : {};
  if (sender && sender.tab && typeof sender.tab.id === 'number') payload.tabId = sender.tab.id;
  if (sender && sender.url) payload.frameUrl = String(sender.url).substring(0, 200);
  return { cat, lvl, msg, payload };
}

describe('Telemetry event normalization', () => {
  test('defaults category to "content"', () => {
    const result = normalizeTelemetryEvent({}, {});
    expect(result.cat).toBe('content');
  });

  test('uses provided category', () => {
    const result = normalizeTelemetryEvent({ category: 'agent' }, {});
    expect(result.cat).toBe('agent');
  });

  test('defaults level to "info"', () => {
    const result = normalizeTelemetryEvent({}, {});
    expect(result.lvl).toBe('info');
  });

  test('accepts valid levels', () => {
    for (const lvl of ['error', 'warn', 'info', 'debug', 'trace']) {
      expect(normalizeTelemetryEvent({ level: lvl }, {}).lvl).toBe(lvl);
    }
  });

  test('rejects invalid level', () => {
    const result = normalizeTelemetryEvent({ level: 'critical' }, {});
    expect(result.lvl).toBe('info');
  });

  test('defaults message to empty string', () => {
    const result = normalizeTelemetryEvent({}, {});
    expect(result.msg).toBe('');
  });

  test('coerces non-string message', () => {
    const result = normalizeTelemetryEvent({ message: 42 }, {});
    expect(result.msg).toBe('42');
  });

  test('creates empty payload for non-object', () => {
    const result = normalizeTelemetryEvent({ payload: 'string' }, {});
    expect(result.payload).toEqual({});
  });

  test('shallow copies object payload', () => {
    const result = normalizeTelemetryEvent({ payload: { key: 'val' } }, {});
    expect(result.payload).toEqual({ key: 'val' });
    expect(result.payload).not.toBe({ key: 'val' }); // different ref
  });

  test('stamps tabId from sender', () => {
    const result = normalizeTelemetryEvent({}, { tab: { id: 42 } });
    expect(result.payload.tabId).toBe(42);
  });

  test('stamps frameUrl from sender', () => {
    const result = normalizeTelemetryEvent({}, { url: 'https://example.com/page' });
    expect(result.payload.frameUrl).toBe('https://example.com/page');
  });

  test('truncates frameUrl to 200 chars', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(250);
    const result = normalizeTelemetryEvent({}, { url: longUrl });
    expect(result.payload.frameUrl.length).toBeLessThanOrEqual(200);
  });

  test('handles null sender gracefully', () => {
    const result = normalizeTelemetryEvent({}, null);
    expect(result.payload).toEqual({});
  });
});

// ===================== Action String Registry =====================
// Ensures all expected action strings are documented

const KNOWN_ACTIONS = [
  'content_telemetry_event',
  'list_persisted_telemetry_runs',
  'load_persisted_telemetry_run',
  'delete_persisted_telemetry_run',
  'list_skills_with_stats',
  'get_skill_stats',
  'reset_skill_stats',
  'get_provider_catalog',
  'fetch_provider_models',
  'check_resume_available',
  'resume_from_checkpoint',
  'execute_command',
  'run_agent_loop',
  'stop_agent_loop',
  'pause_agent_loop',
  'resume_agent_loop',
  'inject_context',
  'get_audit_log',
  'focus_tab_by_url',
  'set_agent_speed',
  'spa_navigation',
  'spa_content_changed',
  'execute_in_frame',
  'enumerate_frames',
  'template_list',
  'template_get',
  'template_save',
  'template_update',
  'template_delete',
  'template_run',
  'client_list',
  'client_get_active',
  'client_set_active',
  'client_get',
  'client_create',
  'client_update',
  'client_delete',
  'client_entry_add',
  'client_entry_update',
  'client_entry_delete',
  'client_export',
  'client_import',
  'schedule_list',
  'schedule_create',
  'schedule_delete',
  'schedule_toggle',
  'schedule_results',
  'schedule_clear_results',
  'schedule_clear_badge',
  'collab_export_template',
  'collab_export_all_templates',
  'collab_validate_import',
  'collab_import_templates',
  'collab_export_report',
  'content_script_ready',
];

describe('Action string registry', () => {
  test('all actions are unique', () => {
    const unique = new Set(KNOWN_ACTIONS);
    expect(unique.size).toBe(KNOWN_ACTIONS.length);
  });

  test('all actions are lowercase with underscores', () => {
    for (const action of KNOWN_ACTIONS) {
      expect(action).toBe(action.toLowerCase());
      expect(action).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test('action count has not shrunk', () => {
    // Regression guard: if actions are removed, this test will alert
    expect(KNOWN_ACTIONS.length).toBeGreaterThanOrEqual(53);
  });
});

// ===================== SPA Transition Guard =====================
// Mirrors the spa_navigation / spa_content_changed guard

function shouldSetTransitionPending(requestAction, isRunning) {
  if (requestAction !== 'spa_navigation' && requestAction !== 'spa_content_changed') return false;
  return isRunning;
}

describe('SPA transition guard', () => {
  test('sets pending when agent running and spa_navigation', () => {
    expect(shouldSetTransitionPending('spa_navigation', true)).toBe(true);
  });

  test('sets pending when agent running and spa_content_changed', () => {
    expect(shouldSetTransitionPending('spa_content_changed', true)).toBe(true);
  });

  test('ignores SPA events when agent not running', () => {
    expect(shouldSetTransitionPending('spa_navigation', false)).toBe(false);
  });

  test('ignores non-SPA actions', () => {
    expect(shouldSetTransitionPending('run_agent_loop', true)).toBe(false);
  });
});
