// tests/platforms.test.js
// OVERRIDE-22 Phase 1 (PLT-01..04): every platform profile passes schema
// validation, selector smoke checks run in the main gate, and the coverage
// report is asserted to cover the full registry.
import fs from 'fs';
import path from 'path';
import { validateProfile, validateRegistry } from '../background/platforms/schema.js';

const PLATFORMS_DIR = new URL('../background/platforms/', import.meta.url);
const NON_PROFILE_FILES = new Set(['index.js', 'schema.js']);

async function loadProfilesFromDisk() {
  const files = fs.readdirSync(PLATFORMS_DIR)
    .filter(f => f.endsWith('.js') && !NON_PROFILE_FILES.has(f))
    .sort();
  const profiles = [];
  for (const f of files) {
    const mod = await import(new URL(f, PLATFORMS_DIR).href);
    // Each profile module exports exactly one profile object (named export).
    const candidates = Object.entries(mod)
      .filter(([, v]) => v && typeof v === 'object' && typeof v.id === 'string');
    if (candidates.length === 0) {
      throw new Error(`${f} exports no profile object with an id`);
    }
    if (candidates.length > 1) {
      throw new Error(`${f} exports multiple id-bearing objects: ${candidates.map(c => c[0]).join(', ')}`);
    }
    profiles.push(candidates[0][1]);
  }
  return { files, profiles };
}

describe('platform profile schema validation (PLT)', () => {
  test('every profile file on disk loads and passes schema validation', async () => {
    const { files, profiles } = await loadProfilesFromDisk();
    expect(profiles.length).toBeGreaterThanOrEqual(19); // 19 documented MSP platforms
    expect(files.length).toBe(profiles.length);
    const invalid = [];
    for (const p of profiles) {
      const res = validateProfile(p);
      if (!res.valid) invalid.push(`${p.id}: ${res.errors.join('; ')}`);
    }
    expect(invalid).toEqual([]);
  });

  test('registry validation catches duplicate ids', async () => {
    const { profiles } = await loadProfilesFromDisk();
    const dup = Object.assign({}, profiles[0]);
    const res = validateRegistry([...profiles, dup]);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('duplicate profile id'))).toBe(true);
  });

  test('validateProfile rejects structurally broken profiles', () => {
    const res = validateProfile({ id: 'Bogus ID!', priority: 'high', pageTypes: [], knownSelectors: {} });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('id must be kebab-case'))).toBe(true);
    expect(res.errors.some(e => e.includes('priority must be a finite number'))).toBe(true);
    expect(res.errors.some(e => e.includes('pageTypes must be a non-empty array'))).toBe(true);
    expect(res.errors.some(e => e.includes('knownSelectors is empty'))).toBe(true);
  });

  test('selector smoke: knownSelectors values are strings, functions, or string[]', async () => {
    const { profiles } = await loadProfilesFromDisk();
    const bad = [];
    for (const p of profiles) {
      for (const [key, val] of Object.entries(p.knownSelectors || {})) {
        if (typeof val === 'string') {
          if (!val.trim()) bad.push(`${p.id}.${key} empty`);
        } else if (Array.isArray(val)) {
          if (val.some(v => typeof v !== 'string' || !v.trim())) bad.push(`${p.id}.${key} array with non-string/empty entries`);
        } else if (typeof val !== 'function') {
          bad.push(`${p.id}.${key} unsupported type ${typeof val}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('coverage report lists every profile with real selector counts (PLT-04)', async () => {
    const { profiles } = await loadProfilesFromDisk();
    const { valid, errors, coverage } = validateRegistry(profiles);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
    expect(coverage.length).toBe(profiles.length);
    // Every profile must carry at least a few real selectors to be actionable
    for (const c of coverage) {
      expect(c.selectors).toBeGreaterThanOrEqual(3);
      expect(c.pageTypes).toBeGreaterThanOrEqual(c.catchAll ? 0 : 1);
    }
  });
});
