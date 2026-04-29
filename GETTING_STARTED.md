# Getting Started with Sentinel Override

A step-by-step guide for IT professionals who want to automate browser tasks with AI.

---

## Prerequisites

- **Google Chrome** or **Microsoft Edge** (Chromium-based)
- An API key from one of the supported providers (see [API Setup](#api-setup) below)
- Basic familiarity with Chrome DevTools is helpful but not required

---

## Installation

### Option A: Load Unpacked (Development)

1. **Download the extension**
   - Clone the repo: `git clone https://github.com/dirtysouthalpha/sentinel-override.git`
   - Or download and extract the latest release ZIP from [GitHub Releases](https://github.com/dirtysouthalpha/sentinel-override/releases)

2. **Enable Developer Mode**
   - Open Chrome/Edge and navigate to `chrome://extensions`
   - Toggle **Developer mode** ON (top-right corner)

3. **Load the extension**
   - Click **Load unpacked**
   - Select the `sentinel-override` folder (the one containing `manifest.json`)
   - The Sentinel Override icon appears in your toolbar

4. **Pin the extension**
   - Click the puzzle piece icon (🧩) in the toolbar
   - Find "SentinelAgent Browser" and click the pin icon

### Option B: From Release ZIP

1. Download the latest `.zip` from [GitHub Releases](https://github.com/dirtysouthalpha/sentinel-override/releases)
2. Extract it to a permanent location (don't delete the folder after loading)
3. Follow steps 2–4 from Option A above

> **Why permanent location?** Chrome loads unpacked extensions by reference. If you move or delete the folder, the extension breaks.

---

## API Setup

Sentinel Override supports multiple LLM providers. Pick one:

### Option 1: OpenRouter (Recommended for Beginners)

OpenRouter gives you access to many models with a single API key.

1. Go to [openrouter.ai](https://openrouter.ai) and create an account
2. Add credits ($5 lasts a long time with affordable models)
3. Go to **Keys** → **Create Key**
4. Copy the key (starts with `sk-or-...`)

**In the extension sidebar:**
- **Provider:** OpenRouter
- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions` (auto-filled)
- **Model:** `deepseek-v4-flash` (default, good balance of speed and cost)
- **API Key:** Paste your OpenRouter key

### Option 2: Venice.ai (Privacy-Focused)

Venice routes requests through privacy-preserving infrastructure.

1. Go to [venice.ai](https://venice.ai) and create an account
2. Add credits and generate an API key

**In the extension sidebar:**
- **Provider:** Venice
- **Endpoint:** `https://api.venice.ai/api/v1/chat/completions` (auto-filled)
- **Model:** `gemma-4-uncensored` or `grok-41-fast`
- **API Key:** Paste your Venice key

### Option 3: z.ai (Budget Option)

z.ai offers low-cost access to GLM and DeepSeek models.

1. Go to [z.ai](https://z.ai) and create an account
2. Generate an API key

**In the extension sidebar:**
- **Provider:** z.ai
- **Endpoint:** `https://api.z.ai/v1/chat/completions` (auto-filled)
- **Model:** `deepseek-v4-flash` or `zai-org-glm-4.7-flash`
- **API Key:** Paste your z.ai key

### Option 4: Ollama (Local, Free)

Run models locally on your machine — no API costs, no data leaves your network.

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull qwen2.5:7b`
3. Start the server: `ollama serve` (usually auto-starts)

**In the extension sidebar:**
- **Provider:** Custom
- **Endpoint:** `http://localhost:11434/v1/chat/completions`
- **Model:** `qwen2.5:7b` (or whatever you pulled)
- **API Key:** `ollama` (placeholder, not validated)

---

## Your First Task

Let's walk through a simple automation: searching Google and extracting results.

### Step 1: Open the Sidebar

Click the Sentinel Override icon in your toolbar. The sidebar opens on the right side of your browser.

### Step 2: Configure Your Provider

If this is your first time, the settings panel will appear. Enter your API key and select a provider (see [API Setup](#api-setup) above). Click **Save**.

### Step 3: Enter a Goal

In the input box at the bottom, type:

```
Search Google for "Windows Server 2025 release date" and extract the top 3 results with titles and URLs
```

Press **Send** or hit Enter.

### Step 4: Review the Plan

The agent analyzes your goal and proposes a step-by-step plan:

```
Plan: Google Search Extraction
1. Navigate to google.com
2. Type search query into search box
3. Click search button
4. Extract top 3 results
```

You can **Approve** to execute as-is, or **Reject** to refine your goal.

### Step 5: Watch It Work

The agent executes each step, showing real-time status updates:

```
[Step 1/4] Navigating to google.com...
[Step 2/4] Typing search query...
[Step 3/4] Clicking search...
[Step 4/4] Extracting results...
✅ Task completed: Extracted 3 search results
```

### Step 6: View Results

The extracted data appears in the conversation. You can:
- **Copy** individual results
- **Export** the full conversation as JSON, Markdown, or plain text
- **Continue** with follow-up tasks in the same session

---

## Understanding the Interface

### Sidebar Controls

| Control | Description |
|---------|-------------|
| **Goal Input** | Type what you want the agent to do |
| **Send** | Submit your goal |
| **Stop** | Halt the running agent |
| **🎤 Voice** | Speak your goal (Chrome speech recognition) |
| **📎 Attach** | Attach files for context |
| **⚙️ Settings** | Configure provider, API key, model |
| **🎨 Theme** | Switch between dark and light themes |
| **📋 Export** | Export conversation as JSON/MD/TXT |
| **🔍 Search** | Search conversation history |

### Approval Mode

Toggle between two modes:

- **Auto-approve** (default): Agent executes plans automatically
- **Manual approval**: Agent pauses before each plan for your review

For sensitive tasks (filling forms, making purchases), use manual approval mode.

---

## Cost Safety

Sentinel Override has built-in cost safeguards:

| Limit | Value |
|-------|-------|
| Max cost per API call (input) | $0.50 |
| Max cost per API call (output) | $0.50 |
| Max cost per API call (total) | $1.00 |
| Max session cost | $5.00 |

**Blocked models** (too expensive for automation):
- GPT-4/5, Claude Opus/Sonnet, Gemini Pro/Ultra, DeepSeek Pro

**Recommended affordable models:**
- `deepseek-v4-flash` — $0.17/$0.35 per 1M tokens (best value)
- `gemma-3-27b-it` — $0.12/$0.20 per 1M tokens
- `qwen3-5-9b` — $0.10/$0.15 per 1M tokens

---

## Tips for IT Professionals

### M365 Admin Portal
```
Navigate to admin.microsoft.com, find the user john.doe@company.com, and check their license assignments
```

### SonicWall Configuration
```
Go to the SonicWall management interface at 192.168.1.1, log in, and export the current firewall rules
```

### Active Directory (via web interface)
```
Open the AD web console, search for users in the Marketing OU, and extract their email addresses
```

### Ticketing Systems
```
Open ServiceNow, filter incidents assigned to my team, and extract the top 5 priority 1 tickets
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send goal |
| `Shift+Enter` | New line in goal input |
| `Escape` | Stop agent / Close modal |
| `Ctrl+F` | Search conversation |

---

## Next Steps

- **[Actions Reference](docs/ACTIONS.md)** — All available action types with examples
- **[Runbook Mode](docs/RUNBOOK_MODE.md)** — Create structured investigation workflows
- **[Advanced Features](docs/ADVANCED.md)** — execute_js, self-learning, strategy shift
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** — Common issues and fixes

---

*Sentinel Override v2.4.5 — Built for IT professionals who automate.*
