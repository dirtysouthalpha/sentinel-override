# Troubleshooting

Common issues and fixes for Sentinel Override. If you don't find your issue here, check the [GitHub Issues](https://github.com/dirtysouthalpha/sentinel-override/issues) page.

---

## Installation Issues

### Extension doesn't appear after loading

**Symptoms:** Clicked "Load unpacked" but no icon appears in the toolbar.

**Fix:**
1. Go to `chrome://extensions`
2. Verify "SentinelAgent Browser" is listed and enabled (toggle is ON)
3. Click the puzzle piece icon (🧩) in the toolbar → find Sentinel Override → click the pin icon
4. If still not visible, check for errors in the extension card — click "Errors" if shown

### "Manifest file is missing or unreadable"

**Symptoms:** Error when loading unpacked: "Manifest file is missing or unreadable."

**Fix:**
1. Make sure you selected the folder containing `manifest.json`, not a parent folder
2. Verify `manifest.json` exists in the selected folder
3. Check that `manifest.json` is valid JSON (no trailing commas, proper quotes)

### Extension loads but sidebar won't open

**Symptoms:** Clicking the icon does nothing or shows a blank panel.

**Fix:**
1. Go to `chrome://extensions`
2. Click "Service Worker" link under the extension → check console for errors
3. Try reloading the extension (circular arrow icon)
4. Make sure you're using Chrome 114+ or Edge 114+ (side panel API required)

---

## API Connection Issues

### "API key not configured"

**Symptoms:** Agent starts but immediately shows "API key not configured."

**Fix:**
1. Open the sidebar → click **⚙️ Settings**
2. Enter your API key in the **API Key** field
3. Make sure you selected the correct **Provider** (OpenRouter, Venice, z.ai)
4. Click **Save**
5. If using a custom endpoint, verify the URL is correct

### "API error: 401" or "Unauthorized"

**Symptoms:** Agent fails with a 401 error.

**Fix:**
1. Verify your API key is correct (no extra spaces, no missing characters)
2. Check that your API key hasn't expired
3. Verify your account has credits remaining
4. For OpenRouter: go to [openrouter.ai/keys](https://openrouter.ai/keys) and verify the key is active
5. For Venice: go to [venice.ai/settings](https://venice.ai/settings) and check key status

### "API error: 429" or "Rate limited"

**Symptoms:** Agent fails with a 429 error after several steps.

**Fix:**
1. The agent has built-in retry with exponential backoff — wait and try again
2. Reduce the complexity of your goal (fewer steps = fewer API calls)
3. Switch to a provider with higher rate limits
4. For OpenRouter: check your rate limit at [openrouter.ai/activity](https://openrouter.ai/activity)

### "API error: 500" or "Server error"

**Symptoms:** Agent fails with a 500 error.

**Fix:**
1. This is a provider-side issue — wait a few minutes and retry
2. Try a different model
3. Try a different provider
4. Check the provider's status page for outages

### "COST SAFETY: Model is BLOCKED"

**Symptoms:** Agent refuses to run with a specific model.

**Fix:**
1. The model is in the cost safety block list (too expensive for automation)
2. Switch to an affordable model: `deepseek-v4-flash`, `gemma-3-27b-it`, or `qwen3-5-9b`
3. If you really need the expensive model, use it manually in the provider's web interface

### "COST SAFETY: Model is NOT in Venice whitelist"

**Symptoms:** Agent refuses to run with a Venice model.

**Fix:**
1. The model isn't in the Venice allowed list
2. Choose a whitelisted model: `gemma-4-uncensored`, `grok-41-fast`, `deepseek-v4-flash`, etc.
3. See the full whitelist in `background.js` → `COST_SAFETY.VENICE_ALLOWED_MODELS`

---

## Agent Execution Issues

### Agent says "Agent already running"

**Symptoms:** Can't start a new task because the agent thinks it's still running.

**Fix:**
1. Click the **Stop** button in the sidebar
2. If Stop doesn't work, close and reopen the sidebar
3. If still stuck, reload the extension at `chrome://extensions`

### Agent gets stuck on "Observing page..."

**Symptoms:** Agent shows "Observing page..." for a long time.

**Fix:**
1. Check if the page has finished loading (look for spinner in browser tab)
2. The content script may have failed to inject — try refreshing the page
3. Check if the page is a `chrome://` or `edge://` URL (these can't be automated)
4. Click **Stop** and retry with a simpler goal

### Agent clicks the wrong element

**Symptoms:** Agent clicks the wrong button or link.

**Fix:**
1. Make your goal more specific: include the exact text or label of the element
2. Use manual approval mode to review each step before execution
3. Check if the page has multiple similar elements — be more specific in your goal

### Agent types in the wrong field

**Symptoms:** Agent types text into the wrong input field.

**Fix:**
1. Make your goal more specific: mention the field name or label
2. If the page has multiple forms, specify which one (e.g., "the login form", "the search box")
3. Use `execute_js` for precise control over which field gets the input

### Agent can't find an element

**Symptoms:** Agent reports "Element not found" for a selector.

**Fix:**
1. Check if the page has loaded completely
2. The element may be inside a shadow DOM — use `execute_js` to access it
3. The element may be dynamically generated — try adding a `wait` step before the action
4. The auto-tool system will attempt to find alternative selectors automatically

### Agent tab was closed

**Symptoms:** Agent stops with "Agent tab was closed."

**Fix:**
1. Don't close the tab the agent is working on
2. If you accidentally closed it, restart the agent on a new tab
3. The agent tracks a specific tab — it won't switch tabs automatically

---

## Content Script Issues

### Content script fails to inject

**Symptoms:** Agent can't interact with the page.

**Fix:**
1. Check if the page allows content scripts (some pages block them)
2. Try refreshing the page before starting the agent
3. Check `chrome://extensions` → click "Service Worker" → look for injection errors
4. Some pages (Chrome Web Store, Chrome settings) block content scripts entirely

### "Cannot access a chrome:// URL"

**Symptoms:** Agent can't interact with browser internal pages.

**Fix:**
1. The agent can't automate `chrome://`, `edge://`, or `about:` pages
2. Navigate to a regular web page first
3. The agent auto-detects internal pages and redirects to Google

### React/Angular/Vue inputs don't register

**Symptoms:** Agent types in a field but the app doesn't recognize the input.

**Fix:**
1. This is a known issue with SPAs — the framework's change detection doesn't see programmatic input
2. The agent uses native value setters + event dispatching to work around this
3. If it still fails, use `execute_js` with the native setter pattern (see [Advanced Features](ADVANCED.md))

---

## Cost and Billing Issues

### Session cost unexpectedly high

**Symptoms:** The cost counter shows higher than expected charges.

**Fix:**
1. Check the model you're using — some models are more expensive than others
2. The cost safety limits are: $0.50 per input, $0.50 per output, $1.00 total per call, $5.00 per session
3. Use cheaper models: `qwen3-5-9b` ($0.10/$0.15), `e2ee-qwen-2-5-7b-p` ($0.05/$0.13)
4. Keep goals simple — fewer steps = fewer API calls = lower cost

### Cost counter not updating

**Symptoms:** The session cost stays at $0.00 even after API calls.

**Fix:**
1. Cost tracking only works for Venice and OpenRouter endpoints
2. For custom/Ollama endpoints, cost tracking is disabled
3. Check the browser console for cost validation errors

---

## Export and Data Issues

### Export produces empty file

**Symptoms:** Exported file is empty or has no content.

**Fix:**
1. Make sure you have conversation history (run at least one task)
2. Try a different export format
3. Check if the browser blocked the download (look for download icon in toolbar)

### Search doesn't find results

**Symptoms:** The conversation search returns no results.

**Fix:**
1. Make sure you have conversation history to search
2. Try different search terms
3. Search is case-insensitive but requires exact word matches

---

## Performance Issues

### Agent is very slow

**Symptoms:** Each step takes a long time to execute.

**Fix:**
1. Use a faster model: `deepseek-v4-flash`, `grok-41-fast`
2. Reduce the number of steps in your goal
3. Check your internet connection — API calls are network-bound
4. The agent has a 2-second delay between steps (built-in rate limiting)

### Agent makes too many API calls

**Symptoms:** Agent uses more API calls than expected.

**Fix:**
1. Be more specific in your goal — fewer ambiguous steps
2. The agent re-reads the page on each step to understand the current state
3. Use planning mode to review steps before execution
4. Shorter goals = fewer steps = fewer API calls

---

## Browser-Specific Issues

### Edge compatibility

**Symptoms:** Extension doesn't work properly in Microsoft Edge.

**Fix:**
1. Edge is Chromium-based — the extension should work identically to Chrome
2. Make sure you're loading from `edge://extensions` (not `chrome://extensions`)
3. If side panel doesn't work, update Edge to version 114+

### Firefox not supported

**Symptoms:** Extension doesn't load in Firefox.

**Fix:**
1. Firefox uses Manifest V2 (not V3) — the current extension requires Chrome MV3
2. Firefox support is planned for a future release (see SVO-18)
3. For now, use Chrome or Edge

---

## Getting Help

If your issue isn't covered here:

1. **Check the console:** `chrome://extensions` → click "Service Worker" → check for errors
2. **Search GitHub Issues:** [github.com/dirtysouthalpha/sentinel-override/issues](https://github.com/dirtysouthalpha/sentinel-override/issues)
3. **Open a new issue:** Include the error message, steps to reproduce, and your browser/version
4. **Join the community:** [Discord](https://discord.com/invite/clawd)

---

*See also: [Getting Started](../GETTING_STARTED.md) · [Actions Reference](ACTIONS.md) · [Runbook Mode](RUNBOOK_MODE.md) · [Advanced Features](ADVANCED.md)*
