# Advanced Features

Power-user features for Sentinel Override: custom JavaScript execution, data extraction and memory, self-learning, and strategy adaptation.

---

## execute_js: Custom JavaScript Execution

When standard actions fail or you need precise control, `execute_js` lets you run arbitrary JavaScript in the page's context.

### How It Works

The agent injects your script into the page's MAIN world using `chrome.scripting.executeScript()`. The script has full access to:
- The page's DOM
- JavaScript variables and frameworks (React, Angular, Vue, jQuery)
- All browser APIs available to the page
- The page's `window` and `document` objects

### Basic Usage

```javascript
// Click an element by text content
document.querySelectorAll('button').forEach(btn => {
  if (btn.textContent.includes('Submit')) btn.click();
});
```

```javascript
// Extract all links on the page
Array.from(document.querySelectorAll('a')).map(a => ({
  text: a.textContent.trim(),
  href: a.href
}));
```

```javascript
// Fill a React-controlled input
const input = document.querySelector('input[name="email"]');
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeSetter.call(input, 'user@example.com');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

### Common Patterns

#### Interacting with SPAs (React/Angular/Vue)

Standard `.click()` and `.value` assignment often don't trigger framework change detection. Use the native setter pattern:

```javascript
// For React inputs
function setReactValue(selector, value) {
  const el = document.querySelector(selector);
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
setReactValue('input[name="username"]', 'admin');
```

#### Clicking Hidden or Overlaid Elements

```javascript
// Force click an element even if obscured
const el = document.querySelector('.hidden-button');
el.style.display = 'block';
el.style.visibility = 'visible';
el.click();
```

#### Working with Shadow DOM

```javascript
// Access shadow DOM elements
const host = document.querySelector('my-component');
const shadowRoot = host.shadowRoot;
const button = shadowRoot.querySelector('button');
button.click();
```

#### Extracting Table Data

```javascript
// Convert an HTML table to JSON
function tableToJson(tableSelector) {
  const table = document.querySelector(tableSelector);
  const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  return rows.map(row => {
    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
}
tableToJson('#user-table');
```

#### Handling Infinite Scroll

```javascript
// Scroll to bottom and wait for new content
async function scrollToBottom() {
  let lastHeight = document.body.scrollHeight;
  while (true) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 2000));
    let newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }
  return document.body.innerText;
}
scrollToBottom();
```

### Auto-Tool Generation

When a standard action fails, the agent automatically generates a JavaScript workaround:

1. Agent tries `click` on `#submit-btn` → **fails** (element not found)
2. Auto-tool system sends the error + step description to the LLM
3. LLM generates a creative workaround script
4. Script is injected into the page
5. If successful, the step is marked "auto-recovered"

**Example auto-generated script:**
```javascript
// Generated because #submit-btn wasn't found
// LLM tried aria-label, title, text content as fallback selectors
document.querySelector('[aria-label="Submit form"]').click();
```

**When auto-tool triggers:**
- Element not found by CSS selector
- Page structure changed since observation
- Framework-specific rendering issues
- Dynamic content not yet loaded

---

## Extract-and-Remember

The agent maintains persistent context across steps using `taskContext`.

### How It Works

```javascript
taskContext = {
  goal: "Extract user data from M365",
  completedSteps: [
    { step: 1, description: "Navigate to admin center", result: "navigated" },
    { step: 2, description: "Search for user", result: "found user" }
  ],
  intermediateData: {
    "structured_data": { /* extracted tables, metadata, forms */ },
    "lastPage": "https://admin.microsoft.com/users",
    "userEmail": "john.doe@company.com"
  },
  failedAttempts: [
    { step: 3, error: "Element not found: .user-details" }
  ],
  currentPhase: "executing",
  startTime: "2026-04-28T10:30:00.000Z"
};
```

### What Gets Remembered

| Data Type | Stored In | Retention |
|-----------|-----------|-----------|
| Page text content | Conversation history | Per-session |
| Structured data (tables, forms, metadata) | `intermediateData.structured_data` | Per-session |
| Successful selectors | Conversation history | Per-session |
| Failed attempts | `failedAttempts` | Per-session |
| Goal and phase | `taskContext` | Per-session |
| Conversation history | `chrome.storage.local` | Until export/clear |

### Using Extracted Data

The agent uses extracted data in subsequent steps:

```
Step 3: Search for user "john.doe@company.com"
         ↓ (email extracted from Step 2's structured_data)
Step 4: Click on the matching user row
         ↓ (selector learned from Step 3's successful click)
Step 5: Extract license assignments
         ↓ (reads the license table from the user detail page)
```

### Data Extraction Capabilities

The `extract_data` action pulls structured information:

**Tables:**
```json
{
  "tables": [{
    "headers": ["Name", "Email", "License"],
    "data": [
      ["John Doe", "john@co.com", "E5"],
      ["Jane Smith", "jane@co.com", "E3"]
    ]
  }]
}
```

**Forms:**
```json
{
  "forms": [{
    "selector": "form:nth-of-type(1)",
    "fields": [
      { "name": "username", "type": "text", "value": "", "selector": "input[name='username']" },
      { "name": "password", "type": "password", "value": "", "selector": "input[name='password']" }
    ]
  }]
}
```

**Metadata:**
```json
{
  "metadata": {
    "description": "M365 Admin Center",
    "og:title": "Microsoft 365 admin center"
  }
}
```

---

## Self-Learning (Experimental)

The agent learns from successful task executions to improve future performance.

### How It Works

1. **Task completes** → Agent stores successful selectors and strategies
2. **Similar page encountered** → Agent recalls previous solutions
3. **Faster execution** → Fewer API calls, more reliable selectors

### What Gets Learned

- **Successful selectors:** CSS selectors that worked on specific pages
- **Navigation patterns:** Common URL structures for known platforms
- **Error recovery:** Workarounds that fixed specific failures
- **Page patterns:** Site-specific knowledge (login forms, search boxes)

### Site-Specific Knowledge

The agent has built-in patterns for common platforms:

```javascript
const SITE_PATTERNS = {
  'github.com': {
    platform: 'github',
    loginSelector: '#login_field',
    passwordSelector: '#password'
  },
  'gmail.com': {
    platform: 'gmail',
    searchSelector: 'input[type="search"]'
  },
  'google.com': {
    platform: 'google',
    searchSelector: 'input[name="q"]'
  },
  'calendar.google.com': {
    platform: 'google-calendar'
  }
};
```

You can extend this by adding custom patterns for your organization's tools.

### Limitations

- Learning is per-browser session (cleared on extension reload)
- No cross-device learning (stored locally)
- Selectors may break when sites update their UI
- Experimental — reliability varies by site complexity

---

## Strategy Shift

When the agent's current approach isn't working, it can adapt its strategy.

### How It Works

The agent tracks failed attempts and adjusts its approach:

```
Attempt 1: Click #submit-btn → Failed (element not found)
Attempt 2: Auto-tool generated script → Failed (wrong element)
Strategy Shift: Try navigating directly to the form submission URL
```

### Strategy Shift Triggers

| Trigger | Adaptation |
|---------|------------|
| 2+ failures on same step | Generate alternative selector |
| Page structure unexpected | Re-observe and re-analyze |
| Authentication required | Ask user for credentials |
| Rate limited | Exponential backoff |
| Tab closed | Stop agent, report error |

### Manual Strategy Override

You can guide the agent's strategy by being more specific in your goal:

```
❌ "Get the user data"
✅ "Go to admin.microsoft.com, click Users, search for john@co.com, click the user row, and read the license info from the detail panel"
```

---

## Shortcuts System

Save frequently-used goals as shortcuts for quick access.

### Creating Shortcuts

1. Click the **📋** icon in the sidebar
2. Enter a name (e.g., `user-check`)
3. Enter the goal text
4. Click **Save**

### Using Shortcuts

Type `/user-check` in the goal input and press Enter. The saved goal is loaded and executed.

### Managing Shortcuts

Shortcuts are stored in `chrome.storage.local` under `savedShortcuts`. To manage them:

1. Open the extension sidebar
2. Click **📋** to view all shortcuts
3. Click a shortcut to edit or delete it

### Example Shortcuts

| Name | Goal |
|------|------|
| `/m365-health` | "Check M365 user health: licenses, MFA, sign-in activity" |
| `/sonicwall-audit` | "Export SonicWall firewall rules and check for disabled rules" |
| `/exchange-rules` | "Check Exchange mailbox rules for forwarding to external domains" |
| `/ad-users` | "Extract all Active Directory users from the Marketing OU" |

---

## Conversation Export

Export your automation sessions for documentation, auditing, or sharing.

### Export Formats

| Format | Use Case |
|--------|----------|
| **JSON** | Programmatic processing, data analysis |
| **Markdown** | Documentation, wikis, READMEs |
| **Plain Text** | Simple sharing, email, chat |

### What Gets Exported

- Your original goal
- The agent's plan (if planning mode)
- Every step's action, result, and status
- Extracted data (tables, forms, metadata)
- Timestamps for each step
- Total session cost and API call count

### Export Process

1. Click **📋 Export** in the sidebar
2. Select your format
3. Choose what to include (steps, data, costs)
4. Download or copy to clipboard

---

## Voice Input

Use speech recognition to dictate goals hands-free.

### Setup

1. Click the **🎤** button in the sidebar
2. Grant microphone permission when prompted
3. Speak your goal clearly
4. The text appears in the input field
5. Review and press Send

### Tips for Voice Input

- Speak clearly and at a moderate pace
- Use specific names: "M365 admin center" not "the admin portal"
- Pause between sentences
- Review the transcription before sending — speech recognition isn't perfect

### Browser Support

Voice input uses the Web Speech API:
- ✅ Chrome (full support)
- ✅ Edge (full support)
- ❌ Firefox (not supported)
- ❌ Safari (not supported)

---

## File Attachments

Attach files to provide context for your automation tasks.

### Supported File Types

- **Images** (PNG, JPG, GIF, WebP) — Analyzed by vision-capable models
- **Text files** (TXT, CSV, JSON, XML) — Read as context
- **Documents** (PDF) — Extracted and analyzed

### How to Attach

1. Click the **📎** button in the sidebar
2. Select one or more files
3. Files appear as previews below the input
4. Type your goal and press Send

### Use Cases

- Attach a screenshot of an error message for troubleshooting
- Attach a CSV of users to look up in M365
- Attach a JSON config to verify against the current system state

---

*See also: [Getting Started](../GETTING_STARTED.md) · [Actions Reference](ACTIONS.md) · [Runbook Mode](RUNBOOK_MODE.md) · [Troubleshooting](TROUBLESHOOTING.md)*
