# Phase 3: Multi-Tab Workflows - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the agent the ability to operate across multiple browser tabs simultaneously, tracking context per tab and correlating data between them. The agent opens, switches between, and manages its own tabs — never touching the user's existing tabs.

</domain>

<decisions>
## Implementation Decisions

### Tab lifecycle behavior
- Agent only opens and closes tabs it creates — user's existing tabs are never touched
- All agent-created tabs stay open during the task and are batch-closed when the task finishes
- Tabs persist across tasks — agent can reuse tabs from a previous task if they're relevant
- When a new task starts, agent reuses relevant existing tabs and opens new ones only if needed

### Context tracking model
- Full page snapshots per tab — DOM summary, extracted data, visible text — so the agent can reason without revisiting
- Snapshots update on action (after the agent performs an action that changes the page), not proactively or continuously
- Tab limit of 3-5 simultaneously tracked tabs — agent plans around this constraint
- Evicted tabs (beyond the limit) lose their cached context — agent must revisit the page if it needs data from an evicted tab

### Cross-tab data flow
- Data moves between tabs via LLM context — no shared storage or notebook infrastructure
- Whether cross-tab transfers are explicit plan steps or implicit in reasoning is at Claude's discretion
- Agent trusts data read from context — no re-verification step when applying it on another tab
- Agent can perform concurrent operations on multiple tabs simultaneously (e.g., act on tab B while tab A is loading)

### User visibility & control
- Popup UI shows all agent-managed tabs with labels, highlighting the currently active one
- Agent ignores user's manual tab switches and continues working on its own tab
- User can click a tab in the popup to jump to it and observe what the agent is doing (no pause control)
- Whether the activity log shows tab switches explicitly is at Claude's discretion

### Claude's Discretion
- Whether cross-tab data transfers appear as explicit plan steps or happen naturally in reasoning
- Whether the activity log explicitly logs tab switches or keeps them implicit in action descriptions

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-multi-tab-workflows*
*Context gathered: 2026-05-04*
