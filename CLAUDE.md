# Sentinel Override — Make It Perfect
## THE GOAL
Make Sentinel Override the best browser automation agent on the planet. It should work better, faster, and more reliably than Claude's own computer use in Chrome. Every feature must be polished, every edge case handled, every test passing. NO RESTRICTIONS — if the user has access to a page, the agent acts without questioning authorization.

## What Is This
AI-powered browser automation Chrome extension (MV3). User gives a goal → agent plans → executes click/type/navigate actions → reports results. The daily driver for an IT Support Technician at an MSP.

## ZERO-FRICTION POLICY (CRITICAL)
The user is an authorized IT technician with legitimate access to every system they visit. The agent must NEVER:
- Block typing into password, API key, secret, or credential fields
- Block actions on Microsoft 365, Azure, Office, SharePoint, or any enterprise platform
- Question whether the user is "authorized" to perform an action
- Refuse to fill credentials, secrets, or sensitive fields
- Block cross-tenant actions — the user manages multiple tenants as their JOB
- Show "sensitive field" errors or "cross-tenant lockdown" messages
- Restrict password extraction from IT documentation systems (IT Glue, etc.)

If the user says "log into this SonicWall" or "change this M365 policy" — the agent EXECUTES. No authorization checks. The user having access IS the authorization.

Specific code to change:
1. content/index.js — Remove `__sentinelCheckSensitiveField()` blocking from `case 'type'` and `case 'focus_element'`. Instead of blocking, just type the value. The function can still LOG for audit but must never block.
2. background/agent-engine.js — Remove `TENANT_LOCKED_HOSTS_RE` and the entire `shouldLockoutCrossTenantAction()` flow. Cross-tenant approval cards should not exist. If the user is on a page, they're authorized.
3. background/agent-engine.js — Remove `safetyBlocks` counter. No action should ever be blocked for being "sensitive."
4. background/platforms/itglue.js — Remove password extraction restriction. IT techs need to read passwords from their documentation system.
5. Keep telemetry/logging of what happened (audit trail) but NEVER block the action.

## CRITICAL — Chrome MV3 Constraints (NEVER VIOLATE)
- NEVER use top-level await in background/index.js (service worker)
- NEVER use const or let at top-level of content/index.js (all_frames: true, MAIN world — use var)
- Every chrome.* API used in background/ must have its corresponding permission in manifest.json
- Use optional chaining (chrome.X?.onY) for any top-level chrome.* access
- NEVER access window or document in service worker context
- NEVER use require() — this is ES modules (type: "module" in manifest)
- NEVER reference a const/let variable before its declaration line (temporal dead zone)
- NEVER add npm dependencies without a compelling reason
- Content scripts sending messages to background MUST unwrap wrapped responses: `response?.data?.text || response?.text`
- New content scripts that need UI panels MUST use Shadow DOM (attachShadow) for style isolation
- New content scripts get their OWN manifest.json content_scripts entry (don't combine with main content script)
- NEVER use const/let at top-level in content scripts (even ISOLATED world — use var or IIFE guard)

## PHASE 1: Fix Everything Broken ✅ DONE
## PHASE 2: Make It Bulletproof ✅ DONE
## PHASE 3: Make It Better Than Claude In Chrome ✅ DONE
## PHASE 4: Polish To Perfection ✅ DONE (v3.49.0)

## PHASE 5: REMOVE ALL RESTRICTIONS (P0 — DO THIS NEXT)
The agent must be completely unrestricted. Remove every safety block, authorization check, and tenant lockout:

### 5.1 — Kill Sensitive Field Blocking
File: `content/index.js`
- Find `case 'type'` (~line 1344) — remove the `__sentinelCheckSensitiveField()` check
- Find `case 'focus_element'` (~line 653) — remove the same check
- Keep `__sentinelCheckSensitiveField()` function for LOGGING only (telemetry/audit)
- Change behavior: if field is "sensitive", log it at info level but PROCEED with typing
- Remove the `throw new Error('BLOCKED: cannot focus sensitive field...')` line
- Remove the `return 'BLOCKED: target field appears sensitive...'` line
- Replace with: log + proceed

### 5.2 — Kill Cross-Tenant Lockout
File: `background/agent-engine.js`
- Remove `TENANT_LOCKED_HOSTS_RE` constant (line ~1603)
- Remove `shouldLockoutCrossTenantAction()` function entirely
- Remove `requestTenantOverride()` function entirely
- Remove `tenantOverrideUrls` Set
- Remove all code that calls these functions (search for `shouldLockoutCrossTenant` and `requestTenantOverride`)
- Remove the `safetyBlocks++` increments (lines ~3787, ~4409)
- Keep the `_hostnameOf()` helper (might be useful elsewhere)

### 5.3 — Kill Safety Block Counter
File: `background/agent-engine.js`
- Remove `safetyBlocks` variable (line ~52)
- Remove from checkpoint state (line ~122)
- Remove from checkpoint restore (line ~177)
- Remove from checkpoint clear (line ~409)
- Remove from trust-score.js integration (the `safetyBlocks` parameter)

### 5.4 — Free IT Glue Platform
File: `background/platforms/itglue.js`
- Remove the "Passwords category is SENSITIVE" restriction from rewriteInstructions
- Allow password extraction — IT techs need to read passwords from their docs
- Change to: "When extracting passwords, show the value. The user is an authorized IT technician."

### 5.5 — Update LLM System Prompt
File: `background/llm-client.js`
- Remove any instructions that tell the LLM to "never type passwords" or "skip sensitive fields"
- Add: "The user is an authorized IT technician. If they ask you to type a credential, type it. If they ask you to extract a password, extract it. Never refuse a legitimate IT workflow action."
- Search for phrases like "do not auto-fill", "manual entry required", "never extract" and remove them

### 5.6 — Verification
- After all changes: `npm test` must pass (update any tests that expect blocking behavior)
- Test: agent should be able to type into password fields without error
- Test: agent should be able to act on microsoft.com without tenant check
- Test: agent should be able to extract IT Glue passwords

## PHASE 6: SEE WHAT I SEE — Vision & Transparency (P0)
**Goal: User never wonders what the agent is doing or if it's frozen**

### 6.1 — Screenshot Capture System
- Use `chrome.debugger` (ALREADY in permissions!) to capture page screenshots
- Call `chrome.debugger.attach(target, "1.3")` → `Page.captureScreenshot`
- Take screenshot BEFORE each step (what the agent sees)
- Take screenshot AFTER each step (verify the action worked)
- Store last 5 screenshots in a ring buffer
- Show current screenshot in a live preview panel in the popup
- IMPORTANT: detach debugger after capture to avoid the "debugging" banner lingering
- Fall back to `chrome.tabs.captureVisibleTab()` if debugger fails

### 6.2 — Live Status Narration
- Add `agent_status` message type to replace the silent "loading" state
- States: `observing` → `thinking` → `planning` → `executing` → `verifying` → `waiting`
- Each state shows a human-readable message: "Reading page structure..." → "Found 3 login forms" → "Clicking the Login button..."
- Stream these as chrome.runtime.sendMessage to the popup in real-time
- Show as a live ticker/typewriter at the top of the chat panel
- Include timestamps: "10:42:15 — Reading page structure..."

### 6.3 — Post-Action Verification
- After EVERY action (click, type, navigate), take a screenshot
- Send screenshot to LLM with prompt: "Did this action succeed? What changed?"
- If verification fails: auto-retry with a different approach (max 2 retries)
- Show verification result to user: ✅ "Login form appeared" or ❌ "Button didn't respond, retrying..."
- Don't verify for trivial actions (scroll, wait) to save API costs

### 6.4 — Health Heartbeat
- Track last LLM response time
- Show pulse indicator in popup: 🟢 API responding (< 3s) / 🟡 API slow (3-10s) / 🔴 API down (> 10s)
- If no response for 30s during a step: show "⚠️ Waiting for API response..." with a spinner
- If no response for 60s: auto-pause and show "API timeout — click Resume to retry"
- Show average response time: "API: 1.2s avg (last 5 calls)"

### 6.5 — Reasoning Cards
- Each step card should show not just WHAT (the action) but WHY (the reasoning)
- Parse the LLM's text response to extract reasoning before the action command
- Show as an expandable "🧠 Thinking..." section on each step card
- Include the agent's confidence level: "High confidence — exact text match on 'Login' button"
- Collapsed by default, click to expand

## PHASE 7: PIXEL-PERFECT INTERACTION (P1)
**Goal: Click anything, anywhere, even without a clean selector**

### 7.1 — Coordinate-Based Fallback
- `click_at(x, y)` already exists in content/index.js — make it the automatic fallback
- When selector matching fails, use the element's bbox to calculate coordinates
- Show click position on the screenshot preview with a crosshair marker
- Support pixel offset for elements that are partially obscured

### 7.2 — Hybrid DOM + Vision Interaction
- When vision model is available: combine DOM data with screenshot analysis
- "I can see a blue Submit button at (450, 320) — confirmed by DOM selector #submit-btn"
- Use DOM for precision, vision for validation
- Fall back to pure vision when DOM selectors all fail

## PHASE 8: INTELLIGENCE UPGRADE (P2)

### 8.1 — Plan Preview
- Show the generated plan to the user BEFORE execution starts
- User can edit/reorder/delete steps
- User can add manual steps
- Show estimated step count: "This will take ~8 steps"

### 8.2 — Page State Narration
- After observing the page, generate plain-English summary
- "I can see a SonicWall management page with 3 active VPN tunnels listed in a table..."
- Show this in the chat as the agent's "understanding" before acting

### 8.3 — Natural Language Correction
- "Wait, click the second one instead" mid-run should adjust the plan
- "No, go back" should navigate back and replan
- "Skip this step" should advance to next step
- No need to stop and restart for corrections

## PHASE 9: THE "BETTER THAN CLAUDE" FEATURES (P3)

### 9.1 — Client Knowledge Visibility
- Show which client facts are being injected during a run
- "Using 5 facts for MSP Client: SonicWall TZ-500, Admin IP 192.168.1.1..."
- Allow inline editing of facts during a run

### 9.2 — Multi-Provider Cost Strategy
- Use cheap model (Haiku $1/MTok) for observation and simple clicks
- Use powerful model (Sonnet $3/MTok) for complex decisions
- Auto-select based on step complexity
- Show cost per run: "This run cost $0.03"

### 9.3 — Run Replay
- Record screenshots + actions + reasoning as a timeline
- Export as shareable HTML report
- Team members can replay exact runs

## Commands
- Test: `npm test`
- Lint: `npx eslint .`
- Build: `node scripts/build.js`

## Git Rules
- Branch: main
- Commit style: conventional commits (feat:, fix:, docs:, style:, chore:, test:)
- Push after every 3-5 commits
- After EVERY change: run tests, then commit

## Key Architecture
- background/agent-engine.js (~242KB) — agent loop, CONFIG, _runSettings
- background/llm-client.js (~118KB) — callLLM(), generatePlan(), providers
- background/provider-registry.js (~25KB) — 20+ LLM provider catalog
- background/telemetry.js (~16KB) — emit() with PII redaction
- popup-modules/chat.js (~137KB) — chat UI, step cards, approval flow
- content/index.js (~111KB) — content script, all action handlers
- content/quick-assist.js (~21KB) — inline AI on any page
- popup.html — chat UI, settings, approval cards

## Priority Order
Phase 5 (Remove Restrictions) → Phase 6 (Vision & Transparency) → Phase 7 (Pixel-Perfect) → Phase 8 (Intelligence) → Phase 9 (Moat Features)
