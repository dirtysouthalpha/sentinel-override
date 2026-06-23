# Neuralis Brain Integration

Sentinel Override can talk to a [Neuralis](https://localhost:8000) knowledge
"brain" running on this machine. This is an **experimental, off-by-default**
feature with two independent halves, each behind its own toggle.

## The two toggles

Both live in **Settings** and both default to **OFF**. They are independent —
turning one on does not affect the other.

### 🧠 Neuralis Brain (read) — `brainEnabled`
When ON, at the **start** of each run the agent makes one `GET /recall` call
and injects any matches into the system prompt as a `## BRAIN KNOWLEDGE
(shared, cross-installation)` section. This gives the agent shared,
community-sourced operating hints for the platform it's working on.

### 🧠 Neuralis Brain Producer (write) — `brainProducerEnabled`
When ON, at the **end** of each run the agent ships **redacted, procedural**
learning (successful self-heals, scrubbed UI-structure notes) to the brain as
`source:"sentinel-override"` neurons. Enabling it shows a confirmation dialog
and re-prompts for consent if the toggle has been off for more than 7 days.

## Requirements

- A **Neuralis instance reachable from this machine**, default
  `http://localhost:8000`. The URL is configurable via the **Brain base URL**
  field in Settings.
- If Neuralis is running in a different network namespace (e.g. WSL2 while the
  browser runs on the Windows host), point `brainBaseUrl` at the address the
  browser can actually reach (e.g. the WSL eth0 IP), not just `localhost`.

## Off-by-default posture

- Both toggles ship **OFF**. Nothing is read from or written to the brain
  unless you explicitly opt in.
- The **write** path additionally requires an explicit confirmation dialog on
  first enable (and re-confirms after 7 days of being off).
- Turning either toggle OFF takes effect immediately on the next run; the
  write path has **no offline queue** (a down brain at run end drops the
  learning).

## Trust model (the important part)

The write path is **trust-critical** — its whole job is to never leak
client-identifying data to a shared brain. Every candidate passes a gate, in
order, before shipping:

1. **PII scrub** (reused from the production `agent-reporting.js` scrubber):
   IPs, emails, ticket numbers, and quoted strings are replaced with
   `[REDACTED:*]` placeholders.
2. **Client denylist** (fail-closed): if the scrubbed content *still* contains
   the active client's name, tenant, or any known client identifier, the
   candidate is **dropped entirely**.
3. **Length/sanity**: capped at 1000 chars; empties dropped.

The read path follows a **leak-zero** rule: recall keys are the **platform id**
(preferred) or the **start-URL host** (fallback) — never client name, tenant,
or raw goal text. Only the platform is disclosed to the brain.

Both paths **fail open**: a down or broken brain never breaks a run. The read
path returns an empty section; the write path drops the learning. You get a
single `console.warn` per run ("brain UNREACHABLE") when the brain can't be
reached — never spam.

## Concurrency note

The Neuralis `/neurons/think` endpoint does **not** dedupe today (identical
content creates distinct neurons). The producer attaches a client-side SHA-256
`content_hash` to every neuron so a future server-side dedupe layer can
collapse duplicate writes from many installs. The field is currently ignored
by the API — harmless until it isn't.

## Design specs

- Sub-project A (MCP wrapper): [`specs/2026-06-19-neuralis-mcp-wrapper-design.md`](superpowers/specs/2026-06-19-neuralis-mcp-wrapper-design.md)
- Sub-project B (read path): [`specs/2026-06-19-sentinel-consumer-brain-design.md`](superpowers/specs/2026-06-19-sentinel-consumer-brain-design.md)
- Sub-project C (write path): [`specs/2026-06-19-sentinel-producer-brain-design.md`](superpowers/specs/2026-06-19-sentinel-producer-brain-design.md)

## Browser smoke test

Before relying on this, run through
[`specs/NEURALIS-BROWSER-SMOKE-CHECKLIST.md`](superpowers/specs/NEURALIS-BROWSER-SMOKE-CHECKLIST.md)
— load the unpacked extension, toggle both paths on, and confirm the read
section renders, the write neuron appears, the fail-open behavior holds with
the brain stopped, and (most importantly) the redaction gate drops
client-identifying candidates.
