# Sentinel Override v3.15.0 — Adaptive Prompts

**Release date:** 2026-05-12
**Theme:** Goals get rewritten for the cloud portal you're actually on, BEFORE the agent starts wasting steps on menus that don't exist.

This release closes the failure mode that bit two consecutive real-world runs:
the M365 SMTP relay goal froze on a sign-in wall (fixed in 3.14.1) and the
SonicWall NSM VPN investigation flailed for 9 steps because the goal used
on-box SonicOS menu paths but the agent was driving the NSM cloud
orchestrator. The fix isn't a per-incident patch — it's a structural feature
that detects what platform you're on and rewrites the goal with the right
menu paths before execution starts.

---

## What ships

### 1. Platform profile system (`background/platforms/*`)

Each platform that matters to MSP work gets a structured profile:

```js
{
  id: 'sonicwall_nsm',
  label: 'SonicWall Network Security Manager',
  memoryKeyPrefix: 'sonicwall_',
  detect: (url, goal) => /* boolean */,
  needsTargetSelection: true,
  preflightInstructions: '/* Phase 0 — drill into the right firewall first */',
  mismatchHints: [/* on-box menu -> NSM menu remappings */],
  liveDataCaveats: '/* what NSM lags on, what to fall through to */',
  knownGotchas: '/* overlays, hidden iframes, version-specific menus */',
  rewriteInstructions: '/* prose appended to the rewriter LLM system prompt */',
}
```

Profiles shipped in this release:

- **`sonicwall_nsm`** — `nsm-*.sonicwall.com` / `cloud.sonicwall.com`. Auto-inserts Phase 0 ("drill into MANAGE > FIREWALLS > [target firewall row]"), translates 9 on-box menu paths to their NSM equivalents, notes the 5–15 min analytics lag, warns about the welcome overlay re-render.
- **`sonicwall_onbox`** — Direct SonicOS web admin via the firewall's WAN IP. The on-box menus are canonical; minimal rewrites.
- **`m365_admin`** — Catches `admin.cloud.microsoft`, `entra.microsoft.com`, `admin.exchange.microsoft.com`, `purview.microsoft.com`, `security.microsoft.com`, `intune.microsoft.com`, plus auth wall `login.microsoftonline.com`. The `inferSurface(goal)` heuristic detects which sub-portal the goal is really about (Entra sign-in logs vs Exchange message trace vs Purview audit) so the agent navigates to the right portal first. Notes the audit-log 5–60 min surfacing delay and the cross-origin-iframe / Graph API fallback pattern.
- **`fortigate`** — FortiGate web admin + FortiManager device drill-down hint.

Add a new platform = add one file + one line in `platforms/index.js`. Profile dispatch is order-sensitive (more-specific profiles first).

### 2. Adaptive Prompts rewriter engine (`background/adaptive-prompts.js`)

New module exports `rewriteGoalForPlatform(rawGoal, currentUrl, technicianInfo, expansionMode)` which:

1. Detects the platform via the profile registry. If no match, returns the original goal unchanged.
2. Identifies on-box menu mismatches in the goal text via the profile's `mismatchHints`.
3. Short-circuits (no LLM call) if the goal is short, has no mismatches, and the platform doesn't need a Phase 0.
4. Otherwise, makes ONE LLM call (same provider as the main agent, ~2–4s, ~$0.001) with a tightly-scoped system prompt: "Preserve intent, structure, deliverable, output style. Only change menu paths, add Phase 0 if required, prefix memory keys."
5. Returns `{adapted, adaptedGoal, originalGoal, platform, summary, mismatchHints, error, durationMs}`. Falls back to the original goal on any error — never blocks a run.

The rewriter system prompt is explicit about what it must NOT do (no new investigation steps, no changes to the deliverable, no padding). Three expansion modes (`off` / `light` / `full`) control whether the rewriter is allowed to add phases to short user goals.

### 3. Wired into `startAgent` (`background/agent-engine.js`)

Before `runAgentLoop` fires, `startAgent` calls the rewriter if `adaptivePromptsMode !== 'off'`. Two modes:

- **Auto** — rewrite silently, swap the goal, fire a `adapted_goal_available` message so the popup can show a collapsed informational card. The agent has already started.
- **Approval** — rewrite, broadcast the card with three buttons (Use Adapted / Use Original / Edit), pause via `_waitForAdaptedGoalDecision()` until the user decides. SW kept alive via the 3.14.0 `startSwKeepalive` helper. 5-minute outer timeout defaults to Use Adapted.

Forensic run log captures one `adaptive_prompt_applied` entry per run with platform id, mismatch count, duration, and before/after lengths.

### 4. Adapted Goal card (`popup-modules/chat.js`)

`showAdaptedGoalCard(payload)` renders a collapsible card with:
- Platform name and "N menu mismatches corrected" / "no on-box menu mismatches detected" line
- Show details / Hide details toggle
- Plain-text summary of changes (rewriter's bullet list)
- Two `<details>` panels: full adapted goal and full original goal
- In approval mode: Use Adapted Goal / Use Original / Edit buttons
- In auto mode: passive note that it was applied

Edit button replaces the adapted text with a textarea, replaces the buttons with Save & Run / Cancel. Save sends `adapted_goal_response` with `edited: true, editedGoal: <textarea value>`.

### 5. Settings UI (`popup.html` + `popup-modules/settings.js`)

New settings section with two dropdowns:

- **Adaptive Prompts**: `Auto` (recommended, default) / `Approval` (review diff) / `Off`
- **Expansion Mode**: `Light` (recommended, default) / `Off` / `Full`

Both auto-save on change.

---

## Storage keys (new)

- `adaptivePromptsMode` — string, default `'auto'`
- `adaptiveExpansionMode` — string, default `'light'`

Existing keys untouched.

---

## What this changes in practice

The two failure modes from the last week:

- **M365 SMTP relay run** — goal said "Go to https://admin.cloud.microsoft/exchange/#/" and "Go to https://entra.microsoft.com/". Adaptive Prompts detects M365 admin, `inferSurface(goal)` returns `exchange` for the first phase and `entra` for the second. Both surfaces already had correct URLs in the user's goal, so the rewriter likely returns `no_adaptation_needed: true` — no overhead. The sign-in wall pause from 3.14.1 still fires on `login.microsoftonline.com`. No change in user behavior; the run completes once Brandon signs in manually.

- **SonicWall NSM VPN run** — goal used `System > Licenses`, `VPN > Settings`, `Users > Local Users`, `Log > View`, `Firewall > Access Rules`. All five hit `sonicwallNsm.mismatchHints`. Adaptive Prompts adds Phase 0 (drill into the target firewall) and rewrites every menu path to the per-device NSM equivalent. The agent's first step is `MANAGE > FIREWALLS` instead of trying to find non-existent menus at the NSM root. No more 9-step flail.

---

## Honest limitations

- **Rewriter accuracy depends on profile coverage.** SonicWall NSM is well-covered; FortiGate is minimal. ConnectWise / NinjaOne / Datto / IT Glue profiles are deliberately deferred to v3.15.1 to keep this release small.
- **The rewriter is one LLM call.** It can hallucinate (rare, given how tightly scoped the prompt is). Approval mode is the safety valve; auto mode is logged so you can review.
- **No user-defined profiles UI yet.** Adding a new platform = editing JS. The Client Knowledge system (3.12.0) is a reasonable analog and v3.15.1 will likely add a parallel "Platform Profiles" panel.
- **No mismatch-only mode.** Currently if `needsTargetSelection: true` OR mismatches exist OR the goal is long, the rewriter runs. There's no setting to ONLY rewrite on detected mismatches.

---

## Files touched

**New:**
- `background/platforms/index.js`
- `background/platforms/sonicwall_nsm.js`
- `background/platforms/sonicwall_onbox.js`
- `background/platforms/m365_admin.js`
- `background/platforms/fortigate.js`
- `background/adaptive-prompts.js`
- `RELEASE_NOTES_v3.15.0.md` (this file)

**Modified:**
- `background/agent-engine.js` — import + rewriter call in `startAgent` + `_waitForAdaptedGoalDecision` helper
- `popup.html` — Adaptive Prompts settings section
- `popup-modules/settings.js` — load/save handlers
- `popup-modules/chat.js` — `showAdaptedGoalCard` + `adapted_goal_available` handler
- `manifest.json` — `3.14.1` → `3.15.0`
- `CHANGELOG.md` — prepended entry

---

## Next pulls from the REVAMP backlog (v3.15.1 candidates)

In order of compounding value:

1. **User-defined platform profiles UI** — parallel to client knowledge, lets MSPs add in-house portals without a release.
2. **More built-in profiles** — ConnectWise PSA, NinjaOne, Datto Autotask, IT Glue, ScreenConnect.
3. **Auto-detect mismatch flag** — when adapted_goal differs significantly from original, surface a "this goal looks like it was written for [other platform]; consider switching tabs" warning in auto mode (not just a passive card).
4. **Config diff capture** (REVAMP, deferred from v3.14.0) — snapshot before/after on configuration changes, ship the diff into the IT_GLUE_KB output.
