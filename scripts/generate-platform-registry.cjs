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

function readProfiles() {
  const profiles = [];
  for (const file of fs.readdirSync(PLATFORMS_DIR).sort()) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
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

/**
 * Resolve the best-matching platform profile for the current URL and goal.
 * Iterates PROFILES in order and returns the first whose detect() returns true.
 * @param {string} currentUrl - The active tab's URL.
 * @param {string} goal - The user's goal text.
 * @returns {object|null} The matching platform profile, or null if none matched.
 */
export function getPlatformProfile(currentUrl, goal) {
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

function main() {
  const profiles = readProfiles();

  const seenIds = new Map();
  for (const p of profiles) {
    if (seenIds.has(p.id)) throw new Error(`duplicate profile id "${p.id}" in ${p.file} and ${seenIds.get(p.id)}`);
    seenIds.set(p.id, p.file);
  }

  const generated = render(profiles);
  const check = process.argv.includes('--check');
  const current = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';

  if (check) {
    if (current.replace(/\r\n/g, '\n') !== generated) {
      console.error('platform registry is stale — run: node scripts/generate-platform-registry.cjs');
      process.exit(1);
    }
    console.log(`platform registry is up to date (${profiles.length} profiles)`);
    return;
  }

  fs.writeFileSync(INDEX_PATH, generated);
  console.log(`wrote ${path.relative(path.resolve(__dirname, '..'), INDEX_PATH)} (${profiles.length} profiles)`);
}

main();
