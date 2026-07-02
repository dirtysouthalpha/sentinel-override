// Sentinel Override v3 -- Template Manager
// Template CRUD, parameter extraction, goal resolution, usage tracking.
// Layer 2 module -- imports from error-utils.js only.
// Storage: chrome.storage.local key 'sentinel_templates'

import { getErrorMessage } from './error-utils.js';
import { ONE_MINUTE_MS } from './constants.js';

const STORAGE_KEY = 'sentinel_templates';
const SEED_KEY = 'sentinel_builtins_seeded';

// (v21.6) Built-in MSP workflow templates — seeded on first run.
export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-m365-user-audit',
    name: 'M365 User Audit',
    description: 'Audit a user M365 permissions, groups, and sign-in activity',
    tags: ['m365', 'audit', 'security'],
    builtin: true,
    goal: 'Go to admin.microsoft.com, search for user ::email::, then audit their assigned roles, group memberships, and recent sign-in activity. Summarize findings with any security concerns.',
    params: [{ key: 'email', label: 'Email', defaultValue: '' }],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-teams-guest-review',
    name: 'Teams Guest Access Review',
    description: 'Review external guest access in Microsoft Teams',
    tags: ['teams', 'audit', 'guest'],
    builtin: true,
    goal: 'Go to admin.teams.microsoft.com, navigate to Users > Guest Users, and list all external guests with their last activity date. Flag any guests inactive for 90+ days.',
    params: [],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-cw-ticket-triage',
    name: 'ConnectWise Ticket Triage',
    description: 'Triage incoming service tickets and prioritize by urgency',
    tags: ['connectwise', 'triage', 'psa'],
    builtin: true,
    goal: 'Go to the ConnectWise service board, review all new and open tickets, and create a triage summary with priority recommendations based on SLA status and business impact.',
    params: [],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-itglue-doc-audit',
    name: 'IT Glue Documentation Audit',
    description: 'Check documentation completeness for a client organization',
    tags: ['itglue', 'documentation', 'audit'],
    builtin: true,
    goal: 'Go to IT Glue, select organization ::org_name::, and audit their documentation. List any missing or outdated documents including passwords, configurations, and network diagrams.',
    params: [{ key: 'org_name', label: 'Organization Name', defaultValue: '' }],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-web-research',
    name: 'Web Research and Summary',
    description: 'Research any topic and create a structured executive summary',
    tags: ['research', 'general', 'summary'],
    builtin: true,
    goal: 'Research ::topic:: by visiting relevant sources. Create a structured summary with key findings, sources cited, and a brief executive summary suitable for sharing with stakeholders.',
    params: [{ key: 'topic', label: 'Research Topic', defaultValue: '' }],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-sonicwall-rules',
    name: 'SonicWall Access Rule Audit',
    description: 'Review firewall access rules on a SonicWall appliance',
    tags: ['sonicwall', 'firewall', 'audit', 'security'],
    builtin: true,
    goal: 'Go to ::firewall_url:: and log in. Navigate to Manage > Rules > Access Rules. List the first 10 access rules with their name, source zone, destination zone, service, and action (allow/deny). Flag any rules that allow ANY source or ANY service.',
    params: [{ key: 'firewall_url', label: 'Firewall URL', defaultValue: 'https://192.168.168.168' }],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-exchange-mailtrace',
    name: 'Exchange Mail Trace',
    description: 'Trace email delivery for a specific sender or recipient',
    tags: ['exchange', 'mail', 'trace', 'm365'],
    builtin: true,
    goal: 'Go to admin.exchange.com, navigate to Mail Flow > Message Trace. Run a trace for sender ::email:: for the last 24 hours. List all messages with their delivery status, subject, recipient, and timestamp. Flag any messages that were rejected or deferred.',
    params: [{ key: 'email', label: 'Email Address', defaultValue: '' }],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-entra-signin',
    name: 'Entra ID Sign-In Audit',
    description: 'Review sign-in logs for suspicious activity in Entra ID (Azure AD)',
    tags: ['entra', 'azure', 'audit', 'security', 'signin'],
    builtin: true,
    goal: 'Go to entra.microsoft.com, navigate to Identity > Monitoring & health > Sign-in logs. Review the last 24 hours of sign-ins. List any failed sign-ins with their user, IP address, location, and failure reason. Flag any sign-ins from unusual locations or repeated failures from the same IP.',
    params: [],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  },
  {
    id: 'builtin-cisa-kev',
    name: 'CISA KEV Vulnerability Check',
    description: 'Check CISA Known Exploited Vulnerabilities catalog for recent entries',
    tags: ['cisa', 'vulnerability', 'security', 'compliance'],
    builtin: true,
    goal: 'Go to https://www.cisa.gov/known-exploited-vulnerabilities-catalog and list the 5 most recently added vulnerabilities with their vendor, product, vulnerability name, CVE ID, date added, and a short description of the exploit. Note any that affect systems in our environment.',
    params: [],
    createdAt: 1719200000000,
    updatedAt: 1719200000000
  }
];

const PARAM_REGEX = /:{2}(\w+):{2}/g;

// ========== In-Memory Cache ==========
let templatesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = ONE_MINUTE_MS; // 1 minute TTL

// Invalidate cache when storage changes externally (e.g., from popup)
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      templatesCache = null;
      cacheTimestamp = 0;
    }
  });
}

/**
 * Clear the in-memory cache. Exposed for testing.
 */
export function clearTemplateCache() {
  templatesCache = null;
  cacheTimestamp = 0;
}

// ========== Parameter Extraction ==========

/**
 * Parse a goal string for ::key:: placeholders.
 * Returns deduplicated array of { key, label, defaultValue: '' }.
 * Label is the key with underscores replaced by spaces and title-cased.
 *
 * @param {string} goalText
 * @returns {Array<{key: string, label: string, defaultValue: string}>}
 */
export function extractParameters(goalText) {
  if (typeof goalText !== 'string') return [];

  const seen = new Set();
  const params = [];

  let match;
  PARAM_REGEX.lastIndex = 0; // Reset lastIndex for fresh search
  while ((match = PARAM_REGEX.exec(goalText)) !== null) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      const label = key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      params.push({ key, label, defaultValue: '' });
    }
  }

  return params;
}


/**
 * (v21.6) Seed built-in MSP templates on first run.
 * Merges any missing builtins into storage without overwriting user templates.
 */
export async function seedBuiltinTemplates() {
  try {
    const result = await chrome.storage.local.get([SEED_KEY]);
    if (result[SEED_KEY]) return;
    const existing = await loadTemplates();
    let added = false;
    for (const tmpl of BUILTIN_TEMPLATES) {
      if (!existing[tmpl.id]) {
        existing[tmpl.id] = tmpl;
        added = true;
      }
    }
    if (added) {
      await saveTemplates(existing);
      console.debug('[Sentinel] Seeded ' + BUILTIN_TEMPLATES.length + ' built-in templates');
    }
    await chrome.storage.local.set({ [SEED_KEY]: true });
  } catch (e) {
    console.warn('[Sentinel] Failed to seed built-in templates:', getErrorMessage(e));
  }
}

// ========== Storage Helpers ==========

/**
 * Read the full templates object from chrome.storage.local.
 * Uses in-memory cache to reduce I/O overhead.
 * @returns {Promise<Object<string, object>>}
 */
export async function loadTemplates() {
  const now = Date.now();
  if (templatesCache && (now - cacheTimestamp) < CACHE_TTL) {
  // (v21.6) Seed built-in templates on first run
    return templatesCache;
  }

  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    templatesCache = result[STORAGE_KEY] || {};
    cacheTimestamp = now;
    return templatesCache;
  } catch (e) { console.error('[template-manager] loadTemplates failed:', getErrorMessage(e)); return {}; }
}

/**
 * Persist the full templates object to chrome.storage.local.
 * Invalidates the in-memory cache after save.
 * @param {Object<string, object>} templates
 */
export async function saveTemplates(templates) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: templates });
    // Update cache immediately after save
    templatesCache = templates;
    cacheTimestamp = Date.now();
  } catch (e) {
    // Storage quota or unavailable — callers should handle
    throw new Error(`Failed to save templates: ${getErrorMessage(e)}`);
  }
}

// ========== CRUD Operations ==========

/**
 * List all templates sorted by updatedAt descending.
 * @returns {Promise<Array<object>>}
 */
export async function listTemplates() {
  const templates = await loadTemplates();
  return Object.values(templates).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * Get a single template by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getTemplate(id) {
  if (!id || typeof id !== 'string') return null;
  const templates = await loadTemplates();
  return templates[id] || null;
}

/**
 * Create and persist a new template.
 * @param {{ name: string, goal: string, params?: Array, tags?: Array<string> }} templateData
 * @returns {Promise<object>} The complete template object
 */
export async function saveTemplate(templateData) {
  try {

  if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) {
    throw new Error('Template data must be an object');
  }
  if (!templateData.name || typeof templateData.name !== 'string' || !templateData.name.trim()) {
    throw new Error('Template name is required');
  }
  if (!templateData.goal || typeof templateData.goal !== 'string' || templateData.goal.trim() === '') {
    throw new Error('Template goal is required');
  }

  const params = (templateData.params && Array.isArray(templateData.params))
    ? templateData.params
    : extractParameters(templateData.goal);

  const now = Date.now();
  const id = crypto.randomUUID();

  const template = {
    id,
    name: templateData.name.trim(),
    goal: templateData.goal,
    params,
    tags: Array.isArray(templateData.tags) ? templateData.tags : [],
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    runCount: 0,
  };

  const templates = await loadTemplates();
  templates[id] = template;
  await saveTemplates(templates);

  return template;
  } catch (e) {
    console.error('[Sentinel] Error in saveTemplate:', e);
    throw e;
  }
}

/**
 * Update an existing template by ID.
 * @param {string} id
 * @param {{ name?: string, goal?: string, params?: Array, tags?: Array<string> }} updates
 * @returns {Promise<object>} The updated template
 */
export async function updateTemplate(id, updates) {
  try {

  if (!id || typeof id !== 'string') {
    throw new Error('Template ID is required');
  }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('Update data must be an object');
  }

  const templates = await loadTemplates();
  const existing = templates[id];
  if (!existing) {
    throw new Error(`Template not found: ${id}`);
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || updates.name.trim() === '') {
      throw new Error('Template name must be a non-empty string');
    }
    existing.name = updates.name.trim();
  }

  if (updates.goal !== undefined) {
    if (typeof updates.goal !== 'string' || updates.goal.trim() === '') {
      throw new Error('Template goal must be a non-empty string');
    }
    existing.goal = updates.goal;
    // Re-extract params if goal changed and params not explicitly provided
    if (updates.params === undefined) {
      existing.params = extractParameters(existing.goal);
    }
  }

  if (updates.params !== undefined) {
    if (!Array.isArray(updates.params)) {
      throw new Error('Params must be an array');
    }
    existing.params = updates.params;
  }

  if (updates.tags !== undefined) {
    existing.tags = Array.isArray(updates.tags) ? updates.tags : [];
  }

  existing.updatedAt = Date.now();

  templates[id] = existing;
  await saveTemplates(templates);

  return existing;
  } catch (e) {
    console.error('[Sentinel] Error in updateTemplate:', e);
    throw e;
  }
}

/**
 * Delete a template by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteTemplate(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Template ID is required');
  }

  const templates = await loadTemplates();
  if (!templates[id]) {
    throw new Error(`Template not found: ${id}`);
  }

  delete templates[id];
  await saveTemplates(templates);
}

// ========== Goal Resolution ==========

/**
 * Resolve a template's goal by substituting ::key:: placeholders with provided values.
 * Updates lastUsedAt and increments runCount.
 *
 * @param {string} templateId
 * @param {Object<string, string>} paramValues - Key-value pairs for substitution
 * @returns {Promise<string>} The resolved goal string
 */
export async function resolveTemplateGoal(templateId, paramValues) {
  try {

  if (!templateId || typeof templateId !== 'string') {
    throw new Error('Template ID is required');
  }

  const templates = await loadTemplates();
  const template = templates[templateId];
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  if (!template.goal || typeof template.goal !== 'string') {
    throw new Error(`Template ${templateId} has no goal`);
  }

  const values = paramValues || {};

  const resolvedGoal = template.goal.replace(PARAM_REGEX, (_, key) => {
    // If value provided and non-empty, use it
    if (values[key] && typeof values[key] === 'string' && values[key].trim()) {
      return values[key];
    }
    // Check for default value in template params
    const paramDef = (template.params || []).find(p => p.key === key);
    if (paramDef && paramDef.defaultValue && paramDef.defaultValue.trim()) {
      return paramDef.defaultValue;
    }
    // Leave placeholder as-is (user skipped an optional param)
    return `::${key}::`;
  });

  // Update usage tracking
  template.lastUsedAt = Date.now();
  template.runCount = (template.runCount || 0) + 1;
  templates[templateId] = template;
  await saveTemplates(templates);

  return resolvedGoal;
  } catch (e) {
    console.error('[Sentinel] Error in resolveTemplateGoal:', e);
    throw e;
  }
}

// ========== Usage Tracking ==========

/**
 * Update usage stats for a template (called after agent finishes a template run).
 * Sets lastUsedAt to now and increments runCount.
 *
 * @param {string} templateId
 * @returns {Promise<void>}
 */
export async function updateTemplateUsage(templateId) {
  if (!templateId || typeof templateId !== 'string') return;

  const templates = await loadTemplates();
  const template = templates[templateId];
  if (!template) return;

  template.lastUsedAt = Date.now();
  template.runCount = (template.runCount || 0) + 1;
  templates[templateId] = template;
  await saveTemplates(templates);
}
