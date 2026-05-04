# Phase 4: Reports & Multi-Provider LLM - Research

**Researched:** 2026-05-04
**Domain:** Chrome extension LLM abstraction, report generation, provider switching UI
**Confidence:** HIGH

## Summary

Phase 4 introduces two independent capabilities: structured report generation after agent task completion, and multi-provider LLM support with UI-based switching between Claude (Anthropic) and OpenAI.

**Multi-provider LLM** is largely already implemented. The current `llm-client.js` already handles both Anthropic and OpenAI API formats (different headers, different request body structures, different response parsing). The `isAnthropicEndpoint()` function detects native Anthropic endpoints and routes accordingly. What is missing is: (1) a proper provider abstraction layer so adding new providers or changing settings is clean, (2) dedicated per-provider configuration in the UI (currently a single endpoint/key/model), (3) per-provider system prompt tweaks, and (4) mid-task provider switching with context bridging.

**Report generation** is entirely new. The agent currently produces a `command.summary` text on finish (line 386 of agent-engine.js) which is sent as a plain text message to the popup. The agent has rich execution data available -- `history[]` array with every step, action, and result; `agentMemory{}` with extracted data; `agentPlan[]` with the original plan; and tab contexts with screenshots. This data needs to be assembled into a structured report by either (a) a dedicated LLM call after task completion, or (b) a template-based approach using the existing data. The CONTEXT.md decision favors an LLM-generated report with fixed base sections.

These two features are fully independent and can be planned/executed in parallel.

**Primary recommendation:** Split into two tracks -- Provider Abstraction (LLM-01/02/03) and Report Generation (RPT-01/02/03). Provider abstraction is ~60% complete already; report generation is greenfield.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| marked.min.js | existing (bundled) | Markdown rendering in popup | Already in codebase, used for chat messages and reports |
| chrome.storage.local | Chrome API | Persistent settings and report data | Already in codebase, no alternative in extension context |
| chrome.runtime.sendMessage | Chrome API | Background-to-popup communication | Already in codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | -- | -- | No new external dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-provider chrome.storage keys | Single provider object | Single object is cleaner for save/load; per-key adds migration burden |
| LLM-generated report | Template-based report | LLM gives adaptive subsections per CONTEXT.md decision; template is faster but rigid |
| Dedicated report LLM call | Reuse finish summary | Finish summary is too brief; report needs structured sections with evidence |

**Installation:** No new dependencies. Everything uses existing Chrome APIs and bundled marked.js.

## Architecture Patterns

### Recommended Project Structure (Changes Only)

```
background/
  llm-client.js          # MODIFY: extract provider abstraction, add generateReport()
  agent-engine.js        # MODIFY: capture richer finish data, call report generation
  message-protocol.js    # MODIFY: add report-related message types
  report-generator.js    # NEW: report generation logic (prompt construction, formatting)
  provider-registry.js   # NEW: provider config, detection, system prompt tweaks
popup-full.js            # MODIFY: add providers section in settings, report modal, export
popup.html               # MODIFY: add providers UI, report modal HTML
```

### Pattern 1: Provider Registry (Provider Abstraction)

**What:** A registry object that maps provider IDs to their API configuration (endpoint patterns, header builders, body builders, response parsers, system prompt tweaks).

**When to use:** Every LLM call goes through the registry instead of inline `if (isAnthropic)` checks.

**Current state:** `llm-client.js` already has two code paths for Anthropic vs OpenAI, duplicated in `callLLM()` (lines 422-461), `generatePlan()` (lines 196-228), and the popup's `testConnectionBtn` handler (lines 1256-1263). This is the code that needs to be consolidated.

**Example (from existing codebase analysis):**
```javascript
// Current pattern in llm-client.js (line 422):
const useAnthropic = isAnthropicEndpoint(endpoint);
if (useAnthropic) {
  // Anthropic-specific request body and headers
  requestBody = JSON.stringify({ model, max_tokens: 8000, system: '...', messages: [...] });
  requestHeaders = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
} else {
  // OpenAI-compatible request body and headers
  requestBody = JSON.stringify({ model, messages: [...], max_tokens: 8000 });
  requestHeaders = { 'Authorization': `Bearer ${apiKey}` };
}

// Proposed pattern -- provider registry:
const PROVIDERS = {
  anthropic: {
    match: (endpoint) => endpoint?.includes('api.anthropic.com'),
    buildHeaders: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
    buildBody: (model, systemPrompt, messages, opts) => ({
      model, max_tokens: opts.maxTokens, system: systemPrompt, messages
    }),
    parseResponse: (data) => data.content?.find(b => b.type === 'text')?.text,
    buildVisionContent: (text, base64Image) => [
      { type: 'text', text },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } }
    ],
    systemPromptTweak: 'You are Sentinel Override, a precise web automation agent. Return ONLY valid JSON.'
  },
  openai: {
    match: () => true, // default/fallback
    buildHeaders: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}` }),
    buildBody: (model, systemPrompt, messages, opts) => ({
      model, max_tokens: opts.maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content,
    buildVisionContent: (text, base64Image) => [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
    ],
    systemPromptTweak: 'You are Sentinel Override, a precise web automation agent. Return ONLY valid JSON.'
  }
};
```

### Pattern 2: Report Data Capture

**What:** When the agent finishes (type: 'finish'), capture the full execution context -- history, memory, plan, step count, timestamps -- and pass it to a report generator function.

**When to use:** On every `command.type === 'finish'` in the agent loop.

**Current state:** Agent-engine.js line 368-388 handles finish. Currently builds `finalSummary` from `command.summary` and `agentMemory`, then sends `agent_finished` message. The `history[]` array is available but gets cleared on success (line 684). The `agentPlan[]` is available. Tab contexts with screenshots are available via `getAllTabContexts()`.

**Key data available at finish time:**
```javascript
// From agent-engine.js runAgentLoop scope:
history           // Array of { step, action: {type, selector, text, url}, result }
agentPlan         // Array of plan step strings (or null)
currentPlanStep   // Which plan step was active
stepCount         // Total steps executed
goal              // The original user goal string
agentMemory       // { key: value } extracted data
apiCallCount      // Number of LLM calls made
// From tab-context.js:
getAllTabContexts() // TabContext objects with snapshots and screenshot caches
```

### Pattern 3: Report Generation LLM Call

**What:** After the agent finishes, make a separate LLM call to generate a structured report from the captured execution data. The LLM produces markdown with fixed sections (Goal, Steps Taken, Key Findings, Evidence, Conclusions).

**When to use:** After `agent_finished` is triggered, before clearing history.

**Important:** The report LLM call must NOT clear `agent_history` before it runs. Currently line 684 clears it after finish. The report call needs to happen before that clear, or the data must be saved separately.

### Pattern 4: Report UI (Inline Card + Modal)

**What:** The report appears as an inline card in the chat feed (similar to existing action cards). Clicking it opens a full-screen modal with the complete report and export options.

**Current state:** The popup already has `addActionCard()`, `addMessage()` with markdown rendering via `marked.parse()`, and export functionality (lines 770-806) supporting markdown, JSON, and plain text formats. The existing `export-format` select and `exportBtn` handler can be extended.

**Example (report card in chat feed):**
```javascript
// Similar to existing addMessage but with report-specific styling
function addReportCard(report) {
  const group = document.createElement('div');
  group.className = 'message-group report-group';
  // ... header with "Investigation Report" title
  // ... summary preview (truncated)
  // ... "View Full Report" button -> opens modal
  // ... export buttons (copy markdown, download .md, copy plain text)
  chatContainer.appendChild(group);
}
```

### Pattern 5: Provider Settings UI

**What:** A dedicated "Providers" section in the settings modal with per-provider cards. Each card has: provider name, API key, model, custom endpoint, and a validate button.

**Current state:** Settings modal (popup.html lines 1760-1836) has single fields for endpoint, key, model. The preset buttons already demonstrate a multi-provider concept. The save handler (popup-full.js lines 602-629) writes to `chrome.storage.local`.

**Proposed storage structure:**
```javascript
// chrome.storage.local keys:
{
  // Current active provider
  active_provider: 'anthropic',  // or 'openai', or 'custom'

  // Per-provider configuration
  providers: {
    anthropic: {
      api_key: 'sk-ant-...',
      model: 'claude-haiku-4-5-20251001',
      endpoint: 'https://api.anthropic.com/v1/messages',  // default, overridable
      max_tokens: 8000,
      temperature: 0.3
    },
    openai: {
      api_key: 'sk-...',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1/chat/completions',  // default
      max_tokens: 8000,
      temperature: 0.3
    }
  },

  // Backward compatibility: existing single-provider keys
  api_endpoint: '...',  // still read as fallback
  api_key: '...',
  model: '...'
}
```

### Anti-Patterns to Avoid

- **Don't duplicate provider logic:** The current code has Anthropic/OpenAI branching in 3 places (callLLM, generatePlan, testConnectionBtn). Consolidate into the provider registry.
- **Don't clear history before report generation:** The `history[]` array is the primary data source for the report. It gets cleared at line 684 of agent-engine.js after `finished`. Report generation must happen before that.
- **Don't make report generation blocking:** The report LLM call should happen after the user sees "Task completed" -- not before. The finish message should appear immediately, then the report card appears when ready.
- **Don't store screenshots in chrome.storage:** Screenshots are base64 and large. They should stay in the in-memory TabContext screenshot cache during report generation, then be released. Only text references to screenshots (by step number) go into the persistent report.
- **Don't break backward compatibility:** Existing users have `api_endpoint`, `api_key`, `model` in storage. The new provider system must fall back to these keys if no `providers` object exists.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom markdown-to-HTML | marked.min.js (already bundled) | Already handles GFM, code blocks, tables |
| Markdown export | Custom file writer | Blob + URL.createObjectURL (already in codebase, line 797) | Existing pattern at popup-full.js lines 770-806 |
| API key validation | Custom validation logic | Existing testConnectionBtn pattern (popup-full.js lines 1240-1278) | Already sends a test request and shows success/error |
| Clipboard copy | Custom clipboard code | navigator.clipboard.writeText (already in codebase, line 389) | Already used for message copy buttons |

**Key insight:** The codebase already has all the building blocks -- markdown rendering, export to file/clipboard, connection testing, provider presets. Phase 4 is primarily about wiring these together with proper abstraction, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Clearing History Before Report Generation
**What goes wrong:** The `history[]` array is the primary data source for the report. Agent-engine.js line 684 clears it (`if (finished) await chrome.storage.local.set({ agent_history: [], agent_memory: {} })`). If report generation is triggered after this line, the data is gone.
**Why it happens:** The finish handler clears state as part of cleanup.
**How to avoid:** Either (a) save the history to a separate `report_data` key before clearing, or (b) generate the report before the cleanup line, or (c) move the cleanup to happen after report generation completes.
**Warning signs:** Report shows empty steps, missing findings, no evidence.

### Pitfall 2: Backward Compatibility with Single-Provider Settings
**What goes wrong:** Existing users have `api_endpoint`, `api_key`, `model` as top-level keys. If the new code only reads from `providers.active_provider` and `providers[active_provider]`, existing users will see a blank settings form.
**Why it happens:** New storage schema doesn't account for existing data.
**How to avoid:** On settings load, check if `providers` key exists. If not, migrate existing `api_endpoint`/`api_key`/`model` into the new structure. Always fall back to reading the old keys.
**Warning signs:** Settings appear empty after upgrade; API calls fail with "no key configured".

### Pitfall 3: Report LLM Call Fails Silently
**What goes wrong:** The report generation LLM call hits a rate limit, timeout, or API error. The user sees "Task completed" but no report appears, with no error indication.
**Why it happens:** The report call is fire-and-forget after the main agent loop ends.
**How to avoid:** Show a "Generating report..." status, then either show the report card or show an error toast with a "Retry" button. Use the existing `callLLMWithRetry` pattern for the report call too.
**Warning signs:** User reports "report never shows up".

### Pitfall 4: Mid-Task Provider Switch Loses Context
**What goes wrong:** User switches from Claude to OpenAI mid-task. The new provider has no context from the previous conversation. The agent repeats steps or produces incoherent actions.
**Why it happens:** Provider switch only changes the API endpoint; conversation history format may differ.
**How to avoid:** Per CONTEXT.md decision: keep conversation history and prepend a context bridge summary. The history format is provider-agnostic (it's the same JSON action objects). The system prompt may need provider-specific tweaks.
**Warning signs:** Agent starts repeating actions after provider switch.

### Pitfall 5: Provider Detection False Positives
**What goes wrong:** `isAnthropicEndpoint()` currently only checks for `api.anthropic.com` in the URL. If a user uses a proxy or custom endpoint that serves Anthropic-format responses, the code treats it as OpenAI format.
**Why it happens:** Detection is URL-based, not format-based.
**How to avoid:** Add a `provider_format` field to the provider config that explicitly sets 'anthropic' or 'openai'. The registry should check this field first, then fall back to URL detection.
**Warning signs:** Anthropic proxy endpoints return parsing errors.

### Pitfall 6: Report Modal Z-Index / Layering Issues
**What goes wrong:** Report modal appears behind the settings modal or behind other UI elements.
**Why it happens:** The existing settings modal and theme modal use `.modal` and `.show` classes. A new report modal needs proper z-index stacking.
**How to avoid:** Use a consistent modal pattern (reuse `.modal` class) and ensure only one modal is shown at a time. Close other modals before opening the report modal.
**Warning signs:** Report modal is not clickable; appears behind other elements.

## Code Examples

### Current Provider Handling (3 locations that need consolidation)

```javascript
// LOCATION 1: llm-client.js callLLM() lines 422-461
const useAnthropic = isAnthropicEndpoint(endpoint);
if (useAnthropic) {
  // ... Anthropic request body and headers
} else {
  // ... OpenAI request body and headers
}

// LOCATION 2: llm-client.js generatePlan() lines 196-228
const useAnthropic = isAnthropicEndpoint(endpoint);
const planBody = useAnthropic ? /* Anthropic format */ : /* OpenAI format */;
const planHeaders = useAnthropic ? /* Anthropic headers */ : /* OpenAI headers */;

// LOCATION 3: popup-full.js testConnectionBtn lines 1256-1263
const isAnthropic = endpoint.includes('api.anthropic.com');
const headers = isAnthropic ? /* Anthropic headers */ : /* OpenAI headers */;
const body = isAnthropic ? /* Anthropic body */ : /* OpenAI body */;
```

### Current Finish Handler (agent-engine.js lines 368-388)

```javascript
// This is where report generation hooks in
if (command.type === 'finish') {
  finished = true;
  consecutiveFailures = 0;
  sendSilentUpdate('Task complete', stepCount);

  let finalSummary = command.summary || '';
  const memKeys = Object.keys(agentMemory);
  if (memKeys.length > 0) {
    const memLines = memKeys.map(k => {
      const val = agentMemory[k];
      const valStr = Array.isArray(val)
        ? val.slice(0, 10).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ')
        : String(val).substring(0, 300);
      return `- ${k}: ${valStr}`;
    }).join('\n');
    finalSummary += `\n\n---\n**Extracted Data (from investigation):**\n${memLines}`;
  }

  chrome.runtime.sendMessage({ action: 'agent_finished', summary: finalSummary }).catch(() => {});
  // REPORT GENERATION SHOULD HAPPEN HERE, BEFORE line 684 clears history
  saveLearnedPattern(goal, history, true);
  break;
}

// Line 684 -- THIS CLEARS THE DATA
if (finished) await chrome.storage.local.set({ agent_history: [], agent_memory: {} });
```

### Current Export Handler (popup-full.js lines 770-806)

```javascript
// This pattern is reused for report export
exportBtn.addEventListener('click', () => {
  if (conversationHistory.length === 0) {
    showToast('No messages to export', 'error');
    return;
  }
  const format = exportFormatSelect.value;
  let content, filename, mimeType;
  if (format === 'markdown') {
    content = conversationHistory
      .map(turn => `### ${turn.role === 'user' ? 'User' : 'Agent'}\n\n${turn.text}`)
      .join('\n\n---\n\n');
    filename = `conversation-${Date.now()}.md`;
    mimeType = 'text/markdown';
  }
  // ... json and txt formats
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});
```

### Current Agent Finished Handler in Popup (popup-full.js lines 1203-1213)

```javascript
// This is where the report card gets inserted
if (message.action === 'agent_finished') {
  removeTypingIndicator();
  removeApprovalCard();
  renderTabBar([]);
  try {
    addMessage('Task completed!\n\n' + (message.summary || 'Done'), 'assistant');
    // REPORT CARD SHOULD BE ADDED HERE (after the completion message)
  } catch (err) {
    console.error('Error displaying completion message:', err);
  }
  resetUI();
}
```

## Parallelization Analysis

Reports and multi-provider LLM are **fully independent** and can be developed in parallel:

| Track | Requirements | Files Modified | New Files | Dependencies |
|-------|-------------|----------------|-----------|--------------|
| **A: Provider Abstraction** | LLM-01, LLM-02, LLM-03 | llm-client.js, popup-full.js, popup.html, agent-engine.js (minor) | provider-registry.js | None |
| **B: Report Generation** | RPT-01, RPT-02, RPT-03 | agent-engine.js, popup-full.js, popup.html, message-protocol.js | report-generator.js | None |

**No shared code changes** between the two tracks, except potentially `popup.html` (both add UI sections to different parts of the settings modal and chat feed).

**Recommended plan count:** 2 plans (one per track), each self-contained.

## Security Considerations

### API Key Storage (HIGH confidence -- from codebase analysis)
- Current: API keys stored in `chrome.storage.local` as plain text. This is the standard Chrome extension pattern -- `chrome.storage.local` is encrypted at rest by Chrome on platforms that support it (Chrome OS, macOS, Windows with encryption enabled).
- Provider abstraction should NOT change this pattern. Adding per-provider keys is the same security posture as the current single key.
- The `type="password"` input in the settings modal already masks the key visually.
- No additional encryption layer is needed for v1 (CONCERNS.md notes this as a recommendation for v2).

### Provider Endpoint Validation (HIGH confidence)
- Current: `isValidUrl()` check in popup-full.js line 614. Basic URL parsing.
- New: Each provider's default endpoint should be hardcoded. Custom endpoints should be validated as URLs. The existing `testConnectionBtn` pattern (sends a minimal request) is the right validation approach.
- Prevent: Users setting endpoints to non-HTTPS URLs (though Chrome extensions can make HTTP requests to any URL with host_permissions).

### Report Data Sanitization (MEDIUM confidence)
- Reports contain data extracted from web pages. The report content is generated by the LLM and rendered via `marked.parse()` with `sanitizeHtml()`.
- The existing `sanitizeHtml()` function (popup-full.js lines 1124-1138) removes script tags, event handlers, and dangerous elements.
- Report content should pass through the same sanitization before rendering.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline provider if/else | Provider registry pattern | Phase 4 | Cleaner abstraction, easier to add providers |
| Single provider config | Per-provider config with active selection | Phase 4 | Users can switch without re-entering credentials |
| Plain text finish summary | Structured markdown report | Phase 4 | Copy-paste ready for ticket documentation |
| Export entire conversation | Export report separately | Phase 4 | Reports are standalone documents |

## Open Questions

1. **Report generation: dedicated LLM call or template-based?**
   - What we know: CONTEXT.md says "fixed base sections with adaptive subsections generated by the LLM" -- this implies an LLM call.
   - What's unclear: The exact prompt engineering for report generation. How much history to include (full 40 entries? condensed?). How to handle screenshots in the report context.
   - Recommendation: Use a dedicated LLM call with the full history array (already capped at 40 entries by CONFIG). Include `agentMemory` and `agentPlan` in the prompt. Ask the LLM to identify "key findings" vs routine steps. Don't include raw screenshots -- reference them by step number.

2. **Should report generation block the finish flow?**
   - What we know: User expects to see "Task completed" immediately.
   - What's unclear: Whether to show a "Generating report..." indicator or make it truly async.
   - Recommendation: Per CONTEXT.md: "auto-generate brief summary on task complete; expandable to full report." Show the finish message immediately, then async-generate the full report card. If the report call fails, show the finish summary as a fallback.

3. **Provider system prompt tweaks: what's different per provider?**
   - What we know: Both providers get the same agent instructions. The difference is formatting (JSON output expectations).
   - What's unclear: Whether Claude and GPT-4o need genuinely different system prompts for optimal JSON output.
   - Recommendation: Start with identical system prompts. Only add provider-specific tweaks if testing reveals output format issues (e.g., one provider wrapping JSON in markdown code blocks more often).

## Sources

### Primary (HIGH confidence)
- Codebase analysis of `background/llm-client.js` (564 lines) -- full provider handling, API call patterns
- Codebase analysis of `background/agent-engine.js` (752 lines) -- agent loop, finish handler, history tracking
- Codebase analysis of `popup-full.js` (1,298 lines) -- settings modal, export, message handling
- Codebase analysis of `popup.html` -- settings modal HTML structure (lines 1760-1836)
- Codebase analysis of `background/message-protocol.js` (177 lines) -- message protocol patterns
- Codebase analysis of `background/tab-context.js` (243 lines) -- tab state and screenshot cache
- `.planning/phases/04-reports-multi-provider-llm/04-CONTEXT.md` -- locked decisions
- `.planning/STATE.md` -- prior architectural decisions
- `.planning/codebase/CONVENTIONS.md` -- coding patterns

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONCERNS.md` -- security and scaling concerns
- `.planning/codebase/ARCHITECTURE.md` -- module dependency graph
- `.planning/REQUIREMENTS.md` -- requirement definitions

### Tertiary (LOW confidence)
- None -- all findings are from direct codebase analysis, no external sources needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all from codebase analysis
- Architecture: HIGH -- all patterns derived from existing code with direct line references
- Pitfalls: HIGH -- identified from code flow analysis, especially the history-clearing race condition

**Research date:** 2026-05-04
**Valid until:** 30 days (stable domain -- Chrome extension APIs don't change frequently)
