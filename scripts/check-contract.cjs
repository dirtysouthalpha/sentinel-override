#!/usr/bin/env node
'use strict';
/**
 * Client↔server contract check — human-readable CLI.
 *
 * The same three checks the Jest suite runs
 * (tests/web-client-server-contract.test.js), printed as a report rather than
 * as assertion diffs. Useful when you are editing a dashboard and want the
 * answer in under a second, or when a CI failure needs to be reproduced by hand.
 *
 *   node scripts/check-contract.cjs          # pass/fail summary
 *   node scripts/check-contract.cjs -v       # also list every resolved URL
 *
 * Exit 0 = the contract holds, 1 = it does not.
 */

const contract = require('./lib/check-contract.cjs');

const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');

let manifest;
try {
  manifest = contract.loadManifest();
} catch (e) {
  console.error('FAIL: cannot read contract/server-routes.json — ' + e.message);
  console.error('      Run: node scripts/generate-route-manifest.cjs');
  process.exit(1);
}

const servers = Object.entries(manifest.servers);
console.log('Server route tables (frozen in contract/server-routes.json):');
for (const [id, s] of servers) {
  console.log(`  ${id.padEnd(24)} ${String(s.routes.length).padStart(4)} routes  ${s.role}`);
  for (const p of s.proxies || []) {
    console.log(`  ${''.padEnd(24)}      proxy ${p.prefix}/*  ->  ${p.upstream}   [${p.declaredIn}]`);
  }
}
console.log();

let failures = 0;
for (const spec of contract.CLIENTS) {
  const { failures: f, info } = contract.checkClient(manifest, spec, {});
  const ok = info.sites.filter((s) => s.status === 'ok').length;
  console.log(`${spec.file}  (served by ${spec.servedBy})`);
  for (const b of info.bases) {
    const vals = Object.entries(info.baseValues).map(([env, m]) => {
      const r = m[b.name];
      return `${env}=${r.error ? 'THROWS ' + r.error : JSON.stringify(r.value)}`;
    });
    console.log(`  base ${b.name} @ line ${b.line}`);
    for (const v of vals) console.log(`       ${v}`);
  }
  console.log(`  ${ok}/${info.sites.length} call sites resolve to a declared route`);

  if (verbose) {
    for (const s of info.sites) {
      const hop = s.hops && s.hops.length ? `  via ${s.hops.map((h) => h.via).join(',')}` : '';
      console.log(`    ${s.status.padEnd(8)} ${String(s.fullPath || s.path).padEnd(36)} -> ${s.server || '?'}${hop}`);
    }
  }

  if (f.length) {
    console.log();
    for (const x of f) console.error(`  FAIL [${x.kind}] ${x.message}`);
    failures += f.length;
  }
  console.log();
}

if (failures) {
  console.error(`${failures} contract failure(s).`);
  console.error('Remember: the server may be in another repo. Check the manifest, not a grep.');
  process.exit(1);
}
console.log('Contract holds.');
