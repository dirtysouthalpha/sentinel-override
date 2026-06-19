# Sentinel Consumer — Read the Brain (Sub-project B)

**Date:** 2026-06-19
**Status:** Approved
**Sub-project:** B of 3 (Neuralis ↔ Sentinel Override integration)
**Code home:** this repo (`sentinel-override`)

---

## Initiative context

Goal: link **Sentinel Override** (this Chrome extension) to the **Neuralis brain** (live FastAPI at
`localhost:8000`) so the brain accumulates knowledge from everywhere it's used and every consumer
benefits. Three independent sub-projects, built in order:

| # | Sub-project | Home | Role | Status |
|---|---|---|---|---|
| **A** | Neuralis MCP wrapper | Neuralis repo | Thin stdio MCP server exposing the brain to ZCode | ✅ Built & verified |
| **B** | **Sentinel consumer** ← *this spec* | this repo (`background/`) | Before each run, query Neuralis `/recall`, inject matches into the system prompt | This spec |
| **C** | Sentinel producer | this repo (`background/` + popup) | After each run, push learned "wisdom" to Neuralis as neurons | Pending |

**Build order: A → B → C.** A is done. B (this spec) is the read path. C is the write path, whose
whole substance is redaction/consent and which depends on knowing what B produces.

---

## What B is

A new module, **`background/brain-client.js`**, that queries Neuralis at run start, turns recalled
neurons into a pre-formatted prompt section, and injects it into the system prompt **alongside**
(not replacing) the existing local Client Knowledge section. If the brain is down or returns
nothing, the run proceeds exactly as today — **B is strictly additive and fails open.**

## Why zero manifest changes

The manifest already declares `host_permissions: ["<all_urls>"]`, so the service worker can already
`fetch('http://localhost:8000/...')`. No new permission, no new user prompt. No CSP change either:
the manifest CSP only governs `script-src`/`object-src`/`style-src`; service-worker `fetch` to
localhost is already permitted.

---

## Trust principle: leak-zero by construction

The recall query is built from **platform id + start-URL host only** — never client name and never
raw goal text. The brain's content (once C feeds it) is procedural ("how SonicWall NSM works"), not
client-identifying ("what Acme did"). Platform/host are the natural keys for procedural knowledge.

This makes B's read path leak-zero by construction: we never send "Acme Corp" or the goal to the
brain; we send `m365_admin` or `admin.microsoft.com`. This is the read-side mirror of the redaction
rule C will enforce on the write side, and it is a locked-in property of this design.

## The integration seam

Existing knowledge-injection path (traced in `agent-engine.js` / `llm-client.js`):

```
agent-engine.js:1373   getClientStartupContext(startUrl)  →  { promptSection }
agent-engine.js:1377   clientKnowledgeText = promptSection
agentState.clientKnowledgeText  ──►  llm-client.js:2335  ──►  ${clientKnowledgeCtx} @ 2059
```

B adds a **parallel** section using the same proven pattern, not a parallel system:

```
+ brain-client.js                                       (new module)
+ agent-engine.js (~line 1474, after adaptive-prompts)  recall → format → brainKnowledgeText
+ agentState.brainKnowledgeText  ──►  llm-client.js  ──►  ${brainKnowledgeCtx} @ ~2059
```

The two sections render adjacently in the prompt but stay **distinct and labeled** — distinct trust
tiers deserve distinct framing:

```
## CLIENT-SPECIFIC KNOWLEDGE for Acme Corp        ← existing, local, authoritative
...existing entries...

## BRAIN KNOWLEDGE (shared, cross-installation)   ← new, from Neuralis
...recalled neurons, tagged with their source...
```

Client Knowledge stays local-and-authoritative-for-this-tenant. Brain Knowledge is explicitly
"shared wisdom from the wider community, treat as helpful hints, verify against the live page."
Different trust levels, different labels, both visible to the model.

---

## The module — `background/brain-client.js`

Mirrors the shape of `client-knowledge.js` (helpers + formatting) but much smaller — no local CRUD,
just a thin read client over HTTP.

```
brain-client.js
├── config:  BASE_URL, TIMEOUT (read from chrome.storage.local keys
│            brainBaseUrl / brainTimeout, defaults http://localhost:8000 / 10s)
├── recallNeurons(context) → GET /recall?context=
│     returns { direct: [...], associated: [...] } or throws
├── formatBrainSection(direct, associated) → string
│     renders the "## BRAIN KNOWLEDGE" section with per-line source tags
└── getBrainStartupContext(context) → orchestrator (the ONLY public entry point)
      returns { ok, section: string, directCount, associatedCount, error? }
      FAILS OPEN: on any error returns { ok: false, section: '' }
```

Rules baked into the module:

- **Fails open.** Network error, non-200, timeout, or malformed JSON → return empty section, never
  throw into the run path. A down brain must not break an MSP's run. Non-negotiable.
- **`getBrainStartupContext` is the only public entry point** agent-engine calls. Naming mirrors
  `getClientStartupContext` on purpose — same role, parallel path.
- **Source tags preserved.** Each rendered line includes `[src:<source>]` so the model sees
  provenance. This is the field C will set to `sentinel-override`; ZCode's neurons today carry
  `source: zcode`. The `[src:memory_key]` audit-chip pattern already exists in the finish-summary
  pipeline, so this is consistent with how Sentinel reasons about provenance.

## Recall strategy

One recall call per run: `GET /recall?context=<platform id or host>`.

- **Primary key:** the adaptive-prompts platform id (`m365_admin`, `sonicwall_nsm`, ...), available
  after `_applyAdaptivePrompts` returns at `agent-engine.js:1473`.
- **Fallback key:** the start-URL host, when no platform is detected.
- **Never used as a key:** client name, tenant, raw goal text (leak-zero rule, above).

## Settings — one new toggle + URL field

New Settings-modal entry, default **OFF**:

> **🧠 Neuralis Brain (experimental)** — *[ ] Query a local knowledge brain at the start of each
> run to inject community wisdom. Requires a Neuralis instance reachable from this machine.
> No client data is sent.*

Plus a **base URL field** defaulting to `http://localhost:8000`.

Rationale:

1. B makes a per-run network call the extension never made before. Even though it's localhost and
   leaks nothing, this extension's default posture is "no network calls except your configured LLM."
   A new outbound call deserves explicit opt-in.
2. The label explicitly states "No client data is sent" — true and verifiable, and material to the
   trust posture. When C adds the write path, that path gets its own separate, harder-to-enable
   toggle.

Storage keys: `brainEnabled` (boolean, default false), `brainBaseUrl` (string, default
`http://localhost:8000`). Wired in `popup-modules/settings.js`.

---

## The diff to existing files

Three files touched, all additive:

1. **`background/brain-client.js`** *(new)* — the module above.
2. **`background/agent-engine.js`** — after line 1473 (`finalGoal = await _applyAdaptivePrompts`),
   one block: read the `brainEnabled` toggle, recall by platform/host, set `brainKnowledgeText`.
   Then add `brainKnowledgeText` to the `agentState` object at line 4847.
3. **`background/llm-client.js`** — mirror the `clientKnowledgeCtx` pattern: derive
   `brainKnowledgeCtx` from `agentState.brainKnowledgeText` (~line 2335), render
   `${brainKnowledgeCtx}` adjacent to `${clientKnowledgeCtx}` at line 2059.

Plus Settings UI wiring (toggle + URL field) in `popup-modules/settings.js`.

## Testing

Sentinel's standard Jest suite. New file **`tests/brain-client.test.js`**:

- `formatBrainSection` — empty input → empty string; direct+associated → correctly labeled section
  with source tags.
- `recallNeurons` — mocked `fetch`: success → parsed shape; non-200 → throws; network error →
  throws; malformed JSON → throws.
- `getBrainStartupContext` — **every error path returns `{ ok:false, section:'' }`** (the
  fails-open guarantee is itself a test target). Toggle off → returns empty without fetching.

Plus a small agent-engine integration test asserting the section lands in
`agentState.brainKnowledgeText` when the toggle is on and the mock returns data.

All existing suites must still pass: `npm test` → 164 suites, 8,313+ passing.

## Scope boundaries — what B is NOT

- **No write path.** B reads only. The producer is C.
- **No new permissions.** `<all_urls>` already covers `localhost:8000`.
- **No client-identifying recall.** Platform/host only, by construction.
- **No changes to Client Knowledge.** The local system is untouched; Brain Knowledge is a sibling.
- **No CSP change.** Service-worker `fetch` to localhost is already permitted.

---

*Execution goal prompt for B is delivered in the brainstorming chat alongside this spec, not stored
in the spec itself. See the conversation where this design was approved.*
