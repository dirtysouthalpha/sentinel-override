// Sentinel Override v3 -- Scheduler
// Schedule CRUD, chrome.alarms management, execution bridge to agent,
// result storage, completion notifications, service worker restart recovery.
// Layer 3 module -- imports from agent-engine.js, template-manager.js, tab-context.js, tab-manager.js.

import * as AgentEngine from './agent-engine.js';
import { resolveTemplateGoal } from './template-manager.js';
 
import { getActiveTabId as _getActiveTabId, registerInitialTab } from './tab-context.js';
import { getTabInfo } from './tab-manager.js';
import { notifyIfEnabled } from './shared-state.js';
import { tel } from './telemetry.js';

// ========== Storage Constants ==========
const SCHEDULES_KEY = 'sentinel_schedules';
const RESULTS_KEY = 'sentinel_schedule_results';
const MAX_RESULTS = 50;

// ========== Agent Completion Callback ==========
let agentCompleteCallbacks = [];

/**
 * Register a callback to be invoked when the agent finishes running.
 * Used by the scheduler execution bridge to detect task completion.
 * @param {function} callback - Called with no arguments when agentRunning flips to false
 */
export function onAgentComplete(callback) {
  agentCompleteCallbacks.push(callback);
}

/**
 * Fire all registered agent-complete callbacks.
 * Called from the polling loop in executeScheduledTask.
 */
 
function _fireAgentCompleteCallbacks() {
  const cbs = agentCompleteCallbacks.slice();
  agentCompleteCallbacks = [];
  cbs.forEach(cb => { try { cb(); } catch (e) { console.error('Agent complete callback error:', e); } });
}

// ========== Storage Helpers ==========

/**
 * Load all schedules from chrome.storage.local.
 * @returns {Promise<Object<string, object>>}
 */
async function loadSchedules() {
  try {
    const result = await chrome.storage.local.get([SCHEDULES_KEY]);
    return result[SCHEDULES_KEY] || {};
  } catch (e) {
    console.warn('[Sentinel/scheduler] loadSchedules failed:', e && e.message);
    return {};
  }
}

/**
 * Persist all schedules to chrome.storage.local.
 * @param {Object<string, object>} schedules
 */
async function saveSchedules(schedules) {
  try {
    await chrome.storage.local.set({ [SCHEDULES_KEY]: schedules });
  } catch (e) {
    console.warn('[Sentinel/scheduler] saveSchedules failed:', e && e.message);
  }
}

/**
 * Load all results from chrome.storage.local.
 * @returns {Promise<Object<string, object>>}
 */
async function loadResults() {
  try {
    const result = await chrome.storage.local.get([RESULTS_KEY]);
    return result[RESULTS_KEY] || {};
  } catch (e) {
    console.warn('[Sentinel/scheduler] loadResults failed:', e && e.message);
    return {};
  }
}

/**
 * Persist all results to chrome.storage.local.
 * @param {Object<string, object>} results
 */
async function saveResults(results) {
  try {
    await chrome.storage.local.set({ [RESULTS_KEY]: results });
  } catch (e) {
    console.warn('[Sentinel/scheduler] saveResults failed:', e && e.message);
  }
}

// ========== Alarm Management ==========

/**
 * Register a chrome.alarm for the given schedule.
 * For 'once': alarm fires once at schedule.nextRunAt.
 * For 'recurring': alarm fires at nextRunAt and repeats at periodInMinutes.
 * @param {object} schedule
 */
function registerAlarm(schedule) {
  if (!schedule.nextRunAt) return;

  const alarmInfo = {
    when: schedule.nextRunAt,
  };

  if (schedule.type === 'recurring' && schedule.recurrence) {
    alarmInfo.periodInMinutes = schedule.recurrence.periodInMinutes;
  }

  const _alarmPromise = chrome.alarms.create(`schedule-${schedule.id}`, alarmInfo);
  if (_alarmPromise && typeof _alarmPromise.catch === 'function') _alarmPromise.catch((e) => {
    console.error('[_alarmPromise] Unhandled rejection:', e);
  });
  tel.debug('scheduler', `Alarm registered: schedule-${schedule.id} at ${new Date(schedule.nextRunAt).toISOString()}`);
}

/**
 * Clear the chrome.alarm for a given schedule ID.
 * @param {string} scheduleId
 */
function clearAlarm(scheduleId) {
  const _p = chrome.alarms.clear(`schedule-${scheduleId}`);
  if (_p && typeof _p.catch === 'function') _p.catch((e) => {
    console.error('[_p] Unhandled rejection:', e);
  });
  tel.debug('scheduler', `Alarm cleared: schedule-${scheduleId}`);
}

// ========== Time Computation ==========

/**
 * Compute the next run timestamp from a recurrence configuration.
 * @param {object} recurrence - { interval, periodInMinutes, daysOfWeek, time }
 * @returns {number} Timestamp in ms for the next run
 */
function computeNextRun(recurrence) {
  if (!recurrence) return Date.now();

  const timeParts = (recurrence.time || '09:00').split(':').map(Number);
  const hours = (Number.isFinite(timeParts[0]) && timeParts[0] >= 0 && timeParts[0] < 24) ? timeParts[0] : 9;
  const minutes = (Number.isFinite(timeParts[1]) && timeParts[1] >= 0 && timeParts[1] < 60) ? timeParts[1] : 0;
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

  if (recurrence.interval === 'daily') {
    // If the time has already passed today, add one day
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  if (recurrence.interval === 'weekly' && recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
    // Find the next matching day of the week
    const currentDay = now.getDay();
    let daysAhead = 0;

    // Sort daysOfWeek to find the next one
    const sortedDays = recurrence.daysOfWeek.sort((a, b) => a - b);

    // Find the first day that is >= today and time hasn't passed, or next week
    for (const day of sortedDays) {
      let diff = day - currentDay;
      if (diff < 0) diff += 7;
      if (diff === 0 && candidate.getTime() <= now.getTime()) diff = 7;
      if (daysAhead === 0 || diff < daysAhead) {
        daysAhead = diff;
      }
    }

    candidate.setDate(candidate.getDate() + daysAhead);
    return candidate.getTime();
  }

  if (recurrence.interval === 'custom') {
    // For custom, just add the period to now (or next whole period boundary)
    const periodMs = (recurrence.periodInMinutes || 60) * 60 * 1000;
    const nowMs = now.getTime();
    // Align to next period boundary from midnight
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const elapsed = nowMs - midnight;
    const periodsElapsed = Math.floor(elapsed / periodMs);
    const nextPeriod = midnight + (periodsElapsed + 1) * periodMs;

    // But also ensure it's at least 1 minute in the future
    if (nextPeriod <= nowMs + 60000) {
      return midnight + (periodsElapsed + 2) * periodMs;
    }
    return nextPeriod;
  }

  // Fallback: 1 hour from now
  return now.getTime() + 3600000;
}

// ========== Notifications ==========

/**
 * Send a chrome notification for a completed scheduled task.
 * @param {object} schedule
 * @param {object} result - { status, completedAt, error, report }
 */
function sendNotification(schedule, result) {
  const title = `Schedule ${schedule.name}`;
  let message;

  if (result.status === 'success') {
    message = `Completed successfully at ${new Date(result.completedAt).toLocaleTimeString()}.`;
    if (result.report) {
      const snippet = result.report.substring(0, 150).replace(/\n/g, ' ');
      message += ` ${snippet}${result.report.length > 150 ? '...' : ''}`;
    }
  } else {
    message = `Failed at ${new Date(result.completedAt).toLocaleTimeString()}.`;
    if (result.error) {
      message += ` Error: ${result.error.substring(0, 100)}`;
    }
  }

  notifyIfEnabled(`schedule-result-${result.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon-128.png'),
    title,
    message: message.substring(0, 500),
    priority: result.status === 'success' ? 0 : 2,
  });
}

// ========== Badge ==========

/**
 * Set the extension icon badge to indicate a pending result.
 * @param {string} status - 'success' or 'failure'
 */
function setBadge(status) {
  const _t = chrome.action.setBadgeText({ text: '1' });
  if (_t && typeof _t.catch === 'function') _t.catch((e) => {
    console.error('[_t] Unhandled rejection:', e);
  });
  const _b = chrome.action.setBadgeBackgroundColor({
    color: status === 'success' ? '#22c55e' : '#ef4444',
  });
  if (_b && typeof _b.catch === 'function') _b.catch((e) => {
    console.error('[_b] Unhandled rejection:', e);
  });
}

// ========== CRUD Operations ==========

/**
 * Create a new schedule.
 * @param {{ name: string, templateId?: string, goal?: string, params?: object, type: 'once'|'recurring', recurrence?: object, runAt?: number }} data
 * @returns {Promise<object>} The created schedule
 */
export async function createSchedule(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Schedule data must be an object');
  }
  if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
    throw new Error('Schedule name is required');
  }
  if (!data.templateId && (!data.goal || typeof data.goal !== 'string' || data.goal.trim() === '')) {
    throw new Error('Either templateId or goal is required');
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  let nextRunAt = null;
  let recurrence = null;

  if (data.type === 'once') {
    // runAt is a timestamp in ms; if not provided or in the past, use 1 hour from now
    if (data.runAt && data.runAt > now) {
      nextRunAt = data.runAt;
    } else {
      nextRunAt = now + 3600000;
    }
  } else if (data.type === 'recurring' && data.recurrence) {
    recurrence = {
      interval: data.recurrence.interval || 'daily',
      periodInMinutes: data.recurrence.periodInMinutes || 1440,
      daysOfWeek: data.recurrence.daysOfWeek || null,
      time: data.recurrence.time || '09:00',
    };

    // Compute periodInMinutes from interval if not explicitly provided
    if (!data.recurrence.periodInMinutes) {
      switch (recurrence.interval) {
        case 'daily':
          recurrence.periodInMinutes = 1440;
          break;
        case 'weekly':
          recurrence.periodInMinutes = 10080;
          break;
        // 'custom' keeps the user-provided value
      }
    }

    nextRunAt = computeNextRun(recurrence);
  } else {
    throw new Error('Schedule type must be "once" or "recurring" with recurrence config');
  }

  const schedule = {
    id,
    name: data.name.trim(),
    templateId: data.templateId || null,
    goal: data.goal || null,
    params: data.params || null,
    type: data.type,
    recurrence,
    enabled: true,
    nextRunAt,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: now,
  };

  const schedules = await loadSchedules();
  schedules[id] = schedule;
  await saveSchedules(schedules);

  // Register the alarm
  registerAlarm(schedule);

  return schedule;
}

/**
 * List all schedules, sorted by nextRunAt ascending (enabled first, then disabled).
 * @returns {Promise<Array<object>>}
 */
export async function listSchedules() {
  const schedules = await loadSchedules();
  const all = Object.values(schedules);

  const enabled = all.filter(s => s.enabled).sort((a, b) => (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity));
  const disabled = all.filter(s => !s.enabled).sort((a, b) => (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity));

  return [...enabled, ...disabled];
}

/**
 * Delete a schedule by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteSchedule(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Schedule ID is required');
  }

  const schedules = await loadSchedules();
  if (!schedules[id]) {
    throw new Error('Schedule not found: ' + id);
  }

  delete schedules[id];
  await saveSchedules(schedules);
  clearAlarm(id);

  // Clear all associated results
  const results = await loadResults();
  const resultIds = Object.keys(results).filter(rid => results[rid].scheduleId === id);
  for (const rid of resultIds) {
    delete results[rid];
  }
  if (resultIds.length > 0) {
    await saveResults(results);
  }
}

/**
 * Toggle a schedule's enabled state.
 * @param {string} id
 * @param {boolean} enabled
 * @returns {Promise<object>} The updated schedule
 */
export async function toggleSchedule(id, enabled) {
  if (!id || typeof id !== 'string') {
    throw new Error('Schedule ID is required');
  }
  if (typeof enabled !== 'boolean') {
    throw new Error('Enabled flag must be a boolean');
  }

  const schedules = await loadSchedules();
  const schedule = schedules[id];
  if (!schedule) {
    throw new Error('Schedule not found: ' + id);
  }

  schedule.enabled = enabled;

  if (enabled) {
    // Recompute nextRunAt if needed
    if (!schedule.nextRunAt || schedule.nextRunAt <= Date.now()) {
      if (schedule.recurrence) {
        schedule.nextRunAt = computeNextRun(schedule.recurrence);
      }
    }
    registerAlarm(schedule);
  } else {
    clearAlarm(id);
  }

  schedules[id] = schedule;
  await saveSchedules(schedules);

  return schedule;
}

/**
 * Calculate the next run time for a schedule.
 * @param {object} schedule
 * @returns {number|null} Timestamp in ms, or null
 */
export function getNextRunTime(schedule) {
  if (!schedule) return null;

  if (schedule.type === 'once') {
    return schedule.nextRunAt;
  }

  if (schedule.type === 'recurring' && schedule.recurrence) {
    return computeNextRun(schedule.recurrence);
  }

  return schedule.nextRunAt;
}

// ========== Execution Bridge ==========

/**
 * Execute a scheduled task when its alarm fires.
 * Called from chrome.alarms.onAlarm in index.js.
 *
 * Flow:
 * 1. Parse scheduleId from alarmName
 * 2. Load schedule, check enabled
 * 3. Check agentRunning -- skip if busy
 * 4. Resolve goal (template or direct)
 * 5. Create result record
 * 6. Find or open a tab, set up tab context
 * 7. Start agent
 * 8. Poll for completion (max 5 minutes)
 * 9. Update result and schedule
 * 10. Re-register alarm for recurring
 * 11. Send notification and set badge
 *
 * @param {string} alarmName - The alarm name (format: schedule-${scheduleId})
 */
export async function executeScheduledTask(alarmName) {
  // Parse scheduleId from alarm name
  const scheduleId = alarmName.replace('schedule-', '');
  if (!scheduleId) {
    console.error('Invalid alarm name:', alarmName);
    return;
  }

  // Load schedule
  const schedules = await loadSchedules();
  const schedule = schedules[scheduleId];
  if (!schedule) {
    console.warn(`Schedule ${scheduleId} not found, clearing orphan alarm`);
    clearAlarm(scheduleId);
    return;
  }
  if (!schedule.enabled) {
    tel.debug('scheduler', `Schedule ${schedule.name} is disabled, skipping`);
    return;
  }

  // Check if agent is already running
  if (AgentEngine.agentRunning) {
    tel.info('scheduler', `Agent busy, skipping schedule ${schedule.name}`);
    schedule.lastRunStatus = 'skipped';
    schedule.lastRunAt = Date.now();
    schedules[scheduleId] = schedule;
    await saveSchedules(schedules);

    // Re-register alarm for recurring schedules so they retry
    if (schedule.type === 'recurring' && schedule.recurrence) {
      schedule.nextRunAt = computeNextRun(schedule.recurrence);
      registerAlarm(schedule);
    }
    return;
  }

  // Resolve goal
  let goal;
  try {
    if (schedule.templateId) {
      goal = await resolveTemplateGoal(schedule.templateId, schedule.params || {});
    } else {
      goal = schedule.goal;
    }
  } catch (err) {
    console.error(`Failed to resolve goal for schedule ${schedule.name}:`, err);
    try {
      await storeResult(schedule, {
        status: 'failure',
        startedAt: Date.now(),
        completedAt: Date.now(),
        report: null,
        error: `Goal resolution failed: ${err.message}`,
      });
    } catch (storeErr) {
      console.error('Failed to store result for goal resolution failure:', storeErr);
    }
    schedule.lastRunStatus = 'failure';
    schedule.lastRunAt = Date.now();
    schedules[scheduleId] = schedule;
    await saveSchedules(schedules);
    if (schedule.type === 'recurring' && schedule.recurrence) {
      schedule.nextRunAt = computeNextRun(schedule.recurrence);
      registerAlarm(schedule);
    }
    return;
  }

  // Create result record
  const resultId = crypto.randomUUID();
  const startedAt = Date.now();

  tel.info('scheduler', `Executing scheduled task: ${schedule.name}`, { goal: goal.substring(0, 80) });

  // Find or open a tab
  let tabId;
  try {
    const tabs = await new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, (t) => resolve(t || []));
    });

    if (tabs && tabs.length > 0) {
      tabId = tabs[0].id;
    } else {
      // No active tab -- create one
      const newTab = await chrome.tabs.create({ url: 'about:blank' });
      tabId = newTab.id;
      // Give the tab a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('Failed to get/create tab:', err);
    try {
      await storeResult(schedule, {
        id: resultId,
        status: 'failure',
        startedAt,
        completedAt: Date.now(),
        report: null,
        error: `Tab creation failed: ${err.message}`,
      });
    } catch (storeErr) {
      console.error('Failed to store result for tab creation failure:', storeErr);
    }
    return;
  }

  // Set up tab context
  let tabInfo;
  try {
    tabInfo = await getTabInfo(tabId);
  } catch {
    tabInfo = null;
  }
  registerInitialTab(tabId, tabInfo?.url || '');

  // Start the agent
  try {
    await AgentEngine.startAgent(goal, { tab: { id: tabId } });
  } catch (err) {
    console.error('Failed to start agent:', err);
    try {
      await storeResult(schedule, {
        id: resultId,
        status: 'failure',
        startedAt,
        completedAt: Date.now(),
        report: null,
        error: `Agent start failed: ${err.message}`,
      });
    } catch (storeErr) {
      console.error('Failed to store result for agent start failure:', storeErr);
    }
    schedule.lastRunStatus = 'failure';
    schedule.lastRunAt = Date.now();
    schedules[scheduleId] = schedule;
    await saveSchedules(schedules);
    if (schedule.type === 'recurring' && schedule.recurrence) {
      schedule.nextRunAt = computeNextRun(schedule.recurrence);
      registerAlarm(schedule);
    }
    return;
  }

  // Wait for agent completion via messaging (replaces polling)
  const completionResult = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ status: 'failure', error: 'Agent execution timed out after 5 minutes', report: null });
    }, 5 * 60 * 1000);

    const listener = (msg) => {
      if (msg.action === 'agent_loop_complete') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ status: 'success', error: null, report: msg.report || null });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });

  const completedAt = Date.now();
  const finalResult = {
    id: resultId,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    templateId: schedule.templateId,
    goal,
    status: completionResult.status,
    startedAt,
    completedAt,
    report: completionResult.report,
    error: completionResult.error,
  };

  // Store result — wrap to prevent silent data loss on storage errors
  try {
    await storeResult(schedule, finalResult);
  } catch (e) {
    console.error('Failed to store scheduled task result:', e);
    try { tel.error('scheduler', 'Failed to store result', { error: e && e.message }); } catch (_) {}
  }

  // Update schedule -- consolidate all mutations into a single save
  schedule.lastRunAt = completedAt;
  schedule.lastRunStatus = completionResult.status;

  // Re-register alarm for recurring schedules
  if (schedule.type === 'recurring' && schedule.recurrence) {
    schedule.nextRunAt = computeNextRun(schedule.recurrence);
    registerAlarm(schedule);
  }

  // Disable one-time schedules after execution
  if (schedule.type === 'once') {
    schedule.enabled = false;
  }

  schedules[scheduleId] = schedule;
  try {
    await saveSchedules(schedules);
  } catch (e) {
    console.error('Failed to save schedule state after execution:', e);
    try { tel.error('scheduler', 'Failed to save schedule state', { error: e && e.message }); } catch (_) {}
  }

  // Send notification
  sendNotification(schedule, finalResult);

  // Set badge
  setBadge(finalResult.status);

  tel.info('scheduler', `Scheduled task ${schedule.name} completed`, { status: finalResult.status });
}

/**
 * Store a result record, enforcing the MAX_RESULTS cap per schedule.
 * @param {object} schedule
 * @param {object} result
 */
async function storeResult(schedule, result) {
  const results = await loadResults();

  // Ensure result has all required fields
  const fullResult = {
    id: result.id || crypto.randomUUID(),
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    templateId: schedule.templateId,
    goal: result.goal || schedule.goal,
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    report: result.report || null,
    error: result.error || null,
  };

  results[fullResult.id] = fullResult;

  // Enforce cap: keep only the most recent MAX_RESULTS per schedule
  const scheduleResultIds = Object.keys(results)
    .filter(rid => results[rid].scheduleId === schedule.id)
    .sort((a, b) => (results[b].completedAt || 0) - (results[a].completedAt || 0));

  if (scheduleResultIds.length > MAX_RESULTS) {
    const toRemove = scheduleResultIds.slice(MAX_RESULTS);
    for (const rid of toRemove) {
      delete results[rid];
    }
  }

  await saveResults(results);
  return fullResult;
}

// ========== Report Retrieval ==========

/**
 * Wait for the report from the last agent run to be written to storage.
 * The agent engine stores it under 'last_agent_report' after generation.
 * @param {number} timeoutMs - Max time to wait for report
 * @returns {Promise<object|null>} Report object or null if unavailable
 */
 
function _waitForReport(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = setInterval(async () => {
      try {
        const stored = await chrome.storage.local.get(['last_agent_report']);
        if (stored.last_agent_report) {
          clearInterval(poll);
          await chrome.storage.local.remove('last_agent_report');
          resolve(stored.last_agent_report);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          resolve(null);
        }
      } catch (e) {
        console.warn('[Sentinel] _waitForReport poll error:', e && e.message);
        clearInterval(poll);
        resolve(null);
      }
    }, 2000);
  });
}

// ========== Result Queries ==========

/**
 * Get results for a specific schedule, sorted by completedAt desc, limited to 20.
 * @param {string} scheduleId
 * @returns {Promise<Array<object>>}
 */
export async function getScheduleResults(scheduleId) {
  if (!scheduleId || typeof scheduleId !== 'string') return [];

  const results = await loadResults();
  return Object.values(results)
    .filter(r => r.scheduleId === scheduleId)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, 20);
}

/**
 * Get recent results across all schedules, sorted by completedAt desc.
 * @param {number} [limit=20]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentResults(limit = 20) {
  const results = await loadResults();
  return Object.values(results)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, limit);
}

/**
 * Clear all results for a specific schedule.
 * @param {string} scheduleId
 * @returns {Promise<void>}
 */
export async function clearScheduleResults(scheduleId) {
  if (!scheduleId || typeof scheduleId !== 'string') {
    throw new Error('Schedule ID is required');
  }

  const results = await loadResults();
  const toRemove = Object.keys(results).filter(rid => results[rid].scheduleId === scheduleId);
  for (const rid of toRemove) {
    delete results[rid];
  }
  await saveResults(results);
}

// ========== Initialization ==========

/**
 * Initialize the scheduler on service worker startup.
 * Re-registers alarms for all enabled schedules that don't already have one.
 * This handles browser restart alarm loss.
 */
export async function initScheduler() {
  tel.info('scheduler', 'Initializing scheduler...');
  const schedules = await loadSchedules();

  for (const [id, schedule] of Object.entries(schedules)) {
    if (!schedule.enabled) continue;

    try {
      const alarm = await new Promise(resolve => {
        chrome.alarms.get(`schedule-${id}`, (a) => resolve(a));
      });

      if (!alarm) {
        // Recompute nextRunAt if it's in the past
        if (!schedule.nextRunAt || schedule.nextRunAt <= Date.now()) {
          if (schedule.recurrence) {
            schedule.nextRunAt = computeNextRun(schedule.recurrence);
          } else {
            schedule.nextRunAt = Date.now() + 3600000; // 1 hour from now
          }
          schedules[id] = schedule;
        }
        registerAlarm(schedule);
        tel.debug('scheduler', `Re-registered alarm for schedule: ${schedule.name}`);
      }
    } catch (err) {
      console.error(`Failed to check/register alarm for schedule ${schedule.name}:`, err);
    }
  }

  // Save any updated schedules
  await saveSchedules(schedules);
  tel.info('scheduler', `Scheduler initialized. ${Object.values(schedules).filter(s => s.enabled).length} enabled schedules.`);
}
