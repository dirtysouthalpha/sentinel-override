// Sentinel Override v3 — LLM Client
// API calls, retry logic, response parsing, vision detection, platform context.
// Imports from message-protocol.js only (no circular dependency risk).

import { sendSilentUpdate } from './message-protocol.js';
import { getAllTabContexts, getActiveTabId, getTabContext, TAB_LIMIT } from './tab-context.js';
import { resolveProvider, getActiveProvider } from './provider-registry.js';

// ========== Platform Context Detection ==========
// Detects which UI the agent is currently operating in based on the page URL
// and goal text, then injects platform-specific behavioral guidance.
// Specifics (IPs, credentials, zone names, rule names) are intentionally NOT
// hardcoded here -- those come from the user's goal/Context Memory. This
// function only provides UI interaction patterns for each platform type.

export function getPlatformContext(currentUrl, goal) {
  const url  = (currentUrl || '').toLowerCase();
  const text = (goal || '').toLowerCase();

  // -- SonicWall --
  const isSonicWall =
    url.includes('sonicwall') ||
    text.includes('sonicwall') ||
    text.includes('sonicos') ||
    /\/ui\b|#\/dashboard|#\/firewall|#\/network|#\/security/.test(url);

  if (isSonicWall) {
    return `
PLATFORM: SonicWall Management UI (SonicOS)
UI-SPECIFIC RULES -- follow these exactly:

DROPDOWNS: SonicWall uses Angular custom dropdowns, NOT native <select> elements.
  - To select a value: first CLICK the dropdown trigger to open the list, then CLICK the desired option.
  - Never use the "select" action on SonicWall dropdowns -- it only works on native HTML <select> and will silently fail here.
  - If a dropdown doesn't open on first click, try hover then click.

SAVING CHANGES: Every policy/object change requires an explicit commit step.
  - After editing a rule or object, look for an "Accept", "Apply", "OK", or "Save" button and click it.
  - Changes shown on screen are NOT saved until committed -- always confirm before moving on.
  - After committing, wait for the success toast/banner before proceeding.

LOG PAGES: Log > View and Connection Monitor pages are slow to populate.
  - After navigating to a log page, use wait_for_text with a 30000ms timeout before reading.
  - Filter inputs may need a click to focus before type will work.
  - Export/download buttons generate CSV files -- note the filename in a "note" action.

NAVIGATION: SonicWall uses SPA hash routing (#/path).
  - After clicking a nav item, wait 2-3 seconds for the panel to render before scanning elements.
  - If a panel seems empty, use scroll to reveal lazy-loaded content, then read_page again.

POLICY RULES TABLE: Click a rule row to open its edit dialog.
  - The edit icon (pencil) or the row itself opens the edit form.
  - Rule order matters: note the row number/position as well as the rule name.

SESSION EXPIRY: If you see a login form mid-task, the session expired.
  - The management URL and credentials are in the goal/context -- re-login and resume.

IFRAMES: Some SonicWall panels (especially older 6.5 UI) embed content in iframes.
  - If expected elements aren't found, try scrolling or waiting -- they may be in a same-origin iframe that the scanner will pick up automatically.
  - Cross-origin iframes cannot be read -- note this and use read_page on the outer frame instead.
`;
  }

  // -- Fortinet / FortiGate --
  const isFortinet =
    url.includes('fortinet') || url.includes('fortigate') || url.includes('fortimanager') ||
    text.includes('fortinet') || text.includes('fortigate');

  if (isFortinet) {
    return `
PLATFORM: Fortinet / FortiGate Management UI
UI-SPECIFIC RULES:
  - Dropdowns are custom widgets -- click to open, then click the option (not native select).
  - After policy changes, click Apply and wait for the green confirmation banner.
  - Log pages use virtual scrolling -- scroll down to load more entries.
  - Tables have inline edit icons (pencil); click the icon not the row to edit.
  - Session timeout is short -- if a login page appears, re-authenticate using goal credentials.
`;
  }

  // -- Cisco (FMC / ASDM / ISE / Meraki) --
  const isCisco =
    url.includes('cisco') || url.includes('/asdm') || url.includes('/fmc') ||
    url.includes('meraki') || url.includes('.ise.') ||
    text.includes('cisco asa') || text.includes('firepower') || text.includes('meraki') ||
    text.includes('cisco ise');

  if (isCisco) {
    return `
PLATFORM: Cisco Management UI (ASA/FMC/Meraki/ISE)
UI-SPECIFIC RULES:
  - ASDM uses Java -- if the UI is Java-based, use execute_js sparingly; DOM interaction is limited.
  - FMC uses custom React components -- dropdowns need click-to-open then click-option.
  - Meraki dashboard: standard web UI, most actions work normally; wait for AJAX to settle after saves.
  - Always look for a Deploy or Commit button after policy changes -- pending changes are staged, not live.
  - Log tables use pagination -- note the page number when extracting log entries.
`;
  }

  // -- Palo Alto (PAN-OS / Panorama) --
  const isPaloAlto =
    url.includes('paloalto') || url.includes('panorama') || url.includes('/php/rest/pan') ||
    text.includes('palo alto') || text.includes('pan-os') || text.includes('panorama');

  if (isPaloAlto) {
    return `
PLATFORM: Palo Alto Networks (PAN-OS / Panorama)
UI-SPECIFIC RULES:
  - After any change, a "Commit" step is required -- look for the Commit button (top right) and click it.
  - Dropdowns are Ext JS widgets -- click the dropdown arrow, then click the option.
  - Tabs within panels are clickable text -- click the tab label to switch views.
  - Log Viewer uses AJAX pagination -- wait for spinner to disappear before extracting log data.
  - Object names are case-sensitive -- extract exact names as shown on screen.
`;
  }

  // -- Generic enterprise/network device UI --
  const isNetworkDevice =
    text.includes('firewall') || text.includes('router') || text.includes('switch') ||
    text.includes('access point') || text.includes('management ui') ||
    text.includes('admin panel') || text.includes('web ui');

  if (isNetworkDevice) {
    return `
PLATFORM: Network/Security Device Management UI (generic)
UI-SPECIFIC RULES:
  - Many network device UIs use custom dropdowns -- if "select" fails, try click-to-open then click-option.
  - Changes are often staged -- look for Apply, Save, Commit, or Accept buttons after edits.
  - Log pages may be slow to load -- use wait_for_text with generous timeouts (20000-30000ms).
  - Session timeouts are common -- if a login form appears, re-authenticate using credentials from the goal.
  - Table rows often open edit dialogs on click -- click the row or its edit icon to modify entries.
`;
  }

  return ''; // No platform-specific context needed
}

// ========== Vision Support ==========
export function supportsVision(model) {
  if (!model) return false;
  const m = model.toLowerCase();
  const vm = ['glm-4.5v', 'glm-4.6v', 'glm-5v', 'gpt-4o', 'gpt-4-vision', 'claude-3', 'claude-4', 'gemini', 'qwen-vl', 'llava', 'vision', 'vl-', '-vl'];
  return vm.some(v => m.includes(v));
}

// ========== Pre-flight Planning ==========
// Generates a numbered plan from the goal before execution begins.
// This gives the agent a map of what it's accomplished and what's left,
// dramatically improving reliability on multi-step and multi-site tasks.
export async function generatePlan(goal, settings, context = {}) {
  const endpoint = settings.api_endpoint || 'https://api.z.ai/api/paas/v4/chat/completions';
  const apiKey = settings.api_key;
  const model = settings.model || 'glm-5.1';
  if (!apiKey) return null;

  const urlContext = context.currentUrl
    ? `Current page: ${context.currentUrl}${context.pageTitle ? ` (${context.pageTitle})` : ''}\n`
    : '';

  const platformContext = context.platformContext || '';

  const patternContext = context.relevantPatterns && context.relevantPatterns.length > 0
    ? `\nPast successful patterns for similar tasks:\n${context.relevantPatterns.map(p => `- "${p.goal}" -> ${p.steps.map(s => s.type).join(', ')}`).join('\n')}\n`
    : '';

  const planPrompt = `You are an expert browser automation planner for an MSP (Managed Service Provider) tool. Given a user goal and current context, produce a DETAILED numbered execution plan.

DECOMPOSITION RULES — follow these exactly:
1. Break every task into EXPLICIT, atomic browser actions. NEVER combine multiple actions into one step.
2. Login flows: navigate to login page → type username → type password → click submit → wait for dashboard
3. Form interactions: locate field → clear/focus → type value → move to next field
4. Navigation: click menu item → wait for content → scan elements → proceed
5. Table/filter tasks: navigate to table → locate filter → set filter → wait for results → read → extract data
6. Configuration changes: navigate to config section → find item → open edit → set values → save → verify success
7. Multi-page research: navigate to source → extract links → open each in tab → read → note findings → close tabs → summarize
8. ALWAYS include data extraction steps (extract, execute_js with key, or note) — never just navigate and read without saving
9. ALWAYS include verification after saves/commits (wait for success message, re-read to confirm)
10. For firewalls/network devices: ALWAYS include the save/commit/apply step after any configuration change
11. Maximum 15 steps — be thorough but not redundant

${urlContext}${platformContext}${patternContext}
Goal: ${goal}

Return ONLY a JSON object: { "plan": ["step 1...", "step 2...", ...] }

Example GOOD plan for a complex MSP task:
Goal: "Block port 3389 from WAN to LAN on the SonicWall at 192.168.1.1"
{ "plan": ["Navigate to https://192.168.1.1", "Type the username into the login field", "Type the password into the password field", "Click the Login button and wait for dashboard", "Click Policy or Firewall in the left navigation menu", "Click Access Rules or IPv4 Rules", "Wait for the rules table to load", "Click Add Rule or the + button to create a new rule", "Set the Source Zone dropdown to WAN", "Set the Destination Zone dropdown to LAN", "Set the Service dropdown to RDP (port 3389) or type 3389", "Set the Action to Deny or Drop", "Type a descriptive name in the Comment/Name field", "Click Save or Apply", "Wait for the success confirmation banner", "Finish with confirmation that the RDP block rule was created"] }

Example GOOD plan for a multi-page research task:
Goal: "Go to cnn.com and give me a briefing on the top 10 articles"
{ "plan": ["Navigate to cnn.com", "Read the homepage content to identify top stories", "Use execute_js with key 'headlines' to extract the top 10 headline titles, links, and descriptions", "For each article that needs more detail, open it in a new tab using open_tab with label", "Switch to each article tab, read the page, and note a brief summary", "Close article tabs when done", "Finish with a numbered briefing of all 10 articles with headlines and key takeaways"] }

Example GOOD plan for a firewall investigation:
Goal: "Check the SonicWall at 10.0.0.1 for why traffic from 192.168.5.20 is being blocked"
{ "plan": ["Navigate to the SonicWall management URL", "Login with the provided credentials", "Click Log in the left navigation menu", "Click View under Log to open the log viewer", "Wait for log entries to load", "Set the Category filter to Firewall if available", "Set the Source IP filter to 192.168.5.20", "Click Apply or Filter to apply the filters", "Wait for filtered results to appear", "Read and extract the blocked connection log entries", "Note the rule IDs, zones, and action (deny/drop) for each blocked connection", "Navigate to the matching firewall rules to understand why traffic is blocked", "Finish with a summary of which rules are blocking the traffic and why"] }

Example BAD plan (too vague):
Goal: "Check the SonicWall firewall for blocked connections"
{ "plan": ["Go to the website", "Find the information", "Get the data"] }`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const provider = resolveProvider(endpoint);
    const planBody = JSON.stringify(provider.buildBody(model, 'You are a planning assistant. Return ONLY valid JSON.', planPrompt, { maxTokens: 1200, temperature: 0.2 }));
    const planHeaders = provider.buildHeaders(apiKey);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: planHeaders,
      body: planBody,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      console.warn('Plan generation API returned', response.status);
      return null;
    }
    const data = await response.json();
    const content = provider.parseResponse(data);
    if (!content) {
      console.warn('Plan generation: empty response content');
      return null;
    }
    // Try direct parse first (plan responses have { "plan": [...] } not { "type": "..." })
    let jsonStr = content.trim();
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) jsonStr = match[1].trim();
    }
    // Strip control characters that break JSON.parse
    jsonStr = jsonStr.replace(/[\x00-\x1f]/g, '');
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.plan) && parsed.plan.length > 0) return parsed.plan;
    } catch (e) {
      // Fallback: try extractFirstJsonObject for models that wrap the plan
      const firstObj = extractFirstJsonObject(content);
      if (firstObj) {
        const parsed = JSON.parse(firstObj);
        if (Array.isArray(parsed.plan) && parsed.plan.length > 0) return parsed.plan;
      }
      console.warn('Plan generation: could not parse response as plan JSON:', e.message, 'Content:', content.slice(0, 200));
    }
  } catch (e) {
    console.warn('Plan generation failed (non-fatal):', e.message);
  }
  return null;
}

// ========== API Call with Retry ==========
// CONFIG is passed as a parameter to avoid coupling to agent-engine state.
export async function callLLMWithRetry(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, retryCount, CONFIG, agentState) {
  try {
    return await callLLM(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, CONFIG, agentState);
  } catch (err) {
    const msg = err.message || '';
    const isRetryable = (msg.includes('429') || msg.includes('502') || msg.includes('503') || msg.includes('timed out') || msg.includes('AbortError') || msg.includes('Failed to fetch')) && retryCount < CONFIG.maxRetries;
    if (isRetryable) {
      const baseDelay = msg.includes('429') ? CONFIG.retryDelay : CONFIG.retryDelay / 2;
      const delay = Math.min(baseDelay * Math.pow(2, retryCount) + Math.floor(Math.random() * 2000), CONFIG.maxRetryDelay);
      sendSilentUpdate(`Retrying in ${Math.round(delay/1000)}s...`, stepCount);
      await sleep(delay);
      return callLLMWithRetry(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, retryCount + 1, CONFIG, agentState);
    }
    throw err;
  }
}

// ========== Main LLM Call ==========
// trimmedElements: the capped/cleaned element list built in the main loop
// totalElementCount: the raw count before trimming (for the prompt header)
async function callLLM(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, CONFIG, agentState) {
  const providerConfig = await getActiveProvider();
  const { endpoint, apiKey, model } = providerConfig;
  if (!apiKey) throw new Error('API key not configured. Set it in extension settings.');
  agentState.apiCallCount++;

  const last_action = history.length > 0 ? history[history.length - 1].action : null;
  const last_result = history.length > 0 ? history[history.length - 1].result : null;

  // Runbook detection
  const isRunbook = /STEP\s+\d|PHASE\s+\d|INVESTIGATION|RUNBOOK|Navigation:|Success Indicator|TICKET|checkpoint|rollback|decision tree|Phase [0-9]|what has been tried|fastest.*resolution/i.test(goal);

  const runbookCtx = isRunbook ? `
RUNBOOK / INVESTIGATION MODE ACTIVE
You are executing a structured, multi-phase IT investigation. Rules for this mode:
1. NEVER finish early -- complete ALL phases listed in the goal before calling "finish".
2. Use "note" actions liberally to document every finding: IPs, zone names, rule IDs, log entries, FQDN lists, any value observed on screen.
3. Use "extract" to save key values (client IP, rule name, zone, etc.) to memory for later reference via ::key::.
4. Navigate to each UI location specified. Read the page after every navigation before acting.
5. If a page has a form or filter, fill it in before reading results.
6. Follow the phase order exactly. Complete each phase fully before advancing.
7. At the end, call "finish" with a COMPLETE ticket-ready summary: all phases covered, all findings listed, the exact change made (or recommended), and rollback steps.
8. Do NOT skip phases because you think you found the answer early -- document ALL phases as instructed.
` : '';

  // Navigation fatigue detection -- DISABLED in runbook mode.
  const navigateCount = history.filter(h => h.action.type === 'navigate').length;
  const extractCount = history.filter(h => ['extract', 'extract_list'].includes(h.action.type)).length;
  const noteCount = history.filter(h => h.action.type === 'note').length;

  const finishCtx = isRunbook ? '' :
    (navigateCount >= 3 && extractCount === 0 && noteCount === 0)
    ? `\nHARD STOP -- You navigated ${navigateCount} times without extracting or noting anything. You MUST use "extract", "note", or "finish" NOW. Do NOT navigate again.\n`
    : (navigateCount >= 5 && extractCount === 0 && noteCount === 0)
    ? `\nFINISH NOW -- ${navigateCount} navigates with nothing recorded. Use your memory and finish with a comprehensive answer. Include ACTUAL content.\n`
    : '';

  // Platform-specific UI guidance
  const platformCtx = getPlatformContext(currentUrl, goal);

  // Self-healing: strategy shift prompt
  let strategyCtx = '';
  if (agentState.consecutiveFailures >= CONFIG.strategyShiftThreshold) {
    strategyCtx = `\nSTRATEGY SHIFT REQUIRED -- You have failed ${agentState.consecutiveFailures} times in a row.\nApproaches already tried: ${agentState.currentStrategies.join(', ')}\nYou MUST try a COMPLETELY DIFFERENT approach. Consider:\n- Using "execute_js" to write custom JavaScript to accomplish the task\n- Scrolling to find different elements\n- Navigating to a different page\n- Using "extract" + memory to build data step by step\nDo NOT repeat the same failed action.\n`;
  }

  // Self-learning: inject relevant patterns
  const patterns = await getRelevantPatterns(goal);
  const patternCtx = patterns.length > 0
    ? `\nPAST SUCCESSFUL PATTERNS (similar tasks):\n${patterns.map((p, i) => `${i+1}. "${p.goal}" -> ${p.steps.map(s => s.type).join(' -> ')}`).join('\n')}\n`
    : '';

  // Memory context
  const memoryKeys = Object.keys(agentState.agentMemory);
  const memoryCtx = memoryKeys.length > 0
    ? `\nAGENT MEMORY (data extracted from pages, use ::key:: to reference):\n${JSON.stringify(agentState.agentMemory, null, 2)}\n`
    : '';

  // Inject plan context if a plan was generated
  let planCtx = '';
  if (agentState.agentPlan && agentState.agentPlan.length > 0) {
    const planLines = agentState.agentPlan.map((step, i) => {
      const marker = i < agentState.currentPlanStep ? '[done]' : i === agentState.currentPlanStep ? '[current]' : '[pending]';
      return `${marker} ${i + 1}. ${step}`;
    }).join('\n');
    planCtx = `\nEXECUTION PLAN (your roadmap -- follow in order):\n${planLines}\n\nCURRENT PLAN STEP: ${agentState.currentPlanStep + 1} -- "${agentState.agentPlan[agentState.currentPlanStep] || 'All steps complete'}"\nWhen the current plan step is fully done, include "advance_plan": true in your JSON response.\n`;
  }

  // Multi-tab context: show all managed tabs with summaries
  const allContexts = getAllTabContexts();
  const activeId = getActiveTabId();

  let tabCtxSection = '';
  if (allContexts.length > 0) {
    tabCtxSection = `\nMANAGED TABS (${allContexts.length}/${TAB_LIMIT} tab limit):\n`;
    for (const ctx of allContexts) {
      const isActive = ctx.tabId === activeId;
      const marker = isActive ? '[ACTIVE] ' : '';
      const snapSummary = ctx.snapshot
        ? `Last seen: "${(ctx.snapshot.pageContent || '').substring(0, 300)}..." (${new Date(ctx.snapshot.timestamp).toLocaleTimeString()})`
        : 'No snapshot yet.';
      tabCtxSection += `- ${marker}"${ctx.label}" (${ctx.url}): ${snapSummary}\n`;
    }
    tabCtxSection += `\nTab rules:\n`;
    tabCtxSection += `- Use "open_tab" to open a new URL in a background tab (max ${TAB_LIMIT} tabs total)\n`;
    tabCtxSection += `- Use "switch_tab" with a label to operate on a different tab\n`;
    tabCtxSection += `- Use "close_tab" with a label to close a tab you no longer need\n`;
    tabCtxSection += `- Extract data from a tab BEFORE opening new tabs that might push it past the ${TAB_LIMIT}-tab limit\n`;
    tabCtxSection += `- Reference data from other tabs in your reasoning -- you can see their last-known content above\n`;
  }

  // Loop directive from stall detection
  const loopCtx = agentState.loopDirective || '';

  // Build prompt
  const prompt = `You are Sentinel Override v3, an autonomous browser agent. You can create tools, extract data, and solve ANY web task.
${runbookCtx}${platformCtx}${planCtx}${strategyCtx}${finishCtx}${patternCtx}${memoryCtx}${tabCtxSection}${loopCtx}
Current URL: ${currentUrl}
Current step: ${stepCount}
Goal: ${goal}

CURRENT PAGE CONTENT:
${pageContent}

AVAILABLE INTERACTIVE ELEMENTS (use ONLY these selectors -- ${trimmedElements.length} of ${totalElementCount} shown, prioritized by type):
${JSON.stringify(trimmedElements, null, 2)}

RECENT HISTORY (last ${isRunbook ? 12 : CONFIG.historyWindow} steps${isRunbook ? ' -- extended for runbook context' : ''}):
${JSON.stringify(history.slice(isRunbook ? -12 : -CONFIG.historyWindow).map(h => ({
  step: h.step,
  action: {
    type: h.action.type,
    selector: h.action.selector
      ? (h.action.selector.length > 60 ? '...' + h.action.selector.slice(-60) : h.action.selector)
      : undefined,
    text: h.action.text,
    url: h.action.url
  },
  result: typeof h.result === 'string' ? h.result.substring(0, 200) : h.result
})), null, 2)}

${last_action && last_result && String(last_result).includes('not found') ? 'CRITICAL: Last action FAILED. You MUST pick a selector from the AVAILABLE INTERACTIVE ELEMENTS list.' : ''}

RULES:
1. **READ BEFORE YOU ACT** -- Always "read_page" or "extract" BEFORE navigating. You CANNOT extract data from a page you already left!
2. **EXTRACT OR FINISH** -- After reading a page, either "extract" key data to memory OR "finish" with the answer. NEVER just navigate away.
3. **MULTI-PAGE RESEARCH PATTERN** -- When the goal requires visiting multiple pages (e.g., "open each article and summarize"):
   a) First extract the list of URLs from the current page using "execute_js" with: document.querySelectorAll('a[href]').length to verify links exist, then extract URLs
   b) Use "open_tab" with url and label for each page (e.g., label: "article-1")
   c) Use "switch_tab" to go to each tab, "read_page" to read it, then "note" to record the summary
   d) Use "close_tab" when done with a tab
   e) After visiting all pages, "finish" with ALL summaries combined
4. **EXTRACT FAILED? USE JS** -- If "extract" or "extract_list" returns "Element not found", use "execute_js" with a "key" to save results to memory:
   - Extract links: { "type": "execute_js", "code": "return Array.from(document.querySelectorAll('a[href]')).slice(0,10).map(a => ({title: a.innerText.trim(), href: a.href}))", "key": "links" }
   - Extract text: { "type": "execute_js", "code": "return Array.from(document.querySelectorAll('h2, h3')).map(e => e.innerText.trim()).filter(Boolean)", "key": "headings" }
   - ALWAYS use "key" with execute_js so data persists in memory for your finish summary
5. **NEVER HALLUCINATE** -- Your "finish" summary MUST only contain information you actually extracted from web pages using "extract", "execute_js" with key, or "note". If you did not extract real data from real pages, you MUST say "I was unable to extract data from the page" — NEVER fabricate article titles, product names, statistics, or summaries from your training data. This is a strict requirement.
6. **NO VAGUE SUMMARIES** -- Include ACTUAL TEXT, names, numbers, URLs, prices extracted from pages. "Found articles" is useless. "Article 'X' by Y says Z" is useful.
7. Use "extract" + memory to carry data between pages. Reference with ::key::.
8. For dropdowns: use "select". For hover menus: use "hover" then "click".
9. One action per step.
10. **HIGH-QUALITY FINISH** -- When you call "finish", your summary should be the ONLY thing the user reads. Make it count:
   - For briefings/lists: Use clear numbered sections with headlines, key takeaways, and source links
   - For research tasks: Lead with the answer, then support with evidence
   - For comparisons: Use structured "vs" format with specific data points
   - Write in a conversational but authoritative tone — like a knowledgeable colleague briefing you
   - Include SPECIFIC details: actual names, numbers, dates, quotes — not generic descriptions
   - Skip the "Raw extracted data" section — synthesize everything into readable prose

Actions:
- { "type": "click", "selector": "FROM_LIST" }
- { "type": "type", "selector": "FROM_LIST", "text": "TEXT" }
- { "type": "navigate", "url": "URL" }
- { "type": "scroll", "amount": INTEGER }
- { "type": "select", "selector": "FROM_LIST", "value": "OPTION" }
- { "type": "hover", "selector": "FROM_LIST" }
- { "type": "press_key", "key": "Enter|Tab|Escape|ArrowDown|..." }
- { "type": "extract", "key": "memory_key", "selector": "FROM_LIST", "attribute": "text|href|value|..." }
- { "type": "extract_list", "key": "memory_key", "selector": "CSS_SELECTOR", "fields": { "title": "h2", "price": ".price" }, "limit": 10 }
- { "type": "wait_for_text", "text": "TEXT", "timeout": 5000 }
- { "type": "wait_for_element", "selector": "FROM_LIST", "timeout": 5000 }
- { "type": "wait_for_navigation", "timeout": 5000 }
- { "type": "execute_js", "code": "JS_CODE", "key": "memory_key" }  -- key is OPTIONAL; if provided, result is saved to memory
- { "type": "read_page" }
- { "type": "note", "text": "FINDINGS" }
- { "type": "finish", "summary": "FULL DETAILED REPORT with actual text, names, numbers, URLs" }
- { "type": "open_tab", "url": "URL", "label": "name" }
- { "type": "switch_tab", "label": "name" }
- { "type": "close_tab", "label": "name" }
- { "type": "dismiss_overlay" }
- { "type": "switch_to_frame", "frame_index": INTEGER }
- { "type": "click_at", "x": PIXEL_X, "y": PIXEL_Y }

${base64Image ? 'VISUAL MODE: You can see a screenshot of the current page. You may use "click_at" with x,y pixel coordinates to click elements you can see but that are not in the element list. Estimate coordinates from the screenshot — the image is full-width so x maps directly. Use click_at when the element list is empty or the selectors don\'t match what you see.\n' : ''}

IMPORTANT: Return ONLY a single JSON object like { "type": "read_page" }. No thinking, no explanation, no markdown, no text before or after the JSON.`;

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeout);

  // Build request body using provider registry
  const provider = resolveProvider(endpoint);
  const userContent = (supportsVision(model) && base64Image)
    ? provider.buildVisionContent(prompt, base64Image)
    : prompt;
  const requestBody = JSON.stringify(provider.buildBody(model, provider.systemPromptTweak, userContent, { maxTokens: 8000, temperature: 0.1 }));
  const requestHeaders = provider.buildHeaders(apiKey);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(fetchTimeout);
    throw err.name === 'AbortError' ? new Error(`API timed out after ${CONFIG.fetchTimeout/1000}s`) : err;
  }
  clearTimeout(fetchTimeout);

  if (!response.ok) {
    const errorData = await response.text();
    if (response.status === 429) throw new Error(`429 Rate limited. ${errorData}`);
    if (response.status === 400 && errorData.includes('Unknown Model')) throw new Error(`Unknown model "${model}".`);
    throw new Error(`API Error: ${response.status} - ${errorData}`);
  }

  const data = await response.json();

  // Parse response using provider registry
  const responseText = provider.parseResponse(data);
  return parseLLMResponse(responseText);
}

// ========== Response Parsing ==========
export function extractFirstJsonObject(str) {
  // Try every '{' position to find a valid JSON object with a "type" field.
  // This handles models that prepend reasoning text before the actual JSON.
  const validTypes = new Set(['click', 'type', 'navigate', 'scroll', 'select', 'hover', 'press_key',
    'extract', 'extract_list', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
    'execute_js', 'read_page', 'note', 'finish', 'open_tab', 'switch_tab', 'close_tab',
    'dismiss_overlay', 'switch_to_frame', 'click_at']);

  let searchFrom = 0;
  while (searchFrom < str.length) {
    const start = str.indexOf('{', searchFrom);
    if (start === -1) return null;

    let depth = 0, inString = false, escape = false;
    let end = -1;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }

    if (end !== -1) {
      const candidate = str.substring(start, end + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.type && validTypes.has(parsed.type)) return candidate;
      } catch (e) { /* not valid JSON, try next */ }
      searchFrom = end + 1;
    } else {
      break;
    }
  }
  return null;
}

export function parseLLMResponse(content) {
  try {
    if (!content || typeof content !== 'string') {
      throw new Error('Empty or null response from API');
    }
    let jsonStr = content.trim();
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) jsonStr = match[1].trim();
    }
    const firstObj = extractFirstJsonObject(jsonStr);
    if (firstObj) jsonStr = firstObj;
    // Fix common JSON issues from LLMs:
    // 1. Literal newlines inside string values (e.g., "summary": "line1\nline2")
    // 2. Control characters
    jsonStr = jsonStr.replace(/[\x00-\x1f]/g, '');
    let parsed = JSON.parse(jsonStr);
    if (!parsed.type && parsed.action && typeof parsed.action === 'object') parsed = parsed.action;
    if (!parsed.type && parsed.command && typeof parsed.command === 'object') parsed = parsed.command;
    if (!parsed.type && parsed.next_action && typeof parsed.next_action === 'object') parsed = parsed.next_action;
    if (!parsed.type) throw new Error('Missing type field');
    const validTypes = ['click', 'type', 'navigate', 'scroll', 'select', 'hover', 'press_key',
      'extract', 'extract_list', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
      'execute_js', 'read_page', 'note', 'finish', 'open_tab', 'switch_tab', 'close_tab',
      'dismiss_overlay', 'switch_to_frame', 'click_at'];
    if (!validTypes.includes(parsed.type)) throw new Error('Invalid command type: ' + parsed.type);
    return parsed;
  } catch (err) {
    console.error('Failed to parse LLM response:', err, 'Content:', content);
    // If the content looks like a finish response (has a long summary),
    // salvage it instead of treating it as a parse error
    if (typeof content === 'string' && content.length > 200 && (content.includes('"type"') || content.includes('"finish"'))) {
      try {
        // Try to fix common issues: unescaped newlines in strings
        const fixed = content
          .replace(/[\x00-\x1f]/g, '')
          .replace(/\\n/g, '\\n')
          .replace(/\n/g, '\\n');
        const parsed = JSON.parse(fixed);
        if (parsed.type === 'finish' && parsed.summary) {
          return parsed;
        }
      } catch (e) { /* fall through to note */ }
    }
    return { type: 'note', text: `Parse error (will retry): ${err.message}` };
  }
}

// ========== Self-Learning ==========
export async function getRelevantPatterns(goal) {
  try {
    const stored = await chrome.storage.local.get(['learned_patterns']);
    const patterns = stored.learned_patterns || [];
    const goalWords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = patterns
      .filter(p => p.success)
      .map(p => ({
        pattern: p,
        score: goalWords.reduce((acc, w) => acc + (p.goal.toLowerCase().includes(w) ? 1 : 0), 0)
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return scored.map(s => s.pattern);
  } catch (e) { return []; }
}

// ========== Utilities ==========
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
