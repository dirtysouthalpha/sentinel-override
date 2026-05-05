// Sentinel Override v3 -- Agent Engine
// Agent loop, planning, self-healing, state management.
// Imports from llm-client.js, tab-manager.js, message-protocol.js.

import { callLLMWithRetry, generatePlan, supportsVision, getPlatformContext, getRelevantPatterns } from './llm-client.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo } from './tab-manager.js';
import { sendSilentUpdate, sendActionMessage, sendActionResult, sendReportUpdate, sendPageContext, sendTabStateUpdate } from './message-protocol.js';
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
  maxSteps: 50,
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

// ========== Heuristic Plan Generator ==========
// Fallback when LLM-based plan generation fails. Analyzes the goal text
// to produce a basic step-by-step plan without any API calls.

function generateHeuristicPlan(goal, currentUrl) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  const currentHost = (() => { try { return new URL(currentUrl).hostname; } catch { return ''; } })();

  // Detect multi-page research patterns
  const isMultiPage = /\b(top\s+\d|each|every|all|10|5|3)\b.*\b(article|page|site|link|url|result|source)\b/i.test(g)
    || /\b(open|visit|browse|check)\b.*\b(each|and|then)\b/i.test(g)
    || /\b(summar|brief|report)\b.*\b(all|each|every)\b/i.test(g);

  // Extract target URL from goal
  const urlMatch = goal.match(/(?:go to|navigate to|visit|check|open)\s+(https?:\/\/[^\s,]+|[\w.-]+\.(?:com|org|net|io|gov|edu|co)[^\s,]*)/i)
    || goal.match(/(https?:\/\/[^\s]+)/);
  const targetUrl = urlMatch ? urlMatch[1] : null;
  const targetHost = targetUrl ? (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
  const alreadyThere = targetHost && currentHost.includes(targetHost);

  // Extract search query from goal
  const searchMatch = goal.match(/(?:search|find|look up|google)\s+(?:for\s+)?["']?([^"']{10,80})/i)
    || goal.match(/(?:about|on|regarding)\s+([^,.\n]{10,60})/i);
  const searchQuery = searchMatch ? searchMatch[1].trim() : null;

  // Extract count
  const countMatch = goal.match(/(?:top\s+)?(\d+)/);
  const count = countMatch ? parseInt(countMatch[1]) : 10;

  if (isMultiPage) {
    const steps = [];
    if (targetUrl && !alreadyThere) {
      steps.push(`Navigate to ${targetUrl}`);
    } else if (searchQuery) {
      steps.push(`Search Google for "${searchQuery}"`);
    }
    steps.push(`Use execute_js with key "links" to extract article/result links from the page`);
    steps.push(`Review extracted links and identify the ${count} most relevant ones`);
    for (let i = 1; i <= Math.min(count, 10); i++) {
      steps.push(`Open article ${i} in a new tab, read it, and note a brief summary`);
    }
    steps.push(`Close all article tabs`);
    steps.push(`Finish with a combined summary of all ${count} items`);
    return steps;
  }

  if (targetUrl && !alreadyThere) {
    return [
      `Navigate to ${targetUrl}`,
      'Read the page content',
      'Extract key information using execute_js with key "data"',
      'Finish with a summary of findings'
    ];
  }

  if (searchQuery) {
    return [
      `Search Google for "${searchQuery}"`,
      'Read search results and extract top links',
      'Visit the most relevant result',
      'Read and extract key information',
      'Finish with a summary'
    ];
  }

  // Generic fallback
  return [
    'Read the current page',
    'Extract key information',
    'If needed, navigate to find more data',
    'Finish with a summary'
  ];
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
    // Fallback: generate a basic heuristic plan from goal analysis
    agentPlan = generateHeuristicPlan(goal, currentTabInfo?.url || '');
    if (agentPlan) {
      sendSilentUpdate(`Basic plan (${agentPlan.length} steps): ${agentPlan[0]}`);
    } else {
      sendSilentUpdate('Running in direct mode');
    }
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
      if (stepCount === 1 && goal) {
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

      // Send page context to popup so user can see where the agent is
      sendPageContext(tabInfo?.url || '', tabInfo?.title || '', stepCount);

      // Send tab state to popup so user can see all managed tabs
      const allTabContexts = getAllTabContexts();
      if (allTabContexts.length > 0) {
        sendTabStateUpdate(allTabContexts);
      }

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

      // Build capped element list (needed before empty page check)
      const allElements = (observation && observation.elements) ? observation.elements : [];

      // Detect empty page (SPA not rendered, anti-bot, or loading failure)
      const pageIsEmpty = pageText.length < 150 || (pageText.includes('Page Title:') && pageText.length < 300);
      const elementsEmpty = allElements.length < 3;
      if (pageIsEmpty) {
        pageText = '[WARNING: Page content is empty or nearly empty. This site may block automation or use heavy JavaScript rendering. Try execute_js with key to extract data directly, or navigate to a different URL.]\n\n' + pageText;
      }
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

      // Anti-loop directives: force the model to make progress
      let loopDirective = '';

      // 1. Consecutive non-productive actions from end of history
      //    Also check for execute_js-heavy patterns in recent window (model escaping consecutive check)
      if (history.length >= 3) {
        const nonProductive = new Set(['read_page', 'execute_js', 'scroll', 'wait_for_text', 'wait_for_element']);
        let consecutiveNonProductive = 0;
        for (let i = history.length - 1; i >= 0; i--) {
          if (nonProductive.has(history[i].action.type)) {
            consecutiveNonProductive++;
          } else {
            break;
          }
        }
        // Also count execute_js in the last 8 steps — if too many without extract/note/finish, it's a loop
        const recentWindow = history.slice(-8);
        const recentJsCount = recentWindow.filter(h => h.action.type === 'execute_js').length;
        const recentExtractCount = recentWindow.filter(h => ['extract', 'extract_list', 'note', 'finish'].includes(h.action.type)).length;
        const jsLoop = recentJsCount >= 4 && recentExtractCount === 0;

        if (consecutiveNonProductive >= 3 || jsLoop) {
          const memCount = Object.keys(agentMemory).length;
          const reason = jsLoop
            ? recentJsCount + ' execute_js calls in last 8 steps with no data saved'
            : consecutiveNonProductive + ' non-productive steps in a row';
          loopDirective = memCount === 0
            ? '\n⚠ LOOP DETECTED -- ' + reason + '. You MUST use "execute_js" with a "key" to save results, or use "note" to record findings. Do NOT run more JS without saving.\n'
            : '\n⚠ LOOP DETECTED -- ' + reason + '. You have ' + memCount + ' items in memory. You MUST use "finish" NOW with a summary of your extracted data.\n';
        }
      }

      // 1b. Empty page detection — page didn't render (SPA, anti-bot, loading failure)
      if ((pageIsEmpty || elementsEmpty) && !loopDirective) {
        const emptyCount = history.slice(-4).filter(h => {
          const r = h.result || '';
          return r.includes('empty') || r.includes('no content') || (r.includes('Page Title:') && r.length < 300);
        }).length;
        if (emptyCount >= 2) {
          loopDirective = '\n⚠ EMPTY PAGE -- The page content has been empty for multiple attempts. This site may block automation or use heavy JavaScript rendering. You MUST try a different approach:\n1. Use "execute_js" with key to extract data directly: return document.body.innerText\n2. Navigate to a simpler URL (e.g., the homepage instead of search results)\n3. Try a different site for the same information\nDo NOT read_page again on this empty page.\n';
        }
      }

      // 2. Step-based soft cap: warn model to finish after 15 steps
      //    But skip the warning if agent is actively making progress (opening tabs, switching tabs)
      const recentTabActions = history.slice(-5).filter(h => ['open_tab', 'switch_tab', 'close_tab'].includes(h.action.type)).length;
      const isMakingProgress = recentTabActions > 0 || Object.keys(agentMemory).length > 0;
      if (stepCount >= 15 && !loopDirective && !isMakingProgress) {
        loopDirective = '\n⚠ STEP LIMIT -- You are on step ' + stepCount + ' with no data extracted and no active tab work. You MUST call "finish" NOW with what you know, or use "execute_js" to extract data. Do not continue reading the same page.\n';
      } else if (stepCount >= 20 && !loopDirective) {
        const memCount = Object.keys(agentMemory).length;
        loopDirective = memCount > 0
          ? '\n⚠ STEP LIMIT -- You are on step ' + stepCount + '. You have ' + memCount + ' extracted items. You MUST call "finish" NOW with a summary. No more reading or extracting.\n'
          : '\n⚠ STEP LIMIT -- You are on step ' + stepCount + '. If you have not found useful data, call "finish" with what you know. Do not continue looping.\n';
      }

      // 3. Step-based hard cap: force finish after 40 steps
      if (stepCount >= 40) {
        const memCount = Object.keys(agentMemory).length;
        const memLines = Object.entries(agentMemory).slice(0, 10).map(([k, v]) => {
          const vStr = Array.isArray(v) ? v.slice(0, 5).map(i => String(i)).join(', ') : String(v).substring(0, 200);
          return '- ' + k + ': ' + vStr;
        }).join('\n');
        const summary = memCount > 0
          ? 'Task completed after ' + stepCount + ' steps with ' + memCount + ' data points extracted:\n\n' + memLines + (Object.keys(agentMemory).length > 10 ? '\n...and ' + (Object.keys(agentMemory).length - 10) + ' more items.' : '')
          : 'Task timed out after ' + stepCount + ' steps without extracting useful data.';
        finished = true;
        sendSilentUpdate('Step limit reached -- finishing', stepCount);
        sendActionResult(stepCount, { type: 'finish', summary }, false);
        history.push({ step: stepCount, action: { type: 'finish', summary }, result: summary });
        chrome.runtime.sendMessage({ action: 'agent_finished', summary }).catch(() => {});
        break;
      }

      // Progress indicator
      let apiWaitSeconds = 0;
      const progressTimer = setInterval(() => {
        apiWaitSeconds += 5;
        sendSilentUpdate(`Consulting AI... (${apiWaitSeconds}s)`, stepCount);
      }, 5000);

      sendSilentUpdate(`Consulting AI -- call #${apiCallCount + 1}`, stepCount);
      let command;
      const agentState = { apiCallCount, agentMemory, consecutiveFailures, currentStrategies, agentPlan, currentPlanStep, loopDirective };
      try {
        command = await callLLMWithRetry(
          trimmedElements, allElements.length, pageText, base64Image,
          goal, history, stepCount, currentUrl,
          0, // retryCount
          CONFIG,
          agentState
        );
      } finally {
        clearInterval(progressTimer);
        base64Image = null; // release screenshot memory after LLM call
      }

      // Sync apiCallCount — callLLM mutates agentState.apiCallCount by reference, but the
      // module-level var is a primitive and doesn't auto-update. Pull it back from the object.
      apiCallCount = agentState.apiCallCount;

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

      // Handle finish — but block premature finishes (model giving up without trying)
      if (command.type === 'finish') {
        const memCount = Object.keys(agentMemory).length;
        const noteCount = history.filter(h => h.action.type === 'note').length;
        const hasData = memCount > 0 || noteCount > 0;

        // Block finish if no real data was extracted and we haven't tried enough
        if (!hasData && stepCount < 8) {
          history.push({ step: stepCount, action: command, result: 'BLOCKED: Cannot finish without extracting data first. Read the page or use execute_js to get real data.' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          sendSilentUpdate('Finish blocked — must extract real data first', stepCount);
          await sleep(1000);
          continue;
        }

        // Block finish if memory only contains failed results ("Done", empty strings)
        const hasRealData = memCount > 0 && Object.values(agentMemory).some(v => {
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          return s.length > 10 && s !== 'Done';
        });
        if (!hasRealData && !hasData && stepCount < 15) {
          history.push({ step: stepCount, action: command, result: 'BLOCKED: No real data in memory. Use execute_js with key to extract actual page content.' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          sendSilentUpdate('Finish blocked — extracted data is empty', stepCount);
          await sleep(1000);
          continue;
        }

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
        const result = waitResult || 'Wait completed';
        sendActionResult(stepCount, result, actionFailed);
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
      if (['navigate', 'click', 'click_at', 'type', 'press_key', 'select'].includes(command.type)) {
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
        sendActionResult(stepCount, result, actionFailed);
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
        sendActionResult(stepCount, result, actionFailed);
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
        sendActionResult(stepCount, result, actionFailed);
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
        result = res || 'Done';
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
      } else if (command.type === 'execute_js' && command.key) {
        // execute_js with key: run JS and save result to agent memory
        const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
        result = res || 'Done';
        // Extract the JS result value
        let jsValue = result;
        if (result.startsWith('JS Result: ')) {
          jsValue = result.substring(10);
        }
        if (result === 'Done' || result.startsWith('JS Error: ')) {
          // JS execution failed or returned nothing — do NOT save to memory
          actionFailed = true;
          result = result === 'Done' ? 'JS execution failed — no response from page' : result;
        } else if (jsValue.length < 5) {
          // Result too short to be useful data
          actionFailed = true;
          result = 'JS returned empty result';
        } else {
          try {
            const parsed = JSON.parse(jsValue);
            agentMemory[command.key] = parsed;
          } catch (e) {
            agentMemory[command.key] = jsValue;
          }
          const memKeys = Object.keys(agentMemory);
          if (memKeys.length > CONFIG.maxMemoryEntries) delete agentMemory[memKeys[0]];
          await chrome.storage.local.set({ agent_memory: agentMemory });
          const preview = String(jsValue).substring(0, 100);
          result = `JS result saved to "${command.key}": ${preview}`;
        }
      } else {
        try {
          const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
          result = res || 'Done';
          actionFailed = result.startsWith('Error') || result.includes(' not found') || result.includes('Element not found') || result.includes('No element');
        } catch (err) {
          result = 'Content script error: ' + (err.message || 'command failed to reach page');
          actionFailed = true;
        }
      }

      // Post-click: handle navigation and new tab capture
      if (command.type === 'click' || command.type === 'click_at') {
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
          const forcedRead = await sendMessageWithRetry(tab, { action: 'read_page' });
          if (forcedRead) {
            const forcedText = (forcedRead.content || '').substring(0, 8000);
            history.push({ step: stepCount, action: { type: 'read_page' }, result: `Auto-read: ${forcedText.substring(0, 500)}` });
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

  // Generate report (await so we can include it in the completion message)
  let agentReport = null;
  if (reportData) {
    try {
      agentReport = await generateReport(reportData, CONFIG);
      sendReportUpdate('ready', agentReport);
      // Backward compat: still write to storage for any code that polls
      await chrome.storage.local.set({ last_agent_report: agentReport });
    } catch (err) {
      console.error('Report generation failed:', err);
      sendReportUpdate('error', null, err.message);
      await chrome.storage.local.set({ last_agent_report_error: err.message });
    }
  }

  agentRunning = false;
  console.log(`Agent completed. Total API calls: ${apiCallCount}`);

  // Signal completion via messaging (replaces polling for scheduler)
  chrome.runtime.sendMessage({ action: 'agent_loop_complete', report: agentReport }).catch(() => {});
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
