# Actions Reference

Complete reference for all Sentinel Override action types. Actions are the building blocks of every automation task — the agent selects and executes them based on your goal.

---

## Core Actions

These are the primary action types the agent uses to interact with web pages.

---

### 1. `click`

Click an element on the page.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | Yes | CSS selector targeting the element |

**Example:**
```json
{
  "type": "click",
  "selector": "button#submit-btn"
}
```

**How it works:**
- Scrolls the element into view
- Fires a native `.click()` event
- Returns success/failure based on whether the element was found

**Common use cases:**
- Clicking buttons, links, tabs, menu items
- Submitting forms
- Expanding collapsible sections
- Acknowledging dialogs or cookie banners

**Tips:**
- The agent prefers text-based selectors (e.g., `button:has-text("Submit")`) when possible
- If a click fails, the auto-tool system generates alternative selectors using `aria-label`, `title`, or text content

---

### 2. `type`

Type text into an input field.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | Yes | CSS selector targeting the input |
| `text` | string | Yes | Text to type |

**Example:**
```json
{
  "type": "type",
  "selector": "input[name='q']",
  "text": "Windows Server 2025"
}
```

**How it works:**
- Scrolls the element into view and focuses it
- Uses the native value setter (avoids React/Angular issues)
- Dispatches `input` and `change` events to trigger framework handlers
- Works with `<input>`, `<textarea>`, and contenteditable elements

**Common use cases:**
- Filling search boxes
- Entering usernames and passwords
- Typing into form fields
- Adding comments or notes

**Tips:**
- For password fields, the agent may pause and use `ask_user` to request the password from you
- On SPAs (React, Angular, Vue), the native setter ensures the framework detects the change

---

### 3. `navigate`

Navigate the browser to a URL.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Full URL to navigate to |

**Example:**
```json
{
  "type": "navigate",
  "url": "https://admin.microsoft.com"
}
```

**How it works:**
- Updates the active tab's URL via `chrome.tabs.update()`
- Waits 2–3 seconds for page load
- Validates the URL format before navigating

**Common use cases:**
- Opening web applications
- Navigating between pages in a workflow
- Going directly to a specific admin portal
- Returning to a previous page

**Tips:**
- Always include the full URL with `https://`
- The agent auto-detects internal pages (`chrome://`, `edge://`) and redirects to Google

---

### 4. `scroll`

Scroll the page vertically.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | integer | Yes | Pixels to scroll (positive = down, negative = up) |

**Example:**
```json
{
  "type": "scroll",
  "amount": 500
}
```

**How it works:**
- Calls `window.scrollBy(0, amount)` on the page
- No element targeting needed — scrolls the entire viewport

**Common use cases:**
- Scrolling down to load more content (infinite scroll)
- Navigating to a section below the fold
- Scrolling back up to review previous content
- Triggering lazy-loaded elements

**Tips:**
- Use positive values to scroll down, negative to scroll up
- Common values: 300 (small scroll), 500 (medium), 1000 (large)
- For infinite scroll, the agent may scroll multiple times with pauses

---

### 5. `read_page`

Read the current page content.

**Parameters:** None

**Example:**
```json
{
  "type": "read_page"
}
```

**How it works:**
- Extracts `document.body.innerText` (visible text)
- Includes page title and current URL
- Returns the full text content as a string

**Common use cases:**
- Confirming page state after navigation
- Reading text content for extraction
- Verifying that a previous action had the expected effect
- Getting the current page context for the next step

**Tips:**
- This is a passive action — it doesn't modify the page
- The agent uses this to "look" at the page before deciding the next action
- For structured data, the agent uses `extract_data` internally

---

### 6. `scroll` (up)

Scroll up by using a negative amount.

**Example:**
```json
{
  "type": "scroll",
  "amount": -500
}
```

Same as `scroll` above, but with a negative value.

---

## Planning Actions

These actions are used during the planning phase, before execution.

---

### 7. `ask_user`

Pause execution and ask the user for input.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | Yes | What to ask the user |

**Example:**
```json
{
  "type": "ask_user",
  "description": "What is your M365 admin password?"
}
```

**How it works:**
- Agent pauses and displays the question in the sidebar
- User provides the answer manually
- Agent resumes with the user's input

**Common use cases:**
- Requesting passwords or credentials
- Asking for clarification on ambiguous goals
- Confirming destructive actions before executing
- Getting domain-specific information the agent can't find

---

### 8. `wait`

Wait for a specified duration.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `duration` | integer | No | Seconds to wait (default: 2) |

**Example:**
```json
{
  "type": "wait",
  "duration": 5
}
```

**How it works:**
- Pauses execution for the specified number of seconds
- Used when the agent knows a page needs time to load or process

**Common use cases:**
- Waiting for AJAX content to load
- Pausing after form submission
- Allowing animations or transitions to complete
- Rate limiting between rapid actions

---

### 9. `finish`

Signal that the task is complete.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `summary` | string | Yes | Brief description of what was accomplished |

**Example:**
```json
{
  "type": "finish",
  "summary": "Extracted 5 user accounts from M365 admin portal"
}
```

**How it works:**
- Terminates the agent loop
- Displays the summary in the sidebar
- Clears the conversation history from storage
- Stops the agent tab tracking

---

## Internal Actions

These actions are used internally by the agent and content scripts. You don't need to invoke them directly, but understanding them helps with debugging.

---

### 10. `observe_page`

Scan the page for interactive elements.

**How it works:**
- Finds all `button`, `a`, `input`, `select`, `textarea`, and ARIA role elements
- Returns each element's tag, text, selector, role, and type
- Used by the agent to understand what can be clicked/typed

**Returns:**
```json
{
  "elements": [
    {
      "index": 0,
      "tag": "BUTTON",
      "text": "Submit",
      "selector": "button:nth-of-type(1)",
      "role": "none",
      "type": "submit"
    }
  ]
}
```

---

### 11. `extract_data`

Extract structured data from the page.

**How it works:**
- Extracts tables as `{ headers, data }` arrays
- Extracts `<meta>` tags as key-value pairs
- Extracts forms with field names, types, values, and selectors
- Includes page URL and title

**Returns:**
```json
{
  "tables": [
    {
      "headers": ["Name", "Email", "Role"],
      "data": [
        ["John Doe", "john@example.com", "Admin"],
        ["Jane Smith", "jane@example.com", "User"]
      ]
    }
  ],
  "metadata": {
    "description": "Page description",
    "og:title": "Page Title"
  },
  "forms": [
    {
      "selector": "form:nth-of-type(1)",
      "fields": [
        { "name": "username", "type": "text", "value": "", "selector": "input[name='username']" }
      ]
    }
  ],
  "url": "https://example.com/page",
  "title": "Page Title"
}
```

---

### 12. `execute_js`

Execute custom JavaScript in the page context.

**How it works:**
- Injects a script into the page's MAIN world
- Can access all DOM APIs, variables, and frameworks
- Returns the result of the last expression
- Used by auto-tool generation when standard actions fail

**Safety notes:**
- Scripts run in the page's context, not the extension's
- Be cautious with scripts on pages containing sensitive data
- The auto-tool system generates scripts only when a step fails

---

### 13. `plan_task`

Decompose a goal into a step-by-step plan.

**How it works:**
- Sends the goal to the LLM with a structured prompt
- LLM returns a JSON plan with 2–8 steps
- Plan is displayed in the sidebar for approval
- Each step has an action type and description

**Returns:**
```json
{
  "plan_title": "M365 User Lookup",
  "steps": [
    { "step_number": 1, "action_type": "navigate", "description": "Go to M365 admin center" },
    { "step_number": 2, "action_type": "type", "description": "Search for user" },
    { "step_number": 3, "action_type": "click", "description": "Click on user result" },
    { "step_number": 4, "action_type": "read_page", "description": "Extract user details" }
  ],
  "estimated_steps": 4,
  "warnings": []
}
```

---

## Auto-Recovery Actions

When a step fails, the agent attempts automatic recovery.

---

### 14. `generateMissingTool`

Auto-generate a JavaScript workaround for a failed step.

**How it works:**
- Triggers when a standard action fails (e.g., element not found)
- Sends the error and step description to the LLM
- LLM generates a short JavaScript snippet (max 15 lines)
- Snippet is injected into the page to attempt recovery
- If successful, the step is marked as "auto-recovered"

**Example scenario:**
1. Agent tries `click` on `#submit-btn` → fails (element not found)
2. Auto-tool generates: `document.querySelector('[aria-label="Submit"]').click()`
3. Recovery succeeds → step marked complete

**When it triggers:**
- Element not found by CSS selector
- Page structure changed since observation
- Framework-specific rendering issues

---

### 15. `self_learn` (Experimental)

Remember successful patterns for future tasks.

**How it works:**
- After a task completes, the agent stores successful selectors and strategies
- On similar pages in future tasks, the agent recalls previous solutions
- Reduces API calls and improves reliability over time

**Status:** Experimental — currently implemented via `taskContext.intermediateData` and conversation history.

---

## Action Selection Guide

The agent chooses actions based on the goal and current page state:

| Situation | Likely Action |
|-----------|---------------|
| Need to go to a website | `navigate` |
| Need to fill a form field | `type` |
| Need to click a button/link | `click` |
| Need to see more content | `scroll` |
| Need to confirm page state | `read_page` |
| Need user input | `ask_user` |
| Need to wait for loading | `wait` |
| Goal achieved | `finish` |
| Standard action failed | `generateMissingTool` |

---

## Cost per Action

Approximate API costs per action (using `deepseek-v4-flash`):

| Action | Est. Input Tokens | Est. Cost |
|--------|-------------------|-----------|
| `click` | ~2,000 | ~$0.0003 |
| `type` | ~2,000 | ~$0.0003 |
| `navigate` | ~1,500 | ~$0.0003 |
| `scroll` | ~2,000 | ~$0.0003 |
| `read_page` | ~3,000 | ~$0.0005 |
| `plan_task` | ~2,500 | ~$0.0004 |
| `extract_data` | ~1,000 | ~$0.0002 |

A typical 5-step task costs approximately **$0.002** (~$0.20 per 1,000 tasks).

---

*See also: [Getting Started](../GETTING_STARTED.md) · [Runbook Mode](RUNBOOK_MODE.md) · [Advanced Features](ADVANCED.md) · [Troubleshooting](TROUBLESHOOTING.md)*
