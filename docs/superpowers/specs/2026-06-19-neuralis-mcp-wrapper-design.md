# Neuralis MCP stdio Wrapper — Design

**Date:** 2026-06-19
**Status:** Approved
**Sub-project:** A of 3 (Neuralis ↔ Sentinel Override integration)
**Code home:** the Neuralis repo — `/home/brandongoolsby/neuralis/scripts/neuralis-mcp-server.py` (NOT this repo)

---

## Initiative context (how this fits the bigger picture)

Goal: link **Sentinel Override** (this Chrome extension) to the **Neuralis brain** (a live FastAPI
service at `localhost:8000`) so the brain accumulates knowledge from everywhere it's used and every
consumer benefits. The work decomposes into three independent sub-projects, built in order:

| # | Sub-project | Home | Role | Trust tension |
|---|---|---|---|---|
| **A** | **Neuralis MCP wrapper** ← *this spec* | Neuralis repo | Thin stdio MCP server exposing the brain to ZCode | None — your ZCode ↔ your brain |
| **B** | **Sentinel consumer** | this repo (`background/`) | Before each run, query Neuralis `/recall`, inject matches into the system prompt | Low — read-only |
| **C** | **Sentinel producer** | this repo (`background/` + popup) | After each run, push learned "wisdom" to Neuralis as neurons | **High** — redaction/consent is the whole job |

**Build order: A → B → C.** A is first because it's fully isolated, unblocks ZCode immediately, and
validates the Neuralis API from a real client before the extension depends on it. Each sub-project
gets its own design doc + goal prompt when reached.

---

## What A is

One Python file, **stdlib-only** (`urllib`, `json`, `sys`, `os`), that runs as an MCP server over
stdio and translates tool calls into HTTP calls against the Neuralis FastAPI app. No `pip install`,
no venv, no `requirements.txt`. Runs anywhere Python 3 runs.

Registered in ZCode's MCP config as:

```yaml
mcp_servers:
  neuralis:
    command: "python3"
    args: ["/home/brandongoolsby/neuralis/scripts/neuralis-mcp-server.py"]
```

## Transport — MCP over stdio

JSON-RPC 2.0, newline-delimited, over stdin/stdout:

- Reads requests from stdin, writes responses to stdout.
- **All logging goes to stderr.** stdout is sacred — one stray log line corrupts the protocol.
- Minimal tool-server lifecycle only: `initialize` handshake → declare the `tools` capability →
  `tools/list` → `tools/call`. No resources, no prompts, no subscriptions (YAGNI).

## The 6 tools

| Tool | Neuralis endpoint | Key params | Purpose |
|---|---|---|---|
| `neuralis_recall` | `GET /recall?context=` | `context` (required) | Context-aware recall — **read the brain**. Direct matches + spreading-activation associates. |
| `neuralis_think` | `POST /neurons/think` | `content` (req), `region` (enum, default `hippocampus`), `source` (default `zcode`), `session_id` (opt) | **Feed the brain**. Creates + auto-fires a neuron. |
| `neuralis_search` | `GET /neurons/search?q=` | `q` (required) | Plain keyword search (simpler than recall). |
| `neuralis_fire` | `POST /neurons/{id}/fire` | `id` (required) | Reinforce a neuron — triggers Hebbian learning. Call when a recalled fact proves useful. |
| `neuralis_stats` | `GET /brain/stats` | none | Per-region counts, strongest synapses, domain balance. Introspection. |
| `neuralis_graph` | `GET /graph` | none | Full graph (nodes + edges + regions). Bulk export. |

### Deliberate design choices

- **`region` is an enum** of the 12 Neuralis regions
  (`hippocampus`, `prefrontal_left`, `prefrontal_right`, `temporal_left`, `temporal_right`,
  `parietal_left`, `parietal_right`, `basal_left`, `basal_right`, `thalamus`, `amygdala`,
  `corpus_callosum`) so the model picks from a clean menu and can't typo. Default `hippocampus`
  (the memory-consolidation region — natural default for "store a new fact").
- **`source` defaults to `zcode`** but is overridable. This is the provenance field that later lets
  Sentinel (sub-project C) tag its neurons as `source: "sentinel-override"`. Designed now, pays off
  in C — without it, brain content can't be attributed to its feeder.
- **`think` is fire-and-forget from the caller's view** — it returns the created neuron, but the
  spreading happens server-side in Neuralis.

## Config

Two env vars, no config file:

- `NEURALIS_BASE_URL` — default `http://localhost:8000` (trailing slash stripped on read).
- `NEURALIS_TIMEOUT` — default `10` seconds.

## Error handling

The stdio loop must never die from a single bad call:

- **Neuralis down / connection refused** → return an MCP tool error (`isError: true`) with a clear
  message; keep serving.
- **HTTP non-200** → surface status + truncated body as a tool error; keep serving.
- **Missing required param** → validate locally, return error before hitting the network.
- **Malformed JSON-RPC on stdin** → log to stderr, continue reading the next line.

## Testing

Lives in the **Neuralis repo** (Python), not sentinel-override's Jest suite. Two layers:

- **HTTP-translation unit tests** — mock `urllib.request.urlopen`; assert each tool builds the
  correct URL / method / body / headers.
- **JSON-RPC dispatch tests** — feed `tools/list` and assert the schema; feed a `tools/call` and
  assert it dispatches to the right translator.

Plus a short **manual smoke-test** documented in the file header (curl the live endpoints, then run
the wrapper and issue a `tools/call` by hand).

## Scope boundaries — what A is NOT

- No resources, prompts, or subscriptions — tools only.
- Does not expose `/neurons` (list all), `/regions`, `/synapses`, or `/maintenance/decay` — outside
  the enumerated set. Easy to add later if a real need appears.
- No auth on the Neuralis side (it's localhost); the wrapper passes nothing extra.

---

*Execution goal prompt for A is delivered in the brainstorming chat alongside this spec, not stored
in the spec itself. See the conversation where this design was approved.*
