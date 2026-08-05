'use strict';
/**
 * The client↔server contract check.
 *
 * THE LESSON THIS ENCODES
 * -----------------------
 * This is a multi-repo system. The dashboard lives in sentinel-override, the
 * server that serves it lives in sentinel-desktop, and half the URLs it calls
 * are answered by neuralis on the far side of a reverse proxy. On 2026-08-04 a
 * grep for `/__brain` in sentinel-override found nothing and the conclusion
 * drawn — "the route does not exist" — was wrong. Proving a route absent in one
 * repo proves nothing.
 *
 * So the check resolves every client URL across repo boundaries, following the
 * proxy hop, against route tables frozen in contract/server-routes.json.
 *
 * THREE FAILURE CLASSES
 * ---------------------
 * (a) ROUTE — a client URL has no matching server route anywhere in the union
 *     of route tables it could legitimately be answered by.
 *     Real instance: /api/files, /api/files/content, /api/files/download and
 *     /api/conversations were called with no handler — 404 on every panel.
 *
 * (b) BASE — a base constant does not resolve to a usable absolute URL in every
 *     environment the page runs in.
 *     (b1) It must parse as an absolute http(s) URL under http:, https: AND
 *          file:. On a file:// page `location.origin` is the STRING "null", so
 *          `location.origin + '/__brain'` produced "null/__brain" and `new URL`
 *          threw TypeError out of every panel. This is defect #1.
 *     (b2) Under http:/https: it must be SAME-ORIGIN. A base hardcoded to
 *          `http://localhost:8001` parses perfectly and is still broken: a
 *          browser reaching the page over the Cloudflare Tunnel has no route to
 *          the server's loopback. This is defect #2 — the "fix" that was merged
 *          and then reverted in PR #62. (b1) alone would have waved it through.
 *
 * (c) PREFIX — a base that introduces a path prefix (`/__brain`) must have that
 *     prefix declared by the server that serves the page: a route, a mount, or
 *     a proxy. This is what makes the multi-repo hop provable rather than
 *     assumed.
 *
 * Both historical defects were in the BASE, not the path, which is why (b) is
 * the load-bearing check and why the fixtures under
 * tests/fixtures/contract-regressions/ replay exactly those two bases.
 */

const fs = require('fs');
const path = require('path');
const client = require('./client-extract.cjs');
const { pathMatches, prefixMatches, normalisePath } = require('./route-extract.cjs');

const REPO = path.join(__dirname, '..', '..');
const MANIFEST = path.join(REPO, 'contract', 'server-routes.json');

/**
 * Which server serves which client page.
 *
 * `servedBy` is a fact, not a preference: sentinel-desktop's api/server.py
 * mounts this repo's web/ directory at /prime and serves dashboard-prime.html
 * at "/". `resolveAgainst` is the set of route tables a same-origin call from
 * that page may legitimately be answered by.
 */
const CLIENTS = [
  {
    file: 'web/dashboard-prime.html',
    servedBy: 'sentinel-desktop',
    resolveAgainst: ['sentinel-desktop', 'sentinel-prime-premium'],
  },
];

function loadManifest(file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** All proxy declarations across the servers a page can talk to. */
function proxiesFor(manifest, serverIds) {
  const out = [];
  for (const id of serverIds) for (const p of manifest.servers[id]?.proxies || []) out.push(p);
  return out;
}

/**
 * Resolve one absolute path against the fleet.
 *
 * Follows a reverse proxy across the repo boundary: /__brain/brain/stats is a
 * question for sentinel-desktop's proxy AND, after the hop, for neuralis'
 * /brain/stats. Neither repo alone can answer it.
 */
function resolvePath(manifest, serverIds, fullPath, method) {
  const hops = [];
  let target = serverIds;
  let p = fullPath;

  for (let depth = 0; depth < 4; depth++) {
    const proxy = proxiesFor(manifest, target).find((x) => prefixMatches(p, x.prefix));
    if (!proxy) break;
    const rest = normalisePath(p.slice(proxy.prefix === '/' ? 0 : proxy.prefix.length) || '/');
    hops.push({ via: proxy.prefix, declaredIn: proxy.declaredIn, to: proxy.upstream, rest });
    if (!manifest.servers[proxy.upstream]) {
      return { ok: false, reason: `proxy ${proxy.prefix}/* forwards to "${proxy.upstream}", whose route table is not in the manifest`, hops };
    }
    target = [proxy.upstream];
    p = rest;
  }

  for (const id of target) {
    const s = manifest.servers[id];
    if (!s) continue;
    // `wildcard` routes (`/`, `/<path:filename>`) are excluded: they match
    // everything, so they can never be evidence that a specific endpoint exists.
    const usable = s.routes.filter((r) => !r.wildcard);
    const route = usable.find((r) => pathMatches(p, r.path) && (!method || r.method === method || r.method === 'GET'));
    if (route) return { ok: true, server: id, route, hops, resolved: p };
    const anyMethod = usable.find((r) => pathMatches(p, r.path));
    if (anyMethod) return { ok: true, server: id, route: anyMethod, hops, resolved: p, methodMismatch: method && anyMethod.method !== method };
    // A mount at "/" is NOT a catch-all answer. neuralis mounts StaticFiles at
    // "/", and StaticFiles 404s for anything with no file behind it — it does
    // not fall through. Honouring a root mount here would make every brain path
    // "match" and quietly disable check (a) for the entire proxied surface.
    const mount = (s.mounts || []).find((m) => m.path !== '/' && prefixMatches(p, m.path));
    if (mount) return { ok: true, server: id, mount, hops, resolved: p };
  }
  return { ok: false, reason: 'no matching route', hops, resolved: p, searched: target };
}

/**
 * Run the whole contract check for one client page.
 * @returns {{failures: Array, info: object}}
 */
function checkClient(manifest, spec, opts = {}) {
  const failures = [];
  const file = path.join(opts.repo || REPO, spec.file);
  const code = opts.code !== undefined ? opts.code : client.loadClientCode(file);

  const bases = client.findBases(code);
  const resolved = client.resolveBases(bases);
  const serving = manifest.servers[spec.servedBy];

  const info = { file: spec.file, bases: [], sites: [], baseValues: resolved };

  if (!serving) {
    failures.push({
      kind: 'manifest',
      message: `client ${spec.file} is served by "${spec.servedBy}", whose route table is missing from contract/server-routes.json`,
    });
    return { failures, info };
  }

  for (const b of bases) {
    const record = { name: b.name, expr: b.expr.replace(/\s+/g, ' ').slice(0, 120), line: b.line, prefix: null };

    // ── (b1) parses as an absolute http(s) URL in every environment ───────
    let parsedByEnv = {};
    for (const env of Object.keys(client.ENVIRONMENTS)) {
      const r = resolved[env][b.name];
      if (r.error) {
        failures.push({
          kind: 'base-eval',
          base: b.name,
          env,
          message: `${spec.file}:${b.line} base ${b.name} throws under ${env}: ${r.error}`,
        });
        continue;
      }
      if (typeof r.value !== 'string') {
        failures.push({
          kind: 'base-type',
          base: b.name,
          env,
          message: `${spec.file}:${b.line} base ${b.name} is ${typeof r.value} under ${env}, expected a string URL`,
        });
        continue;
      }
      let u;
      try {
        u = new URL(r.value);
      } catch (e) {
        failures.push({
          kind: 'base-url',
          base: b.name,
          env,
          value: r.value,
          message:
            `${spec.file}:${b.line} base ${b.name} = ${JSON.stringify(r.value)} under ${env} is not a parseable absolute URL ` +
            `(new URL threw ${e.name}). ` +
            (env === 'file'
              ? 'On a file:// page location.origin is the STRING "null" — deriving a base from it yields "null/...". '
              : '') +
            'Every fetch() built on this base throws before it reaches the network.',
        });
        continue;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        failures.push({
          kind: 'base-protocol',
          base: b.name,
          env,
          value: r.value,
          message: `${spec.file}:${b.line} base ${b.name} resolves to ${u.protocol} under ${env}; fetch needs http: or https:`,
        });
        continue;
      }
      if (!u.hostname) {
        failures.push({
          kind: 'base-host',
          base: b.name,
          env,
          value: r.value,
          message: `${spec.file}:${b.line} base ${b.name} = ${JSON.stringify(r.value)} under ${env} has no host`,
        });
        continue;
      }
      parsedByEnv[env] = u;
    }

    // ── (b2) same-origin when the page is actually served ────────────────
    for (const env of ['http', 'https']) {
      const u = parsedByEnv[env];
      if (!u) continue;
      const pageOrigin = client.ENVIRONMENTS[env].location.origin;
      if (u.origin !== pageOrigin) {
        failures.push({
          kind: 'base-cross-origin',
          base: b.name,
          env,
          value: u.href,
          message:
            `${spec.file}:${b.line} base ${b.name} = ${JSON.stringify(u.origin)} is cross-origin when the page is served from ` +
            `${pageOrigin}. A base must address the origin that served the page (optionally with a path prefix), or the ` +
            `dashboard only works on the box the server runs on — a browser behind the Cloudflare Tunnel has no route to it. ` +
            `If this host genuinely must be reached, proxy it through the serving origin the way /__brain proxies the brain.`,
        });
      }
    }

    // ── (c) a path prefix must be declared by the serving server ─────────
    const probe = parsedByEnv.https || parsedByEnv.http;
    if (probe) {
      const prefix = probe.pathname.replace(/\/+$/, '');
      record.prefix = prefix || '/';
      if (prefix && prefix !== '') {
        // Same exclusion as route matching, and for the same reason: a `/`
        // mount or a root wildcard route would "cover" any prefix anyone
        // invented, which is precisely the assumption that has to be disproved.
        const covered =
          (serving.proxies || []).some((x) => x.prefix !== '/' && prefixMatches(prefix, x.prefix)) ||
          (serving.mounts || []).some((m) => m.path !== '/' && prefixMatches(prefix, m.path)) ||
          serving.routes.some(
            (r) =>
              !r.wildcard &&
              (pathMatches(prefix, r.path) || prefixMatches(prefix, r.path.replace(/\/:splat$/, ''))),
          );
        if (!covered) {
          failures.push({
            kind: 'base-prefix',
            base: b.name,
            prefix,
            message:
              `${spec.file}:${b.line} base ${b.name} introduces the path prefix ${prefix}, which ${spec.servedBy} does not ` +
              `declare — no route, no mount, no proxy. Every call on this base 404s. ` +
              `(Checked ${serving.routes.length} routes / ${(serving.mounts || []).length} mounts / ` +
              `${(serving.proxies || []).length} proxies from ${spec.servedBy}.)`,
          });
        }
      }
    }
    info.bases.push(record);
  }

  // ── (a) every call site resolves to a declared route ───────────────────
  // A base's own initializer (`BRAIN_API = API + '/__brain'`) is a base
  // declaration, not a call site; it is checked by (c), not by (a).
  const baseNames = bases.map((b) => b.name);
  const sites = client.findCallSites(code, baseNames, {
    skipRanges: bases.map((b) => [b.start, b.end]).filter(([a, z]) => a != null && z != null),
  });

  for (const site of sites) {
    if (site.path === null) {
      // Not a failure on its own — recorded so an unreadable call site is
      // visible rather than silently skipped.
      info.sites.push({ ...site, status: 'unresolved' });
      continue;
    }
    const baseUrl = (resolved.https[site.base] || {}).value;
    if (typeof baseUrl !== 'string') {
      info.sites.push({ ...site, status: 'base-broken' });
      continue; // already reported under (b)
    }
    let basePrefix = '';
    try {
      basePrefix = new URL(baseUrl).pathname.replace(/\/+$/, '');
    } catch {
      info.sites.push({ ...site, status: 'base-broken' });
      continue;
    }
    const { path: cleanPath } = client.splitPath(site.path, site.dynamic);
    const fullPath = normalisePath(basePrefix + cleanPath);
    const res = resolvePath(manifest, spec.resolveAgainst, fullPath, null);
    info.sites.push({ ...site, fullPath, status: res.ok ? 'ok' : 'missing', server: res.server, hops: res.hops });
    if (!res.ok) {
      const searched = (res.searched || spec.resolveAgainst).join(', ');
      const hopNote = res.hops.length
        ? ` (after proxy hop ${res.hops.map((h) => `${h.via}/* -> ${h.to}`).join(' -> ')}, looking for ${res.resolved})`
        : '';
      failures.push({
        kind: 'route',
        base: site.base,
        clientPath: site.path,
        fullPath,
        message:
          `${spec.file}:${site.line} calls ${site.base} + ${JSON.stringify(site.path)} -> ${fullPath}${hopNote}, ` +
          `but no route matches in: ${searched}. ` +
          `Declare the handler, or fix the path. Remember the server may be in another repo — check the manifest, not a grep.`,
      });
    }
  }

  return { failures, info };
}

function checkAll(opts = {}) {
  const manifest = opts.manifest || loadManifest();
  const all = [];
  const infos = [];
  for (const spec of CLIENTS) {
    const { failures, info } = checkClient(manifest, spec, opts);
    all.push(...failures);
    infos.push(info);
  }
  return { failures: all, infos, manifest };
}

module.exports = { checkAll, checkClient, loadManifest, resolvePath, CLIENTS, MANIFEST, REPO };
