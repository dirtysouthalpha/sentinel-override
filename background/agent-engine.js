// Sentinel Override v3 -- Agent Engine
// Agent loop, planning, self-healing, state management.
// Imports from llm-client.js, tab-manager.js, message-protocol.js.

import { callLLMWithRetry, generatePlan, supportsVision, getPlatformContext, getRelevantPatterns } from './llm-client.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo } from './tab-manager.js';
import { sendSilentUpdate, sendActionMessage, sendActionResult, sendReportUpdate } from './message-protocol.js';
import { generateReport } from './report-generator.js';
import { getActiveProvider, migrateLegacySettings } from './provider-registry.js';
import { isSPATransitionPending, clearSPATransition } from './shared-state.js';
import { getActiveTabId, setActiveTab, getTabContext, getAllTabContexts, openTab, switchToTab, closeTab, closeAllAgentTabs, updateSnapshot, resetAllContexts, findTabByLabel, registerInitialTab, handleTabRemoved, getTabCount } from './tab-context.js';

// ========== Agent State ==========
let agentRunning = false;
let apiCallCount = 0;
let lastApiCallTime = 0;
let agentMemory = {};           // Extract-and-remember: carries data between pages
let consecutiveFailures = 0;    // Self-healing: tracks failures for strategy shift
let currentStrategies = [];     // Self-healing: remembers tried approaches
let agentPlan = null;           // Planning phase: numbered list of steps
let currentPlanStep = 0;        // Planning phase: which step we're currently on

// Expose agentRunning for index.js
export { agentRunning };

/** Compatibility accessor -- returns the current active tab ID from tab-context. */
export function getAgentTabId() { return getActiveTabId(); }

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
  agentMemory = {};
  consecutiveFailures = 0;
  currentStrategies = [];
  agentPlan = null;
  currentPlanStep = 0;
  resetAllContexts();
}

// ========== Agent Lifecycle ==========
export async function startAgent(goal, sender) {
  if (agentRunning) throw new Error('Agent already running');

  // Determine which tab to operate on
  let startTabId;
  if (!sender.tab || !sender.tab.id) {
    const tabs = await new Promise(resolve => { chrome.tabs.query({active: true, currentWindow: true}, (t) => resolve(t)); });
    if (tabs && tabs.length > 0) {
      startTabId = tabs[0].id;
    } else {
      throw new Error('No active tab found');
    }
  } else {
    startTabId = sender.tab.id;
  }

  agentRunning = true;
  resetAgentState();

  // Register the starting tab in the tab context map
  const tabInfo = await getTabInfo(startTabId);
  registerInitialTab(startTabId, tabInfo?.url || '');

  runAgentLoop(goal, startTabId);
  return 'Agent started in background';
}

export async function stopAgent() {
  agentRunning = false;
  await closeAllAgentTabs();
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
  let reportData = null;  // Snapshot for async report generation
  agentPlan = null;
  currentPlanStep = 0;

  // Migrate legacy settings before any LLM calls
  await migrateLegacySettings();

  const stored = await chrome.storage.local.get(['agent_history', 'agent_context', 'agent_memory']);
  await chrome.storage.local.set({ agent_history: [] });

  if (stored.agent_context && stored.agent_context.trim()) {
    goal = `Previous context: ${stored.agent_context.trim()}\n\nCurrent goal: ${goal}`;
  }

  let consecutiveNavigates = 0;

  // Generate a plan before execution
  sendSilentUpdate('Planning task...');
  const planProviderConfig = await getActiveProvider();
  const planSettings = {
    api_endpoint: planProviderConfig.endpoint,
    api_key: planProviderConfig.apiKey,
    model: planProviderConfig.model
  };

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

  while (!finished && agentRunning) {
    try {
      stepCount++;
      if (stepCount > CONFIG.maxSteps) {
        sendSilentUpdate(`Reached step limit (${CONFIG.maxSteps}). Finishing.`, stepCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Reached step limit of ${CONFIG.maxSteps}. Task may be incomplete.` }).catch(() => {});
        break;
      }

      // Check for pending SPA transition -- if the page changed under us,
      // re-scan instead of using stale observation data
      if (isSPATransitionPending()) {
        sendSilentUpdate('SPA page transition detected -- re-scanning...', stepCount);
        clearSPATransition();
        // Invalidate screenshot cache for current active tab
        const spaCtx = getTabContext(getActiveTabId());
        if (spaCtx) {
          spaCtx.screenshotCache.cachedBase64Image = null;
          spaCtx.screenshotCache.lastScreenshotUrl = null;
        }
        // Don't skip the iteration -- just let the normal observe/scan flow run
        // with fresh data. The continue is NOT used here because we want the
        // normal flow to pick up the new page state.
      }

      let tab = getActiveTabId();
      if (!tab) {
        sendSilentUpdate('No active tab -- stopping', stepCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'No active tab. Task interrupted.' }).catch(() => {});
        break;
      }

      // Get tab info
      let tabInfo = await getTabInfo(tab);

      if (!tabInfo) {
        sendSilentUpdate('Agent tab lost. Attempting recovery...', stepCount);
        const allTabs = await new Promise(resolve => { chrome.tabs.query({}, (t) => resolve(t)); });
        const lostTab = allTabs.find(t => t.id === tab);
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

      // Auto-navigate to URL found in goal (first iteration only)
      // Smart: checks current page hostname before navigating
      if (stepCount === 0 && goal) {
        const urlMatch = goal.match(/https?:\/\/[^\s"'<>,]+/i) || goal.match(/(?:go to|visit|navigate to|open)\s+(?:the\s+)?(?:site\s+)?([^\s]+?\.(?:com|org|net|io|gov|edu|co|us|uk|de|fr|cn|jp|ru|br|in|ca|au|me|tv|info|biz|dev|app|ai|xyz))/i);
        if (urlMatch) {
          const goalUrl = urlMatch[0].startsWith('http') ? urlMatch[0] : 'https://' + urlMatch[1];
          try {
            const goalHostname = new URL(goalUrl).hostname.toLowerCase();
            const currentHostname = new URL(tabInfo.url).hostname.toLowerCase();
            if (!currentHostname.includes(goalHostname.replace(/^www\./, ''))) {
              sendSilentUpdate('Navigating to: ' + goalUrl, stepCount);
              sendActionMessage({ type: 'navigate', url: goalUrl }, stepCount, null);
              await chrome.tabs.update(tab, { url: goalUrl });
              await waitForPageLoad(tab);
              await sleep(1500);
              const reinjected = await injectContentScript(tab);
              if (reinjected) {
                history.push({ step: stepCount, action: { type: 'navigate', url: goalUrl }, result: 'Navigated to ' + goalUrl });
                await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
              }
              continue;
            }
            // Already on the right page - skip navigation
          } catch (e) { /* URL parse error, skip auto-navigate */ }
        }
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

      // Update snapshot for the current tab
      updateSnapshot(tab, {
        elements: observation?.elements || [],
        pageContent: pageContent?.content || '',
        url: tabInfo?.url || '',
        title: tabInfo?.title || ''
      });

      // Screenshot (CDP with per-tab cache)
      const freshTabInfo = await getTabInfo(tab);
      if (!freshTabInfo) { await sleep(1000); continue; }

      const currentUrl = (freshTabInfo && freshTabInfo.url) || tabInfo.url;

      // Get per-tab screenshot cache
      const tabCtx = getTabContext(tab);
      if (!tabCtx) { await sleep(1000); continue; }
      const screenshotCache = tabCtx.screenshotCache;

      let base64Image = null;
      const screenshotProviderConfig = await getActiveProvider();
      const modelForScreenshot = screenshotProviderConfig.model || 'glm-5.1';
      if (supportsVision(modelForScreenshot)) {
        const shotResult = await takeScreenshot(tab, freshTabInfo.windowId, currentUrl, screenshotCache, CONFIG, stepCount, sendSilentUpdate);
        if (shotResult) {
          base64Image = shotResult.base64Image;
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

      // Action-type loop detection: if the model keeps doing the same non-productive
      // action (read_page, execute_js) without extracting or finishing, force a directive
      let loopDirective = '';
      if (history.length >= 4) {
        const recent = history.slice(-5).map(h => h.action.type);
        const nonProductive = ['read_page', 'execute_js', 'scroll', 'wait_for_text', 'wait_for_element'];
        const productive = ['extract', 'extract_list', 'note', 'finish', 'navigate', 'open_tab', 'switch_tab', 'click', 'type', 'select'];
        const nonProductiveCount = recent.filter(t => nonProductive.includes(t)).length;
        const productiveCount = recent.filter(t => productive.includes(t)).length;
        if (nonProductiveCount >= 4 && productiveCount === 0) {
          const memCount = Object.keys(agentMemory).length;
          loopDirective = memCount === 0
            ? '\n⚠ LOOP DETECTED -- You have read/scrolled/executed JS multiple times without extracting ANY data. You MUST use "extract" or "extract_list" NOW to capture data from the page. Do NOT read_page again.\n'
            : '\n⚠ LOOP DETECTED -- You have enough data extracted (' + Object.keys(agentMemory).length + ' items). You MUST use "finish" NOW with a comprehensive summary using your extracted data. Do NOT read_page or execute_js again.\n';
        }
      }

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
          { apiCallCount, agentMemory, consecutiveFailures, currentStrategies, agentPlan, currentPlanStep, loopDirective }
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

      // Template substitution: replace ::key:: with memory values
      if (command.text && typeof command.text === 'string') {
        command.text = command.text.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (command.url && typeof command.url === 'string') {
        command.url = command.url.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (command.value && typeof command.value === 'string') {
        command.value = command.value.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
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

        // Capture report data BEFORE history gets cleared at loop exit
        reportData = {
          goal,
          history: history.slice(),
          agentMemory: { ...agentMemory },
          agentPlan: agentPlan ? agentPlan.slice() : null,
          stepCount,
          apiCallCount,
          tabContexts: getAllTabContexts().map(tc => ({ label: tc.label, url: tc.url, hasScreenshot: !!tc.snapshot }))
        };

        chrome.runtime.sendMessage({ action: 'agent_finished', summary: finalSummary }).catch(() => {});
        sendReportUpdate('generating');
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
        const invalidationCtx = getTabContext(tab);
        if (invalidationCtx) {
          invalidationCtx.screenshotCache.cachedBase64Image = null;
          invalidationCtx.screenshotCache.lastScreenshotUrl = null;
        }
      }

      // Execute command
      const urlBeforeCommand = tabInfo.url;
      let result;
      let actionFailed = false;

      // Handle open_tab
      if (command.type === 'open_tab') {
        if (!isValidUrl(command.url)) {
          result = 'Invalid URL: ' + command.url;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          sendSilentUpdate(`Opening tab: ${command.label || command.url}`, stepCount);
          const ctx = await openTab(command.url, command.label);
          await switchToTab(ctx.tabId);
          await sleep(2000);
          await injectContentScript(ctx.tabId);
          result = `Opened tab "${command.label || command.url}" (ID: ${ctx.tabId})`;
        }
        sendActionResult(stepCount, command, result, actionFailed);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        continue;
      }

      // Handle switch_tab
      if (command.type === 'switch_tab') {
        let targetId = command.tab_id;
        if (!targetId && command.label) {
          targetId = findTabByLabel(command.label);
        }
        if (!targetId) {
          result = `Tab not found: ${command.label || command.tab_id}`;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          await switchToTab(targetId);
          await injectContentScript(targetId);
          result = `Switched to tab "${getTabContext(targetId)?.label || targetId}"`;
        }
        sendActionResult(stepCount, command, result, actionFailed);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        continue;
      }

      // Handle close_tab
      if (command.type === 'close_tab') {
        let targetId = command.tab_id;
        if (!targetId && command.label) {
          targetId = findTabByLabel(command.label);
        }
        if (!targetId) {
          result = `Tab not found: ${command.label || command.tab_id}`;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          await closeTab(targetId);
          result = `Closed tab "${command.label || targetId}"`;
        }
        sendActionResult(stepCount, command, result, actionFailed);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        continue;
      }

      if (command.type === 'navigate') {
        if (!isValidUrl(command.url)) {
          result = 'Invalid URL: ' + command.url;
          actionFailed = true;
        } else {
          await chrome.tabs.update(tab, { url: command.url });
          await waitForPageLoad(tab);
          await sleep(1500);
          // Re-inject content script on the new page
          const reinjected = await injectContentScript(tab);
          if (!reinjected) {
            result = 'Navigated to ' + command.url + ' (content script failed to load)';
            actionFailed = true;
          } else {
            // Verify we actually arrived at the intended page
            const newTabInfo = await getTabInfo(tab);
            const arrivedUrl = newTabInfo ? newTabInfo.url : command.url;
            try {
              const intendedHost = new URL(command.url).hostname.toLowerCase();
              const arrivedHost = new URL(arrivedUrl).hostname.toLowerCase();
              if (arrivedHost.includes(intendedHost.replace(/^www\./, ''))) {
                result = 'Navigated to ' + arrivedUrl;
              } else {
                result = 'Navigated but landed on ' + arrivedUrl + ' instead of ' + command.url;
                actionFailed = true;
              }
            } catch (e) {
              result = 'Navigated to ' + arrivedUrl;
            }
          }
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
        } catch (err) {
          result = 'Content script error: ' + (err.message || 'command failed to reach page');
          actionFailed = true;
        }
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
            if (getTabCount() > 1) {
              // Multi-tab mode: register the new tab as a tracked context
              registerInitialTab(newTab.id, newUrl);
              // Mark it as agent-created since it was opened by page interaction
              const newCtx = getTabContext(newTab.id);
              if (newCtx) newCtx.isAgentCreated = true;
              result = 'Clicked -> new tab opened: ' + (newUrl ? new URL(newUrl).hostname : 'new page');
            } else {
              // Single tab mode: capture URL, close new tab, navigate original (backward compat)
              chrome.tabs.remove(newTabs.map(t => t.id));
              await chrome.tabs.update(tab, { url: newUrl });
              await waitForPageLoad(tab);
              await sleep(500);
              result = 'Clicked -> navigated to ' + (newUrl ? new URL(newUrl).hostname : 'new page');
            }
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

  // Batch-close all agent-created tabs
  await closeAllAgentTabs();

  // Async report generation (non-blocking -- runs after loop exit)
  if (reportData) {
    generateReport(reportData, CONFIG)
      .then(report => {
        sendReportUpdate('ready', report);
        chrome.storage.local.set({ last_agent_report: report }).catch(() => {});
      })
      .catch(err => {
        console.error('Report generation failed:', err);
        sendReportUpdate('error', null, err.message);
        chrome.storage.local.set({ last_agent_report_error: err.message }).catch(() => {});
      });
  }

  agentRunning = false;
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
