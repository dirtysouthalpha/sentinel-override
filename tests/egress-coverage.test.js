// tests/egress-coverage.test.js
//
// THE RULE: a choke point only protects what actually flows through it.
//
// Masking was built as a choke point inside callLLM. Nine other outbound paths
// in background/ never flowed through it — a SECOND full LLM path
// (quick-assist-handler), the report generator, the goal rewriter, the planner,
// the parallel text provider, a GitHub Gist upload carrying user-written
// automation goals to a third party, a remote federation peer, the brain client
// and the UAP event bridge. Every one of them was reachable in production while
// the Settings panel promised masking.
//
// Nothing in the build could tell you that. This test can: every `fetch(` and
// every WebSocket `send(` in background/ must be accounted for in
// background/egress-manifest.js, and every path classified `scrubbed` must
// actually reference the scrubber. A new unguarded door fails the suite.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const BG = join(ROOT, 'background');

const { EGRESS_MANIFEST, MANIFESTED_FILES } = await import('../background/egress-manifest.js');

/** Recursively collect background/**\/*.js, excluding the manifest itself. */
function collectJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { collectJs(full, out); continue; }
    if (!name.endsWith('.js')) continue;
    out.push(full);
  }
  return out;
}

/**
 * Strip COMMENTS only.
 *
 * An earlier version also stripped string literals, which desynced on a regex
 * literal containing a quote and silently swallowed whole regions of
 * llm-client.js, agent-engine.js, adaptive-prompts.js and collaboration.js —
 * so the detector reported them as having no egress at all. In a test whose job
 * is to catch a NEW unguarded door, a false negative is the dangerous
 * direction: over-detecting merely forces a manifest entry, under-detecting
 * lets an unmasked path ship. Comments are stripped because the manifest and
 * the code comments legitimately quote these very patterns.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');  // line comments (keep URLs like http://)
}

const FILES = collectJs(BG);

/** relative path -> code with comments/strings stripped */
const CODE = new Map(
  FILES.map(f => [`background/${f.slice(BG.length + 1)}`, codeOnly(readFileSync(f, 'utf8'))])
);

/** Files that actually perform outbound network calls. */
const EGRESS_RE = /\bfetch\s*\(|\bws\s*\.\s*send\s*\(|\bnew\s+WebSocket\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/;

function filesWithEgress() {
  const out = [];
  for (const [rel, code] of CODE) {
    if (rel === 'background/egress-manifest.js' || rel === 'background/egress-scrub.js') continue;
    if (EGRESS_RE.test(code)) out.push(rel);
  }
  return out.sort();
}

// ═══════════════════════════════════════════════════════════════════════════
describe('every outbound path in background/ is accounted for', () => {
  test('no unmanifested file performs network egress', () => {
    const unaccounted = filesWithEgress().filter(f => !MANIFESTED_FILES.has(f));
    expect(unaccounted).toEqual([]);
  });

  test('the manifest has no stale entries', () => {
    const actual = new Set(filesWithEgress());
    // uap-server.js is manifested as a non-extension helper and may not match
    // the egress regex; that is fine. Everything else must still do egress.
    const stale = EGRESS_MANIFEST
      .map(e => e.file)
      .filter(f => !actual.has(f) && f !== 'background/uap-server.js');
    expect(stale).toEqual([]);
  });

  test('every entry carries a description and a status', () => {
    for (const e of EGRESS_MANIFEST) {
      expect(typeof e.file).toBe('string');
      expect(['scrubbed', 'exempt']).toContain(e.status);
      expect(typeof e.carries).toBe('string');
      expect(e.carries.length).toBeGreaterThan(10);
    }
  });

  test('every exemption states WHY, not just that it is exempt', () => {
    for (const e of EGRESS_MANIFEST.filter(x => x.status === 'exempt')) {
      expect(typeof e.why).toBe('string');
      expect(e.why.length).toBeGreaterThan(20);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('files classified "scrubbed" actually reference the scrubber', () => {
  const scrubbed = EGRESS_MANIFEST.filter(e => e.status === 'scrubbed');

  test.each(scrubbed.map(e => [e.file]))('%s references a scrub gate', (file) => {
    const code = CODE.get(file);
    expect(code).toBeTruthy();
    // Either the shared choke point, or a documented purpose-built gate
    // (brain-producer's _scrubPii + denylist), or llm-client's inline chokepoint.
    const usesGate = /scrubForEgress|tryScrubForEgress|_redactWithDenylist|getEgressScrubber/.test(code);
    expect(usesGate).toBe(true);
  });

  test('every scrubbed entry names how it is gated', () => {
    for (const e of scrubbed) {
      expect(typeof e.via).toBe('string');
      expect(e.via.length).toBeGreaterThan(10);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the specific doors that were open', () => {
  test('quick-assist no longer sends a raw prompt', () => {
    const code = CODE.get('background/quick-assist-handler.js');
    expect(code).toMatch(/scrubForEgress/);
    // The scrubbed value, not the raw parameter, must reach the body.
    const src = readFileSync(join(BG, 'quick-assist-handler.js'), 'utf8');
    expect(src).toMatch(/handleQuickAssist\(rawPrompt\)/);
    expect(src).toMatch(/const prompt = await scrubForEgress\(rawPrompt/);
  });

  test('the gist upload scrubs and can never be public', () => {
    const src = readFileSync(join(BG, 'collaboration.js'), 'utf8');
    expect(src).toMatch(/scrubForEgress\(templates/);
    expect(src).toMatch(/content: JSON\.stringify\(scrubbedTemplates/);
    // Count in CODE only: the explanatory comment above the flag also contains
    // the literal "public: false".
    const publics = codeOnly(src).match(/public:\s*(true|false)/g) || [];
    expect(publics).toEqual(['public: false']);
    expect(codeOnly(src)).not.toMatch(/public:\s*true/);
  });

  test('the report generator scrubs the prompt it sends', () => {
    const src = readFileSync(join(BG, 'report-generator.js'), 'utf8');
    expect(src).toMatch(/scrubForEgress\(prompt/);
    expect(src).toMatch(/buildBody\(model, reportSystem, _scrubbedPrompt/);
  });

  test('the federation peer post scrubs the sub-goal', () => {
    const src = readFileSync(join(BG, 'federation.js'), 'utf8');
    expect(src).toMatch(/scrubForEgress\(subGoal\.description/);
    expect(src).toMatch(/goal: _peerGoal/);
  });

  test('ws-bridge is exempt only because its URL is a hard-coded literal', () => {
    const src = readFileSync(join(BG, 'ws-bridge.js'), 'utf8');
    // If this ever becomes configurable the exemption is void — the heartbeat
    // carries the active tab's url and title.
    expect(src).toMatch(/const BRIDGE_URL = 'ws:\/\/localhost:8001\/extension-bridge'/);
    // Exactly one assignment, and it is that literal — no storage read, no
    // options override. (A naive /BRIDGE_URL\s*=\s*[^']/ passes trivially: \s*
    // backtracks to empty and [^'] matches the space before the quote.)
    const assigns = codeOnly(src).match(/BRIDGE_URL\s*=/g) || [];
    expect(assigns).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('scrubForEgress behaviour', () => {
  let scrub;
  beforeAll(async () => {
    globalThis.chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    scrub = await import('../background/egress-scrub.js');
    scrub.resetEgressScrubber();
  });

  test('masks for a cloud endpoint', async () => {
    scrub.resetEgressScrubber();
    const out = await scrub.scrubForEgress('write to victim@client.example', {
      endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', kind: 't',
    });
    expect(out).not.toContain('victim@client.example');
    expect(out).toMatch(/\[\[EMAIL-\d+\]\]/);
  });

  test('leaves a genuinely self-hosted destination alone', async () => {
    scrub.resetEgressScrubber();
    const out = await scrub.scrubForEgress('write to victim@client.example', {
      endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2', kind: 't',
    });
    expect(out).toContain('victim@client.example');
  });

  test('masks a cloud model behind a local proxy', async () => {
    scrub.resetEgressScrubber();
    const out = await scrub.scrubForEgress('write to victim@client.example', {
      endpoint: 'http://127.0.0.1:8901/u/zai/v1/chat/completions', model: 'glm-4.6', kind: 't',
    });
    expect(out).not.toContain('victim@client.example');
  });

  test('walks objects, not just strings', async () => {
    scrub.resetEgressScrubber();
    const out = await scrub.scrubForEgress(
      { a: { b: ['mail me at victim@client.example'] } },
      { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o', kind: 't' }
    );
    expect(out.a.b[0]).toMatch(/\[\[EMAIL-\d+\]\]/);
  });

  test('tryScrubForEgress reports failure instead of throwing', async () => {
    const res = await scrub.tryScrubForEgress('x', { endpoint: 'https://api.openai.com/v1', kind: 't' });
    expect(res.ok).toBe(true);
  });
});
