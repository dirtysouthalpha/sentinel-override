// Sentinel Override v3 -- Template Manager
// Template CRUD, parameter extraction, goal resolution, usage tracking.
// Layer 2 module -- imports NOTHING from other background modules.
// Storage: chrome.storage.local key 'sentinel_templates'

const STORAGE_KEY = 'sentinel_templates';
const PARAM_REGEX = /:{2}(\w+):{2}/g;

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
  const regex = new RegExp(PARAM_REGEX.source, PARAM_REGEX.flags);
  while ((match = regex.exec(goalText)) !== null) {
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

// ========== Storage Helpers ==========

/**
 * Read the full templates object from chrome.storage.local.
 * @returns {Promise<Object<string, object>>}
 */
export async function loadTemplates() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || {};
  } catch {
    return {};
  }
}

/**
 * Persist the full templates object to chrome.storage.local.
 * @param {Object<string, object>} templates
 */
export async function saveTemplates(templates) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: templates });
  } catch (e) {
    // Storage quota or unavailable — callers should handle
    throw new Error('Failed to save templates: ' + (e.message || e));
  }
}

// ========== CRUD Operations ==========

/**
 * List all templates sorted by updatedAt descending.
 * @returns {Promise<Array<object>>}
 */
export async function listTemplates() {
  const templates = await loadTemplates();
  return Object.values(templates).sort((a, b) => b.updatedAt - a.updatedAt);
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
  if (!templateData || typeof templateData !== 'object') {
    throw new Error('Template data must be an object');
  }
  if (!templateData.name || typeof templateData.name !== 'string' || templateData.name.trim() === '') {
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
}

/**
 * Update an existing template by ID.
 * @param {string} id
 * @param {{ name?: string, goal?: string, params?: Array, tags?: Array<string> }} updates
 * @returns {Promise<object>} The updated template
 */
export async function updateTemplate(id, updates) {
  if (!id || typeof id !== 'string') {
    throw new Error('Template ID is required');
  }
  if (!updates || typeof updates !== 'object') {
    throw new Error('Update data must be an object');
  }

  const templates = await loadTemplates();
  const existing = templates[id];
  if (!existing) {
    throw new Error('Template not found: ' + id);
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
    throw new Error('Template not found: ' + id);
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
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('Template ID is required');
  }

  const templates = await loadTemplates();
  const template = templates[templateId];
  if (!template) {
    throw new Error('Template not found: ' + templateId);
  }

  const values = paramValues || {};

  const resolvedGoal = template.goal.replace(PARAM_REGEX, (_, key) => {
    // If value provided and non-empty, use it
    if (values[key] && values[key].trim() !== '') {
      return values[key];
    }
    // Check for default value in template params
    const paramDef = template.params.find(p => p.key === key);
    if (paramDef && paramDef.defaultValue && paramDef.defaultValue.trim() !== '') {
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
