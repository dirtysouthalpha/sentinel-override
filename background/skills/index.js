// background/skills/index.js
// Recovery Skill Library — v3.21.0
//
// When the agent hits a failure pattern (click with no target, navigate loop,
// unproductive extract, etc.), the engine consults this library and either:
//   • Auto-applies a deterministic recovery action (no LLM call needed) — fast
//   • Injects a recovery directive into the next LLM prompt — when the
//     situation needs the LLM to choose between alternatives
//
// Skills are independently testable, individually disable-able, and the
// library grows as new failure patterns surface in real runs.
//
// Skill module shape:
//   export const mySkill = {
//     id: 'unique-id',
//     description: 'Human-readable description',
//     priority: 50,                     // Higher fires first when multiple match
//     matches: (ctx) => boolean,        // Should this skill fire for the current context?
//     autoApply: (ctx) => command|null, // Deterministic recovery command, or null to defer
//     promptInjection: (ctx) => string, // Directive appended to system prompt, or '' to skip
//   };
//
// Context shape passed to every skill:
//   {
//     lastCommand,        // The most-recent command the agent emitted (null on first step)
//     lastResult,         // String result of last action
//     lastActionFailed,   // Boolean
//     history,            // Sliced recent history array
//     consecutiveFailures,
//     agentMemory,        // {key: value}
//     stepCount,
//     dynamicMaxSteps,    // Total step budget for this run
//     currentUrl,
//     allElements,        // Latest observed element list
//     pageText,           // Latest observed page text
//     lastAiCallMs,       // ms the most recent LLM call took (or null)
//     consecutiveNavigates,
//     productiveSteps,
//   }
//
// Return shape from runRecoverySkills:
//   {
//     autoApply: command|null,       // If non-null, engine dispatches this instead of consulting LLM
//     promptInjection: string,       // Combined injection text (may be '')
//     appliedSkillIds: string[],     // For activity stream + forensic log
//   }

import { clickNoTarget } from './click-no-target.js';
import { navigateLoop } from './navigate-loop.js';
import { unproductiveExtract } from './unproductive-extract.js';
import { selectorMiss } from './selector-miss.js';
import { consecutiveFailures } from './consecutive-failures.js';
import { emptyObservation } from './empty-observation.js';
import { slowLlmCall } from './slow-llm-call.js';
import { cspBlocked } from './csp-blocked.js';

// Order matters when multiple skills match — higher priority fires first for
// autoApply. All matching skills contribute to promptInjection regardless.
const SKILLS = [
  cspBlocked,
  clickNoTarget,
  navigateLoop,
  selectorMiss,
  unproductiveExtract,
  emptyObservation,
  consecutiveFailures,
  slowLlmCall,
];

/**
 * Run the recovery skill library against the current agent context.
 * Returns the first applicable skill's autoApply (if any) and the combined
 * promptInjection from all matching skills.
 *
 * @param {object} context See module header for shape.
 * @returns {{autoApply: object|null, promptInjection: string, appliedSkillIds: string[]}}
 */
export function runRecoverySkills(context) {
  const result = { autoApply: null, promptInjection: '', appliedSkillIds: [] };
  if (!context || typeof context !== 'object') return result;

  const matches = [];
  for (const skill of SKILLS) {
    if (!skill || typeof skill.matches !== 'function') continue;
    try {
      if (skill.matches(context)) {
        matches.push(skill);
      }
    } catch (e) {
      // Skill predicate threw — skip, don't crash the loop
      try { console.warn('[Sentinel/skills] predicate error in', skill.id, ':', e && e.message); } catch (ee) {}
    }
  }
  if (matches.length === 0) return result;

  // Sort by priority descending
  matches.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // First skill with a non-null autoApply wins — engine dispatches that
  // command instead of consulting the LLM next step.
  for (const skill of matches) {
    if (typeof skill.autoApply === 'function') {
      try {
        const cmd = skill.autoApply(context);
        if (cmd && typeof cmd === 'object' && cmd.type) {
          result.autoApply = cmd;
          result.appliedSkillIds.push(skill.id);
          break;
        }
      } catch (e) {
        try { console.warn('[Sentinel/skills] autoApply error in', skill.id, ':', e && e.message); } catch (ee) {}
      }
    }
  }

  // All matching skills contribute their promptInjection. Concatenate so
  // the LLM sees every recovery angle, not just the first.
  const injections = [];
  for (const skill of matches) {
    if (typeof skill.promptInjection !== 'function') continue;
    try {
      const text = skill.promptInjection(context);
      if (text && typeof text === 'string' && text.trim().length > 0) {
        injections.push('### Recovery skill: ' + skill.id + '\n' + text.trim());
        if (!result.appliedSkillIds.includes(skill.id)) {
          result.appliedSkillIds.push(skill.id);
        }
      }
    } catch (e) {
      try { console.warn('[Sentinel/skills] promptInjection error in', skill.id, ':', e && e.message); } catch (ee) {}
    }
  }
  if (injections.length > 0) {
    result.promptInjection = '\n\n## ⚙ RECOVERY DIRECTIVES (Sentinel skill library)\nThe engine detected a pattern that suggests a different strategy. Read these before deciding your next action:\n\n' + injections.join('\n\n') + '\n';
  }

  return result;
}

/** Lightweight listing for UI / debugging. */
export function listSkills() {
  return SKILLS.map(s => ({ id: s.id, description: s.description, priority: s.priority || 0 }));
}
