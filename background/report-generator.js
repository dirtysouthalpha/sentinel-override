// Sentinel Override v3 -- Report Generator
// Generates structured investigation reports after agent task completion.
// Imports from llm-client.js for LLM calls and message-protocol.js for popup messaging.

import { sendSilentUpdate } from './message-protocol.js';
import { getActiveProvider, resolveProvider } from './provider-registry.js';

// ========== Report Generation ==========
/**
 * Generate a structured investigation report from agent execution data.
 * Uses callLLMWithRetry for reliable LLM calls with automatic retry.
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
 * @returns {Promise<{summary: string, fullReport: string, goal: string, timestamp: string}>}
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

  // Build memory summary for evidence section
  const memoryKeys = Object.keys(agentMemory);
  const memorySummary = memoryKeys.length > 0
    ? memoryKeys.map(k => {
        const val = agentMemory[k];
        const valStr = Array.isArray(val)
          ? `${val.length} items: ${val.slice(0, 5).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ')}`
          : String(val).substring(0, 500);
        return `- **${k}**: ${valStr}`;
      }).join('\n')
    : 'No extracted data stored.';

  // Build plan context if a plan was generated
  const planContext = agentPlan && agentPlan.length > 0
    ? `\nOriginal plan (${agentPlan.length} steps):\n${agentPlan.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '\nNo formal plan was generated (direct execution mode).';

  // Build tab/screenshot references
  const tabReferences = tabContexts.length > 0
    ? `\nTabs/screenshots captured:\n${tabContexts.map(tc => `- "${tc.label}" (${tc.url})${tc.hasScreenshot ? ' [screenshot available]' : ''}`).join('\n')}`
    : '';

  const reportPrompt = `You are an investigation report writer. Generate a structured markdown report based on the agent's execution data below.

## Original Goal
${goal}

${planContext}

## Execution Summary
- Total steps: ${stepCount}
- API calls made: ${apiCallCount}
- Timestamp: ${timestamp}

## Action History (condensed)
${condensedHistory.map(h => `**Step ${h.step}** [${h.action}]: ${h.result}`).join('\n')}

## Extracted Data (Evidence)
${memorySummary}

${tabReferences}

---

Produce a structured markdown report with these EXACT sections:

### Goal
State the original goal in a clear, concise sentence.

### Steps Taken
A numbered list of the key actions taken. Do NOT list every single step -- condense routine actions (e.g., navigating, scrolling, waiting) and highlight important ones (extracting data, finding results, making changes). Aim for 5-15 items depending on task complexity.

### Key Findings
Goal-relevant observations and discoveries. The LLM decides what counts as a finding vs routine. List each finding with enough context to understand why it matters. If no significant findings, say "No significant findings beyond routine navigation."

### Evidence
Reference specific extracted data from the investigation. Use format like "IP 10.0.0.5 found in blocked connections log" or "Configuration value X set to Y". If no data was extracted, say "No structured data was extracted during this investigation."

### Conclusions
Summary of outcomes and any recommended next steps. Include what was accomplished and what might need follow-up.

IMPORTANT:
- Write in a professional, factual tone suitable for ticket documentation
- Include actual values, names, and data -- not vague descriptions
- The report will be rendered as markdown -- use proper markdown formatting
- Do NOT wrap the report in code fences or JSON
- Return ONLY the report content, nothing else`;

  try {
    // Make the LLM call for report generation
    // We reuse callLLMWithRetry but need a minimal call setup
    // Build a minimal call that uses the retry infrastructure
    const reportResult = await generateReportViaLLM(reportPrompt, CONFIG);

    const fullReport = typeof reportResult === 'string' ? reportResult.trim() : String(reportResult).trim();

    // Extract summary: first paragraph or first 300 chars
    const firstParagraph = fullReport.split('\n\n')[0] || '';
    const summary = firstParagraph.length > 300
      ? firstParagraph.substring(0, 297) + '...'
      : firstParagraph;

    return { summary, fullReport, goal, timestamp };
  } catch (err) {
    console.error('Report generation failed:', err);
    // Return a fallback report from the raw data
    const fallbackReport = buildFallbackReport(executionData);
    return { summary: fallbackReport.split('\n\n')[0], fullReport: fallbackReport, goal, timestamp };
  }
}

// ========== LLM Call for Report ==========
/**
 * Makes an LLM call specifically for report generation.
 * Reuses settings from chrome.storage but with a dedicated prompt.
 */
async function generateReportViaLLM(prompt, CONFIG) {
  const providerConfig = await getActiveProvider();
  const { endpoint, apiKey, model } = providerConfig;

  if (!apiKey) throw new Error('API key not configured');

  const provider = resolveProvider(endpoint, apiKey, model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeout || 45000);

  const reportSystemPrompt = 'You are an investigation report writer. Produce clean, professional markdown reports. Return ONLY the report content with no wrapping.';

  const requestBody = JSON.stringify(provider.buildBody(model, reportSystemPrompt, prompt, { maxTokens: 4000, temperature: 0.3 }));
  const requestHeaders = provider.buildHeaders(apiKey);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBody,
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Report LLM call failed: ${response.status} - ${errorData}`);
  }

  const data = await response.json();
  const responseText = provider.parseResponse(data);

  // Strip code fences if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  return cleaned;
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
    .filter(h => !['read_page', 'scroll', 'wait_for_text', 'wait_for_element', 'wait_for_navigation'].includes(h.action.type))
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
