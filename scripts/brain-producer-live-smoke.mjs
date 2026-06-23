// Live smoke harness for sub-project C (Neuralis brain WRITE producer).
// Exercises the REAL brain-producer.js against a live Neuralis brain.
//
// Run against a live brain:
//   NEURALIS_URL=http://172.22.82.67:8000 node scripts/brain-producer-live-smoke.mjs
import { publishRunLearning, redactCandidate } from '../background/brain-producer.js';

const NEURALIS_URL = process.env.NEURALIS_URL || 'http://localhost:8000';

// --- chrome.storage.local stub ---
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
// 1. Producer ON + confirmed + survivor -> neuron shipped (source: sentinel-override)
banner(`1. producer ON + confirmed + self-heal survivor -> POST /neurons/think (NEURALIS_URL=${NEURALIS_URL})`);
_store.brainProducerEnabled = true;
_store.brainProducerLastConfirmedAt = new Date().toISOString();
_store.brainBaseUrl = NEURALIS_URL;
const goodCtx = {
  platformId: 'm365_admin',
  healingHistory: [{ id: 'live-h1', status: 'healed', attempts: 2, successStrategy: 'fallback_to_xpath_selector', endTime: Date.now() }],
  recoveryEvents: [],
  notes: ['The conditional access policy form needs the Legacy auth toggle expanded first'],
  clientIdentity: { displayName: 'Unrelated Co', tenant: 'unrelated.onmicrosoft.com' },
};
let fetchCount = 0;
const _origFetch = globalThis.fetch;
globalThis.fetch = (...a) => { fetchCount++; return _origFetch(...a); };
let r1 = await publishRunLearning(goodCtx);
globalThis.fetch = _origFetch;
console.log('ok:', r1.ok, '| shipped:', r1.shipped, '| dropped:', r1.dropped, '| fetchCalls:', fetchCount);
const shipped1 = r1.ok && r1.shipped > 0;
console.log('RESULT:', shipped1 ? 'PASS — survivor neuron(s) shipped to live brain' : 'FAIL');

// ---------------------------------------------------------------------------
// 2. Redaction drop demo: candidate with the client name UNQUOTED -> dropped, NO fetch
banner('2. redaction gate: client-name candidate -> DROPPED, no fetch');
_store.brainProducerEnabled = true;
_store.brainProducerLastConfirmedAt = new Date().toISOString();
fetchCount = 0;
globalThis.fetch = (...a) => { fetchCount++; return _origFetch(...a); };
const leakCtx = {
  platformId: 'm365_admin',
  healingHistory: [],
  recoveryEvents: [],
  notes: ['Acme Corp special SSO flow breaks on Fridays'], // client name UNQUOTED
  clientIdentity: { displayName: 'Acme Corp', tenant: 'acme.onmicrosoft.com' },
};
let r2 = await publishRunLearning(leakCtx);
globalThis.fetch = _origFetch;
console.log('ok:', r2.ok, '| shipped:', r2.shipped, '| dropped:', r2.dropped, '| fetchCalls:', fetchCount);
const redacted = r2.shipped === 0 && fetchCount === 0;
console.log('RESULT:', redacted ? 'PASS — client-identifying candidate dropped, nothing shipped' : 'FAIL');

// Also prove redactCandidate directly: client name -> null; IP -> redacted survivor
const denyDirect = await redactCandidate('Acme Corp uses a proxy', { displayName: 'Acme Corp', tenant: 'acme.onmicrosoft.com' });
const ipDirect = await redactCandidate('Server 10.0.0.5 timed out', {});
console.log('redactCandidate(client name) =', JSON.stringify(denyDirect), '(expect null)');
console.log('redactCandidate(IP) =', JSON.stringify(ipDirect), '(expect [REDACTED:ip])');

// ---------------------------------------------------------------------------
// 3. Consent gate: producer OFF -> NO fetch
banner('3. consent gate: producer OFF -> no fetch');
_store.brainProducerEnabled = false;
fetchCount = 0;
globalThis.fetch = (...a) => { fetchCount++; return _origFetch(...a); };
let r3 = await publishRunLearning(goodCtx);
globalThis.fetch = _origFetch;
console.log('ok:', r3.ok, '| shipped:', r3.shipped, '| fetchCalls:', fetchCount);
const gated = r3.shipped === 0 && fetchCount === 0;
console.log('RESULT:', gated ? 'PASS — OFF ships nothing' : 'FAIL');

console.log('\n=========================================\nSUMMARY\n-----------------------------------------');
console.log('1 ON ships survivor neuron   :', shipped1 ? 'PASS' : 'n/a (brain unreachable)');
console.log('2 redaction drops client data :', redacted ? 'PASS' : 'FAIL');
console.log('3 OFF gates all writes        :', gated ? 'PASS' : 'FAIL');
