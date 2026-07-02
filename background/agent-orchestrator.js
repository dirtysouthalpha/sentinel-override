// Sentinel Override v21.6.53 — Agent Orchestrator
// Decomposes complex multi-section prompts into sequential single-page sub-tasks.
// Each sub-task runs as its own focused agent loop iteration.

import { getErrorMessage } from './error-utils.js';

/**
 * Heuristic detection of complex multi-section goals.
 * Returns true if the goal should be decomposed.
 */
export function isComplexGoal(goal) {
  if (!goal || typeof goal !== 'string') return false;
  const trimmed = goal.trim();

  // Must be reasonably long
  if (trimmed.length < 100) return false;

  // Check for numbered sections (1. 2. 3. etc.)
  const numberedSections = trimmed.match(/\n\s*\d+[.)]\s+[A-Z]/g);
  if (numberedSections && numberedSections.length >= 2) return true;

  // Check for multiple "Navigate to" instructions
  const navigateCount = (trimmed.match(/Navigate to/gi) || []).length;
  if (navigateCount >= 2) return true;

  // Check for markdown headers (## or ###)
  const headerSections = trimmed.match(/^#{2,3}\s/gm);
  if (headerSections && headerSections.length >= 2) return true;

  // Check for explicit INVESTIGATION TASKS / TASK list patterns
  if (/INVESTIGATION+TASKS|TASK+LIST|SECTIONS?:/i.test(trimmed)) return true;

  // Check for "For each" + multiple items pattern
  const forEachSections = trimmed.match(/For each/gi);
  if (forEachSections && forEachSections.length >= 2) return true;

  return false;
}

/**
 * Build the decomposition prompt for the LLM.
 * The LLM breaks the complex goal into simple single-page sub-tasks.
 */
export function buildDecompositionPrompt(goal) {
  return `You are a task decomposition engine. Break this complex investigation goal into simple, sequential sub-tasks.

COMPLEX GOAL:
${goal.substring(0, 3000)}

RULES:
1. Each sub-task must be achievable on a SINGLE page (navigate + extract + done)
2. Each sub-task must have a clear, simple instruction
3. Order sub-tasks logically (dashboard first, then specific pages)
4. Maximum 8 sub-tasks
5. Each sub-task should take no more than 15 steps to complete

Return a JSON object with this exact structure:
{
  "subtasks": [
    {
      "title": "Short title (e.g., WAN IP Address)",
      "goal": "Simple instruction: Go to [URL or menu path], extract [specific data], then call done()",
      "context": "What we already know or need to find"
    }
  ]
}

Return ONLY the JSON. No markdown, no explanation.`;
}

/**
 * Parse the LLM's decomposition response.
 */
export function parseDecomposition(response) {
  if (!response || typeof response !== 'string') return null;

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(response);
    if (parsed.subtasks && Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0) {
      return parsed.subtasks.map((s, i) => ({
        title: s.title || `Task ${i + 1}`,
        goal: s.goal || s.task || '',
        context: s.context || ''
      })).filter(s => s.goal.length > 5);
    }
  } catch (_) {
    // Not clean JSON, try to extract
  }

  // Try to find JSON in the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = (() => { try { return JSON.parse(jsonMatch[0]); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
      if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
        return parsed.subtasks.map((s, i) => ({
          title: s.title || `Task ${i + 1}`,
          goal: s.goal || s.task || '',
          context: s.context || ''
        })).filter(s => s.goal.length > 5);
      }
    } catch (_) {
      // Failed to parse
    }
  }

  return null;
}

/**
 * Build the focused goal for a single sub-task, including context from
 * previous sub-task results so the agent knows what was already found.
 */
export function buildSubTaskGoal(subtask, originalGoal, index, total, accumulatedResults) {
  const prevResults = accumulatedResults.length > 0
    ? accumulatedResults.map((r, i) => `[Task ${i + 1}: ${r.title}]
Findings: ${r.summary.substring(0, 500)}`).join('\n\n---\n\n')
    : 'None yet (this is the first task).';

  // Extract any URL hints from the original goal
  const urls = originalGoal.match(/https?:\/\/[^\s\)]+/g);
  const urlHint = urls && urls.length > 0 ? urls[0] : '';

  return `ORCHESTRATED SUB-TASK ${index + 1} of ${total}: ${subtask.title}

PREVIOUS FINDINGS:
${prevResults}

YOUR TASK:
${subtask.goal}
${urlHint ? `\nSTARTING URL: ${urlHint}` : ''}
${subtask.context ? `\nCONTEXT: ${subtask.context}` : ''}

INSTRUCTIONS:
- This is ONE focused task within a larger investigation.
- Navigate to the page, extract the requested data using execute_js, then immediately call done() with your findings.
- Do NOT try to do other tasks — those will be handled in subsequent sub-tasks.
- Keep your extraction focused and structured.
- Call done() as soon as you have the data.`;
}

/**
 * Orchestrator state (module-level, reset per run).
 */
export function createOrchestratorState() {
  return {
    subtasks: [],
    currentIndex: 0,
    accumulatedResults: [],
    originalGoal: '',
    active: false,
    totalApiCalls: 0,
    totalSteps: 0,
  };
}
