/**
 * Client↔server contract test.
 *
 * WHAT THIS IS DEFENDING
 * ----------------------
 * On 2026-08-04 the Prime dashboard broke twice in one day, and both times the
 * defect was in a URL BASE, not in a path:
 *
 *   1. `const BRAIN_API = location.origin + '/__brain'`
 *      On a file:// page `location.origin` is the ASCII string "null", so the
 *      base became "null/__brain". `new URL()` throws TypeError on it, out of
 *      every panel that touched the brain.
 *
 *   2. The fix for 1: repoint BRAIN_API at `:8001` directly — reasoned from a
 *      grep for `/__brain` in THIS repo that found nothing. The grep was right;
 *      the conclusion was wrong. The route is declared in sentinel-desktop's
 *      `api/server.py`, which is the server that serves this page. Shipped in
 *      #61, reverted in #62.
 *
 * The lesson worth encoding is #2's: **this is a multi-repo system, and proving
 * a route absent in one repo proves nothing.** So this test resolves every
 * client URL against route tables extracted from all three server repos —
 * sentinel-desktop, sentinel-prime-premium and neuralis — and follows the
 * `/__brain` reverse proxy across the repo boundary to the brain, because that
 * hop is the only way half these URLs resolve at all.
 *
 * CI cannot clone the sibling repos (one is private), so the tables are frozen
 * into `contract/server-routes.json` and committed. `--check` on the generator
 * re-extracts and fails on drift wherever the siblings ARE present, so the
 * frozen copy cannot rot into a comfortable lie.
 *
 * THE THREE CHECKS
 *   (a) route          — a client URL with no matching server route anywhere
 *   (b) base           — b1: resolves to a parseable absolute http(s) URL under
 *                            http:, https: AND file:
 *                        b2: is same-origin when the page is actually served
 *   (c) base-prefix    — a prefix a base introduces must be declared somewhere
 *
 * (b2) is the one that earns its keep. Defect #2 passes (b1) cleanly.
 *
 * Every check is proved against a fixture that replays the real defect —
 * see tests/fixtures/contract-regressions/.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');

const contract = require('../scripts/lib/check-contract.cjs');
const clientExtract = require('../scripts/lib/client-extract.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'contract-regressions');
const manifest = contract.loadManifest();

/** Run the check over an arbitrary page body instead of a file on disk. */
function checkSource(code, spec = {}) {
  return contract.checkClient(
    manifest,
    {
      file: spec.file || '<fixture>',
      servedBy: spec.servedBy || 'sentinel-desktop',
      resolveAgainst: spec.resolveAgainst || ['sentinel-desktop', 'sentinel-prime-premium'],
    },
    { code },
  );
}

function checkFixture(name) {
  const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  return checkSource(clientExtract.inlineScript(html), { file: `fixtures/${name}` });
}

const kinds = (result) => result.failures.map((f) => f.kind);

// ───────────────────────────────────────────────────────────────────────────
describe('route manifest', () => {
  test('covers all three server repos', () => {
    expect(Object.keys(manifest.servers).sort()).toEqual(
      ['neuralis', 'sentinel-desktop', 'sentinel-prime-premium'].sort(),
    );
  });

  test('every server contributed routes', () => {
    for (const [id, s] of Object.entries(manifest.servers)) {
      expect(`${id}: ${s.routes.length} routes`).not.toBe(`${id}: 0 routes`);
      expect(s.filesRead.length).toBeGreaterThan(0);
    }
  });

  test('declares the /__brain proxy hop into the brain repo', () => {
    // If this ever disappears, every BRAIN_API path silently stops resolving —
    // and the resulting "no route" storm would be the test lying, not the
    // dashboard breaking. Assert the hop itself, not just its effects.
    const proxies = manifest.servers['sentinel-desktop'].proxies;
    const brain = proxies.find((p) => p.prefix === '/__brain');
    expect(brain).toBeDefined();
    expect(brain.upstream).toBe('neuralis');
    expect(brain.declaredIn).toMatch(/sentinel-desktop:api\/server\.py/);
  });

  test('sentinel-desktop declares the routes the file and conversation panels call', () => {
    // These four 404'd on every load before sentinel-desktop v31.1.0. Named
    // explicitly so the regression is a test failure, not an absence.
    const paths = new Set(manifest.servers['sentinel-desktop'].routes.map((r) => r.path));
    for (const p of ['/api/files', '/api/files/content', '/api/files/download', '/api/conversations']) {
      expect([p, paths.has(p)]).toEqual([p, true]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('web/dashboard-prime.html satisfies the fleet contract', () => {
  const result = contract.checkClient(manifest, contract.CLIENTS[0], {});

  test('no client URL is missing a server route (check a)', () => {
    const routeFailures = result.failures.filter((f) => f.kind === 'route');
    expect(routeFailures.map((f) => f.message)).toEqual([]);
  });

  test('every base resolves to a usable URL under http:, https: and file: (check b1)', () => {
    const baseFailures = result.failures.filter((f) =>
      ['base-eval', 'base-type', 'base-url', 'base-protocol', 'base-host'].includes(f.kind),
    );
    expect(baseFailures.map((f) => f.message)).toEqual([]);
  });

  test('every base is same-origin when the page is served (check b2)', () => {
    const xo = result.failures.filter((f) => f.kind === 'base-cross-origin');
    expect(xo.map((f) => f.message)).toEqual([]);
  });

  test('every path prefix a base introduces is declared by a server (check c)', () => {
    const pfx = result.failures.filter((f) => f.kind === 'base-prefix');
    expect(pfx.map((f) => f.message)).toEqual([]);
  });

  test('no failures of any kind', () => {
    expect(result.failures.map((f) => `${f.kind}: ${f.message}`)).toEqual([]);
  });

  test('the check actually inspected the page it claims to', () => {
    // A silent extraction failure would make every assertion above pass on an
    // empty set. Pin the shape: both bases found, and a substantial number of
    // call sites resolved rather than skipped.
    const names = result.info.bases.map((b) => b.name).sort();
    expect(names).toEqual(['API', 'BRAIN_API']);
    const resolved = result.info.sites.filter((s) => s.status === 'ok');
    expect(resolved.length).toBeGreaterThanOrEqual(40);
    expect(result.info.sites.filter((s) => s.status === 'unresolved')).toEqual([]);
  });

  test('BRAIN_API resolves through the proxy into neuralis, not to a direct port', () => {
    // The positive statement of what #62 restored: brain traffic is same-origin
    // and lands in the brain's route table only after the /__brain hop.
    const brainSites = result.info.sites.filter((s) => s.base === 'BRAIN_API' && s.status === 'ok');
    expect(brainSites.length).toBeGreaterThan(20);
    for (const s of brainSites) {
      expect([s.fullPath, s.server]).toEqual([s.fullPath, 'neuralis']);
      expect(s.hops.map((h) => h.via)).toEqual(['/__brain']);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The part that makes the green above mean something.
describe('historical regressions — the check must fail on each', () => {
  test('01: BRAIN_API = location.origin + "/__brain" is caught under file:', () => {
    const r = checkFixture('01-brain-api-null-origin.html');
    expect(kinds(r)).toContain('base-url');
    const f = r.failures.find((x) => x.kind === 'base-url');
    expect(f.base).toBe('BRAIN_API');
    expect(f.env).toBe('file');
    expect(f.value).toBe('null/__brain');
    // ...and it is NOT flagged under http/https, where it genuinely worked.
    expect(r.failures.filter((x) => x.kind === 'base-url' && x.env !== 'file')).toEqual([]);
  });

  test('02: BRAIN_API pointed straight at :8001 is caught as cross-origin', () => {
    const r = checkFixture('02-brain-api-direct-8001.html');
    expect(kinds(r)).toContain('base-cross-origin');
    const envs = r.failures.filter((x) => x.kind === 'base-cross-origin').map((x) => x.env).sort();
    expect(envs).toEqual(['http', 'https']);
    // The whole point of this fixture: a URL-validity check passes it.
    expect(kinds(r)).not.toContain('base-url');
    expect(kinds(r)).not.toContain('base-eval');
  });

  test('03: client paths with no server handler are caught', () => {
    const r = checkFixture('03-missing-server-route.html');
    const missing = r.failures.filter((x) => x.kind === 'route').map((x) => x.clientPath).sort();
    expect(missing).toEqual([
      '/api/conversations-that-does-not-exist',
      '/api/files-that-does-not-exist?path=',
      '/api/files/content-that-does-not-exist?path=x',
    ]);
    // /status is real and must not be swept up.
    expect(r.failures.some((x) => x.kind === 'route' && x.clientPath === '/status')).toBe(false);
  });

  test('04: a base prefix no server declares is caught', () => {
    const r = checkFixture('04-undeclared-base-prefix.html');
    expect(kinds(r)).toContain('base-prefix');
    const f = r.failures.find((x) => x.kind === 'base-prefix');
    expect(f.prefix).toBe('/__neuralis');
  });

  test('the real dashboard fails if regression 01 is reintroduced into it', () => {
    // Not a fixture — the actual page, with only the base swapped, so the check
    // is proved against the real 5700-line file and not just a toy.
    const real = clientExtract.loadClientCode(path.join(REPO, 'web', 'dashboard-prime.html'));
    const broken = real.replace(
      "const BRAIN_API = API + '/__brain';",
      "const BRAIN_API = location.origin + '/__brain';",
    );
    expect(broken).not.toBe(real); // the substitution actually applied
    const r = checkSource(broken, { file: 'web/dashboard-prime.html (regression 01 injected)' });
    expect(kinds(r)).toContain('base-url');
    expect(r.failures.find((x) => x.kind === 'base-url').value).toBe('null/__brain');
  });

  test('the real dashboard fails if regression 02 is reintroduced into it', () => {
    const real = clientExtract.loadClientCode(path.join(REPO, 'web', 'dashboard-prime.html'));
    const broken = real.replace(
      "const BRAIN_API = API + '/__brain';",
      'const BRAIN_API = (location.protocol === \'http:\' || location.protocol === \'https:\')\n' +
        '  ? `${location.protocol}//${location.hostname}:8001`\n' +
        "  : 'http://localhost:8001';",
    );
    expect(broken).not.toBe(real);
    const r = checkSource(broken, { file: 'web/dashboard-prime.html (regression 02 injected)' });
    expect(kinds(r)).toContain('base-cross-origin');
  });

  test('a healthy base passes every check', () => {
    // The control. Without it, a check that fails everything looks identical to
    // a check that works.
    const r = checkSource(`
      const API = (location.protocol === 'http:' || location.protocol === 'https:')
        ? location.origin
        : 'http://localhost:8091';
      const BRAIN_API = API + '/__brain';
      fetch(API + '/status');
      fetch(BRAIN_API + '/brain/stats');
    `);
    expect(r.failures).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('base resolution semantics', () => {
  test('location.origin is the STRING "null" under file:, as browsers report it', () => {
    // The single fact the whole (b1) check rests on. Asserted directly so a
    // future edit to the environment table cannot quietly defuse fixture 01.
    expect(clientExtract.ENVIRONMENTS.file.location.origin).toBe('null');
    expect(typeof clientExtract.ENVIRONMENTS.file.location.origin).toBe('string');
    expect(() => new URL('null' + '/__brain')).toThrow();
  });

  test('all three environments are exercised', () => {
    expect(Object.keys(clientExtract.ENVIRONMENTS).sort()).toEqual(['file', 'http', 'https']);
  });

  test('a same-origin base with a different port is still cross-origin', () => {
    // Why fixture 02 is caught: the host matches and the port does not.
    const r = checkSource(`
      const API = location.origin;
      const OTHER_API = location.protocol + '//' + location.hostname + ':9999';
      fetch(API + '/status');
    `);
    expect(r.failures.some((f) => f.kind === 'base-cross-origin' && f.base === 'OTHER_API')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('route matching is strict', () => {
  test('a mount at "/" is not treated as a catch-all', () => {
    // neuralis mounts StaticFiles at "/". Starlette's StaticFiles 404s rather
    // than falling through, so honouring that mount would make EVERY brain path
    // "resolve" and silently disable check (a) across the whole proxied surface.
    const rootMount = (manifest.servers.neuralis.mounts || []).some((m) => m.path === '/');
    expect(rootMount).toBe(true); // the hazard is real and still present
    const r = contract.resolvePath(manifest, ['sentinel-desktop'], '/__brain/definitely/not/a/route', null);
    expect(r.ok).toBe(false);
  });

  test('a root-level wildcard route is not treated as a catch-all', () => {
    // sentinel-prime-premium declares `@app.route('/<path:filename>')`, which
    // serves a file if one exists and 404s otherwise. Counting it as a match
    // would make check (a) certify every URL ever asked about — the test would
    // be worse than nothing, because it would green-light the exact defect it
    // exists to catch. This was a real bug in the first draft of this test:
    // fixture 03's deliberately-missing paths all "resolved" through it.
    const pp = manifest.servers['sentinel-prime-premium'].routes;
    const wildcards = pp.filter((r) => r.wildcard);
    expect(wildcards.length).toBeGreaterThan(0); // the hazard is real and still present
    expect(wildcards.map((r) => r.path).sort()).toContain('/:splat');

    const r = contract.resolvePath(manifest, ['sentinel-prime-premium'], '/nothing/declares/this', null);
    expect(r.ok).toBe(false);
  });

  test('path parameters match one segment, not many', () => {
    // /api/conversations/{conv_id} must not answer for /api/conversations/a/b/c.
    expect(contract.resolvePath(manifest, ['sentinel-desktop'], '/api/conversations/abc', null).ok).toBe(true);
    expect(contract.resolvePath(manifest, ['sentinel-desktop'], '/api/conversations/a/b/c', null).ok).toBe(false);
  });

  test('an unknown path is reported missing rather than matched', () => {
    const r = contract.resolvePath(manifest, ['sentinel-desktop', 'sentinel-prime-premium'], '/no/such/endpoint', null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no matching route');
  });
});
