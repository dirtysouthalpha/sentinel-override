// background/skills/index.js
// Recovery Skill Library — v3.21.0
//
// When the agent hits a failure pattern (click with no target, navigate loop,
// unproductive extract, etc.), the engine consults this library and either:
//   - Auto-applies a deterministic recovery action (no LLM call needed) — fast
//   - Injects a recovery directive into the next LLM prompt — when the
//     situation needs the LLM to choose between alternatives

import { clickNoTarget } from './click-no-target.js';
import { navigateLoop } from './navigate-loop.js';
import { unproductiveExtract } from './unproductive-extract.js';
import { selectorMiss } from './selector-miss.js';
import { consecutiveFailures } from './consecutive-failures.js';
import { emptyObservation } from './empty-observation.js';
import { slowLlmCall } from './slow-llm-call.js';
import { cspBlocked } from './csp-blocked.js';
import { tel } from '../telemetry.js';

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

// (3.29.0) Adaptive Skill Priority
const STATS_KEY = 'skill_stats';
const ADAPT_ENABLED_KEY = 'telemetrySkillAdapt';
const MIN_FIRES_FOR_ADJUSTMENT = 3;
const MAX_PRIORITY_DELTA = 20;
let _stats = {};
let _adaptEnabled = true;
let _pendingOutcomeSkillIds = [];
let _saveStatsTimer = null;

(function loadAdaptiveState() {
  try {
    chrome.storage.local.get([STATS_KEY, ADAPT_ENABLED_KEY], (r) => {
      if (r && r[STATS_KEY] && typeof r[STATS_KEY] === 'object') _stats = r[STATS_KEY];
      if (r && r[ADAPT_ENABLED_KEY] === false) _adaptEnabled = false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[ADAPT_ENABLED_KEY]) {
        const v = changes[ADAPT_ENABLED_KEY].newValue;
        _adaptEnabled = (v === undefined || v === null) ? true : !!v;
      }
      if (changes[STATS_KEY]) {
        const v = changes[STATS_KEY].newValue;
        _stats = (v && typeof v === 'object') ? v : {};
      }
    });
  } catch (e) { console.warn('[Sentinel/skills] init error:', e && e.message); }
})();

function _scheduleSaveStats() {
  if (_saveStatsTimer) return;
  _saveStatsTimer = setTimeout(() => {
    _saveStatsTimer = null;
    try { chrome.storage.local.set({ [STATS_KEY]: _stats }); } catch (e) { console.warn('[Sentinel/skills] stats save error:', e && e.message); }
  }, 1500);
}

function _effectivePriority(skill) {
  const base = (skill && typeof skill.priority === 'number') ? skill.priority : 0;
  if (!_adaptEnabled) return base;
  const stat = _stats[skill.id];
  if (!stat || stat.fires < MIN_FIRES_FOR_ADJUSTMENT) return base;
  const rate = stat.successes / Math.max(stat.fires, 1);
  const delta = Math.round((rate - 0.5) * 2 * MAX_PRIORITY_DELTA);
  return base + delta;
}

function _recordPendingOutcomes(context) {
  if (_pendingOutcomeSkillIds.length === 0) return;
  if (typeof context.lastActionFailed !== 'boolean') {
    _pendingOutcomeSkillIds = [];
    return;
  }
  const success = !context.lastActionFailed;
  const now = Date.now();
  for (const skillId of _pendingOutcomeSkillIds) {
    if (!_stats[skillId]) _stats[skillId] = { fires: 0, successes: 0, failures: 0, lastFiredAt: 0, lastOutcomeAt: 0 };
    _stats[skillId].fires++;
    if (success) _stats[skillId].successes++;
    else _stats[skillId].failures++;
    _stats[skillId].lastOutcomeAt = now;
    try {
      tel.debug('skill', 'Skill outcome: ' + skillId + ' -> ' + (success ? 'success' : 'failure'), {
        skillId,
        success,
        fires: _stats[skillId].fires,
        successes: _stats[skillId].successes,
        failures: _stats[skillId].failures,
        successRate: _stats[skillId].successes / _stats[skillId].fires,
        adjustedPriority: _effectivePriority({ id: skillId, priority: (SKILLS.find(s => s.id === skillId) || {}).priority })
      });
    } catch (te) { /* telemetry logging failure is non-critical */ }
  }
  _pendingOutcomeSkillIds = [];
  _scheduleSaveStats();
}

export async function resetSkillStats() {
  _stats = {};
  _pendingOutcomeSkillIds = [];
  try { await chrome.storage.local.remove(STATS_KEY); } catch (e) { console.warn('[Sentinel/skills] stats clear error:', e && e.message); }
  try { tel.info('skill', 'Skill outcome stats reset', {}); } catch (e) { /* telemetry unavailable */ }
}

export function getSkillStats() {
  const out = {};
  for (const [k, v] of Object.entries(_stats)) {
    out[k] = { ...v };
    const skill = SKILLS.find(s => s.id === k);
    out[k].basePriority = skill ? (skill.priority || 0) : null;
    out[k].effectivePriority = skill ? _effectivePriority(skill) : null;
    out[k].successRate = v.fires > 0 ? v.successes / v.fires : null;
  }
  return out;
}

export function runRecoverySkills(context) {
  const result = { autoApply: null, promptInjection: '', appliedSkillIds: [] };
  if (!context || typeof context !== 'object') return result;

  _recordPendingOutcomes(context);

  const matches = [];
  for (const skill of SKILLS) {
    if (!skill || typeof skill.matches !== 'function') continue;
    try {
      if (skill.matches(context)) {
        matches.push(skill);
        try {
          tel.debug('skill', 'Skill matched: ' + skill.id, {
            skillId: skill.id,
            priority: skill.priority || 0,
            stepCount: context.stepCount,
            consecutiveFailures: context.consecutiveFailures,
            lastActionFailed: !!context.lastActionFailed,
            lastCommandType: context.lastCommand ? context.lastCommand.type : null
          });
        } catch (te) { /* telemetry failure is non-critical */ }
      }
    } catch (e) {
      try { tel.error('skill', 'Skill predicate threw: ' + skill.id, { skillId: skill.id, error: e && e.message }); } catch (te) { /* telemetry unavailable */ }
      try { console.warn('[Sentinel/skills] predicate error in', skill.id, ':', e && e.message); } catch (ee) {}
    }
  }
  if (matches.length === 0) return result;

  matches.sort((a, b) => _effectivePriority(b) - _effectivePriority(a));

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
    result.promptInjection = '\n\n## RECOVERY DIRECTIVES (Sentinel skill library)\nThe engine detected a pattern that suggests a different strategy. Read these before deciding your next action:\n\n' + injections.join('\n\n') + '\n';
  }

  if (result.appliedSkillIds.length > 0) {
    const now = Date.now();
    _pendingOutcomeSkillIds = result.appliedSkillIds.slice();
    for (const id of result.appliedSkillIds) {
      if (!_stats[id]) _stats[id] = { fires: 0, successes: 0, failures: 0, lastFiredAt: 0, lastOutcomeAt: 0 };
      _stats[id].lastFiredAt = now;
    }
    _scheduleSaveStats();
  }

  return result;
}

export function listSkills() {
  return SKILLS.map(s => ({
    id: s.id,
    description: s.description,
    priority: s.priority || 0,
    effectivePriority: _effectivePriority(s),
    stats: _stats[s.id] ? { ...(_stats[s.id]) } : null
  }));
}
