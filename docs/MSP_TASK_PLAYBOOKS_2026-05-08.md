# Sentinel Override — MSP Task Playbooks
**Date:** 2026-05-08
**Audience:** Technician (Acme IT)
**Goal:** Match or beat Claude in Chrome for the four real workflows that get pushed to the agent: **SonicWall VPN tunnels**, **M365 permission edits**, **Exchange mail trace**, **AD/Entra sign-in auditing**.

This document walks through each task family — what the current build does, where it breaks, and the specific code-level fixes that close the gap. The fixes at the end are *cross-cutting*: each one unlocks multiple task families.

---

## Task 1 — Add a VPN tunnel on a SonicWall

### What the agent has to do

1. Reach the appliance (often via public IP with a self-signed cert warning).
2. Log in. Sometimes 2FA.
3. Navigate to `Manage > VPN > Site to Site VPN` (or `Network > IPSec VPN > Rules and Settings` on newer SonicOS).
4. Click `+ Add` to open the wizard.
5. Fill 4-tab dialog: **General** (name, peer, auth method, PSK), **Network** (local/remote network objects), **Proposals** (IKE phase 1 + 2 ciphers, lifetime), **Advanced** (keep-alive, Suppress trigger).
6. Click `OK` on the dialog.
7. **Apply** at the page level — without this step, the dialog just closes and nothing is saved.
8. Verify: re-read the VPN policy table and confirm the new policy is enabled with the right peer.

### What works today

- `llm-client.js:27-62` has SonicWall-specific platform context that tells the model: dropdowns are Angular custom widgets, every change needs a commit step, log pages need long waits.
- Custom-dropdown opener in `dropdown-utils.js:17-45` correctly clicks-then-polls.
- `findDropdownOptions` is now scoped (#22 from the audit), so two open dropdowns no longer bleed options.
- Layout-stability waits (#19) before clicks reduce mis-clicks during smooth-scroll.

### Where it breaks

#### 1.1 Pre-shared key gets typed in plaintext, no protection
- `content/index.js:856` (`case 'type'`) does not block based on labels like "Pre-shared key", "Secret", "Shared secret", "Authentication key".
- The PSK field is usually `<input type="text">` (not `password`) on SonicWall, so even the password-field guard I'm proposing wouldn't catch it.
- **Fix:** Add a label-proximity check in `case 'type'`. Walk up to 3 ancestors from the target input, gather their visible text, and reject if it matches `/pre.?shared|shared secret|secret key|api key|client secret|encryption key|passphrase|recovery code/i`. Surface as approval-required when in approval mode.

#### 1.2 Multi-tab dialogs lose context across tabs
- The wizard uses tabs labeled `General | Network | Proposals | Advanced` *inside* a modal. The agent's element scan only emits visible-tab elements; flipping tabs invalidates refs.
- After a tab flip, `_beginScan()` resets ref counters — but the LLM doesn't know to re-observe before clicking the next tab's fields.
- **Fix:** Add a `switch_tab_in_dialog` action (or extend `click` with a hint) that *forces* a re-scan immediately after, and adds a system-prompt rule: "After switching dialog tabs, re-scan the element list before issuing the next action."

#### 1.3 Save/Apply gating is advisory only
- The system prompt at `llm-client.js:39-44` *describes* the SonicWall save/apply step but doesn't enforce it.
- `finish` blocking at `agent-engine.js:748-775` only blocks finish without extracted data — doesn't block finish before commit.
- **Fix:** Configuration-change detector. When the goal text matches `/add|create|delete|modify|update|enable|disable|block|allow|configure/i` AND the current platform context is SonicWall/Fortinet/Palo/Cisco, require: a `click` whose target text matches `/apply|save|commit|deploy|accept/i` to have happened in the last 10 history entries before `finish` is allowed. Otherwise inject a system note: "BLOCKED: configuration change not yet committed — find and click the Apply/Save button."

#### 1.4 Self-signed cert warnings stop the agent cold
- Most SonicWalls are reached via a self-signed `https://` URL. Chrome's interstitial doesn't auto-bypass.
- The agent has no "I'm on a cert warning page" handler.
- **Fix:** Detect Chrome's interstitial (URL contains `data:text/html` from chrome-error or page title contains "Privacy error"). When detected, surface a one-shot approval card: "Cert warning on `<host>` — proceed past?" If approved, click `Advanced` then `Proceed to <host> (unsafe)` via `click_at` on the known coordinates / button text.
- Persist the bypass per-host (in `chrome.storage.session`) so the agent doesn't re-prompt on multi-step tasks.

#### 1.5 Verification step is recommended, not enforced
- Plan generator says "always include verification" but the live loop never demands it.
- **Fix:** After commit, force a `read_page` + `extract_list` against the VPN policy table; require the new policy name to appear in the result before allowing `finish`. This is the same enforcement as 1.3 but on the *post*-commit side.

### What ships in playbook form

A SonicWall runbook template the user can run by name:
```
Template: "SonicWall: Add Site-to-Site VPN"
Params: ::firewall_url::, ::firewall_user::, ::firewall_pass::,
        ::policy_name::, ::peer_ip::, ::psk::,
        ::local_network::, ::remote_network::, ::ike_phase1_cipher::, ::ike_phase2_cipher::
Goal:
  STEP 1: Navigate to ::firewall_url:: and log in
  STEP 2: Manage > VPN > Site to Site VPN
  STEP 3: Click +Add
  STEP 4: Fill General tab: name=::policy_name::, peer=::peer_ip::, PSK=::psk::
  STEP 5: Switch to Network tab: local=::local_network::, remote=::remote_network::
  STEP 6: Switch to Proposals tab: IKE p1=::ike_phase1_cipher::, p2=::ike_phase2_cipher::
  STEP 7: Click OK
  STEP 8: Click Apply on the policies page
  STEP 9: Re-read the policy table; verify "::policy_name::" appears and is enabled
  STEP 10: Finish with: policy name, peer, networks, ciphers, and a confirmation that Apply was clicked.
```
Treat `::psk::` as sensitive — never log, never include in chat history, scrub from learned patterns (P2 #22 in the prior audit).

---

## Task 2 — Edit permissions in M365

### What the agent has to do

The actual work spans four different admin centers. Most-common flows:

- **Assign admin role:** admin.microsoft.com → Users → Active users → pick user → Roles → Manage roles → check role → Save.
- **Mailbox permissions (Send As / Full Access):** admin.exchange.microsoft.com → Recipients → Mailboxes → pick mailbox → Mailbox delegation → add → save.
- **Group membership:** admin.microsoft.com → Teams & groups → Active teams & groups → pick group → Members → Add members.
- **Conditional Access:** entra.microsoft.com → Protection → Conditional Access → policy → assignments → save.
- **SharePoint site permissions:** admin.microsoft.com → SharePoint admin → Active sites → site → Permissions.

### What works today

- Most M365 admin pages are React with `data-automationid` and `aria-label` attributes — the existing selector strategy in `dom-utils.js:52-69` prefers `data-testid`, `aria-label`, then `id`, which works well here.
- CDP trusted-input path (#9) bypasses Microsoft's stricter event-trust checks on save buttons.

### Where it breaks

#### 2.1 No platform context for the M365 admin centers specifically
- `llm-client.js` has context for SonicWall, Fortinet, Cisco, ConnectWise, NinjaOne, Datto, IT Glue, Huntress, ScreenConnect — and zero for `admin.microsoft.com`, `admin.exchange.microsoft.com`, `portal.azure.com`, `entra.microsoft.com`, `compliance.microsoft.com`.
- **Fix:** Add platform context blocks for each. Specific guidance to include:
  - "Microsoft Fluent UI uses `[data-automationid]` extensively — prefer those selectors when present."
  - "Side panels open from the right and have their own scrollable region. After clicking a row, wait for the panel `[role='complementary']` or `[data-automationid='detailsPaneOuter']` before scanning."
  - "Save buttons on Fluent UI panels are at the bottom of the panel and use class `ms-Button--primary` or text `Save`. They re-disable until form changes are valid."
  - "Conditional Access policies have an explicit `Enable policy → On` toggle that must be set before clicking Save."

#### 2.2 MFA mid-task is not detected, agent runs forever
- Many admin actions trigger a step-up auth ("Verify your identity"). The current build keeps observing/clicking on the auth page until the loop limit runs out.
- **Fix:** Add a content-script-level detector that runs on every observation. Match page text against `/verify your identity|enter the code|approve.*sign.?in.*request|we'?ve sent.*code/i`. When matched:
  - Pause the agent automatically (`agentPaused = true`).
  - Send `chrome.notifications.create` to the desktop: "Sentinel paused — MFA challenge on <hostname>."
  - Show a chat banner: "Approve the MFA push or enter the code, then click Resume."
  - Resume button in the popup unblocks the loop.

#### 2.3 Tenant context is non-existent — high cross-client risk
- A tech might run "add a user to Domain Admins" and the goal goes to whatever tenant is currently signed in, with no check that it's the correct client tenant.
- **Fix:** Add a per-run "tenant lock" field. Either:
  - Auto-detect tenant from `https://*.onmicrosoft.com` references in the page, OR from the top-right tenant picker text.
  - At plan time, the LLM is told: "Confirm tenant matches `<expected>` before any modifying action. If mismatch, finish with 'Wrong tenant — switch to <expected> first'."
  - In the popup, show the detected tenant as a chip ("Acme Corp.onmicrosoft.com") so the technician can eyeball it.

#### 2.4 Virtualized user/group lists — search-then-click loses scroll position
- Active users page is virtualized. Searching for a user via the top search box returns 1-3 visible rows. Clicking a row opens a panel; if the panel close goes back to a scrolled-down state, the agent's element refs are stale.
- **Fix:** Always issue an explicit search via the search box before trying to find a user/group row. The LLM gets a pattern: "If looking for a specific user/group/site/policy, type the name into the page-level search input *first*. Don't scroll-and-scan; the list virtualizes."
  - Bake this into the M365 platform context.

#### 2.5 Save confirmation toast disappears in 3 seconds
- The confirmation banner ("Mailbox permissions updated") shows briefly. The agent's next observation often misses it, so the verification step fails.
- **Fix:** Listen for the toast via `MutationObserver` *during* the Apply step:
  - Before clicking Save, install a one-shot observer for `[role='alert'], [data-automationid='Toast']` insertions, accumulating their text.
  - After the click + a 1500ms wait, return the captured toast text as part of the action result.
  - The LLM uses that captured text instead of having to re-observe within the toast window.

### What ships in playbook form

```
Template: "M365: Assign Admin Role"
Params: ::user_upn::, ::role_name::, ::tenant_expected::
Goal:
  STEP 1: Navigate to https://admin.microsoft.com
  STEP 2: Verify tenant chip == "::tenant_expected::" (else finish with mismatch)
  STEP 3: Users > Active users
  STEP 4: Type "::user_upn::" into the user search box
  STEP 5: Click the matching user row
  STEP 6: In the right panel, click "Manage roles"
  STEP 7: Search for "::role_name::" in the role search box
  STEP 8: Check the role checkbox
  STEP 9: Click Save and capture the success toast
  STEP 10: Read the user's Roles section back; verify "::role_name::" appears
  STEP 11: Finish with toast text + verified roles list
```

---

## Task 3 — Search Exchange for mail issues (message trace)

### What the agent has to do

1. `admin.exchange.microsoft.com` → Mail flow → Message trace.
2. Click "Start a trace".
3. Fill: sender, recipient, time range, status filter (Failed, Pending, Quarantined, etc.).
4. Run.
5. Wait for the trace to queue → run → produce results.
6. Read results. Often pop a row to see delivery details / event timeline.
7. Maybe export to CSV for ticket attachment.

### What works today

- The Exchange admin center is largely Fluent UI; same React selector preferences as M365.
- The platform context detector (`llm-client.js`) catches Exchange via the M365 detection (well, it doesn't — currently no detector matches `outlook.office.com` / `admin.exchange.microsoft.com`). So this falls through to no platform context.

### Where it breaks

#### 3.1 No detector for Exchange specifically
- The platform-context function in `llm-client.js:16-222` returns `''` for Exchange URLs.
- **Fix:** Add an `isExchangeAdmin = url.includes('admin.exchange.microsoft.com') || url.includes('outlook.office365.com/ecp')` block, with guidance: "Use the page search before browsing recipient lists. Trace queries are async — after Run, wait for `[role='status']` to disappear or for a row count to appear before reading results."

#### 3.2 Custom date/time-range pickers
- Exchange's date range picker is a Fluent UI calendar with separate date and time spinners. `setDatePickerValue` in `special-inputs.js:82-141` only handles native date inputs and "framework wrappers around an input". Fluent UI is neither — it's a button-popper with calendar grid + time spinners.
- **Fix:** Add a Fluent UI date strategy. Three-tier:
  - (a) Try native (existing code).
  - (b) If wrapped, set the inner input value (existing code).
  - (c) New: open the picker by clicking, then drive the calendar grid by data-automationid: `[data-automationid='dateCell']` with the right text. For time, drive the spinner buttons.
- Also accept relative phrases: "last 24 hours", "last 7 days", "today" — map to clicks on the relative-time chips that Exchange shows.

#### 3.3 Async result waiting has no built-in primitive
- The agent currently uses `wait_for_element` / `wait_for_text`, which is fine — but the timing is fragile because Exchange traces queue.
- **Fix:** Introduce a `wait_for_async_result` action with a `pollSelector` and a `successText`/`failureText`/`timeout`. Specifically tuned for: a Run button, a spinner, then results. The action polls every 1500ms up to a 5-minute wall.
- Also: the LLM should be told via Exchange platform context, "Message trace can take 5+ minutes. Do not finish before results return."

#### 3.4 No CSV download capture
- The user often wants the CSV exported for ticket attachment. The agent can click Export, but Chrome saves the file to disk and the agent has no way to read it.
- **Fix:** Use `chrome.downloads.onCreated` (declare `"downloads"` permission in manifest). When a download fires during an active run, capture its file path, read it via `chrome.downloads.search` + a one-time `fetch('file://...')` (won't work due to MV3) — alternative: route export through CDP `Page.setDownloadBehavior` with `behavior: 'allow', downloadPath: <a managed dir>`, then read the file from the extension's IndexedDB or accept that the user opens it manually.
- Realistic short-term: at minimum, *announce* the download in chat with file path and mime type so the user can attach it to the ticket. That alone is a leap over "agent ignored the download."

### What ships in playbook form

```
Template: "Exchange: Message trace for mail issue"
Params: ::sender::, ::recipient::, ::time_range::, ::status_filter::
Goal:
  STEP 1: Navigate to https://admin.exchange.microsoft.com
  STEP 2: Mail flow > Message trace
  STEP 3: Click "Start a trace"
  STEP 4: Set sender=::sender::, recipient=::recipient::, time range=::time_range::, status=::status_filter::
  STEP 5: Click Search
  STEP 6: Wait for results spinner to disappear (max 5 minutes)
  STEP 7: Extract result rows: timestamp, sender, recipient, subject, status, latest event
  STEP 8: For up to 5 rows, click and capture the delivery details panel
  STEP 9: Finish with a structured summary by status, suspected cause, and any blocking event (spam, transport rule, etc.)
```

---

## Task 4 — Audit logins for AD accounts via Entra (sign-in logs)

### What the agent has to do

1. `entra.microsoft.com` → Monitoring & health → Sign-in logs.
2. Filter: User, Date, Status (Success/Failure/Interrupted), App, Conditional Access result, Risk level.
3. Read paginated/virtualized results.
4. Optional: click row → full JSON detail panel.
5. Optional: export as CSV.
6. Produce a writeup: failure reasons, IP/location patterns, MFA patterns, blocked attempts.

### What works today

- The current ref-id system handles row-level click targeting reasonably.
- Time-range pickers in Entra sign-in logs are *more* native than Exchange — some are HTML5 date inputs, which `setDatePickerValue` handles.

### Where it breaks

#### 4.1 Virtualized list extraction is incomplete
- Sign-in logs render ~30 rows visible at once and recycle on scroll. `extract_list` (`content/index.js`) only sees the visible window.
- **Fix:** Add a `scroll_and_collect` action: takes a `containerSelector` (or ref), a `rowSelector`, a `field map`, and a `targetCount` (or `until: "no new rows in 3 scrolls"`). Internally:
  - For each scroll iteration: `extract_list` against the visible rows, dedupe by a row identity hash (e.g., timestamp + user), append.
  - Scroll the container by `container.clientHeight - 100`.
  - Stop when target reached or no new rows for N iterations.
- This is the single most-requested missing feature for log-style audits.

#### 4.2 JSON detail panels are Monaco editors
- Click a sign-in log row → details panel has tabs (Basic info, Location, Device info, Authentication details, Conditional Access). The "Authentication details" tab is a Monaco-style code view — `innerText` reads it, but each token is a separate span.
- **Fix:** Special handling: when `read_page` runs in a panel that contains `.monaco-editor`, prefer extracting via `monaco.editor.getModels()[0].getValue()` from CDP `Runtime.evaluate`. Add it as a hint in `read_page` for any URL matching `entra.microsoft.com`.

#### 4.3 Filter-chip state isn't surfaced to the model
- Filters in Entra sign-in logs render as chips above the table. The chips are descriptive (e.g., "Date: Last 24 hours", "Status: Failure"). The agent's element scan picks them up as buttons but doesn't tag them as "applied filters".
- **Fix:** Add a "filter state" extractor for Entra-specific URLs that reads the chip area and surfaces the active filters as a synthetic prompt header: `Active filters: [Date: Last 24h, Status: Failure]`. So the LLM doesn't try to re-apply filters that are already on.

#### 4.4 No risk/anomaly summarization in finish
- The agent currently produces a generic summary. For sign-in audits, the value is in patterns: "5 failures from <IP> targeting <user>, all blocked by Conditional Access".
- **Fix:** When the goal text matches `/audit.*sign.?in|login.*audit|failed.*login|suspicious.*log.?in/i`, inject an output template into the system prompt: "Group results by user × status × IP. Flag any IP with >3 failures, any country mismatch with the user's typical location, any token-binding mismatch, any MFA-not-required-but-expected." Force the finish summary into a "Findings + Recommended action" structure suitable for pasting into a ticket.

### What ships in playbook form

```
Template: "Entra: Audit sign-ins for user"
Params: ::user_upn::, ::time_range::, ::tenant_expected::
Goal:
  STEP 1: Navigate to https://entra.microsoft.com
  STEP 2: Verify tenant == "::tenant_expected::"
  STEP 3: Monitoring & health > Sign-in logs
  STEP 4: Filter User=::user_upn::, Date=::time_range::, Status=All
  STEP 5: scroll_and_collect: rows up to 500 with fields {time, status, ip, location, app, ca_result, risk}
  STEP 6: For each Failure or Interrupted row: click and capture Authentication details panel
  STEP 7: Group by IP and by status; flag IPs with >3 failures or country mismatch
  STEP 8: Finish in "Findings + Recommended action" format suitable for ticket FINAL_NOTES
```

---

## Cross-cutting fixes that unlock all four tasks

These items show up repeatedly across the playbooks above. Implementing them lifts every workflow at once. Ordered by leverage.

### A. Sensitive-field detection by label (not just type=password)
**Hits:** Task 1 (PSK), Task 2 (recovery codes / temp passwords), Task 3 (no impact), Task 4 (no impact).
- In `content/index.js` `case 'type'`, after resolving the target element, walk up to 3 ancestors and to the previous sibling for label text. Reject the type if the surrounding text matches a configurable regex (default: `/pre.?shared|shared secret|secret|api key|client secret|encryption key|passphrase|recovery code|temporary password|tenant.*key/i`).
- In approval mode, surface as a **highlighted approval card** with the masked target label, not the value.
- Add a settings list "Always require approval for fields labeled like:" the user can edit.

### B. MFA-challenge detection + auto-pause
**Hits:** Tasks 1 (FW 2FA), 2 (M365 MFA step-up), 3 (Exchange MFA), 4 (Entra MFA on access).
- Content-script observer that runs on every observation: match page text + element labels against `/verify your identity|enter the code|approve.*sign.?in|enter your code|6.?digit|two.?factor|authenticator app|call.*phone|push notification/i`.
- When matched: set `agentPaused = true`, send `chrome.notifications.create`, post chat banner with "Resume" button.
- This is one observer + one chat banner — small surface, huge value.

### C. Configuration-change verification gate
**Hits:** Tasks 1, 2 (any save/apply on M365), 3 (no impact), 4 (no impact).
- Decision rule (gate before `finish` is allowed):
  - If the goal text matches change verbs (`add|create|delete|modify|update|enable|disable|block|allow|configure|grant|revoke|assign|remove|change`),
  - AND we're on a known config platform (firewall family OR M365 admin centers OR RMM tools),
  - THEN require the last 10 history entries to contain (a) a click whose target text matches `/apply|save|commit|deploy|accept|update|create|delete/i`, AND (b) a subsequent `read_page` or `extract` showing the change is reflected.
- If those aren't met, inject a system note: "Cannot finish: configuration change not yet verified. Re-read the table and confirm the change is active."

### D. `read_console_messages` and `read_network_requests` actions
**Hits:** All four tasks. Especially Task 2 and Task 3 — admin actions hit Microsoft Graph and the *interesting* error often only appears in a 4xx response, never in a UI toast.
- New CDP-backed actions, buffered in the background:
  - `read_console_messages` → returns last 50 entries with level/text/url/lineNumber/timestamp.
  - `read_network_requests` → returns last 30 with method/url/status/duration/responseSize; supports `filter: 'failed' | '4xx' | '5xx' | 'graph.microsoft.com'`.
- These are how a real technician diagnoses M365 problems — the agent should have parity.

### E. Virtualized-list `scroll_and_collect`
**Hits:** Task 2 (Active users), Task 3 (mail trace results), Task 4 (sign-in logs).
- New action. Single-purpose: scroll a container to load all rows, dedupe, collect.
- Without this, audits are limited to the first viewport-worth of data and the agent confidently summarizes incomplete data.

### F. M365 Fluent UI date / time picker
**Hits:** Task 2 (CA policy date scopes), Task 3 (mail trace ranges), Task 4 (sign-in log ranges).
- Extend `setDatePickerValue` with a third strategy: open the popper, click a `[data-automationid='dateCell']` matching the date text, drive the time spinners by clicking their up/down buttons until the displayed time matches.
- Also recognize relative chips ("Last 24 hours", "Last 7 days") as buttons to click directly.

### G. Tenant lock for any `*.microsoft.com` admin URL
**Hits:** Tasks 2, 3, 4.
- Auto-detect the tenant via the top-right tenant chip text, the URL's `tid=` param, or the first `*.onmicrosoft.com` reference on the page.
- At plan time, force the LLM to confirm the detected tenant matches the goal's `::tenant::` parameter (or a chat-confirmed tenant) before any modifying action.
- Show the detected tenant as a chip in the popup header — at-a-glance reassurance for the technician.

### H. Cert-warning bypass with one-tap approval
**Hits:** Task 1 (SonicWall self-signed). Less so for the Microsoft tasks.
- Detect Chrome interstitial. Surface single-shot approval. Click `Advanced` → `Proceed to <host> (unsafe)`. Persist per-host bypass in `chrome.storage.session`.

### I. Per-tenant credential vault
**Hits:** All four tasks. Right now `::firewall_pass::`, `::admin_password::`, `::psk::` etc. are typed into the goal in plaintext.
- Settings panel: "Saved credentials per host". Stored encrypted in `chrome.storage.session` (cleared at browser restart). Goals reference `${cred:firewall.acme.com}` — the agent engine resolves the lookup *just before dispatch*, never logs the resolved value, scrubs it from history.
- This is the single biggest privacy / safety upgrade for an MSP product. Claude in Chrome doesn't have it because Anthropic doesn't ship a vault. You can.

### J. CSV / file-download capture
**Hits:** Task 3, Task 4.
- Add `"downloads"` permission. Listen on `chrome.downloads.onCreated`. When a download starts during an active run, capture filename + path + mime, post it as a chat message ("Downloaded: signinLogs-2026-05-08.csv → ~/Downloads/..."), and offer "Attach to ticket" action.

### K. Streamlined approval card for config diffs
**Hits:** Tasks 1, 2.
- When the action is a click on a Save/Apply button after a series of `type` / `select` / `check` actions on the same modal, the approval card should show a *diff-style summary*: "About to save with these field values: name=acme-vpn, peer=203.0.113.5, PSK=********."
- Builds trust. Currently approval shows "Click: button.SaveButton" with no context.

---

## Recommended ship order

**Week 1 (correctness + table-stakes safety):**
- A (sensitive-field labels), B (MFA detection), C (config verification gate), H (cert warning).
- These four together remove the worst current failure modes.

**Week 2 (observability + lists):**
- D (console/network), E (scroll_and_collect), F (Fluent UI date pickers), J (downloads).
- Suddenly the agent can actually finish a full audit run.

**Week 3 (MSP-specific differentiation):**
- G (tenant lock), I (credential vault), K (config-diff approval card).
- Add the four task-family runbook templates as ready-to-run library entries.
- Add Exchange and Entra/M365 platform context blocks.

**Week 4 (polish):**
- Wire `MSP_TASK_PLAYBOOKS` runbooks into the templates panel.
- Add a "Tenant" chip in the popup header.
- Audit-trail export (P2 #24 from prior audit).

---

## What this gets you over Claude in Chrome

After Week 3:

1. **Sensitive-field protection at the input layer**, not just by prompt. Claude in Chrome relies on instruction-following.
2. **MFA pause + resume.** Claude in Chrome doesn't have a clean handoff mechanism.
3. **Config-change verification gate.** Forces re-read after Apply. Claude in Chrome will declare done and move on.
4. **Tenant lock for M365 work.** Cross-client mistakes are a *career* risk in MSP land. Claude in Chrome has no concept of tenant scope.
5. **Encrypted credential vault tied to host.** Claude in Chrome can't store secrets at all.
6. **MSP runbook templates** with parameterized goals, ready to push from your chatbot.
7. **Forensic run log** + **download capture**: every click and typed value, every downloaded CSV, exportable for the ticket.

Keep the existing strengths Sentinel already has (CDP trusted input, ref+bbox, DPR-aware screenshots, custom dropdown handling) and these additions push it past Claude in Chrome on the *things you actually do*, not on generic web-agent benchmarks.
