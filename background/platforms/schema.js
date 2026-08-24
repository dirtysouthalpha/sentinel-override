// background/platforms/schema.js
// Platform profile schema validation (OVERRIDE-22 Phase 1, PLT-01..04).
//
// Every platform profile must satisfy this contract before it ships. The test
// suite runs all profiles through validateProfile() — a profile that drifts
// out of schema fails the gate instead of breaking detection at runtime.
//
// Schema (see any profile, e.g. fortigate.js):
//   id               string, kebab-case (legacy underscores accepted), unique
//   label            non-empty string
//   priority         number (lower = higher precedence)
//   detect(url,goal) function
//   pageTypes[]      non-empty (empty allowed only with catchAll:true);
//                    each { name: unique string, urlMatch: RegExp, hint: string }
//   knownSelectors   plain object; values are selector strings, parameterized
//                    selector functions, or string[] text-option lists

// Ids historically used underscores (sonicwall_nsm); new profiles use kebab-case.
// Both are accepted — renaming live ids would churn chrome.storage memory keys.
const ID_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
// Selector smoke charset: CSS selectors this codebase uses (incl. Playwright-ish
// :has-text() / :text-is() pseudo-passthroughs and attribute-substring values
// like a[href*="/vuln/detail/CVE-"] the agent runtime understands).
const SELECTOR_RE = /^[A-Za-z0-9_\-\.\s,#:\*\[\]="'()~>+^$|/?&%!@\\]+$/;

function validatePageType(pt, profileId, errors, seenPageNames) {
  if (!pt || typeof pt !== 'object') {
    errors.push(`${profileId}: pageTypes entry must be an object`);
    return;
  }
  if (typeof pt.name !== 'string' || !pt.name.trim()) {
    errors.push(`${profileId}: pageType missing name`);
  } else if (seenPageNames.has(pt.name)) {
    errors.push(`${profileId}: duplicate pageType name "${pt.name}"`);
  } else {
    seenPageNames.add(pt.name);
  }
  if (!(pt.urlMatch instanceof RegExp)) {
    errors.push(`${profileId}: pageType "${pt.name}" urlMatch must be a RegExp`);
  }
  if (typeof pt.hint !== 'string' || !pt.hint.trim()) {
    errors.push(`${profileId}: pageType "${pt.name}" missing hint`);
  }
}

function validateKnownSelectors(selectors, profileId, errors) {
  if (!selectors || typeof selectors !== 'object' || Array.isArray(selectors)) {
    errors.push(`${profileId}: knownSelectors must be a non-empty object`);
    return;
  }
  const keys = Object.keys(selectors);
  if (keys.length === 0) {
    errors.push(`${profileId}: knownSelectors is empty — a profile with no selectors cannot act`);
  }
  for (const key of keys) {
    const val = selectors[key];
    // Parameterized selector: function taking args, returning a selector string.
    // Validated by calling with no args when arity allows; otherwise type-only.
    if (typeof val === 'function') {
      if (val.length === 0) {
        const out = val();
        if (typeof out !== 'string' || !out.trim()) {
          errors.push(`${profileId}: knownSelectors.${key}() must return a non-empty selector string`);
        }
      }
      continue;
    }
    // Text option list (dropdown choices the agent picks among).
    if (Array.isArray(val)) {
      if (val.length === 0 || val.some(v => typeof v !== 'string' || !v.trim())) {
        errors.push(`${profileId}: knownSelectors.${key} array must contain non-empty strings`);
      }
      continue;
    }
    if (typeof val !== 'string' || !val.trim()) {
      errors.push(`${profileId}: knownSelectors.${key} must be a non-empty string, function, or string[]`);
    } else if (!SELECTOR_RE.test(val)) {
      errors.push(`${profileId}: knownSelectors.${key} contains non-selector characters: "${val.slice(0, 60)}"`);
    }
  }
}

export function validateProfile(profile) {
  const errors = [];
  const p = profile;
  if (!p || typeof p !== 'object') {
    return { valid: false, errors: ['profile must be an object'] };
  }
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) {
    errors.push(`id must be kebab-case string, got: ${JSON.stringify(p.id)}`);
  }
  if (typeof p.label !== 'string' || !p.label.trim()) {
    errors.push(`${p.id || '(no id)'}: label must be a non-empty string`);
  }
  if (typeof p.priority !== 'number' || !Number.isFinite(p.priority)) {
    errors.push(`${p.id || '(no id)'}: priority must be a finite number`);
  }
  if (typeof p.detect !== 'function') {
    errors.push(`${p.id || '(no id)'}: detect must be a function`);
  }
  // A declared catch-all profile (registered last, matches anything specific
  // profiles missed) may ship without pageTypes — it acts via generic selectors.
  const isCatchAll = p.catchAll === true;
  if (!Array.isArray(p.pageTypes) || p.pageTypes.length === 0) {
    if (!isCatchAll) {
      errors.push(`${p.id || '(no id)'}: pageTypes must be a non-empty array (or declare catchAll: true)`);
    }
  } else {
    const seen = new Set();
    for (const pt of p.pageTypes) validatePageType(pt, p.id, errors, seen);
  }
  validateKnownSelectors(p.knownSelectors, p.id, errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate the full platform registry: every profile valid + globally unique ids.
 * Returns { valid, errors, coverage } — coverage feeds the profile coverage report.
 */
export function validateRegistry(profiles) {
  const errors = [];
  const seenIds = new Map();
  const coverage = [];
  const list = Array.isArray(profiles) ? profiles : [];
  for (const p of list) {
    const res = validateProfile(p);
    errors.push(...res.errors);
    if (p && typeof p.id === 'string') {
      if (seenIds.has(p.id)) {
        errors.push(`duplicate profile id "${p.id}"`);
      }
      seenIds.set(p.id, true);
      coverage.push({
        id: p.id,
        label: p.label,
        priority: p.priority,
        catchAll: p.catchAll === true,
        pageTypes: Array.isArray(p.pageTypes) ? p.pageTypes.length : 0,
        selectors: p.knownSelectors && typeof p.knownSelectors === 'object' ? Object.keys(p.knownSelectors).length : 0,
      });
    }
  }
  if (list.length === 0) {
    errors.push('platform registry is empty');
  }
  coverage.sort((a, b) => a.priority - b.priority);
  return { valid: errors.length === 0, errors, coverage };
}
