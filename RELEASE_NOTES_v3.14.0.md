# Sentinel Override v3.14.0 — Ticket Mode + Run Log History + SW Keepalive

**Release date:** 2026-05-11
**Theme:** Ship the three highest-leverage MSP improvements from the REVAMP backlog.

This release adds the workflow features that close the gap between Sentinel
Override's raw research capability and the day-to-day artifact production an
MSP technician needs. The agent already investigates, extracts, and reports.
v3.14.0 makes the report come out in the format you'd paste into the ticket.

---

## 1. Ticket Mode — six MSP output templates

The post-3.8.0 `FINAL_NOTES` auto-formatter only fired for ticket-shaped goals
and only produced one format. v3.14.0 promotes it to a first-class mode with
six templates matching the user's preference doc:

- **TICKET_KICKOFF** — new/unresolved tickets: MAIN ISSUE, WHAT HAS BEEN TRIED,
  FASTEST SAFE RESOLUTION PATH.
- **FINAL_NOTES** — resolved tickets: Action Taken / Contact / Next Step /
  Ownership Statement. (Existing 3.8.0 format, now dispatcher-routed.)
- **WAITING_ON_CLIENT** — pending client action with a 24-hour follow-up
  default and an ownership commitment.
- **WAITING_ON_VENDOR** — diagnostics complete, vendor case opened, follow-up
  scheduled.
- **IT_GLUE_KB** — knowledge-base article: Title / Issue / Environment /
  Resolution Steps / Verification / Screenshots. Environment is derived from
  the goal text (M365, firewall, EDR, RMM/PSA).
- **CLIENT_EMAIL** — resolved-ticket email body with subject line, one-line
  recap, and the contact footer auto-filled.

### Settings (new section)

- **Ticket Mode toggle** — when on, every finish summary runs through the
  dispatcher; when off, the legacy 3.8.0 behavior (auto-detect ticket-shaped
  goals → `FINAL_NOTES`) remains.
- **Default Output Format dropdown** — `Auto` (heuristic match against goal
  text — "waiting on vendor", "kickoff", "draft an email", etc.) or any of the
  six explicit formats.
- **Technician Details** — name, title, company, phone, email. Defaults to
  Brandon Goolsby / IT Support Technician / Premier Networx / 706-426-6313 /
  support@augustaitguys.com. Stored in `chrome.storage.local.technicianInfo`.
  Auto-saved on every keystroke.

### Files touched

- `background/agent-engine.js`: five new formatters
  (`formatTicketKickoff`, `formatWaitingOnClient`, `formatWaitingOnVendor`,
  `formatItGlueKb`, `formatClientEmail`) + `formatTicketOutput` dispatcher +
  `_autoPickFormat` heuristic. Finish handler rewired to read
  `ticketMode`/`ticketFormat` from settings.
- `popup.html`: Ticket Mode toggle row, format dropdown, technician input grid.
- `popup-modules/settings.js`: load/save/wire toggle + dropdown + technician
  fields with debounced auto-save.

---

## 2. Run Log History — browse & re-export past forensic logs

v3.9.0 shipped per-step structured run logs and an immediate post-run export
banner. Problem: dismissing the banner (or restarting Chrome before exporting)
made the log permanently unreachable from the UI even though it was still in
`chrome.storage.local.run_log_<id>`.

v3.14.0 adds:

- **`run_log_index`** storage key — ordered list of the last 20 runs with
  `{runLogId, goal, startedAt, finishedAt, stepCount, apiCallCount, completed,
  startUrl}`. Updated at run start (initial entry) and run finish (mark
  complete with final counts). Overflow runs have both their index entry and
  their detail record (`run_log_<id>`) evicted from storage.
- **Run Log History modal** — accessible via:
  - The new "View past runs" button on the post-run export banner.
  - The command palette (`Cmd/Ctrl+K`) → "Run Log History".
  Lists each stored run with goal preview, timestamp, step count, AI call
  count, duration, and a status chip (COMPLETE / INCOMPLETE). Per-row buttons:
  Export JSON, Export CSV, Delete. Footer: Clear All (with confirm).

### Files touched

- `background/agent-engine.js`: new `_updateRunLogIndex` helper called at run
  start and at finish.
- `popup.html`: new `run-log-history-modal`.
- `popup-modules/chat.js`: `openRunLogHistoryModal`, `renderRunLogHistoryList`,
  `exportRunLogById`, `deleteRunLogById`, `clearAllRunLogs`, plus a
  command-palette entry and a "View past runs" button on the existing banner.

---

## 3. Service-worker keepalive during approval / tenant-override waits

MV3 service workers terminate after ~30s of idle. The approval flow has a 60s
timeout; the tenant-override flow has a 90s timeout. Both register a
`chrome.runtime.onMessage` listener and await user response. While awaiting,
nothing was actively poking the SW — meaning an AFK user past the 30s mark
killed the SW, the listener got GC'd, and the user's eventual click resolved
into the void. Silent timeout with no recovery.

v3.14.0 wraps both `requestApproval` and `requestTenantOverride` with a
`startSwKeepalive(name)` / `stopSwKeepalive(name)` pair from
`background/shared-state.js`. The keepalive does a trivial
`chrome.storage.session.set` ping every 20s — any `chrome.*` API call resets
the MV3 idle timer.

Helper is ref-counted by name, so multiple concurrent waits don't trample one
another. The keepalive is stopped on every exit path: resolve, reject,
timeout, or listener firing.

### Files touched

- `background/shared-state.js`: new `startSwKeepalive` / `stopSwKeepalive`
  helpers.
- `background/agent-engine.js`: imports the helpers; wraps both approval
  request functions.

---

## Compat / migration

- All existing settings (`approvalMode`, `useTrustedInput`,
  `sentinelSoundEnabled`, `expectedTenant`, etc.) untouched.
- `technicianInfo` storage key is new — first read returns defaults that
  match the prior hardcoded values, so behavior is identical until you edit.
- `run_log_index` is new — first read returns `[]`; no migration of existing
  `run_log_<id>` records is performed (they'll appear in the index when their
  associated run completes, or via a future migration).
- Manifest permissions unchanged (`alarms`, `notifications`,
  `chrome.storage.session`, etc. were already declared).

## Known limitations / out of scope

- The Run Log History modal is read-only for past runs; in-flight runs only
  show their index entry, not their live buffer (the post-run banner still
  exists for live exports).
- The keepalive helper uses `chrome.storage.session.set` as the pulse target.
  If `chrome.storage.session` is unavailable (very old Chrome), it falls back
  to `chrome.runtime.getPlatformInfo`. Both reset the MV3 idle timer.
- Ticket Mode auto-format heuristics are intentionally conservative —
  ambiguous goals default to `FINAL_NOTES`. Explicit format selection in
  Settings always wins.
