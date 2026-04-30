# Sentinel Prime (SentinelAgent Browser) — Architecture Reference

> Chrome Manifest V3 extension for LLM-powered browser automation.
> Location: `C:\Users\Administrator\.openclaw\workspace\sentinel-override\`
> Version: 2.4.5

---

## File Map

```
sentinel-override/
├── manifest.json              # Extension manifest (MV3)
├── background.js              # Service worker — agent loop, orchestration (967 lines)
├── content.js                 # Content script — DOM interaction (150 lines)
├── popup.html                 # Side panel UI — full markup + CSS (1949 lines)
├── popup-full.js              # Side panel UI logic (1622 lines)
├── popup_mockup.html          # UI mockup reference
├── llm/
│   ├── index.js               # Provider registration + llmChat() entry point (73 lines)
│   ├── ProviderInterface.js   # Abstract base class for providers (79 lines)
│   ├── ProviderFactory.js     # Singleton registry, auto-detection from URL (90 lines)
│   ├── ModelTierRouter.js     # Task → tier → model routing (472 lines)
│   └── providers/
│       ├── ZAIProvider.js     # Z.AI (glm-4.7-flash, glm-4.5v, glm-5.1) (94 lines)
│       ├── OllamaProvider.js  # Local Ollama (free) (101 lines)
│       ├── OpenRouterProvider.js  # OpenRouter affordable models (104 lines)
│       └── VeniceProvider.js  # Venice with cost limits (162 lines)
├── tests/
│   ├── providers.test.js      # Provider unit tests (175 lines)
│   └── tier-router.test.js   # Tier router unit tests (243 lines)
├── docs/
│   └── TEST_PLAN.md          # 52 test cases, 5 known defects (995 lines)
├── README.md                 # Project overview
├── USAGE.md                  # Install and quick start
├── CHANGELOG.md              # Version history (v2.0.0 → v2.4.0)
├── CONTRIBUTING.md           # Dev setup, code style, PR process
├── GROWTH_PLAN.md            # 4-phase growth and monetization
└── DEMO_VIDEO_SCRIPT.md      # Demo video script
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  popup.html                      │
│              (Side Panel UI)                     │
│  ┌─────────────────────────────────────────┐    │
│  │           popup-full.js                  │    │
│  │  Chat, Settings, Themes, Approval Mode   │    │
│  └──────────────┬──────────────────────────┘    │
└─────────────────┼───────────────────────────────┘
                  │ chrome.runtime.sendMessage
                  ▼
┌─────────────────────────────────────────────────┐
│              background.js                       │
│           (Service Worker)                       │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │Agent Loop│  │Plan Exec │  │Rate Limiter   │ │
│  │observe→  │  │Decompose │  │2s gap, 3x    │ │
│  │think→act │  │→execute  │  │exp backoff   │ │
│  └────┬─────┘  └──────────┘  └───────────────┘ │
│       │                                         │
│  ┌────▼─────────────────────────────────────┐   │
│  │          LLM Provider Stack               │   │
│  │  ┌──────────────────────────────────┐     │   │
│  │  │      llm/index.js (llmChat)      │     │   │
│  │  └──────────────┬───────────────────┘     │   │
│  │  ┌──────────────▼───────────────────┐     │   │
│  │  │     ModelTierRouter              │     │   │
│  │  │  classify → route → select model │     │   │
│  │  └──────────────┬───────────────────┘     │   │
│  │  ┌──────────────▼───────────────────┐     │   │
│  │  │     ProviderFactory              │     │   │
│  │  │  auto-detect from endpoint URL   │     │   │
│  │  └──────────────┬───────────────────┘     │   │
│  │  ┌──────┬───────┼───────┬──────────┐     │   │
│  │  │ ZAI  │Ollama │OpenRtr│ Venice   │     │   │
│  │  └──────┴───────┴───────┴──────────┘     │   │
│  └───────────────────────────────────────────┘   │
└─────────────────┬───────────────────────────────┘
                  │ chrome.tabs.sendMessage
                  ▼
┌─────────────────────────────────────────────────┐
│              content.js                          │
│         (Content Script — in-page)               │
│  observe_page | read_page | extract_data         │
│  execute_command (click, type, scroll)           │
└─────────────────────────────────────────────────┘
```

---

## Core Components

### background.js — Service Worker (967 lines)

**State variables:**
- `agentRunning` — whether the agent loop is active
- `agentTabId` — tab the agent is controlling
- `apiCallCount`, `sessionCost`, `costLog` — usage tracking
- `currentPlan`, `currentStepIndex` — plan execution state
- `lastTierInfo` — last tier decision from ModelTierRouter
- `taskContext` — `{ goal, completedSteps, intermediateData, failedAttempts, currentPhase }`

**Key functions:**

| Function | Lines | Purpose |
|----------|-------|---------|
| `runAgentLoop()` | ~main loop | observe page → capture screenshot → call LLM with vision → parse JSON command → execute → repeat |
| `callLLM()` | ~mid | Full LLM call with vision support, cost validation, tier routing |
| `callLLMSimple()` | ~mid | LLM call without vision, used for planning and tool generation |
| `planTask()` | ~mid | Decomposes goal into ordered steps |
| `executePlan()` | ~mid | Executes plan steps sequentially |
| `generateMissingTool()` | ~mid | Auto-generates tool when a step fails |
| `parseLLMResponse()` | ~mid | Extracts JSON from LLM output, validates action type |

**Rate limiting:** 2-second minimum between calls, 3 retries with exponential backoff.

**Valid action types:** `click, type, navigate, scroll, select, hover, press_key, extract, wait_for_text, wait_for_element, wait_for_navigation, execute_js, read_page, note, finish`

**Message routing (receives from popup):**
- `run_agent` — start agent loop
- `stop_agent` — stop agent loop
- `plan_task` — decompose goal into plan
- `execute_plan` — execute an existing plan
- `run_prompt` — simple non-agent LLM call
- `respond_approval` — user approved/rejected/skipped action

**Message routing (sends to popup):**
- `agent_update`, `agent_finished` — status updates
- `request_approval` — action needs user approval
- `show_plan`, `plan_error`, `step_executing`, `step_complete`, `plan_finished` — plan execution events

### content.js — Content Script (150 lines)

**Actions implemented:**

| Message Action | Handler | Status |
|---------------|---------|--------|
| `observe_page` | Find interactive elements (buttons, inputs, links) | Working |
| `read_page` | Get page text content | Working |
| `extract_data` | Tables, metadata, forms | Working |
| `execute_command` → `click` | Click element by selector | Working |
| `execute_command` → `type` | Type text into input | Working |
| `execute_command` → `scroll` | Scroll page by direction | Working |
| `execute_command` → `navigate` | Navigate to URL | Working |

**Known gap (DEF-001):** `select`, `hover`, `press_key`, `extract`, `wait_for_text`, `wait_for_element`, `execute_js` — 7 action types are NOT handled in content.js and fail silently.

**Helper:** `getUniqueSelector(element)` — generates unique CSS selector for any DOM element.

---

## LLM Provider System

### ProviderInterface.js (Abstract Base)

Methods all providers must implement:
- `chat(messages, options)` — send messages, get response
- `stream(messages, options)` — streaming response (not yet used)
- `estimateCost(model, inputTokens, outputTokens)` — cost calculation
- `validateModel(model)` — check if model is supported
- `getModels()` — list available models
- `getConfigSchema()` — provider config schema

Helper methods:
- `buildUserContent(text, screenshot)` — builds user message with optional image
- `normalizeMessages(messages)` — ensures proper message format

### ProviderFactory.js (Registry)

Singleton pattern. Key methods:
- `fromEndpoint(url)` — auto-detect provider from URL:
  - `venice.ai` → VeniceProvider
  - `openrouter.ai` → OpenRouterProvider
  - `z.ai` → ZAIProvider
  - `localhost:11434` or URL containing `ollama` → OllamaProvider
- `register(id, provider)` — register a provider
- `get(id)` — retrieve provider by ID
- `listProviders()` — list all registered providers
- `modelSupportsVision(providerId, model)` — check vision support

### ModelTierRouter.js (472 lines)

**Tier definitions:**

| Tier | Use Case | Token Budget |
|------|----------|-------------|
| nano | Simple actions (click, type, scroll) | Low |
| standard | Navigation, forms, multi-step | Medium |
| heavy | Complex reasoning, analysis, comparison | High |

**Classification logic (`classifyTask`):**
1. Keyword analysis (e.g., "click" → nano, "navigate" → standard, "analyze" → heavy)
2. Pattern matching for multi-step indicators
3. Context modifiers: step count, history length, previous failures
4. Failure bias: previous failures push toward heavier tier

**Routing priority (`route`):**
1. User override (if set) — always wins
2. Session stickiness — if 2 consecutive successes at same tier/model, reuse
3. Forced tier (if set) — overrides classification
4. Auto-classify → select cheapest capable model

**Escalation:** 2 consecutive failures at same tier → escalate (nano→standard→heavy). Heavy cannot escalate further.

**Session stickiness:** 2 consecutive successes at same tier/model → sticky model for that goal pattern. Stored in-memory Map, keyed by goal pattern.

**Per-provider model maps:**

| Provider | nano | standard | heavy |
|----------|------|----------|-------|
| Venice | e2ee-qwen-2-5-7b-p | deepseek-v4-flash | grok-41-fast |
| OpenRouter | mistral-7b | llama-3.2-1b | command-r-plus |
| ZAI | glm-4.7-flash | glm-4.5v | glm-5.1 |
| Ollama | qwen2.5:3b | qwen2.5:7b | qwen2.5:14b |

### ZAI Provider

- Base URL: `https://api.z.ai/api/coding/paas/v4`
- OpenAI-compatible API format
- Models: glm-4.7-flash, glm-4.5v (vision), glm-5.1 (reasoning)
- Cost: $0.13/1M input, $0.50/1M output (all models)
- Vision support: glm-4.5v only

### Ollama Provider

- Base URL: `http://localhost:11434` (local)
- Uses `/api/chat` endpoint
- Free — no cost tracking
- Models: qwen2.5 variants, llama3.2, mistral, gemma2, deepseek-v2, phi3

### OpenRouter Provider

- Base URL: `https://openrouter.ai/api/v1`
- OpenAI-compatible
- Affordable models: mistral-7b, llama-3.2-1b, command-r-plus, deepseek (free), gemma (free)
- Max cost: $0.50 per 1K tokens

### Venice Provider

- Base URL: `https://api.venice.ai/api/v1`
- 13 allowed models
- Blocked prefixes: gpt-4, gpt-5, o1, o3, claude-opus, etc.
- Hard limits: $0.50 in/out per call, $1.00 total per call, $5.00 session max

---

## Cost Safety System

- **Per-call validation:** Provider estimates cost before API call
- **Session budget:** $5.00 maximum per session (Venice)
- **Blocked model prefixes:** High-cost models blocked at provider level
- **Whitelists:** Only approved models allowed per provider
- **Cost logging:** Every call logged with model, tokens, cost

---

## UI Components (popup.html + popup-full.js)

### Side Panel Layout
- **Header:** Active indicator, agent status
- **Toolbar:** Search, preview, attach, export, shortcuts, speak
- **Chat container:** Message history with markdown rendering
- **Input area:** Text input, voice button, send/stop buttons
- **Modals:** Settings, theme customizer, command palette, shortcuts

### Key UI Features

**Approval Mode:**
- YOLO (OFF) — agent acts autonomously
- ON — each action requires user approve/reject/skip
- Toggle in settings modal
- Approval cards appear inline in chat

**Plan Cards:**
- Shows decomposed plan with numbered steps
- Step status: pending (⏳), executing (🔄), complete (✅), failed (❌)
- Progress bar
- Execute/Modify buttons
- Warnings for complex steps

**Provider Selector:**
- In settings modal
- Dropdown with OpenRouter, Venice, ZAI presets
- Auto-populates endpoint URL and model list on selection

**Themes (8 presets):**
light, dark, matrix, tron, cyberpunk, neon, terminal, blood
Each defines full CSS variable set (background, text, accent, borders, shadows, etc.)

**Command Palette:** Ctrl+K shortcut, 7 commands

**Shortcuts:** Save/load/run prompt templates with emoji categorization, stored in chrome.storage.local

**TTS:** Via local server at `http://localhost:8765/tts?text=...&voice=en-US-JennyNeural`

**Conversation Export:** Markdown, JSON, or text format

**HTML Sanitization:** Removes script, iframe, object, embed, form, link, base, meta tags and event handler attributes from rendered messages.

---

## Agent Loop Flow

```
User sends prompt
    │
    ├── Simple prompt → runPrompt → callLLMSimple → display response
    │
    └── Complex prompt (plan/execute/task/extract/automate/monitor/crawl/scrape or URLs)
        │
        ▼
    planTask(goal)
        │ callLLMSimple → get step list
        ▼
    showPlanCard → user clicks Execute
        │
        ▼
    executePlan(plan)
        │ for each step:
        ▼
    runAgentLoop()
        │
        ├── 1. observe_page → get interactive elements
        ├── 2. Capture screenshot
        ├── 3. callLLM (with vision) → get action JSON
        ├── 4. parseLLMResponse → validate action
        ├── 5. If approval mode ON → request_approval → wait
        ├── 6. Execute action via content.js
        ├── 7. If step complete → next step
        ├── 8. If step fails → retry (up to 3)
        │       If still fails → generateMissingTool → retry
        │       If still fails → escalate tier → retry
        └── 9. finish → plan_finished
```

---

## Known Defects

| ID | Severity | Description |
|----|----------|-------------|
| DEF-001 | High | content.js missing handlers for select, hover, press_key, extract, wait_for_text, wait_for_element, execute_js — 7/15 action types fail silently |
| DEF-002 | Medium | `wait_for_navigation` not in validTypes array in background.js |
| DEF-003 | Medium | `read_page` routing mismatch — message action vs execute_command handler |
| DEF-004 | Low | `note` type sent to content.js produces noise |
| DEF-005 | Low | Default "Command failed" error message is not actionable |

---

## Key Configuration Points

**Settings stored in chrome.storage.local:**
- `apiEndpoint` — LLM provider base URL
- `apiKey` — API key
- `model` — selected model name
- `theme` — active theme preset
- `approvalMode` — YOLO vs per-action
- `shortcuts` — saved prompt templates

**Provider presets (hardcoded in popup-full.js):**
- OpenRouter: `https://openrouter.ai/api/v1`
- Venice: `https://api.venice.ai/api/v1`
- ZAI: `https://api.z.ai/api/coding/paas/v4`

---

## Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| v2.0.0 | 2026-04-24 | Cost safeguards, OpenRouter migration |
| v2.1.0 | 2026-04-25 | Plan-Decompose UX, OpenRouter provider preset |
| v2.2.0 | 2026-04-26 | Lean context retention, auto-tool generation |
| v2.3.0 | 2026-04-27 | Shortcut UI, growth plan, documentation |
| v2.4.0 | 2026-04-27 | Structured data extraction, persistent memory |

---

## Relationship to Paperclip/OpenClaw Infrastructure

Sentinel Prime is **independent** of the Paperclip agent system. They share:
- The same machine (homeserver)
- Z.AI as an LLM provider (glm-5.1 model)
- The `.openclaw` workspace directory

They do **not** share:
- Code — Sentinel Prime is a Chrome extension; Paperclip is a Node.js gateway
- Database — Sentinel Prime uses chrome.storage; Paperclip uses PostgreSQL on port 5433
- Runtime — Sentinel Prime runs in Chrome; Paperclip runs via Node.js on port 18789
