# Architecture

**Analysis Date:** 2026-04-24

## Pattern Overview

**Overall:** Event-Driven Chrome Extension with Centralized Agent Loop

**Key Characteristics:**
- Chrome Manifest V3 architecture with service worker and content scripts
- Single-threaded event loop for agent execution
- Message passing between background, content scripts, and UI
- Centralized state management via Chrome storage API

## Layers

### Background Service Worker (`background.js`)
- Purpose: Core agent engine, API integration, tab management, self-healing logic
- Location: `C:\Users\brandon.goolsby\Downloads\sentinel-override-v3.1.3\background.js`
- Contains: Agent loop planning, API calls, retry logic, platform detection
- Depends on: Chrome APIs (tabs, storage, messaging, debugger), content scripts
- Used by: Content scripts (message requests), UI popup (message responses)

### Content Script (`content.js`)
- Purpose: DOM interaction, element scanning, action execution
- Location: `C:\Users\brandon.goolsby\Downloads\sentinel-override-v3.1.3\content.js`
- Contains: Element scanning, action handlers, iframe support
- Depends on: Document DOM, Chrome messaging API
- Used by: Background service worker (command execution)

### UI Layer (`popup.html` + `popup-full.js`)
- Purpose: User interface, chat interface, settings, themes
- Location: `C:\Users\brandon.goolsby\Downloads\sentinel-override-v3.1.3\popup.html`, `popup-full.js`
- Contains: Chat interface, settings modal, theme customization, command palette
- Depends on: Chrome storage, messaging APIs, marked.js for markdown
- Used by: User interaction

## Data Flow

### 1. Task Initiation
```
User Input → popup-full.js → chrome.runtime.sendMessage → background.js (run_agent_loop)
```

### 2. Agent Loop Execution
```
background.js:
├── Generate plan (optional)
├── Loop while agentRunning:
│   ├── Get tab info
│   ├── Wait for page load
│   ├── Inject content script
│   ├── Observe page (content.js)
│   ├── Take screenshot
│   ├── Call LLM API
│   ├── Execute command (content.js)
│   ├── Track success/failure
│   └── Update state
└── Send results to UI
```

### 3. Command Execution Flow
```
background.js → chrome.scripting.executeScript → content.js
content.js → Execute action → Return result
```

### 4. Self-Healing Flow
```
Action Failure → consecutiveFailures++ → Strategy Shift → Try new approach
```

## Key Abstractions

### Agent State Manager
- Purpose: Maintains agent execution state across iterations
- Location: `background.js` (agentRunning, agentMemory, agentPlan variables)
- Pattern: Centralized state with Chrome storage persistence

### Platform Context Detector
- Purpose: Detects enterprise UI patterns and injects guidance
- Location: `getPlatformContext()` in `background.js`
- Examples: SonicWall, Fortinet, Cisco, Palo Alto specific rules
- Pattern: Strategy pattern with platform-specific implementations

### Self-Healing System
- Purpose: Automatically retries failed actions with different strategies
- Location: `consecutiveFailures` tracking and strategy shift prompts
- Pattern: Retry with exponential backoff and strategy variation

### Memory System
- Purpose: Carries extracted data between pages and sessions
- Location: `agentMemory` object and Chrome storage
- Pattern: Key-value storage with template substitution ({{key}})

## Entry Points

### Extension Entry Point (`manifest.json`)
- Location: `C:\Users\brandon.goolsby\Downloads\sentinel-override-v3.1.3\manifest.json`
- Triggers: Icon click opens side panel, action button opens UI
- Responsibilities: Service worker registration, permissions declaration

### Background Service Worker Entry Points
- `chrome.runtime.onMessage`: Handles all agent control messages
- `chrome.action.onClicked`: Opens side panel when icon clicked
- `chrome.runtime.onInstalled`: Handles migration tasks

### UI Entry Point (`popup-full.js`)
- `window.addEventListener('DOMContentLoaded')`: Initializes the application
- Event listeners for all UI interactions (send, stop, settings, etc.)

## Error Handling

**Strategy:** Multi-layered with retry and fallback mechanisms

**Patterns:**
1. Content script injection failures → Retry with timeout
2. API timeouts → Retry with exponential backoff
3. Invalid selectors → Re-ask LLM with updated element list
4. Navigation failures → Auto-recovery and tab management

## Cross-Cutting Concerns

**Logging:** Console logging for debugging, UI updates for user feedback

**Validation:** URL validation, selector validation against scanned elements

**Authentication:** None required - relies on externally configured API keys

---

*Architecture analysis: 2026-04-24*