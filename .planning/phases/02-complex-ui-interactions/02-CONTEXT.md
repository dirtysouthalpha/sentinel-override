# Phase 2: Complex UI Interactions - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable the agent to reliably interact with the full range of complex enterprise web UI elements including dropdowns, iframes, shadow DOM, modals, and special input types. Also extract content script DOM operations into reusable utility functions.

</domain>

<decisions>
## Implementation Decisions

### Dropdown & menu interaction
- Agent detects dropdown readiness via DOM polling — waits until option elements appear, with a timeout fallback
- For large option lists (50+): try search/filter input first if available, then scan visible options
- On selection failure: retry with alternate strategy (different timing, click vs hover, scroll then select)
- Guiding principle: agent should be self-sufficient — if it needs a tool or script to solve a problem, it creates one

### Iframe & shadow DOM strategy
- Auto-detect and traverse all iframes — no user intervention needed
- Cross-origin iframes: attempt access via background script's webNavigation/API permissions where possible
- Always pierce shadow roots (both open and closed) — treat shadow DOM elements as first-class
- Include full path (iframe/shadow hierarchy) when describing elements to the LLM for decision-making

### Modal & overlay handling
- Auto-dismiss any overlay that blocks the target element — aggressive clearing
- Check for blocking overlays reactively (on action failure), not proactively before every action
- Dismissal strategy: common patterns in order — X buttons, 'Close' text, 'Accept' on cookie banners, Escape key
- All overlay types treated the same: modals, toasts, cookie banners, confirmation dialogs, tooltips

### Special input types
- Date pickers: programmatic value setting first, fall back to UI interaction (click calendar controls)
- File uploads: programmatic file input API (no OS dialog simulation)
- Rich text editors: direct editor API first (innerHTML, ContentEditable commands, editor JS API), fall back to simulated keyboard input
- Consistent pattern across all special inputs: try smart/programmatic approach first, fall back to simulated user interaction

### Claude's Discretion
- Nested hover menu traversal strategy (hover vs click vs hybrid)
- Special input type identification (registry vs runtime DOM analysis vs hybrid)
- Exact DOM polling intervals, timeouts, and retry counts
- Shadow root piercing implementation details
- Specific dismiss pattern ordering and detection heuristics

</decisions>

<specifics>
## Specific Ideas

- Agent should be self-sufficient: "If it needs a tool or script, make it — whatever it needs, it either figures it out or creates a solution"
- Consistent fallback pattern across all complex interactions: try the smart/programmatic approach first, fall back to UI interaction if it doesn't work

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-complex-ui-interactions*
*Context gathered: 2026-04-24*
