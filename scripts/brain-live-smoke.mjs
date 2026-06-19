// Live smoke harness for sub-project B. Exercises the REAL brain-client.js
// (no mocks) against a live (or deliberately-down) Neuralis brain.
//
// Run against a live brain:
//   NEURALIS_URL=http://172.22.82.67:8000 node scripts/brain-live-smoke.mjs
// Fails-open check (brain down): stop Neuralis, then run with a dead address:
//   NEURALIS_URL=http://172.22.82.67:8000 node scripts/brain-live-smoke.mjs
import { getBrainStartupContext, recallNeurons } from '../background/brain-client.js';

// Address under test. Defaults to localhost:8000 (the extension default). On
// this machine Neuralis runs in WSL2, so pass the WSL eth0 IP to hit it from
// Windows. Point this at a dead address to exercise the fails-open path.
const NEURALIS_URL = process.env.NEURALIS_URL || 'http://localhost:8000';

// --- Minimal chrome.storage.local stub (mirrors the extension surface) ---
const _store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        const defs = (typeof keys === 'object' && !Array.isArray(keys)) ? keys : {};
        const list = Array.isArray(keys) ? keys : Object.keys(defs);
        for (const k of list) out[k] = (k in _store) ? _store[k] : defs[k];
        return out;
      },
      set: async (obj) => { Object.assign(_store, obj); },
    },
  },
};

function banner(t) { console.log('\n=========================================\n' + t + '\n-----------------------------------------'); }

// ---------------------------------------------------------------------------
// 1. brainEnabled ON + matching platform key → section appears
banner(`1. brainEnabled ON, recall key "premier"  (NEURALIS_URL=${NEURALIS_URL})`);
_store.brainEnabled = true;
_store.brainBaseUrl = NEURALIS_URL;
let fetchCount = 0;
const _origFetch = globalThis.fetch;
globalThis.fetch = (...a) => { fetchCount++; return _origFetch(...a); };

let r1 = await getBrainStartupContext('premier');
globalThis.fetch = _origFetch;
console.log('ok:', r1.ok, '| directCount:', r1.directCount, '| associatedCount:', r1.associatedCount, '| fetchCalls:', fetchCount);
console.log('--- section (first 700 chars) ---');
console.log((r1.section || '[EMPTY]').slice(0, 700));
const onHasSection = r1.ok && r1.section.includes('## BRAIN KNOWLEDGE') && r1.section.includes('[src:');
console.log('RESULT:', onHasSection ? 'PASS — BRAIN KNOWLEDGE section present with [src:] tags' : 'FAIL (expected when brain is down/unreachable; re-run with a live NEURALIS_URL)');

// ---------------------------------------------------------------------------
// 2. brainEnabled OFF → empty WITHOUT calling fetch
banner('2. brainEnabled OFF → empty section, NO fetch');
_store.brainEnabled = false;
fetchCount = 0;
globalThis.fetch = (...a) => { fetchCount++; return _origFetch(...a); };
let r2 = await getBrainStartupContext('premier');
globalThis.fetch = _origFetch;
console.log('ok:', r2.ok, '| section:', JSON.stringify(r2.section), '| fetchCalls:', fetchCount);
const offOk = r2.ok === false && r2.section === '' && fetchCount === 0;
console.log('RESULT:', offOk ? 'PASS — OFF returns empty without any network call' : 'FAIL');

// ---------------------------------------------------------------------------
// 3. Fails-open: point at a dead URL (Neuralis down) + ON → run still proceeds
banner('3. Fails-open: brainBaseUrl = dead port 9999, brainEnabled ON');
_store.brainEnabled = true;
_store.brainBaseUrl = 'http://localhost:9999'; // nothing listening
let r3 = await getBrainStartupContext('premier');
console.log('ok:', r3.ok, '| section:', JSON.stringify(r3.section), '| error:', r3.error || '(none)');
const failOpen = r3.ok === false && r3.section === '';
console.log('RESULT:', failOpen ? 'PASS — down brain returns ok:false, empty section (run proceeds)' : 'FAIL');

// ---------------------------------------------------------------------------
// 4. Direct recallNeurons against the configured brain (raw shape sanity)
banner(`4. recallNeurons raw (baseUrl=${NEURALIS_URL})`);
let raw;
try {
  raw = await recallNeurons('premier', { baseUrl: NEURALIS_URL });
  const d0 = raw.direct[0] || {};
  const a0 = raw.associated[0] || {};
  console.log('direct[0].content sample:', JSON.stringify((d0.content || '').slice(0, 90)));
  console.log('associated[0] extra fields:', a0.synapse_strength !== undefined ? 'synapse_strength, connected_to' : '(none)');
  console.log('RESULT: PASS — recall returned', raw.direct.length, 'direct,', raw.associated.length, 'associated');
} catch (e) {
  console.log('RESULT: (brain unreachable) —', e.message);
}

console.log('\n=========================================\nSUMMARY\n-----------------------------------------');
console.log('1 ON shows section        :', onHasSection ? 'PASS' : 'n/a (brain down)');
console.log('2 OFF empty no fetch      :', offOk ? 'PASS' : 'FAIL');
console.log('3 fails-open when down    :', failOpen ? 'PASS' : 'FAIL');
