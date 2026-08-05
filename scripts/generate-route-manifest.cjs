#!/usr/bin/env node
'use strict';
/**
 * Freeze the fleet's server route tables into `contract/server-routes.json`.
 *
 * WHY A FROZEN MANIFEST
 * ---------------------
 * The client that must be checked lives in THIS repo. The servers that answer
 * it live in three others — one of them private. CI here cannot clone them, and
 * the failure mode we are defending against is exactly "I looked in one repo
 * and concluded the route does not exist". So the route tables are extracted
 * from the sibling checkouts, committed here, and CI checks the client against
 * the committed copy. When the siblings ARE present (a dev box, or a job that
 * checks them out) `--check` re-extracts and fails on drift, so the frozen copy
 * cannot rot into a lie.
 *
 *   node scripts/generate-route-manifest.cjs          # write the manifest
 *   node scripts/generate-route-manifest.cjs --check  # fail if it is stale
 *
 * Sibling locations are overridable so this works off a hard-coded C:\AgentLink:
 *   SENTINEL_DESKTOP_DIR, SENTINEL_PRIME_PREMIUM_DIR, NEURALIS_DIR
 *
 * sentinel-desktop is read through `git show origin/main:<path>` and never
 * touched: another agent works in that tree and its working copy is not ours to
 * trust or to modify.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  extractPythonRoutes,
  extractBlueprintPrefixes,
  normalisePath,
} = require('./lib/route-extract.cjs');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'contract', 'server-routes.json');

/**
 * Which ports belong to which server, so a reverse proxy can be followed
 * automatically. `/__brain/{path:path}` forwards to http://localhost:8001;
 * without this table nothing would know that a `/__brain/...` URL is really a
 * question for the neuralis route table, in a third repo.
 */
const PORT_OWNERS = {
  8001: 'neuralis',
  8091: 'sentinel-desktop',
};

const SERVERS = [
  {
    id: 'sentinel-desktop',
    role: 'serves web/dashboard-prime.html (mounted at /prime and at /)',
    dirEnv: 'SENTINEL_DESKTOP_DIR',
    dirDefault: 'C:/AgentLink/sentinel-desktop',
    // READ-ONLY repo: read committed content, never the working tree.
    gitRef: 'origin/main',
    files: ['api/server.py', 'core/dashboard.py'],
  },
  {
    id: 'sentinel-prime-premium',
    role: 'serves public/ (index, tv-mode, voice-mode) from NUKE',
    dirEnv: 'SENTINEL_PRIME_PREMIUM_DIR',
    dirDefault: 'C:/AgentLink/sentinel-prime-premium',
    gitRef: null,
    files: ['server/app.py'],
    // Flask blueprints, resolved through register_blueprint(url_prefix=...).
    blueprintGlob: 'server',
  },
  {
    id: 'neuralis',
    role: 'the brain — reached only through the /__brain proxy',
    dirEnv: 'NEURALIS_DIR',
    dirDefault: 'C:/AgentLink/neuralis',
    gitRef: null,
    // Explicitly listed, not globbed: code/neuralis holds unmounted modules
    // (cognition_v8.py, *.bak-*) whose routes are NOT reachable, and a glob
    // would silently make the table too permissive.
    files: [
      'code/neuralis/main.py',
      'code/neuralis/routes_brain.py',
      'code/neuralis/routes_recall.py',
      'code/neuralis/routes_cognition.py',
      'code/neuralis/routes_ops.py',
      'code/neuralis/routes_memory.py',
      'code/neuralis/pipelines.py',
      'code/neuralis/synthesis.py',
      'code/neuralis/topics.py',
      'code/neuralis/cognition.py',
      'code/neuralis/reasoning.py',
      'code/neuralis/v6_agi.py',
    ],
  },
];

function repoDir(server) {
  return process.env[server.dirEnv] || server.dirDefault;
}

function readSource(server, rel) {
  const dir = repoDir(server);
  if (server.gitRef) {
    try {
      return execFileSync('git', ['show', `${server.gitRef}:${rel}`], {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Detect reverse-proxy routes automatically.
 *
 * A route whose path ends in a `:splat` and whose handler forwards to
 * `http://localhost:<port>` is a proxy; the remainder of the URL is a question
 * for whichever server owns that port. This is how `/__brain/{path:path}` is
 * found without anybody having to know it exists — the multi-repo hop that was
 * missed on 2026-08-04 becomes a fact the tooling derives.
 */
function detectProxies(src, label, routes) {
  const found = [];
  const lines = src.split('\n');
  for (const r of routes) {
    if (!r.path.endsWith(':splat')) continue;
    const startLine = Number(String(r.declaredIn).split(':').pop()) || 1;
    const body = lines.slice(startLine - 6, startLine + 45).join('\n');
    // Either a literal target, or a variable assigned one nearby / in-file.
    let portMatch = /https?:\/\/(?:localhost|127\.0\.0\.1)[:](\d+)/.exec(body);
    if (!portMatch) {
      const varUse = /\{?(_?[A-Z][A-Z0-9_]*URL)\}?/.exec(body);
      if (varUse) {
        const assign = new RegExp(String.raw`${varUse[1]}\s*=\s*["']https?://(?:localhost|127\.0\.0\.1):(\d+)`).exec(src);
        if (assign) portMatch = [null, assign[1]];
      }
    }
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    const prefix = r.path.replace(/\/?:splat$/, '') || '/';
    found.push({
      prefix: normalisePath(prefix),
      upstream: PORT_OWNERS[port] || `unknown:${port}`,
      upstreamPort: port,
      declaredIn: `${label} (${r.declaredIn})`,
    });
  }
  // De-duplicate: one entry per prefix, methods do not change the routing.
  const byPrefix = new Map();
  for (const p of found) if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, p);
  return [...byPrefix.values()];
}

function collectServer(server) {
  const out = {
    id: server.id,
    role: server.role,
    source: server.gitRef ? `${server.gitRef} (read-only)` : 'working tree',
    filesRead: [],
    filesMissing: [],
    routes: [],
    mounts: [],
    proxies: [],
  };

  let files = [...server.files];

  // Flask blueprints: only the modules app.py actually registers, with the
  // url_prefix it registers them under.
  let bpPrefixes = {};
  let bpModules = {};
  if (server.blueprintGlob) {
    const appSrc = readSource(server, server.files[0]);
    if (appSrc) {
      bpPrefixes = extractBlueprintPrefixes(appSrc);
      for (const m of appSrc.matchAll(/^\s*from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\s+([A-Za-z_][A-Za-z0-9_]*_bp|[a-z_]*_bp)\s*$/gm)) {
        bpModules[m[2]] = `${server.blueprintGlob}/${m[1]}.py`;
      }
      for (const [bpVar, rel] of Object.entries(bpModules)) {
        if (!(bpVar in bpPrefixes)) continue;
        files.push({ rel, extraPrefix: bpPrefixes[bpVar] || '' });
      }
    }
  }

  for (const entry of files) {
    const rel = typeof entry === 'string' ? entry : entry.rel;
    const extraPrefix = typeof entry === 'string' ? '' : entry.extraPrefix;
    const src = readSource(server, rel);
    if (src === null) {
      out.filesMissing.push(rel);
      continue;
    }
    out.filesRead.push(rel);
    const label = `${server.id}:${rel}`;
    const { routes, mounts } = extractPythonRoutes(src, label, { extraPrefix });
    out.routes.push(...routes);
    out.mounts.push(...mounts);
    out.proxies.push(...detectProxies(src, label, routes));
  }

  // Stable ordering so the committed manifest has no spurious diffs.
  const key = (r) => `${r.path}\u0000${r.method || ''}\u0000${r.declaredIn}`;
  out.routes.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  out.mounts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  out.proxies.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  return out;
}

function build() {
  const servers = {};
  const unavailable = [];
  for (const s of SERVERS) {
    const collected = collectServer(s);
    if (!collected.filesRead.length) {
      unavailable.push({ id: s.id, dir: repoDir(s), env: s.dirEnv });
      continue;
    }
    servers[s.id] = collected;
  }
  return {
    // Bump when the extractor's output shape changes.
    schema: 1,
    generatedBy: 'scripts/generate-route-manifest.cjs',
    note:
      'Frozen route tables for the servers that answer this repo\'s dashboards. ' +
      'Client and server live in different repos; a route missing HERE proves nothing. ' +
      'Regenerate with: node scripts/generate-route-manifest.cjs',
    servers,
    unavailable,
  };
}

function stableJson(manifest) {
  // `generatedAt` is deliberately absent — a timestamp would make --check fail
  // on every run and train everyone to ignore it.
  return JSON.stringify(manifest, null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const built = build();

  if (built.unavailable.length) {
    for (const u of built.unavailable) {
      console.warn(`  warn: ${u.id} not readable at ${u.dir} (set ${u.env} to override)`);
    }
  }
  if (check) {
    // Drift check, per server.
    //
    // CI for this repo cannot clone the sibling checkouts — one of them is
    // private — so "no siblings visible" is the normal case there and must NOT
    // be a failure; the contract test still runs in full against the committed
    // manifest. Where a sibling IS visible (any dev box, or a job that checks it
    // out) its table is re-extracted and compared, so the frozen copy cannot rot
    // into a comfortable lie. Servers are compared individually so a partial
    // environment still checks what it can see.
    let current;
    try {
      current = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch {
      console.error(`FAIL: ${path.relative(REPO, OUT)} is missing or unparseable. Run: node scripts/generate-route-manifest.cjs`);
      process.exit(1);
    }
    const checked = Object.keys(built.servers);
    if (!checked.length) {
      console.log('skip: no sibling server repo is readable here — cannot verify manifest freshness.');
      console.log('      The contract test still runs in full against the committed manifest.');
      return;
    }
    let stale = 0;
    for (const id of checked) {
      const was = current.servers?.[id];
      const now = built.servers[id];
      if (!was) {
        console.error(`FAIL: ${id} is missing from the committed manifest.`);
        stale += 1;
        continue;
      }
      if (JSON.stringify(was) === JSON.stringify(now)) {
        console.log(`  ok: ${id} — ${now.routes.length} routes, current.`);
        continue;
      }
      stale += 1;
      console.error(`FAIL: ${id} route table is stale.`);
      const wasSet = new Set((was.routes || []).map((r) => `${r.method} ${r.path}`));
      const nowSet = new Set((now.routes || []).map((r) => `${r.method} ${r.path}`));
      for (const r of nowSet) if (!wasSet.has(r)) console.error(`      + ${r}`);
      for (const r of wasSet) if (!nowSet.has(r)) console.error(`      - ${r}`);
    }
    if (stale) {
      console.error('\nRun: node scripts/generate-route-manifest.cjs  and commit contract/server-routes.json.');
      process.exit(1);
    }
    console.log(`ok: route manifest current for ${checked.length} server(s).`);
    return;
  }

  if (!Object.keys(built.servers).length) {
    console.error('FAIL: no server repo was readable — refusing to write an empty manifest.');
    process.exit(2);
  }

  const next = stableJson(built);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, next);
  let total = 0;
  for (const [id, s] of Object.entries(built.servers)) {
    console.log(`  ${id}: ${s.routes.length} routes, ${s.mounts.length} mounts, ${s.proxies.length} proxies (${s.filesRead.length} files)`);
    for (const p of s.proxies) console.log(`      proxy ${p.prefix}/* -> ${p.upstream} (:${p.upstreamPort})  ${p.declaredIn}`);
    total += s.routes.length;
  }
  console.log(`Wrote ${path.relative(REPO, OUT)} — ${total} routes.`);
}

if (require.main === module) main();

module.exports = { build, SERVERS, OUT, repoDir };
