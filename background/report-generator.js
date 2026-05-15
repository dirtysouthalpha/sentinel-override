// Sentinel Override v3 -- Report Generator
// Generates structured investigation reports after agent task completion.
// Imports from llm-client.js for LLM calls and message-protocol.js for popup messaging.

import { sendSilentUpdate } from './message-protocol.js';
import { getActiveProvider, resolveProvider } from './provider-registry.js';

// ========== Report Generation ==========
/**
 * Generate a structured investigation report from agent execution data.
 * Uses callLLMWithRetry for reliable LLM calls with automatic retry.
 * Returns both human-readable markdown and machine-readable structured JSON.
 *
 * @param {object} executionData - Snapshot of agent execution state
 * @param {string} executionData.goal - The original user goal
 * @param {Array} executionData.history - Step-by-step action history
 * @param {object} executionData.agentMemory - Extracted data from investigation
 * @param {Array|null} executionData.agentPlan - Original execution plan (if any)
 * @param {number} executionData.stepCount - Total steps executed
 * @param {number} executionData.apiCallCount - Total API calls made
 * @param {Array} executionData.tabContexts - Tab contexts with label, url, hasScreenshot
 * @param {object} CONFIG - Agent configuration object
 * @returns {Promise<{summary: string, fullReport: string, structuredData: object, goal: string, timestamp: string}>}
 */
export async function generateReport(executionData, CONFIG) {
  const { goal, history, agentMemory, agentPlan, stepCount, apiCallCount, tabContexts } = executionData;
  const timestamp = new Date().toISOString();

  sendSilentUpdate('Generating investigation report...');

  // Build a condensed history for the prompt (step + action type + result, not full elements)
  const condensedHistory = history.map(h => ({
    step: h.step,
    action: h.action.type,
    detail: h.action.selector ? h.action.selector.substring(0, 80) : (h.action.url || h.action.text || ''),
    result: typeof h.result === 'string' ? h.result.substring(0, 200) : String(h.result)
  }));

  // Build memory summary for evidence section — skip failed/empty entries
  const memoryKeys = Object.keys(agentMemory);
  const usableKeys = memoryKeys.filter(k => {
    const v = agentMemory[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > 3 && s !== 'Done'
      && !s.startsWith('Execution error') && !s.startsWith('Code execution timed out')
      && !s.startsWith('JS Error:') && !s.startsWith('Element not found');
  });
  // (3.12.4) Hard-cap each memory entry at 600 chars before injecting into
  // the synthesis prompt. The previous logic stringified up to 5 array items
  // per key with no per-key total cap, which produced multi-KB-per-key
  // sections for research-heavy runs (NVD CVE lists, multi-page article
  // briefings). Stuffed into a 6000-token model with a 4000-token context
  // budget for the user prompt, this could hang or 4xx the LLM call. Cap is
  // intentionally low -- the report-LLM doesn't need the raw scrape, just
  // enough to cite from. The original full data lives in the run log.
  function _truncateMemoryValue(val, maxChars) {
    if (val == null) return '';
    let valStr;
    if (Array.isArray(val)) {
      valStr = val.slice(0, 5).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
    } else if (typeof val === 'object') {
      try { valStr = JSON.stringify(val); } catch (e) { valStr = String(val); }
    } else {
      valStr = String(val);
    }
    if (valStr.length > maxChars) {
      valStr = valStr.substring(0, maxChars) + '... [truncated; full value in run log]';
    }
    return valStr;
  }
  const memorySummary = usableKeys.length > 0
    ? usableKeys
        .map(k => `- ${k}: ${_truncateMemoryValue(agentMemory[k], 600)}`)
        .join('\n')
    : 'No usable data was extracted (all extractions failed or timed out).';
  // (3.12.0) List of memory keys the report MUST cite from. Passed into
  // the prompt so the report-LLM can emit [src:key] tags that the popup
  // renders as clickable audit chips.
  const citableKeysList = usableKeys.length > 0
    ? usableKeys.map(k => `\`${k}\``).join(', ')
    : '(none — investigation produced no extractable data)';

  // Build plan context if a plan was generated
  const planContext = agentPlan && agentPlan.length > 0
    ? `\nOriginal plan (${agentPlan.length} steps):\n${agentPlan.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '\nNo formal plan was generated (direct execution mode).';

  // Build tab/screenshot references
  const tabReferences = tabContexts.length > 0
    ? `\nTabs/screenshots captured:\n${tabContexts.map(tc => `- "${tc.label}" (${tc.url})${tc.hasScreenshot ? ' [screenshot available]' : ''}`).join('\n')}`
    : '';

  const reportPrompt = `You are a brilliant research analyst and writer — think Claude-quality output. Your job is to take raw data collected by a browser agent and produce a polished, insightful report that the user actually WANTS to read.

## Original Goal
${goal}

${planContext}

## How the Agent Collected Data
- Total steps: ${stepCount}
- API calls: ${apiCallCount}
- Timestamp: ${timestamp}

## Raw Action History
${condensedHistory.map(h => `[${h.action}] ${h.result}`).join('\n')}

## Raw Extracted Data
${memorySummary}

${tabReferences}

---

## YOUR TASK

Synthesize the raw extracted data into a clean, compelling report. Follow these principles:

### Writing Style
- **Conversational but authoritative** — like a knowledgeable colleague briefing you over coffee, not a robot reading a list
- **Lead with insight** — open with a 1-2 sentence executive summary that answers the user's core question
- **Specific > vague** — use actual names, numbers, dates, quotes, URLs. "3.2 million users" not "a large number of users"
- **Contextualize** — don't just list facts; explain WHY they matter. Connect dots between data points
- **Structured for scanning** — use headers, numbered lists, bold key terms. The user should find any detail in <5 seconds

### Output Format
Adapt to the task type:

**For news briefings (top N articles):**
→ Lead with "Here's your briefing on [topic]..."
→ Each item: **numbered headline** → 2-3 sentence summary of what happened and why it matters → source link
→ End with "Bottom line:" — one sentence takeaway

**For research/analysis tasks:**
→ Lead with the answer/conclusion upfront
→ Then support with evidence in structured sections
→ End with recommendations or next steps

**For comparisons:**
→ Side-by-side format with specific data points
→ Clear verdict with reasoning

**For data extraction (configs, logs, etc.):**
→ Clean structured format (tables, key-value pairs)
→ Anomalies or notable findings highlighted
→ Summary of what was found

### Rules
- ONLY use data that was actually extracted — NEVER fabricate, infer, or use training data
- If data is incomplete or missing, say so explicitly rather than guessing
- If extracted data contains errors/failed extractions, skip those and work with what succeeded
- Keep the report tight — every sentence should earn its place
- Use proper markdown formatting (headers, bold, lists, links)
- Do NOT wrap in code fences or JSON
- Return ONLY the report, nothing else

### Source-Cited Outputs (MANDATORY)
Every specific factual claim in your report — numbers, prices, dates, statistics, named quotes, named people / companies / IPs, URLs you actually visited — MUST end with an inline tag in the form **\`[src:memory_key]\`** where \`memory_key\` is one of the keys listed below in "Available memory keys to cite from". The popup renders these as clickable orange chips that expand the underlying data, so the reader can audit any claim back to its source.

**Available memory keys to cite from:** ${citableKeysList}

Examples of correctly cited claims:

- "M4 Max Mac Studio starts at $1,999 [src:apple_store_pricing]"
- "47 sign-ins from IP 203.0.113.42 [src:entra_signins]"
- "Repository has 110,000 stars [src:github_repo_meta]"

Hard rules:

1. **Every** number, price, date, percentage, statistic, named entity, named quote, or specific URL needs a \`[src:key]\` tag pointing to a real memory key from the list above.
2. If a claim has NO supporting memory key (e.g., it's general framing or your interpretation), either drop the specific number / leave it un-cited as prose, OR tag it \`[unverified]\` and move it to a "Caveats" section.
3. Do NOT invent memory keys. If you can't find a real key for a claim, either remove the claim or mark it \`[unverified]\`.
4. Headers, transitions, and structural prose do not need tags — only specific factual claims do.
5. Cite generously — overcitation is acceptable; under-citation is not.

This is not optional. A report with specific numbers but no \`[src:*]\` tags is broken, even if the prose looks polished.`;

  const reportSystemPrompt = `You are a world-class research analyst and writer. You produce clear, insightful, beautifully structured reports from raw data. Your writing is conversational yet authoritative — like a brilliant colleague who respects the reader's time. You never use filler phrases, corporate jargon, or generic descriptions. Every word earns its place.`;

  // Build machine-readable structured data from raw execution data.
  const structuredData = buildStructuredData(executionData, timestamp);

  try {
    // Make the LLM call for report generation
    const reportResult = await generateReportViaLLM(reportPrompt, CONFIG, reportSystemPrompt);

    const fullReport = typeof reportResult === 'string' ? reportResult.trim() : String(reportResult).trim();

    // Extract summary: first paragraph or first 300 chars
    const firstParagraph = fullReport.split('\n\n')[0] || '';
    const summary = firstParagraph.length > 300
      ? firstParagraph.substring(0, 297) + '...'
      : firstParagraph;

    return { summary, fullReport, structuredData, goal, timestamp };
  } catch (err) {
    console.error('Report generation failed:', err);
    // Return a fallback report from the raw data
    const fallbackReport = buildFallbackReport(executionData);
    return { summary: fallbackReport.split('\n\n')[0], fullReport: fallbackReport, structuredData, goal, timestamp };
  }
}

// ========== LLM Call for Report ==========
/**
 * Makes an LLM call specifically for report generation.
 * Reuses settings from chrome.storage but with a dedicated prompt.
 */
async function generateReportViaLLM(prompt, CONFIG, systemPrompt) {
  const providerConfig = await getActiveProvider();
  if (!providerConfig) throw new Error('No active provider configured');
  const { endpoint, apiKey, model } = providerConfig;

  if (!apiKey) throw new Error('API key not configured');

  const provider = resolveProvider(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeout || 45000);

  const reportSystem = systemPrompt || 'You are a world-class research analyst and writer. You produce clear, insightful, beautifully structured reports from raw data. Return ONLY the report content with no wrapping.';

  let requestBody, requestHeaders;
  try {
    requestBody = JSON.stringify(provider.buildBody(model, reportSystem, prompt, { maxTokens: 6000, temperature: 0.3 }));
    requestHeaders = provider.buildHeaders(apiKey);
  } catch (err) {
    clearTimeout(timeout);
    throw new Error('Failed to build report request: ' + err.message);
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error(`Report LLM call timed out after ${(CONFIG.fetchTimeout || 45000) / 1000}s`);
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorData = await response.text().catch(() => 'unknown error');
    throw new Error(`Report LLM call failed: ${response.status} - ${errorData}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('Report LLM returned invalid JSON');
  }
  const responseText = provider.parseResponse(data);

  // Strip code fences if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  return cleaned;
}

// ========== Structured Data Builder ==========
/**
 * Builds a machine-readable JSON object from raw execution data.
 * This provides programmatic access to findings for automation, scheduling, and API consumers.
 *
 * @param {object} executionData - Same data passed to generateReport
 * @param {string} timestamp - ISO timestamp for the report
 * @returns {object} Structured report data
 */
function buildStructuredData(executionData, timestamp) {
  if (!executionData) return {};
  const { goal, history, agentMemory, agentPlan, stepCount, apiCallCount, tabContexts } = executionData;

  // Classify action types for the action breakdown
  const actionCounts = {};
  const actionTypes = ['navigate', 'click', 'type', 'extract', 'extract_list', 'execute_js',
    'read_page', 'note', 'scroll', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
    'select', 'check', 'hover', 'press_key', 'finish', 'open_tab', 'switch_tab', 'close_tab',
    'dismiss_overlay', 'click_at', 'scroll_to', 'verify', 'lookup', 'read_console_messages',
    'read_network_requests', 'run_remote_command', 'repeat_for_each'];
  for (const t of actionTypes) actionCounts[t] = 0;
  let failedActions = 0;
  let successfulActions = 0;

  for (const h of history) {
    const t = (h.action && h.action.type) || 'unknown';
    if (actionCounts[t] !== undefined) actionCounts[t]++;
    const result = String(h.result || '');
    if (result.includes('not found') || result.includes('Error') || result.includes('failed') || result.includes('timed out')) {
      failedActions++;
    } else {
      successfulActions++;
    }
  }

  // Extract findings from agent memory — separate by type
  const findings = {};
  const memoryKeys = Object.keys(agentMemory || {});
  for (const key of memoryKeys) {
    const val = agentMemory[key];
    // Truncate large values for structured output
    if (Array.isArray(val)) {
      findings[key] = val.slice(0, 50);
    } else if (typeof val === 'object' && val !== null) {
      try {
        const str = JSON.stringify(val);
        findings[key] = str.length > 2000 ? str.substring(0, 2000) + '... [truncated]' : val;
      } catch (e) {
        findings[key] = String(val).substring(0, 2000);
      }
    } else {
      const str = String(val || '');
      findings[key] = str.length > 2000 ? str.substring(0, 2000) + '... [truncated]' : str;
    }
  }

  // URLs visited
  const urlsVisited = [];
  const seenUrls = new Set();
  for (const h of history) {
    if (h.action && h.action.type === 'navigate' && h.action.url) {
      const u = h.action.url;
      if (!seenUrls.has(u)) { urlsVisited.push(u); seenUrls.add(u); }
    }
    if (h.url && !seenUrls.has(h.url)) {
      urlsVisited.push(h.url);
      seenUrls.add(h.url);
    }
  }

  // Determine task type from goal text
  let taskType = 'general';
  const goalLower = (goal || '').toLowerCase();
  if (/top \d|briefing|latest|recent|news|articles/i.test(goalLower)) taskType = 'briefing';
  else if (/compar|vs\.|versus|better|which/i.test(goalLower)) taskType = 'comparison';
  else if (/extract|pull|scrape|list|inventory|export|gather/i.test(goalLower)) taskType = 'extraction';
  else if (/investigat|analyz|audit|review|check|look into|diagnos|troubleshoot/i.test(goalLower)) taskType = 'investigation';
  else if (/config|setup|install|deploy|create|add|enable|configure/i.test(goalLower)) taskType = 'configuration';

  return {
    meta: {
      version: '4.0',
      timestamp,
      goal,
      taskType,
      planSteps: agentPlan ? agentPlan.length : 0,
      totalSteps: stepCount,
      apiCallCount,
      successRate: stepCount > 0 ? Math.round((successfulActions / stepCount) * 100) : 0,
      failedActions,
      urlsVisited: urlsVisited.slice(0, 50),
      tabsUsed: tabContexts ? tabContexts.length : 0
    },
    actionBreakdown: actionCounts,
    findings,
    tabs: (tabContexts || []).map(tc => ({
      label: tc.label,
      url: tc.url,
      hasScreenshot: !!tc.hasScreenshot
    }))
  };
}

// ========== Fallback Report ==========
/**
 * Builds a basic report from execution data when the LLM call fails.
 * Ensures the user always gets something useful even if report generation errors out.
 */
function buildFallbackReport(executionData) {
  const { goal, history, agentMemory, stepCount, apiCallCount } = executionData;

  const memoryLines = Object.keys(agentMemory).map(k => {
    const val = agentMemory[k];
    const valStr = Array.isArray(val)
      ? `${val.length} items: ${val.slice(0, 5).map(v => String(v).substring(0, 100)).join(', ')}`
      : String(val).substring(0, 300);
    return `- **${k}**: ${valStr}`;
  });

  const stepsTaken = history
    .filter(h => h.action && h.action.type && !['read_page', 'scroll', 'wait_for_text', 'wait_for_element', 'wait_for_navigation'].includes(h.action.type))
    .map(h => `${h.step}. **${h.action.type}**${h.action.selector ? ` on ${h.action.selector.substring(0, 60)}` : ''}: ${typeof h.result === 'string' ? h.result.substring(0, 150) : ''}`)
    .join('\n');

  return `### Goal
${goal}

### Steps Taken
${stepsTaken || 'No significant steps recorded.'}

### Key Findings
Report generation encountered an error. The raw extracted data is shown below.

### Evidence
${memoryLines.length > 0 ? memoryLines.join('\n') : 'No data was extracted during this investigation.'}

### Conclusions
Investigation completed in ${stepCount} steps (${apiCallCount} API calls). For a detailed report, retry the task or check the agent's step-by-step log above.`;
}
