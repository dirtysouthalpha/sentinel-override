// Sentinel Override — Egress Manifest
//
// Every outbound call in background/ is classified here, and
// tests/egress-coverage.test.js fails if a `fetch(` or a WebSocket `send(`
// appears that this file does not account for.
//
// WHY: masking was built as a choke point in callLLM, and nine other outbound
// paths never flowed through it — including a SECOND full LLM path
// (quick-assist-handler), the report generator, the goal rewriter, the planner,
// the parallel text provider, and a GitHub Gist upload carrying user-written
// automation goals to a third party. A choke point only protects what actually
// flows through it, and nothing in the build could tell you what did.
//
// RULES FOR EDITING THIS FILE
// - Adding a new outbound call means adding an entry here, with a reason.
// - `scrubbed` means the payload passes through scrubForEgress / a documented
//   equivalent gate before it leaves.
// - `exempt` requires a justification that stands on its own. "It's localhost"
//   is not one unless the address is hard-coded and cannot be configured.

/** @typedef {'scrubbed'|'exempt'} EgressStatus */

export const EGRESS_MANIFEST = [
  // ── LLM paths: user/page content to a model provider ──────────────────────
  {
    file: 'background/llm-client.js', status: 'scrubbed',
    carries: 'Full agent prompt: page text, DOM extracts, history, memory, goal.',
    via: 'scrubForEgress-equivalent inline at the buildAgentPrompt chokepoint; restore in llm-retry.js.',
  },
  {
    file: 'background/quick-assist-handler.js', status: 'scrubbed',
    carries: 'Quick Assist prompt: page context + the technician\'s selected text.',
    via: 'scrubForEgress (kind: quick-assist). Fails closed.',
    note: 'This was the second full LLM path and was entirely unguarded.',
  },
  {
    file: 'background/report-generator.js', status: 'scrubbed',
    carries: 'Report prompt built from run history and extracted memory.',
    via: 'scrubForEgress (kind: report-generator). Fails closed.',
  },
  {
    file: 'background/llm-planning.js', status: 'scrubbed',
    carries: 'Plan prompt: the goal plus page context.',
    via: 'scrubForEgress (kind: plan-generation). Fails closed.',
  },
  {
    file: 'background/adaptive-prompts.js', status: 'scrubbed',
    carries: 'Goal-rewriter prompt: the raw goal and the current URL.',
    via: 'scrubForEgress (kind: goal-rewriter). Fails closed.',
  },
  {
    file: 'background/agent-engine.js', status: 'scrubbed',
    carries: 'Parallel TEXT-provider call alongside vision — same page-derived content as the main call. Also a DNS-over-HTTPS hostname lookup, see note.',
    via: 'scrubForEgress (kind: parallel-text-provider). Fails closed.',
    note: 'The DoH lookup sends only a HOSTNAME the user is already visiting, to a public resolver, for tenant detection. No page content. Documented rather than wrapped.',
  },

  // ── Third-party upload ────────────────────────────────────────────────────
  {
    file: 'background/collaboration.js', status: 'scrubbed',
    carries: 'Template export to GitHub Gists. Templates hold `goal` — free text that routinely names the client, their portal hostname, ticket numbers and contacts.',
    via: 'scrubForEgress (kind: github-gist). Fails closed.',
    note: 'Gists are created with public:false — a SECRET gist, readable by anyone with the URL and unencrypted, so it is not a substitute for masking. The flag is hard-coded with no caller-controlled path. importFromGist is an inbound GET and carries nothing.',
  },

  // ── Cross-machine ─────────────────────────────────────────────────────────
  {
    file: 'background/federation.js', status: 'scrubbed',
    carries: 'Sub-goal text POSTed to a REMOTE peer machine.',
    via: 'scrubForEgress (kind: federation-peer). Fails closed.',
  },
  {
    file: 'background/uap-bridge.js', status: 'scrubbed',
    carries: 'Event payloads narrating agent actions (urls, titles, extracted values).',
    via: 'tryScrubForEgress (kind: uap-event); the event is DROPPED on scrub failure.',
    note: 'Health-check and task-poll calls are GETs with no body and carry nothing.',
  },
  {
    file: 'background/brain-client.js', status: 'scrubbed',
    carries: 'Recall context in a query string — which also lands in the brain server\'s access log.',
    via: 'tryScrubForEgress (kind: brain-recall); recall is SKIPPED on scrub failure.',
  },
  {
    file: 'background/brain-producer.js', status: 'scrubbed',
    carries: 'Run learnings POSTed to the Neuralis brain.',
    via: 'Its OWN purpose-built gate: _scrubPii plus a client-entity denylist (_redactWithDenylist), which DROPS a candidate outright if it still contains a client identifier. Stricter than masking for this use case; deliberately not double-wrapped.',
  },

  // ── Exempt: no user or page content leaves ────────────────────────────────
  {
    file: 'background/plugin-registry.js', status: 'exempt',
    carries: 'Nothing. Two GETs with no request body: the plugin registry index and a plugin manifest URL.',
    why: 'Outbound payload is empty. The URLs are operator-configured registry/manifest addresses, not derived from page content.',
  },
  {
    file: 'background/provider-registry.js', status: 'exempt',
    carries: 'Nothing. GET /models to populate the model dropdown.',
    why: 'No request body; sends only the operator\'s own API key as auth.',
  },
  {
    file: 'background/ws-bridge.js', status: 'exempt',
    carries: 'Control frames (auth, auth_challenge_response, command results) and a heartbeat status frame with the active tab\'s url and title.',
    why: 'BRIDGE_URL is the hard-coded literal ws://localhost:8001/extension-bridge with no configuration path, so these bytes cannot leave the machine. The url/title in the heartbeat IS user data — if this URL ever becomes configurable, this entry must move to scrubbed.',
  },
  {
    file: 'background/uap-server.js', status: 'exempt',
    carries: 'Nothing outbound from the extension.',
    why: 'Server-side helper, not part of the extension\'s outbound path.',
  },
];

/** Files whose outbound calls are accounted for above. */
export const MANIFESTED_FILES = new Set(EGRESS_MANIFEST.map(e => e.file));
