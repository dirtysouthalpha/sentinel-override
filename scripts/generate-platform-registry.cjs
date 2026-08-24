#!/usr/bin/env node
/**
 * Generate background/platforms/index.js from the profiles in that directory.
 *
 *   node scripts/generate-platform-registry.cjs          # rewrite index.js
 *   node scripts/generate-platform-registry.cjs --check  # fail if it is stale
 *
 * The import list and PROFILES array used to be maintained by hand, so adding a
 * profile meant editing three places and a missed edit produced a profile that
 * existed but never matched. Order still decides which profile wins (first
 * detect() to return true), but it now comes from each profile's own `priority`
 * rather than its position in a list someone has to keep sorted.
 *
 * This is a build step by necessity: MV3 has no filesystem at runtime and cannot
 * import paths that aren't known when the extension is packaged.
 */
const fs = require('fs');
const path = require('path');

const PLATFORMS_DIR = path.resolve(__dirname, '..', 'background', 'platforms');
const INDEX_PATH = path.join(PLATFORMS_DIR, 'index.js');
const POPUP_LIST_PATH = path.resolve(__dirname, '..', 'popup-modules', 'platform-profiles.generated.js');

function readProfiles() {
  const profiles = [];
  for (const file of fs.readdirSync(PLATFORMS_DIR).sort()) {
    if (!file.endsWith('.js') || file === 'index.js' || file === 'schema.js') continue; // schema.js = validation module, not a profile
    const source = fs.readFileSync(path.join(PLATFORMS_DIR, file), 'utf8');

    const exportMatch = source.match(/^export const ([A-Za-z0-9_$]+)\s*=\s*\{/m);
    if (!exportMatch) {
      throw new Error(`${file}: no "export const <name> = {" found — a profile must export exactly one object`);
    }
    const idMatch = source.match(/^\s*id:\s*'([^']+)'/m);
    if (!idMatch) throw new Error(`${file}: profile is missing an id`);

    const priorityMatch = source.match(/^\s*priority:\s*(\d+)/m);
    if (!priorityMatch) {
      throw new Error(`${file}: profile is missing a priority. Lower numbers are matched first; `
        + 'give a specific profile a lower number than any catch-all it must beat.');
    }

    profiles.push({
      file,
      exportName: exportMatch[1],
      id: idMatch[1],
      priority: Number(priorityMatch[1]),
    });
  }
  return profiles;
}

function render(profiles) {
  // Ties break on filename so the output is stable regardless of readdir order.
  const ordered = [...profiles].sort((a, b) => a.priority - b.priority || a.file.localeCompare(b.file));

  const imports = ordered
    .map(p => `import { ${p.exportName} } from './${p.file}';`)
    .join('\n');
  const entries = ordered
    .map(p => `  ${p.exportName},${' '.repeat(Math.max(1, 22 - p.exportName.length))}// ${p.priority}`)
    .join('\n');

  return `// background/platforms/index.js
// Platform profile registry — GENERATED FILE, DO NOT EDIT BY HAND.
//
// Regenerate with:  node scripts/generate-platform-registry.cjs
// CI fails if this file does not match the profiles on disk.
//
// To add a platform, drop a profile in this directory exporting an object with
// an \`id\`, a \`priority\` and a \`detect(url, goal)\`, then regenerate. The
// Adaptive Prompts engine (background/adaptive-prompts.js) iterates this list in
// order and picks the FIRST profile whose detect() returns true, so a specific
// profile needs a lower priority than any catch-all that would also match it.

${imports}

const PROFILES = [
${entries}
];

// Manual profile override. Detection is heuristic, so a user on an unusual host
// (a white-labelled portal, an on-prem instance behind a vanity domain) can pin the
// profile themselves. Held in module scope because getPlatformProfile is sync and
// called on the agent's hot path, while chrome.storage is async — the service worker
// loads the stored value once at startup and on change via setPlatformOverride.
let _overrideId = null;

/**
 * Pin profile selection to one id, or pass a falsy value to return to auto-detection.
 * @param {string|null} profileId - A profile id, or null/'' for automatic.
 * @returns {boolean} True if the id was applied; false if it matched no profile.
 */
export function setPlatformOverride(profileId) {
  if (!profileId) { _overrideId = null; return true; }
  if (!PROFILES.some(p => p.id === profileId)) {
    console.warn('[Sentinel] Ignoring unknown platform override:', profileId);
    return false;
  }
  _overrideId = profileId;
  return true;
}

/**
 * The currently pinned profile id, or null when detection is automatic.
 * @returns {string|null}
 */
export function getPlatformOverride() {
  return _overrideId;
}

/**
 * Resolve the best-matching platform profile for the current URL and goal.
 * Returns the pinned profile when one is set; otherwise iterates PROFILES in order
 * and returns the first whose detect() returns true.
 * @param {string} currentUrl - The active tab's URL.
 * @param {string} goal - The user's goal text.
 * @returns {object|null} The matching platform profile, or null if none matched.
 */
export function getPlatformProfile(currentUrl, goal) {
  if (_overrideId) {
    const pinned = PROFILES.find(p => p.id === _overrideId);
    if (pinned) return pinned;
  }
  for (const p of PROFILES) {
    try {
      if (p && typeof p.detect === 'function' && p.detect(currentUrl, goal)) return p;
    } catch (_e) {
      console.warn('[Sentinel] Platform detect error (profile:', p && p.id, '):', typeof _e === 'object' && _e !== null && typeof _e.message === 'string' ? _e.message : String(_e));
      continue;
    }
  }
  return null;
}

/**
 * Inspect a goal for menu paths that don't match the detected profile's surface.
 * Returns hints that map on-box menu paths to their cloud-portal equivalents.
 * @param {object} profile - The matched platform profile with mismatchHints array.
 * @param {string} goal - The user's goal text.
 * @returns {Array<{onbox: string, target: string}>} Mismatch hints found in the goal.
 */
export function findMismatchHints(profile, goal) {
  if (!profile || !Array.isArray(profile.mismatchHints) || !goal) return [];
  const hits = [];
  for (const hint of profile.mismatchHints) {
    try {
      if (hint && hint.pattern && hint.pattern.test(goal)) {
        hits.push({ onbox: hint.onbox, target: hint.nsm });
      }
    } catch (_e) { /* skip bad pattern */ }
  }
  return hits;
}

/**
 * Lightweight listing of all registered platform profiles.
 * Returns id, label, and memoryKeyPrefix for each profile.
 * @returns {Array<{id: string, label: string, memoryKeyPrefix: string}>}
 */
export function listAllProfiles() {
  return PROFILES.map(p => ({ id: p.id, label: p.label, memoryKeyPrefix: p.memoryKeyPrefix }));
}
`;
}

// The settings panel needs the profile list, but popup-modules/*.js are classic
// scripts: they cannot `import` the registry, and a dynamic import() is not
// available in every context they run in. Emit a plain classic script instead, so
// the list still has exactly one source of truth.
function renderPopupList(profiles) {
  const ordered = [...profiles].sort((a, b) => a.priority - b.priority || a.file.localeCompare(b.file));
  const entries = ordered
    .map(p => `  { id: ${JSON.stringify(p.id)}, label: ${JSON.stringify(p.label)} },`)
    .join('\n');
  return `// popup-modules/platform-profiles.generated.js
// GENERATED FILE, DO NOT EDIT BY HAND.
// Regenerate with:  node scripts/generate-platform-registry.cjs
//
// Classic script (the popup loads it with a plain <script> tag), so it assigns a
// global rather than exporting. Mirrors background/platforms/ in match order.
window.SENTINEL_PLATFORM_PROFILES = [
${entries}
];
`;
}

function readLabel(dir, file) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  const m = source.match(/^\s*label:\s*'([^']*)'/m) || source.match(/^\s*label:\s*"([^"]*)"/m);
  return m ? m[1] : null;
}

function main() {
  const profiles = readProfiles();
  for (const p of profiles) {
    p.label = readLabel(PLATFORMS_DIR, p.file);
    if (!p.label) throw new Error(`${p.file}: profile is missing a label`);
  }

  const seenIds = new Map();
  for (const p of profiles) {
    if (seenIds.has(p.id)) throw new Error(`duplicate profile id "${p.id}" in ${p.file} and ${seenIds.get(p.id)}`);
    seenIds.set(p.id, p.file);
  }

  const outputs = [
    { file: INDEX_PATH, content: render(profiles) },
    { file: POPUP_LIST_PATH, content: renderPopupList(profiles) },
  ];
  const check = process.argv.includes('--check');
  const root = path.resolve(__dirname, '..');

  if (check) {
    for (const { file, content } of outputs) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (current.replace(/\r\n/g, '\n') !== content) {
        console.error(`${path.relative(root, file)} is stale — run: node scripts/generate-platform-registry.cjs`);
        process.exit(1);
      }
    }
    console.log(`platform registry is up to date (${profiles.length} profiles)`);
    return;
  }

  for (const { file, content } of outputs) {
    fs.writeFileSync(file, content);
    console.log(`wrote ${path.relative(root, file)} (${profiles.length} profiles)`);
  }
}

main();
