     1|# Sentinel Override → Beat Claude in Chrome
     2|## Full Gap Analysis & Improvement Roadmap
     3|
     4|---
     5|
     6|## HOW CLAUDE IN CHROME WORKS (The Competition)
     7|
     8|### 1. Vision System (How Claude "sees" the page)
     9|- Takes **full-page screenshots** at configurable resolution (e.g. 1024x768)
    10|- Sends screenshots to the LLM as **base64 image content**
    11|- LLM reads text, recognizes buttons, layouts from the screenshot directly
    12|- Also supports **zoom** — can zoom into a specific region at full resolution
    13|- Coordinate system: pixel-based, with bbox mapping for precise clicks
    14|
    15|### 2. Interaction Model
    16|- **Pixel-based actions**: click at (x,y), type text, press keys, scroll
    17|- Not selector-based — it clicks WHERE IT SEES something
    18|- Supports: left_click, right_click, double_click, triple_click, drag, scroll, key combos
    19|- Fine-grained: left_mouse_down/up for hold actions, hold_key for duration
    20|- "wait" action for timing between steps
    21|
    22|### 3. What the User Sees
    23|- **Live screenshot stream** — you see exactly what Claude sees in real-time
    24|- **Thinking/narration** — Claude explains WHY it's doing each action
    25|- **Step-by-step log** — every action is timestamped and visible
    26|- **Action preview** — before clicking, you see where it's about to click
    27|- **Error recovery visible** — when something goes wrong, you see it reassess
    28|- **No black box** — every thought, every action, every screenshot is logged
    29|
    30|### 4. Error Handling & Recovery
    31|- After each action, takes a **new screenshot** to verify the result
    32|- If the action didn't work, it **self-corrects** based on the new screenshot
    33|- Maximum iteration limit prevents infinite loops
    34|- "Take a screenshot and carefully evaluate" is built into the prompt strategy
    35|
    36|### 5. What Makes It Feel "Intelligent"
    37|- It NARRATES its reasoning: "I can see a login form with username and password fields"
    38|- It VERIFIES after each step: takes screenshot, compares expected vs actual
    39|- It ADAPTS: if a button moved, it finds it on the new screenshot
    40|- It PLANS: breaks complex tasks into ordered steps before executing
    41|- It EXPLAINS failures: "The dropdown didn't open, likely because..."
    42|
    43|---
    44|
    45|## WHAT SENTINEL OVERRIDE HAS TODAY
    46|
    47|### ✅ Strengths (What Claude in Chrome DOESN'T have)
    48|- **DOM-based interaction** — reads the actual DOM, not just pixels (more reliable for web)
    49|- **23 background modules** — rich plugin architecture
    50|- **12 content scripts** — deep page interaction (dropdowns, overlays, frames, shadow DOM)
    51|- **96 tests** — solid test coverage
    52|- **Client knowledge system** — per-client facts injected into prompts
    53|- **Collaboration features** — multi-user run sharing
    54|- **Template system** — reusable goal templates with parameters
    55|- **Scheduler** — scheduled/automated runs
    56|- **Audit log** with in-memory cache
    57|- **Trust scoring** — learns which actions are safe
    58|- **Macro recorder** — can record and replay sequences
    59|- **Quick Assist** — side panel for quick queries
    60|- **Multi-LLM** — works with any provider (Claude, OpenAI, GLM, etc.)
    61|- **Recovery skills** — auto-healing when steps fail
    62|- **Adaptive prompts** — rewrites goals based on page context
    63|- **Self-healing selectors** — falls back to alternatives when a selector breaks
    64|- **Pause/resume** — can pause mid-run
    65|- **Inject context** — add notes to running agent
    66|
    67|### ❌ Gaps (What Claude in Chrome DOES that we DON'T)
    68|
    69|#### CRITICAL — The "Black Box" Problem
    70|1. **No screenshot preview** — user can't see what the agent sees
    71|2. **No thinking narration** — user doesn't know WHY the agent chose an action
    72|3. **No post-action verification** — agent doesn't screenshot after acting to confirm
    73|4. **No health heartbeat** — no visual indicator that the API is still responding
    74|5. **No streaming status** — no "Reading page..." → "Found 3 forms" → "Clicking..." narration
    75|
    76|#### HIGH — Vision & Accuracy
    77|6. **No screenshot capture system** — the vision code exists but isn't capturing screenshots
    78|7. **No zoom/inspect region** — can't zoom into specific areas for detail
    79|8. **No coordinate-based clicking** — only selector-based (misses when elements have no good selector)
    80|9. **No visual element matching** — can't "click the blue button that says Submit"
    81|
    82|#### MEDIUM — Intelligence & Adaptation
    83|10. **No plan preview** — user doesn't see the plan before execution starts
    84|11. **No step-by-step reasoning display** — each step card shows action but not reasoning
    85|12. **No confidence scoring** — doesn't tell user how sure it is about an action
    86|13. **No "what I see" summary** — doesn't describe the page state in plain language
    87|14. **No learned pattern display** — patterns are saved but not shown to user
    88|
    89|#### LOW — Polish
    90|15. **No keyboard shortcut overlay** — doesn't show available shortcuts
    91|16. **No run timeline** — no visual timeline of the entire run
    92|17. **No export run as video** — can't share a replay of what happened
    93|18. **No dark/light mode sync** — doesn't match Chrome's theme
    94|19. **No notification on completion** — no system notification when run finishes
    95|
    96|---
    97|
    98|## THE IMPROVEMENT PLAN
    99|
   100|### Phase 5: See What I See (Vision & Transparency)
   101|**Goal: User never wonders what the agent is doing or if it's frozen**
   102|
   103|#### 5.1 — Screenshot Capture System
   104|- Use `chrome.debugger` (already in permissions!) to capture page screenshots
   105|- Take screenshot before each step (what the agent sees)
   106|- Take screenshot after each step (verify the action worked)
   107|- Store last N screenshots in memory for the step cards
   108|- Show current screenshot in a live preview panel
   109|
   110|#### 5.2 — Live Status Narration
   111|- Add "thinking" state: "Analyzing page structure..." before LLM call
   112|- Add "acting" state: "Clicking the Login button..." during action
   113|- Add "verifying" state: "Checking if the action worked..." after action
   114|- Stream these as `agent_status` messages to the popup
   115|- Show as a live ticker at the top of the chat
   116|
   117|#### 5.3 — Post-Action Verification
   118|- After every action, take a screenshot and compare expected vs actual
   119|- If verification fails, automatically retry with a different approach
   120|- Show verification result to user: ✅ "Login form appeared" or ❌ "Button didn't respond, retrying..."
   121|
   122|#### 5.4 — Health Heartbeat
   123|- Ping the LLM API every 30s during long-running steps
   124|- Show a pulse indicator: 🟢 API responding / 🔴 API slow / ⚫ API down
   125|- If API is down, pause and notify user instead of silently failing
   126|- Show last response time: "API: 1.2s avg"
   127|
   128|#### 5.5 — Reasoning Cards
   129|- Each step card shows not just WHAT (the action) but WHY (the reasoning)
   130|- Parse the LLM's response to extract reasoning text
   131|- Show as expandable "🧠 Thinking..." section on each step card
   132|- Include confidence level: "High confidence — exact text match found"
   133|
   134|### Phase 6: Pixel-Perfect Interaction
   135|**Goal: Click anything, anywhere, even without a clean selector**
   136|
   137|#### 6.1 — Coordinate-Based Actions
   138|- Add `click_at(x, y)` to content script (already exists in the code!)
   139|- Generate bbox for all interactive elements during `observe_page`
   140|- Fall back to coordinate clicking when selector matching fails
   141|- Show click coordinates on the screenshot preview
   142|
   143|#### 6.2 — Visual Element Matching
   144|- When screenshot + vision model available: "I can see a blue Submit button at (450, 320)"
   145|- Combine DOM data + screenshot for hybrid interaction
   146|- Allow LLM to specify "click the element that looks like [description]"
   147|
   148|#### 6.3 — Zoom & Inspect
   149|- Implement zoom into specific page regions for detail
   150|- Show zoomed view in the preview panel
   151|- Use for dense UIs like admin panels, dashboards
   152|
   153|### Phase 7: Intelligence Upgrade
   154|**Goal: Agent that gets smarter over time and shows its work**
   155|
   156|#### 7.1 — Plan Preview & Editing
   157|- Show the generated plan to the user BEFORE execution starts
   158|- Allow user to edit/reorder/delete steps
   159|- Allow user to add manual steps mid-plan
   160|- Show estimated steps: "This will take ~8 steps"
   161|
   162|#### 7.2 — Confidence Scoring
   163|- Each action gets a confidence score (0-100%)
   164|- Based on: selector match quality, text match, element visibility, historical success
   165|- Color-code: green (>80%), yellow (50-80%), red (<50%)
   166|- Low confidence → auto-request approval even in auto-approve mode
   167|
   168|#### 7.3 — Page State Narration
   169|- After observing the page, generate a plain-English summary
   170|- "I can see a SonicWall management page with 3 active VPN tunnels listed in a table..."
   171|- Show this in the chat as the agent's "understanding" of the page
   172|- Update after each action
   173|
   174|#### 7.4 — Learned Patterns Dashboard
   175|- Show which patterns the agent has learned (per-site, per-action)
   176|- Allow user to view/edit/delete learned patterns
   177|- Show pattern hit rate: "Login flow for this site: used 12 times, 100% success"
   178|- Patterns inject into future runs automatically
   179|
   180|### Phase 8: The "Better Than Claude" Features
   181|**Goal: Features Claude in Chrome doesn't have that make us clearly superior**
   182|
   183|#### 8.1 — Client Knowledge Context
   184|- Already exists but needs to be VISIBLE to the user
   185|- Show which client facts are being injected: "Using 5 facts for MSP Client"
   186|- Allow inline editing of facts during a run
   187|
   188|#### 8.2 — Run Replay & Sharing
   189|- Record the entire run (screenshots + actions + reasoning)
   190|- Export as shareable HTML report or video
   191|- Team members can replay exact runs
   192|- "Here's how I configured that SonicWall tunnel"
   193|
   194|#### 8.3 — Multi-Provider Strategy
   195|- Use cheap model (Haiku) for observation and simple clicks
   196|- Use powerful model (Sonnet/Opus) for complex decisions
   197|- Auto-select based on step complexity
   198|- Show cost per run: "This run cost $0.03 (Haiku: $0.01, Sonnet: $0.02)"
   199|
   200|#### 8.4 — Scheduler + Notification
   201|- Already exists but needs completion notifications
   202|- Desktop notification when scheduled run finishes
   203|- Email/Discord summary of scheduled run results
   204|- Attach run replay link
   205|
   206|#### 8.5 — Natural Language Correction
   207|- "Wait, click the second one instead" mid-run
   208|- Agent interprets and adjusts plan in real-time
   209|- No need to stop and restart
   210|
   211|---
   212|
   213|## PRIORITY ORDER
   214|
   215|| Priority | Phase | Feature | Impact | Effort |
   216||----------|-------|---------|--------|--------|
   217|| 🔴 P0 | 5.2 | Live Status Narration | Kills the black box | Low |
   218|| 🔴 P0 | 5.4 | Health Heartbeat | Kills the "is it frozen?" fear | Low |
   219|| 🔴 P0 | 5.5 | Reasoning Cards | Shows WHY not just WHAT | Medium |
   220|| 🟡 P1 | 5.1 | Screenshot Capture + Preview | Full visual transparency | Medium |
   221|| 🟡 P1 | 5.3 | Post-Action Verification | Self-correcting behavior | Medium |
   222|| 🟡 P1 | 6.1 | Coordinate-Based Fallback | Clicks anything | Low (code exists!) |
   223|| 🟢 P2 | 7.1 | Plan Preview & Editing | User control | Medium |
   224|| 🟢 P2 | 7.3 | Page State Narration | Intelligence display | Low |
   225|| 🟢 P2 | 8.5 | Natural Language Correction | Real-time control | Medium |
   226|| 🔵 P3 | 7.2 | Confidence Scoring | Trust indicator | Medium |
   227|| 🔵 P3 | 7.4 | Learned Patterns Dashboard | Shows learning | Medium |
   228|| 🔵 P3 | 8.1 | Client Knowledge Visibility | MSP workflows | Low |
   229|| 🔵 P3 | 8.3 | Multi-Provider Strategy | Cost optimization | Medium |
   230|| ⚪ P4 | 6.2 | Visual Element Matching | Advanced vision | High |
   231|| ⚪ P4 | 6.3 | Zoom & Inspect | Detail work | Medium |
   232|| ⚪ P4 | 8.2 | Run Replay & Sharing | Team feature | High |
   233|| ⚪ P4 | 8.4 | Scheduler Notifications | Automation | Low |
   234|
   235|---
   236|
   237|## WHAT MAKES US BETTER THAN CLAUDE (Our Moat)
   238|
   239|1. **DOM + Vision hybrid** — Claude only sees pixels. We see the actual DOM AND pixels. More reliable.
   240|2. **Client knowledge injection** — Claude doesn't know your MSP clients. We do.
   241|3. **Multi-LLM** — Claude only uses Claude. We use the best model for each step.
   242|4. **Self-healing selectors** — Claude retries the same click. We find alternatives.
   243|5. **Recovery skills** — Claude errors out. We auto-heal with learned patterns.
   244|6. **Template system** — Claude does one-offs. We save and replay workflows.
   245|7. **Scheduler** — Claude is interactive only. We run on autopilot.
   246|8. **Cost control** — Claude is $15/MTok. We can use Haiku at $1/MTok for simple steps.
   247|9. **Trust scoring** — Claude doesn't learn. We learn which actions are safe over time.
   248|10. **Collaboration** — Claude is single-user. We share runs across teams.
   249|