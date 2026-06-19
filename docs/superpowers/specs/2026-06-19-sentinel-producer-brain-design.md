# Sentinel Producer — Feed the Brain (Sub-project C)

**Date:** 2026-06-19
**Status:** Approved
**Sub-project:** C of 3 (Neuralis ↔ Sentinel Override integration)
**Code home:** this repo (`sentinel-override`)

---

## Initiative context

Goal: link **Sentinel Override** (this Chrome extension) to the **Neuralis brain** (live FastAPI at
`localhost:8000`) so the brain accumulates knowledge from everywhere it's used and every consumer
benefits. Three independent sub-projects, built in order:

| # | Sub-project | Home | Role | Status |
|---|---|---|---|---|
| **A** | Neuralis MCP wrapper | Neuralis repo | Thin stdio MCP server exposing the brain to ZCode | ✅ Built & verified |
| **B** | Sentinel consumer | this repo (`background/`) | Read `/recall` at run start, inject as prompt section | ✅ Built & verified |
| **C** | **Sentinel producer** ← *this spec* | this repo (`background/` + popup) | After each run, push redacted procedural learning to the brain as neurons | This spec |

**Build order: A → B → C.** C is last because all the trust/redaction/consent weight lives here, and
it depends on the read path (B) and the wrapper (A) being proven first.

---

## The central problem

The extension's identity is "no data exfiltration." C asks it to ship run-learned knowledge to a
shared brain — which is exfiltration by definition. The design problem is to make that exfiltration
**safe enough that it doesn't violate the contract an MSP has with their own client.** Everything in
this spec serves that one goal.

## The resolution: ship procedural-only, gate it hard

Not all knowledge is equal. Split it by trust tier:

| Tier | Example | Ship to brain? |
|---|---|---|
| **Procedural** — how a *platform* works, independent of any client | "SonicWall NSM's VPN policy add form requires the Advanced toggle before the PSK field appears" | ✅ Yes — universally useful, no client identity |
| **Client-identifying** — facts about a specific tenant/user/account | "acme.onmicrosoft.com uses a SAML proxy at /auth/saml" | ❌ Never — that's someone else's data |

The brain collects procedural learning only. This is the same split B already encodes on the read
side (recall by platform/host, never by client). C is the write-side mirror — leak-zero by
construction, just like B.

## Existing infrastructure C reuses (verified in the code)

Two gifts that make C dramatically simpler and safer than a from-scratch build:

1. **A production-tested PII scrubber** — `agent-reporting.js:182` `_scrubPii` (with regex constants
   `PII_IP_RE`, `PII_EMAIL_RE`, `PII_TICKET_RE`, `PII_CLIENT_STRING_RE`, `PII_CLIENT_SINGLE_RE`).
   Redacts IPs, emails, tickets, quoted/singly-quoted client strings. C reuses it; does not reinvent
   it. (Requires exporting `_scrubPii` and its regex constants — a minimal, well-bounded change to
   `agent-reporting.js`.)
2. **A non-fatal end-of-run hook** — `agent-engine.js:7918`, right after the client-knowledge
   `markRunCompleted` call, already wrapped in "never let knowledge bookkeeping break the run finish
   path." C plugs in there with the same isolation guarantee.

---

## What gets shipped — candidate set + the mandatory gate

At run end (the `markRunCompleted` seam, `agent-engine.js:7918`), C gathers a **candidate neuron**
from three safe sources:

1. **The detected platform id** (e.g. `m365_admin`) — as a tag, never as content.
2. **Self-healing recovery events that succeeded** — "selector X failed, fell back to Y, it worked."
   This is the highest-value procedural knowledge: literally "how to operate this UI when the
   obvious thing breaks." Sentinel already tracks these via `_learnedPatterns` and the recovery
   skills system.
3. **Timing/UI-structure observations** the agent made via `note` actions, *after* PII scrubbing.

### The gate (mandatory, in this order)

1. **PII scrub** — run the existing `_scrubPii` regex pass over all candidate content. Zero new regex
   to invent.
2. **Client-entity denylist** — if the scrubbed content still contains the active client's name,
   tenant, or any `chrome.storage.local` known client identifier, **drop the whole candidate.**
   Fail-closed: if we can't prove it's clean, we don't ship it.
3. **Length/sanity** — cap at 1000 chars (matches `client-knowledge.js`); drop empties.

Only candidates that clear all three gates get shipped. The scrub is the default; the denylist is the
safety net for anything the regex misses (e.g. an unusual client-name format).

## Provenance — `source: "sentinel-override"`

Every neuron C ships carries `source: "sentinel-override"` (the field A's `think` tool exposes, and
B preserves as `[src:...]` tags). Non-cosmetic: it lets a future trust-tier system in the brain
weight community-contributed knowledge differently from your own ZCode-contributed knowledge, and it
lets you audit "who fed the brain what."

---

## Consent — three layers, all required

1. **Master toggle, OFF by default** (`brainProducerEnabled`). Distinct from B's read toggle —
   opting into *reading* community wisdom does **not** opt you into *writing* it. A new outbound
   *write* of user data needs its own, harder opt-in.
2. **Per-run confirmation** the first time after enabling, and re-prompted if the setting was off for
   >7 days. Confirmation text: *"This will send redacted, platform-level operating notes to your
   Neuralis brain. No client names, tenants, emails, or IPs are sent. Continue?"*
3. **Revoke at any time** — toggling off stops all writes immediately; no pending queue ships.

## No offline queue

If the brain is down at run end, the learning is **dropped** (not stored for later). Rationale: keeps
the "no data accumulation" posture intact. Queues are where that posture erodes. Revisitable later;
out of scope now.

---

## The module — `background/brain-producer.js`

Same architecture as `brain-client.js`: one public orchestrator, fails-open, all errors contained.

```
brain-producer.js
├── redactCandidate(content, clientIdentity) → string | null
│     applies _scrubPii, then client denylist. Returns null if it fails the gate.
├── buildCandidates(runContext) → [{ content, tags, region }]
│     pulls safe sources (platform tag, successful recoveries, scrubbed notes)
├── shipNeuron(neuron) → POST /neurons/think
│     { content, region, source: "sentinel-override" }
└── publishRunLearning(runContext) → orchestrator (ONLY public entry point)
      reads brainProducerEnabled + confirmation state;
      builds candidates, redacts each, ships survivors;
      FAILS OPEN: never throws into the run-finish path
```

### Region mapping

Neuralis has 12 brain regions. C maps platform learning deliberately:

| Source | Region | Why |
|---|---|---|
| Successful self-healing / recovery | `hippocampus` | Procedural memory consolidation — "how to do it" |
| UI-structure / timing observations | `parietal_left` | Spatial/structural sense of the UI |
| Anything else / fallback | `hippocampus` | Safe default (matches A's default) |

Kept to two regions, both sensible. Avoids over-engineering a 12-way mapping.

---

## The diff to existing files

1. **`background/brain-producer.js`** *(new)* — the module above.
2. **`background/agent-engine.js`** — at the `markRunCompleted` seam (~line 7920), add one non-fatal
   block: if `brainProducerEnabled`, gather run context and call `publishRunLearning`. Same try/catch
   isolation as the line above it.
3. **`popup-modules/settings.js`** + **`popup.html`** — add the master toggle
   (`brainProducerEnabled`) under B's read toggle, with the first-run/re-confirm flow. Storage keys:
   `brainProducerEnabled` (boolean, default false), `brainProducerLastConfirmedAt` (ISO string).
4. **`background/agent-reporting.js`** — **export** `_scrubPii` and its regex constants
   (`PII_IP_RE`, `PII_EMAIL_RE`, `PII_TICKET_RE`, `PII_CLIENT_STRING_RE`, `PII_CLIENT_SINGLE_RE`)
   so `brain-producer.js` reuses them instead of duplicating. Minimal, well-bounded change.

## Config

Read from `chrome.storage.local`:

- `brainProducerEnabled` (boolean, default `false`)
- `brainProducerLastConfirmedAt` (ISO string or null)
- `brainBaseUrl` (string, default `http://localhost:8000`) — **shared with B**; one URL setting.
- `brainTimeout` (number, default `10000`) — shared with B.

## Testing

`tests/brain-producer.test.js` — the **redaction gate is the primary test target** because it's the
trust-critical part:

- `redactCandidate`: content with an IP → IP redacted, candidate survives. Content with the client's
  own name → **returns null** (denylist fires). Content with a tenant → null. Clean content → passes
  through. Quoted client string → redacted or dropped.
- `buildCandidates`: mock a run with a failed-then-recovered action → produces a hippocampus
  candidate. Run with no recoveries → fewer candidates.
- `publishRunLearning`: toggle OFF → no fetch calls. Toggle ON, all candidates fail the gate → no
  fetch calls (fail-closed). Toggle ON with survivors → correct `POST /neurons/think` with
  `source: sentinel-override`. **Any fetch error → caught, run-finish path unaffected** (fails-open
  test).
- Full `npm test` must remain green (baseline after B: 214 suites, 9804+ passing).

Plus a live smoke test: with the toggle ON, run a real goal that triggers a self-heal, confirm a
neuron appears in `GET /neurons/search?q=sentinel-override`.

## Scope boundaries — what C is NOT

- **Does not read from the brain** — that's B.
- **Does not bypass consent** — three consent layers, all required, master toggle OFF by default.
- **Does not ship client-identifying knowledge** — by construction (scrub + denylist + fail-closed).
- **Does not add permissions** — same `<all_urls>` already covers the POST.
- **Does not queue offline** — learning dropped if the brain is down at run end.

---

## Initiative completion checklist (after C ships)

- [ ] A wrapper runs; ZCode can `recall`/`think` against the brain.
- [ ] B read path injects BRAIN KNOWLEDGE section; toggle off by default; fails open; full suite green.
- [ ] C write path ships redacted procedural neurons; consent gate honored; redaction tests green;
      live smoke produces a real `source: sentinel-override` neuron.
- [ ] The brain's stats show contributions from both `zcode` (via A) and `sentinel-override` (via C)
      provenance — the multi-source brain is live.

---

*Execution goal prompt for C is delivered in the brainstorming chat alongside this spec, not stored
in the spec itself. See the conversation where this design was approved.*
