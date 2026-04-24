// Sentinel Override v3 -- Agent Engine
// Agent loop, planning, self-healing, state management.
// Imports from llm-client.js, tab-manager.js, message-protocol.js.

import { callLLMWithRetry, generatePlan, supportsVision, getPlatformContext, getRelevantPatterns } from './llm-client.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo } from './tab-manager.js';
import { sendSilentUpdate, sendActionMessage, sendActionResult } from './message-protocol.js';

// ========== Agent State ==========
let agentRunning = false;
let agentTabId = null;
let apiCallCount = 0;
let lastApiCallTime = 0;
let lastScreenshotUrl = null;
let cachedBase64Image = null;
let agentMemory = {};           // Extract-and-remember: carries data between pages
let consecutiveFailures = 0;    // Self-healing: tracks failures for strategy shift
let currentStrategies = [];     // Self-healing: remembers tried approaches
let agentPlan = null;           // Planning phase: numbered list of steps
let currentPlanStep = 0;        // Planning phase: which step we're currently on

// Expose agentRunning and agentTabId as mutable exports for index.js
export { agentRunning, agentTabId };

// ========== Configuration ==========
const CONFIG = {
  minDelayBetweenCalls: 2000,
  maxRetries: 3,
  retryDelay: 5000,
  maxRetryDelay: 30000,
  screenshotQuality: 30,
  fetchTimeout: 45000,
  pageLoadTimeout: 25000,
  maxSteps: 120,
  maxPageContentLength: 16000,
  maxElements: 80,
  maxSelectorLength: 200,
  historyWindow: 5,
  screenshotCache: true,
  maxMemoryEntries: 50,
  maxHistoryEntries: 40,
  maxStoredHistory: 20,
  maxLearnedPatterns: 100,
  strategyShiftThreshold: 3,
  stallConfig: {
    similarityWindow: 3,        // Look at last N actions for repeated identical failures
    maxConsecutiveFailures: 5,  // Hard limit: force recovery after this many total failures
    stateRecheckSteps: 3,       // After N same-result steps, force re-scan
  },
};

// ========== State Reset ==========
export function resetAgentState() {
  apiCallCount = 0;
  lastApiCallTime = 0;
  lastScreenshotUrl = null;
  cachedBase64Image = null;
  agentMemory = {};
  consecutiveFailures = 0;
  currentStrategies = [];
  agentPlan = null;
  currentPlanStep = 0;
}

// ========== Agent Lifecycle ==========
export async function startAgent(goal, sender) {
  if (agentRunning) throw new Error('Agent already running');

  // Determine which tab to operate on
  if (!sender.tab || !sender.tab.id) {
    const tabs = await new Promise(resolve => { chrome.tabs.query({active: true, currentWindow: true}, (t) => resolve(t)); });
    if (tabs && tabs.length > 0) {
      agentTabId = tabs[0].id;
    } else {
      throw new Error('No active tab found');
    }
  } else {
    agentTabId = sender.tab.id;
  }

  agentRunning = true;
  resetAgentState();
  runAgentLoop(goal, agentTabId);
  return 'Agent started in background';
}

export function stopAgent() {
  agentRunning = false;
  agentTabId = null;
  return 'Agent stopped';
}

// ========== Stall Detection ==========
function detectStall(history, consecutiveFailures, currentStrategies) {
  const recent = history.slice(-CONFIG.stallConfig.similarityWindow);

  // Check 1: All recent actions are the same type with the same failure result
  if (recent.length >= CONFIG.stallConfig.similarityWindow) {
    const allSameType = recent.every(h => h.action.type === recent[0].action.type);
    const allSameResult = recent.every(h => h.result === recent[0].result);
    const allFailed = recent.every(h =>
      h.result.includes('not found') ||
      h.result.startsWith('Error') ||
      h.result.includes('timed out') ||
      h.result.includes('Element not found') ||
      h.result.includes('No element')
    );

    if (allSameType && allSameResult && allFailed) {
      return {
        stalled: true,
        reason: `Repeated "${recent[0].action.type}" with same failure: "${recent[0].result}"`,
        recoveryAction: 'RESCAN_AND_REPLAN'
      };
    }
  }

  // Check 2: High consecutive failures regardless of action type
  if (consecutiveFailures >= CONFIG.stallConfig.maxConsecutiveFailures) {
    return {
      stalled: true,
      reason: `${consecutiveFailures} consecutive failures without progress`,
      recoveryAction: 'FORCE_STRATEGY_SHIFT'
    };
  }

  return { stalled: false };
}

// ========== Main Agent Loop ==========
async function runAgentLoop(goal, workingTabId) {
  console.log('Agent starting loop for goal:', goal);
  let finished = false;
  let history = [];
  let stepCount = 0;
  agentPlan = null;
  currentPlanStep = 0;

  const stored = await chrome.storage.local.get(['agent_history', 'agent_context', 'agent_memory']);
  await chrome.storage.local.set({ agent_history: [] });

  if (stored.agent_context && stored.agent_context.trim()) {
    goal = `Previous context: ${stored.agent_context.trim()}\n\nCurrent goal: ${goal}`;
  }

  let consecutiveNavigates = 0;

  // Generate a plan before execution
  sendSilentUpdate('Planning task...');
  const planSettings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);

  // Gather context for plan generation
  const currentTabInfo = await getTabInfo(workingTabId);
  const platformCtx = getPlatformContext(
    currentTabInfo?.url || '',
    goal
  );
  const patterns = await getRelevantPatterns(goal);

  agentPlan = await generatePlan(goal, planSettings, {
    currentUrl: currentTabInfo?.url || '',
    pageTitle: currentTabInfo?.title || '',
    platformContext: platformCtx,
    relevantPatterns: patterns
  });
  if (agentPlan) {
    sendSilentUpdate(`Plan ready (${agentPlan.length} steps): ${agentPlan[0]}`);
  } else {
    sendSilentUpdate('No plan generated -- running in direct mode');
  }

  // Screenshot cache ref (mutable, passed to takeScreenshot)
  const screenshotCache = { cachedBase64Image: null, lastScreenshotUrl: null };

  while (!finished && agentRunning) {
    try {
      stepCount++;
      if (stepCount > CONFIG.maxSteps) {
        sendSilentUpdate(`Reached step limit (${CONFIG.maxSteps}). Finishing.`, stepCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Reached step limit of ${CONFIG.maxSteps}. Task may be incomplete.` }).catch(() => {});
        break;
      }

      let tab = workingTabId;

      // Get tab info
      let tabInfo = await getTabInfo(tab);

      if (!tabInfo) {
        sendSilentUpdate('Agent tab lost. Attempting recovery...', stepCount);
        const allTabs = await new Promise(resolve => { chrome.tabs.query({}, (t) => resolve(t)); });
        const lostTab = allTabs.find(t => t.id === workingTabId);
        if (lostTab) { tabInfo = lostTab; }
        else {
          sendSilentUpdate('Agent tab was closed. Task stopped.', stepCount);
          chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'Agent tab closed. Task interrupted.' }).catch(() => {});
          break;
        }
      }

      // Wait for page load
      if (tabInfo.status !== 'complete') {
        sendSilentUpdate('Waiting for page to load...', stepCount);
        await waitForPageLoad(tab);
        await sleep(500);
      }

      // Redirect internal pages
      if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('edge://') || tabInfo.url.startsWith('about:')) {
        sendSilentUpdate('Internal page -- navigating to Google', stepCount);
        await chrome.tabs.update(tab, { url: 'https://www.google.com' });
        await sleep(3000);
        continue;
      }

      sendSilentUpdate('Observing page...', stepCount);

      // Inject content script
      const scriptReady = await injectContentScript(tab);
      if (!scriptReady) { sendSilentUpdate('Content script failed -- retrying', stepCount); await sleep(2000); continue; }

      // Get page data
      let observation, pageContent;
      try {
        observation = await sendMessageWithRetry(tab, { action: 'observe_page' });
        pageContent = await sendMessageWithRetry(tab, { action: 'read_page' });
      } catch (err) {
        sendSilentUpdate(`Error reading page: ${err.message}`, stepCount);
        await sleep(2000);
        continue;
      }

      // Screenshot (CDP with cache)
      const freshTabInfo = await getTabInfo(tab);
      if (!freshTabInfo) { await sleep(1000); continue; }

      const currentUrl = (freshTabInfo && freshTabInfo.url) || tabInfo.url;

      let base64Image = null;
      const modelForScreenshot = (await chrome.storage.local.get(['model'])).model || 'glm-5.1';
      if (supportsVision(modelForScreenshot)) {
        // Sync local cache vars with screenshotCache ref
        if (screenshotCache.cachedBase64Image) cachedBase64Image = screenshotCache.cachedBase64Image;
        if (screenshotCache.lastScreenshotUrl) lastScreenshotUrl = screenshotCache.lastScreenshotUrl;

        const shotResult = await takeScreenshot(tab, freshTabInfo.windowId, currentUrl, screenshotCache, CONFIG, stepCount, sendSilentUpdate);
        if (shotResult) {
          base64Image = shotResult.base64Image;
          cachedBase64Image = base64Image;
          lastScreenshotUrl = currentUrl;
        }
      }

      // Truncate page content
      let pageText = (pageContent && pageContent.content) || '';
      const effectiveMaxLength = (goal && /PHASE\s+\d|RUNBOOK|INVESTIGATION|checkpoint|TICKET/i.test(goal))
        ? 28000
        : CONFIG.maxPageContentLength;
      if (pageText.length > effectiveMaxLength) {
        pageText = pageText.substring(0, effectiveMaxLength) + '\n\n[... content truncated]';
      }

      // Build capped element list
      const allElements = (observation && observation.elements) ? observation.elements : [];
      const priorityTypes = ['button', 'input', 'select', 'textarea'];
      const priorityEls = allElements.filter(e => priorityTypes.some(t => e.selector && e.selector.toLowerCase().includes(t)));
      const otherEls    = allElements.filter(e => !priorityTypes.some(t => e.selector && e.selector.toLowerCase().includes(t)));
      const trimmedElements = [...priorityEls, ...otherEls]
        .slice(0, CONFIG.maxElements)
        .map(e => ({
          ...e,
          text: e.text && e.text.length > 80 ? e.text.substring(0, 77) + '...' : e.text
        }));

      // Rate limiting
      await enforceRateLimit();

      // Progress indicator
      let apiWaitSeconds = 0;
      const progressTimer = setInterval(() => {
        apiWaitSeconds += 5;
        sendSilentUpdate(`Consulting AI... (${apiWaitSeconds}s)`, stepCount);
      }, 5000);

      sendSilentUpdate(`Consulting AI -- call #${apiCallCount + 1}`, stepCount);
      let command;
      try {
        command = await callLLMWithRetry(
          trimmedElements, allElements.length, pageText, base64Image,
          goal, history, stepCount, currentUrl,
          0, // retryCount
          CONFIG,
          { apiCallCount, agentMemory, consecutiveFailures, currentStrategies, agentPlan, currentPlanStep }
        );
      } finally {
        clearInterval(progressTimer);
        base64Image = null; // release screenshot memory after LLM call
      }

      // Sync back any state changes from the LLM call (apiCallCount is incremented inside)
      apiCallCount = apiCallCount; // already mutated by reference

      // Advance plan step if the LLM signalled it's done with the current step
      if (command.advance_plan && agentPlan && currentPlanStep < agentPlan.length - 1) {
        currentPlanStep++;
        sendSilentUpdate(`Plan advanced to step ${currentPlanStep + 1}: ${agentPlan[currentPlanStep]}`);
        delete command.advance_plan;
      }

      // Template substitution: replace {{key}} with memory values
      if (command.text && typeof command.text === 'string') {
        command.text = command.text.replace(/\{\{(\w+)\}\}/g, (_, key) => agentMemory[key] || `{{${key}}}`);
      }
      if (command.url && typeof command.url === 'string') {
        command.url = command.url.replace(/\{\{(\w+)\}\}/g, (_, key) => agentMemory[key] || `{{${key}}}`);
      }
      if (command.value && typeof command.value === 'string') {
        command.value = command.value.replace(/\{\{(\w+)\}\}/g, (_, key) => agentMemory[key] || `{{${key}}}`);
      }

      // Validate selectors against the trimmed list
      if ((command.type === 'click' || command.type === 'type' || command.type === 'hover' || command.type === 'select' || command.type === 'extract') && command.selector) {
        const selectorExists = trimmedElements.some(e => e.selector === command.selector);
        if (!selectorExists) {
          sendSilentUpdate('Invalid selector -- re-asking AI', stepCount);
          consecutiveFailures++;
          history.push({ step: stepCount, action: command, result: `Invalid selector "${command.selector}" -- not in element list.` });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          await sleep(1000);
          continue;
        }
      }

      // Handle finish
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
        saveLearnedPattern(goal, history, true);
        break;
      }

      // Handle note
      if (command.type === 'note') {
        const noteText = command.text || command.summary || 'No note text';
        sendSilentUpdate(`${noteText.slice(0, 200)}${noteText.length > 200 ? '...' : ''}`, stepCount);
        history.push({ step: stepCount, action: command, result: `Note recorded: ${noteText}` });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        await sleep(500);
        continue;
      }

      // Handle extract / extract_list (save to agent memory)
      if (command.type === 'extract' || command.type === 'extract_list') {
        sendSilentUpdate(`Extracting: ${command.key}`, stepCount);
      }

      // Handle wait_for actions
      if (command.type === 'wait_for_text' || command.type === 'wait_for_element' || command.type === 'wait_for_navigation') {
        sendSilentUpdate(`Waiting for: ${command.text || command.selector || 'navigation'}`, stepCount);
        sendActionMessage(command, stepCount, observation);
        const waitResult = await sendMessageWithRetry(tab, {
          action: 'wait_for',
          condition: { ...command, currentUrl: tabInfo.url }
        });
        const result = (waitResult && waitResult.result) || 'Wait completed';
        sendActionResult(stepCount, result, false);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        await sleep(500);
        continue;
      }

      sendSilentUpdate(`Executing: ${command.type}`, stepCount);

      // Approval gate
      const settings = await chrome.storage.local.get(['approvalMode']);
      if (settings.approvalMode === true) {
        const approval = await requestApproval(command, stepCount);
        if (approval.rejected) {
          history.push({ step: stepCount, action: command, result: 'Rejected by user' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          await sleep(1000); continue;
        }
        if (approval.skipped) {
          history.push({ step: stepCount, action: command, result: 'Skipped by user' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          await sleep(1000); continue;
        }
      }

      // Show action card
      sendActionMessage(command, stepCount, observation);

      // Invalidate screenshot cache for actions that can change the page
      if (['navigate', 'click', 'type', 'press_key', 'select'].includes(command.type)) {
        lastScreenshotUrl = null;
        cachedBase64Image = null;
        screenshotCache.cachedBase64Image = null;
        screenshotCache.lastScreenshotUrl = null;
      }

      // Execute command
      const urlBeforeCommand = tabInfo.url;
      let result;
      let actionFailed = false;

      if (command.type === 'navigate') {
        if (!isValidUrl(command.url)) {
          result = 'Invalid URL: ' + command.url;
          actionFailed = true;
        } else {
          await chrome.tabs.update(tab, { url: command.url });
          await sleep(2000);
          result = 'Navigated to ' + command.url;
        }
      } else if (command.type === 'read_page') {
        try {
          const freshContent = await sendMessageWithRetry(tab, { action: 'read_page' });
          result = freshContent ? 'Page content re-read' : 'Failed to re-read page';
          actionFailed = !freshContent;
        } catch (err) { result = 'Could not re-read page'; actionFailed = true; }
      } else if (command.type === 'extract' || command.type === 'extract_list') {
        const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
        result = (res && res.result) || 'Done';
        let extractSucceeded = false;
        try {
          const parsed = JSON.parse(result.replace('JS Result: ', ''));
          if (parsed.key !== undefined && parsed.value !== undefined) {
            agentMemory[parsed.key] = parsed.value;
            const memKeys = Object.keys(agentMemory);
            if (memKeys.length > CONFIG.maxMemoryEntries) {
              delete agentMemory[memKeys[0]];
            }
            await chrome.storage.local.set({ agent_memory: agentMemory });
            const preview = Array.isArray(parsed.value)
              ? `${parsed.value.length} items extracted`
              : `"${String(parsed.value).substring(0, 100)}"`;
            result = `Extracted ${parsed.key} = ${preview}`;
            extractSucceeded = true;
          }
        } catch (e) {
          // extract result wasn't JSON -- treat as failure
        }
        if (!extractSucceeded) actionFailed = true;
      } else {
        try {
          const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
          result = (res && res.result) ? res.result : 'Done';
          actionFailed = result.startsWith('Error') || result.includes(' not found') || result.includes('Element not found') || result.includes('No element');
        } catch (err) { result = 'Executed (page navigated)'; }
      }

      // Post-click: handle navigation and new tab capture
      if (command.type === 'click') {
        await sleep(1000);
        try {
          const allTabs = await new Promise(resolve => { chrome.tabs.query({}, (t) => resolve(t)); });
          const newTabs = allTabs.filter(t => t.openerTabId === tab && t.id !== tab);
          if (newTabs.length > 0) {
            const newTab = newTabs[0];
            const newUrl = newTab.url;
            chrome.tabs.remove(newTabs.map(t => t.id));
            await chrome.tabs.update(tab, { url: newUrl });
            await waitForPageLoad(tab);
            await sleep(500);
            result = 'Clicked -> navigated to ' + (newUrl ? new URL(newUrl).hostname : 'new page');
          } else {
            const updatedTab = await getTabInfo(tab);
            if (updatedTab && updatedTab.url !== urlBeforeCommand) {
              await waitForPageLoad(tab);
              await sleep(500);
              try { result = 'Clicked -> navigated to ' + new URL(updatedTab.url).hostname; } catch (e) { result = 'Clicked -> page navigated'; }
            }
          }
        } catch (e) {}
      }

      // Track success/failure for self-healing
      if (actionFailed) {
        consecutiveFailures++;
        currentStrategies.push(`${command.type}:${command.selector || command.url || ''}`);
        if (currentStrategies.length > 10) currentStrategies.shift();
      } else {
        consecutiveFailures = 0;
        currentStrategies = [];
      }

      // Check for stall
      const stall = detectStall(history, consecutiveFailures, currentStrategies);
      if (stall.stalled) {
        sendSilentUpdate(`Stall detected: ${stall.reason}. Recovering...`, stepCount);

        if (stall.recoveryAction === 'RESCAN_AND_REPLAN') {
          // Force re-scan and replan from current page state
          agentPlan = null;
          currentPlanStep = 0;
          consecutiveFailures = 0;
          currentStrategies = [];

          // Inject stall context into history so the LLM knows what happened
          history.push({
            step: stepCount,
            action: { type: 'note', text: `STALL RECOVERY: Re-assessing page state. Previous approach: ${stall.reason}` },
            result: 'Stall detected -- forcing page re-scan and strategy change'
          });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });

          // Skip the normal sleep to recover faster
          continue;
        }

        if (stall.recoveryAction === 'FORCE_STRATEGY_SHIFT') {
          // Bump consecutiveFailures above threshold to ensure strategyCtx fires in callLLM
          consecutiveFailures = Math.max(consecutiveFailures, CONFIG.strategyShiftThreshold);
          // Don't continue -- let the normal flow proceed with the strategy shift prompt injected
        }
      }

      sendActionResult(stepCount, result, actionFailed);
      history.push({ step: stepCount, action: command, result });

      // Consecutive navigate tracking
      if (command.type === 'navigate') {
        consecutiveNavigates++;
      } else if (['extract', 'extract_list', 'read_page'].includes(command.type)) {
        consecutiveNavigates = 0;
      }

      // HARD GUARD: After 3 consecutive navigates without reading/extracting
      if (consecutiveNavigates >= 3) {
        sendSilentUpdate(`Auto-reading page after ${consecutiveNavigates} navigates`, stepCount);
        try {
          const forcedRead = await sendMessageWithRetry(tab, { action: 'get_page_info' });
          if (forcedRead) {
            const forcedText = (forcedRead.text || '').substring(0, 8000);
            history.push({ step: stepCount, action: { type: 'read_page' }, result: `Auto-read: ${forcedText.substring(0, 500)}` });
            observation = forcedText;
          }
        } catch (e) { /* non-fatal */ }
        consecutiveNavigates = 0;
      }
      // Cap in-memory history
      if (history.length > CONFIG.maxHistoryEntries) {
        history.splice(0, history.length - CONFIG.maxHistoryEntries);
      }
      await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
      await sleep(1500);

    } catch (err) {
      console.error('Agent loop error:', err);
      sendSilentUpdate(`Loop error: ${err.message}`, stepCount);
      consecutiveFailures++;
      if (err.message.includes('was closed')) { agentRunning = false; break; }
      await sleep(3000);
    }
  }

  if (finished) await chrome.storage.local.set({ agent_history: [], agent_memory: {} });
  agentRunning = false;
  agentTabId = null;
  console.log(`Agent completed. Total API calls: ${apiCallCount}`);
}

// ========== Self-Learning ==========
async function saveLearnedPattern(goal, history, success) {
  try {
    const stored = await chrome.storage.local.get(['learned_patterns']);
    const patterns = stored.learned_patterns || [];
    patterns.push({
      goal: goal.substring(0, 100),
      steps: history.map(h => ({ type: h.action.type, selector: h.action.selector })),
      success,
      timestamp: Date.now()
    });
    if (patterns.length > CONFIG.maxLearnedPatterns) patterns.splice(0, patterns.length - CONFIG.maxLearnedPatterns);
    await chrome.storage.local.set({ learned_patterns: patterns });
  } catch (e) { console.warn('Failed to save pattern:', e); }
}

// ========== Utilities ==========
async function enforceRateLimit() {
  const delayNeeded = Math.max(0, CONFIG.minDelayBetweenCalls - (Date.now() - lastApiCallTime));
  if (delayNeeded > 0) await sleep(delayNeeded);
  lastApiCallTime = Date.now();
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ========== Approval Mode ==========
function describeAction(command) {
  switch (command.type) {
    case 'click': return `Click: ${command.selector}`;
    case 'type': return `Type into ${command.selector}: '${(command.text||'').substring(0,50)}'`;
    case 'navigate': return `Navigate to ${command.url}`;
    case 'scroll': return `Scroll ${(command.amount||0)>=0?'down':'up'}`;
    case 'select': return `Select "${command.value}" in ${command.selector}`;
    case 'hover': return `Hover: ${command.selector}`;
    case 'press_key': return `Press: ${command.key}`;
    case 'execute_js': return `Run JS: ${(command.code||'').substring(0,80)}...`;
    case 'extract': return `Extract "${command.key}" from ${command.selector}`;
    default: return `${command.type}: ${JSON.stringify(command).substring(0,80)}`;
  }
}

async function requestApproval(command, stepNumber) {
  const description = describeAction(command);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'request_approval', payload: { action: command.type, description, stepNumber } }).catch(() => {});
    const listener = (message) => {
      if (message.action === 'approval_response') {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        resolve({ approved: message.approved === true, skipped: message.skipped === true, rejected: message.rejected === true });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ approved: true, skipped: false, rejected: false });
    }, 60000);
  });
}
