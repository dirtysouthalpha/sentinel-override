// Sentinel Override v3 — "Tron" Agent Engine
// Self-healing, self-learning browser automation agent

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

// ========== One-time migration ==========
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['api_endpoint', 'model'], (result) => {
    const updates = {};
    if (result.api_endpoint && result.api_endpoint.includes('bigmodel.cn')) updates.api_endpoint = '';
    if (result.model && (result.model.includes('glm-4.6v-flash') || result.model.includes('glm-4v-'))) updates.model = '';
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
});

// ========== Tab Locking ==========
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html' });
});

const CONFIG = {
  minDelayBetweenCalls: 2000,
  maxRetries: 3,            // Reduced from 5 — fewer retries means faster failure detection
  retryDelay: 5000,         // Reduced from 10000 — shorter base delay
  maxRetryDelay: 30000,     // Reduced from 60000 — cap retry waits at 30s not 60s
  screenshotQuality: 30,
  fetchTimeout: 45000,      // Reduced from 60000 — fail faster if API is unresponsive
  pageLoadTimeout: 25000,  // Increased from 10s — SonicWall/enterprise pages load slowly
  maxSteps: 120,            // Increased from 50 — IT runbooks can span 7 phases × 10+ steps each
  maxPageContentLength: 16000, // Reduced from 24000 — leave headroom for large element lists
  maxElements: 80,          // NEW: cap elements sent to LLM — Etsy/eBay have 500+ elements
  maxSelectorLength: 200,   // NEW: truncate absurdly long CSS selectors in the elements list
  historyWindow: 5,
  screenshotCache: true,
  maxMemoryEntries: 50,
  maxHistoryEntries: 40,
  maxStoredHistory: 20,
  maxLearnedPatterns: 100,
  strategyShiftThreshold: 3,
};

// ========== Message Handler ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'execute_command') {
    if (!agentTabId) { sendResponse({result: 'No agent tab specified'}); return; }
    const tab = agentTabId;
    const cmd = request.command;
    if (cmd.type === 'navigate') {
      if (!isValidUrl(cmd.url)) { sendResponse({result: 'Invalid URL provided'}); return; }
      chrome.tabs.update(tab, { url: cmd.url }, () => { sendResponse({result: 'Navigated to ' + cmd.url}); });
      return true; // keep message channel open for async callback
    }
    chrome.scripting.executeScript({ target: {tabId: tab}, files: ['content.js'] }, () => {
      chrome.tabs.sendMessage(tab, { action: 'execute_command', command: cmd }, (res) => {
        if (chrome.runtime.lastError) sendResponse({result: 'Error: ' + chrome.runtime.lastError.message});
        else sendResponse(res || {result: 'No response from content script'});
      });
    });
    return true;

  } else if (request.action === 'run_agent_loop') {
    if (agentRunning) { sendResponse({status: 'Agent already running'}); return; }
    if (!sender.tab || !sender.tab.id) {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs && tabs.length > 0) {
          agentTabId = tabs[0].id;
          agentRunning = true;
          apiCallCount = 0;
          agentMemory = {};
          consecutiveFailures = 0;
          currentStrategies = [];
          agentPlan = null;
          currentPlanStep = 0;
          runAgentLoop(request.goal, agentTabId);
          sendResponse({status: 'Agent started in background'});
        } else {
          sendResponse({status: 'Error: No active tab found'});
        }
      });
      return true;
    }
    agentTabId = sender.tab.id;
    agentRunning = true;
    apiCallCount = 0;
    agentMemory = {};
    consecutiveFailures = 0;
    currentStrategies = [];
    agentPlan = null;
    currentPlanStep = 0;
    runAgentLoop(request.goal, agentTabId);
    sendResponse({status: 'Agent started in background'});

  } else if (request.action === 'stop_agent_loop') {
    agentRunning = false;
    agentTabId = null;
    sendResponse({status: 'Agent stopped'});
  }
});

// ========== Pre-flight Planning ==========
// Generates a numbered plan from the goal before execution begins.
// This gives the agent a map of what it's accomplished and what's left,
// dramatically improving reliability on multi-step and multi-site tasks.
async function generatePlan(goal, settings) {
  const endpoint = settings.api_endpoint || 'https://api.z.ai/api/paas/v4/chat/completions';
  const apiKey = settings.api_key;
  const model = settings.model || 'glm-5.1';
  if (!apiKey) return null;

  const planPrompt = `You are a browser automation planner. Given a user goal, produce a concise numbered execution plan.

Goal: ${goal}

Rules:
- Each step should be one specific browser action or data collection task
- Be concrete: "Navigate to etsy.com" not "Go to a website"
- Multi-site tasks need explicit steps for EACH site
- Maximum 15 steps
- Return ONLY a JSON object: { "plan": ["step 1...", "step 2...", ...] }`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const useAnthropic = isAnthropicEndpoint(endpoint);
    const planBody = useAnthropic
      ? JSON.stringify({
          model,
          max_tokens: 800,
          temperature: 0.2,
          system: 'You are a planning assistant. Return ONLY valid JSON.',
          messages: [{ role: 'user', content: planPrompt }]
        })
      : JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a planning assistant. Return ONLY valid JSON.' },
            { role: 'user', content: planPrompt }
          ],
          temperature: 0.2,
          max_tokens: 800
        });
    const planHeaders = useAnthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: planHeaders,
      body: planBody,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    const content = useAnthropic
      ? (data.content && data.content.find(b => b.type === 'text')?.text) || ''
      : data.choices?.[0]?.message?.content || '';
    const firstObj = extractFirstJsonObject(content);
    if (!firstObj) return null;
    const parsed = JSON.parse(firstObj);
    if (Array.isArray(parsed.plan) && parsed.plan.length > 0) return parsed.plan;
  } catch (e) {
    console.warn('Plan generation failed (non-fatal):', e.message);
  }
  return null;
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
  // NOTE: agent_history from a prior incomplete run is intentionally NOT loaded.
  // If a previous task was stopped mid-way, its history would still be in storage
  // and would bleed stale context into this new task. We always start with a clean
  // history. The storage is cleared below so stale data doesn't persist.
  await chrome.storage.local.set({ agent_history: [] });
  // NOTE: agentMemory is intentionally NOT loaded from storage here.
  // The message handler already resets it to {} before each new task run.
  // Loading from storage would silently undo that reset, bleeding memory from
  // a prior task into the new one. Memory persistence across tasks is handled
  // by agent_context (goal prepend), not by carrying over raw extracted values.

  if (stored.agent_context && stored.agent_context.trim()) {
    goal = `Previous context: ${stored.agent_context.trim()}\n\nCurrent goal: ${goal}`;
  }

  let consecutiveNavigates = 0; // Hard guard: force extract after 3 navigates in a row

  // Generate a plan before execution so the agent knows its full roadmap.
  // Non-fatal: if plan generation fails the agent falls back to goalless execution.
  sendSilentUpdate(`🗺️ Planning task...`);
  const planSettings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  agentPlan = await generatePlan(goal, planSettings);
  if (agentPlan) {
    sendSilentUpdate(`📋 Plan ready (${agentPlan.length} steps): ${agentPlan[0]}`);
  } else {
    sendSilentUpdate(`⚡ No plan generated — running in direct mode`);
  }

  while (!finished && agentRunning) {
    try {
      stepCount++;
      if (stepCount > CONFIG.maxSteps) {
        sendSilentUpdate(`⚠️ Reached step limit (${CONFIG.maxSteps}). Finishing.`, stepCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Reached step limit of ${CONFIG.maxSteps}. Task may be incomplete.` }).catch(() => {});
        break;
      }

      let tab = workingTabId;

      // Get tab info
      let tabInfo = await new Promise(resolve => {
        chrome.tabs.get(tab, (info) => { resolve(chrome.runtime.lastError ? null : info); });
      });

      if (!tabInfo) {
        sendSilentUpdate(`⚠️ Agent tab lost. Attempting recovery...`, stepCount);
        const allTabs = await new Promise(resolve => { chrome.tabs.query({}, (t) => resolve(t)); });
        const lostTab = allTabs.find(t => t.id === workingTabId);
        if (lostTab) { tabInfo = lostTab; }
        else {
          sendSilentUpdate(`❌ Agent tab was closed. Task stopped.`, stepCount);
          chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'Agent tab closed. Task interrupted.' }).catch(() => {});
          break;
        }
      }

      // Wait for page load
      if (tabInfo.status !== 'complete') {
        sendSilentUpdate(`Waiting for page to load...`, stepCount);
        await waitForPageLoad(tab);
        await sleep(500);
      }

      // Redirect internal pages
      if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('edge://') || tabInfo.url.startsWith('about:')) {
        sendSilentUpdate(`Internal page — navigating to Google`, stepCount);
        await chrome.tabs.update(tab, { url: 'https://www.google.com' });
        await sleep(3000);
        continue;
      }

      sendSilentUpdate(`🔍 Observing page...`, stepCount);

      // Inject content script
      let scriptReady = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const csListener = createContentScriptListener(tab);
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab }, files: ['content.js'] });
          scriptReady = await csListener.promise;
          if (scriptReady) break;
        } catch (err) { csListener.cancel(); }
        await sleep(500);
      }
      if (!scriptReady) { sendSilentUpdate(`⚠️ Content script failed — retrying`, stepCount); await sleep(2000); continue; }

      // Get page data
      let observation, pageContent;
      try {
        observation = await sendMessageWithRetry(tab, { action: 'observe_page' });
        pageContent = await sendMessageWithRetry(tab, { action: 'read_page' });
      } catch (err) {
        sendSilentUpdate(`⚠️ Error reading page: ${err.message}`, stepCount);
        await sleep(2000);
        continue;
      }

      // Screenshot (CDP with cache)
      const freshTabInfo = await new Promise(resolve => {
        chrome.tabs.get(tab, (info) => { resolve(chrome.runtime.lastError ? tabInfo : info); });
      });
      if (!freshTabInfo) { await sleep(1000); continue; }

      let base64Image = null;
      // Use freshTabInfo.url — tabInfo may be stale if a redirect happened
      // between the top-of-loop tab.get and the content script injection.
      const currentUrl = (freshTabInfo && freshTabInfo.url) || tabInfo.url;

      // Only take screenshots if the current model actually supports vision.
      // Non-vision models silently drop the image anyway — taking it is pure waste
      // (expensive CDP call every step for zero benefit).
      const modelForScreenshot = (await chrome.storage.local.get(['model'])).model || 'glm-5.1';
      if (supportsVision(modelForScreenshot)) {
        if (CONFIG.screenshotCache && cachedBase64Image && lastScreenshotUrl === currentUrl) {
          base64Image = cachedBase64Image;
        } else {
          try {
            await chrome.debugger.attach({ tabId: tab }, '1.3');
            const screenshotResult = await chrome.debugger.sendCommand({ tabId: tab }, 'Page.captureScreenshot', { format: 'jpeg', quality: CONFIG.screenshotQuality });
            await chrome.debugger.detach({ tabId: tab });
            base64Image = screenshotResult.data;
            cachedBase64Image = base64Image;
            lastScreenshotUrl = currentUrl;
          } catch (debuggerErr) {
            try { await chrome.debugger.detach({ tabId: tab }); } catch(e) {}
            try {
              const screenshot_data_url = await new Promise((resolve, reject) => {
                chrome.tabs.captureVisibleTab(freshTabInfo.windowId, { format: 'jpeg', quality: CONFIG.screenshotQuality }, (dataUrl) => {
                  if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                  else resolve(dataUrl);
                });
              });
              base64Image = screenshot_data_url.split(',')[1];
              cachedBase64Image = base64Image;
              lastScreenshotUrl = currentUrl;
            } catch (err) {
              sendSilentUpdate(`📷 Screenshot skipped (text-only mode)`, stepCount);
            }
          }
        }
      }

      // Truncate page content — use a larger window in runbook mode so dense
      // log pages (SonicWall Log > View, Connection Monitor exports) aren't cut short.
      let pageText = (pageContent && pageContent.content) || '';
      const effectiveMaxLength = (goal && /PHASE\s+\d|RUNBOOK|INVESTIGATION|checkpoint|TICKET/i.test(goal))
        ? 28000
        : CONFIG.maxPageContentLength;
      if (pageText.length > effectiveMaxLength) {
        pageText = pageText.substring(0, effectiveMaxLength) + '\n\n[... content truncated]';
      }

      // Build the capped element list HERE in the main loop so both the
      // LLM call and the selector validator use exactly the same set.
      // Complex pages (Etsy, eBay) can have 500+ elements — sending them all
      // causes request-body timeouts. Prioritize actionable element types.
      const allElements = (observation && observation.elements) ? observation.elements : [];
      const priorityTypes = ['button', 'input', 'select', 'textarea'];
      const priorityEls = allElements.filter(e => priorityTypes.some(t => e.selector && e.selector.toLowerCase().includes(t)));
      const otherEls    = allElements.filter(e => !priorityTypes.some(t => e.selector && e.selector.toLowerCase().includes(t)));
      const trimmedElements = [...priorityEls, ...otherEls]
        .slice(0, CONFIG.maxElements)
        .map(e => ({
          ...e,
          // Truncate label text only — NEVER truncate the selector string or
          // the LLM will return a broken selector the content script can't find.
          text: e.text && e.text.length > 80 ? e.text.substring(0, 77) + '…' : e.text
        }));

      // Rate limiting
      await enforceRateLimit();

      // Progress indicator
      let apiWaitSeconds = 0;
      const progressTimer = setInterval(() => {
        apiWaitSeconds += 5;
        sendSilentUpdate(`🤖 Consulting AI... (${apiWaitSeconds}s)`, stepCount);
      }, 5000);

      sendSilentUpdate(`🤖 Consulting AI — call #${apiCallCount + 1}`, stepCount);
      let command;
      try {
        command = await callLLMWithRetry(trimmedElements, allElements.length, pageText, base64Image, goal, history, stepCount, currentUrl);
      } finally {
        clearInterval(progressTimer);
        base64Image = null; // FIX: release screenshot memory after LLM call
      }

      // Advance plan step if the LLM signalled it's done with the current step
      if (command.advance_plan && agentPlan && currentPlanStep < agentPlan.length - 1) {
        currentPlanStep++;
        sendSilentUpdate(`📋 Plan advanced to step ${currentPlanStep + 1}: ${agentPlan[currentPlanStep]}`);
        delete command.advance_plan; // don't pass this field to the executor
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

      // Validate selectors against the trimmed list that was actually sent to the LLM.
      // Using the full observation.elements would allow selectors the LLM never saw,
      // and would reject valid ones that happen to come from the trimmed set.
      if ((command.type === 'click' || command.type === 'type' || command.type === 'hover' || command.type === 'select' || command.type === 'extract') && command.selector) {
        const selectorExists = trimmedElements.some(e => e.selector === command.selector);
        if (!selectorExists) {
          sendSilentUpdate(`⚠️ Invalid selector — re-asking AI`, stepCount);
          consecutiveFailures++;
          history.push({ step: stepCount, action: command, result: `Invalid selector "${command.selector}" — not in element list.` });
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
        sendSilentUpdate(`✅ Task complete`, stepCount);

        // Append extracted memory values to the summary so ticket output is complete.
        // Without this, all IPs, rule IDs, zone names, and FQDNs collected across
        // the investigation phases are silently dropped from the final output.
        let finalSummary = command.summary || '';
        const memKeys = Object.keys(agentMemory);
        if (memKeys.length > 0) {
          const memLines = memKeys.map(k => {
            const val = agentMemory[k];
            const valStr = Array.isArray(val)
              ? val.slice(0, 10).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ')
              : String(val).substring(0, 300);
            return `• ${k}: ${valStr}`;
          }).join('\n');
          finalSummary += `\n\n---\n**Extracted Data (from investigation):**\n${memLines}`;
        }

        chrome.runtime.sendMessage({ action: 'agent_finished', summary: finalSummary }).catch(() => {});
        // Self-learning: save pattern
        saveLearnedPattern(goal, history, true);
        break;
      }

      // Handle note
      if (command.type === 'note') {
        const noteText = command.text || command.summary || 'No note text';
        sendSilentUpdate(`📝 ${noteText.slice(0, 200)}${noteText.length > 200 ? '...' : ''}`, stepCount);
        history.push({ step: stepCount, action: command, result: `Note recorded: ${noteText}` });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        await sleep(500);
        continue;
      }

      // Handle extract / extract_list (save to agent memory)
      if (command.type === 'extract' || command.type === 'extract_list') {
        sendSilentUpdate(`🔍 Extracting: ${command.key}`, stepCount);
      }

      // Handle wait_for actions
      if (command.type === 'wait_for_text' || command.type === 'wait_for_element' || command.type === 'wait_for_navigation') {
        sendSilentUpdate(`⏳ Waiting for: ${command.text || command.selector || 'navigation'}`, stepCount);
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

      sendSilentUpdate(`⚡ Executing: ${command.type}`, stepCount);

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

      // Invalidate screenshot cache for any action that can change the page
      if (['navigate', 'click', 'type', 'press_key', 'select'].includes(command.type)) {
        lastScreenshotUrl = null;
        cachedBase64Image = null;
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
        // Extract / extract_list — send to content script, save result to agentMemory
        const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
        result = (res && res.result) || 'Done';
        let extractSucceeded = false;
        try {
          const parsed = JSON.parse(result.replace('JS Result: ', ''));
          if (parsed.key !== undefined && parsed.value !== undefined) {
            agentMemory[parsed.key] = parsed.value;
            // Enforce maxMemoryEntries — evict oldest key when over the limit
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
          // extract result wasn't JSON — treat as failure so strategy-shift can trigger
        }
        if (!extractSucceeded) actionFailed = true;
      } else {
        // All other commands go through content script
        try {
          const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
          result = (res && res.result) ? res.result : 'Done';
          // Use case-sensitive prefix checks to avoid false positives when
          // page content or typed text happens to contain "not found" or "Error".
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
            result = 'Clicked → navigated to ' + (newUrl ? new URL(newUrl).hostname : 'new page');
          } else {
            const updatedTab = await new Promise(resolve => {
              chrome.tabs.get(tab, (info) => { resolve(chrome.runtime.lastError ? null : info); });
            });
            if (updatedTab && updatedTab.url !== urlBeforeCommand) {
              await waitForPageLoad(tab);
              await sleep(500);
              try { result = 'Clicked → navigated to ' + new URL(updatedTab.url).hostname; } catch (e) { result = 'Clicked → page navigated'; }
            }
          }
        } catch (e) {}
      }

      // Track success/failure for self-healing
      if (actionFailed) {
        consecutiveFailures++;
        currentStrategies.push(`${command.type}:${command.selector || command.url || ''}`);
        // Cap to avoid injecting an ever-growing list into every prompt
        if (currentStrategies.length > 10) currentStrategies.shift();
      } else {
        consecutiveFailures = 0;
        currentStrategies = [];
      }

      sendActionResult(stepCount, result, actionFailed);
      history.push({ step: stepCount, action: command, result });
      
      // Consecutive navigate tracking
      if (command.type === 'navigate') {
        consecutiveNavigates++;
      } else if (['extract', 'extract_list', 'read_page'].includes(command.type)) {
        consecutiveNavigates = 0;
      }
      
      // HARD GUARD: After 3 consecutive navigates without reading/extracting,
      // force a read_page so the LLM actually sees what it navigated to
      if (consecutiveNavigates >= 3) {
        sendSilentUpdate(`📖 Auto-reading page after ${consecutiveNavigates} navigates`, stepCount);
        try {
          const forcedRead = await sendMessageWithRetry(tab, { action: 'get_page_info' });
          if (forcedRead) {
            const forcedText = (forcedRead.text || '').substring(0, 8000);
            history.push({ step: stepCount, action: { type: 'read_page' }, result: `Auto-read: ${forcedText.substring(0, 500)}` });
            // Inject the page content into the next LLM call by updating the last observation
            observation = forcedText;
          }
        } catch (e) { /* non-fatal */ }
        consecutiveNavigates = 0;
      }
      // FIX: cap in-memory history to prevent unbounded RAM growth
      if (history.length > CONFIG.maxHistoryEntries) {
        history.splice(0, history.length - CONFIG.maxHistoryEntries);
      }
      // FIX: only write last N entries to storage (not the full array every step)
      await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
      await sleep(1500);

    } catch (err) {
      console.error('Agent loop error:', err);
      sendSilentUpdate(`❌ Loop error: ${err.message}`, stepCount);
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
    // Keep only the last N patterns
    if (patterns.length > CONFIG.maxLearnedPatterns) patterns.splice(0, patterns.length - CONFIG.maxLearnedPatterns);
    await chrome.storage.local.set({ learned_patterns: patterns });
  } catch (e) { console.warn('Failed to save pattern:', e); }
}

async function getRelevantPatterns(goal) {
  try {
    const stored = await chrome.storage.local.get(['learned_patterns']);
    const patterns = stored.learned_patterns || [];
    // Simple relevance: match on shared keywords
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

// ========== Silent Updates ==========
// stepNumber tags the message to a specific step card in the UI.
// Pass 0 or omit for pre-loop messages (planning, startup).
function sendSilentUpdate(text, stepNumber) {
  chrome.runtime.sendMessage({ action: 'agent_update', text, stepNumber: stepNumber || 0, silent: true }).catch(() => { console.log(text); });
}

function sendActionMessage(command, stepNumber, observation) {
  let description;
  if (['click', 'type', 'hover', 'select', 'extract'].includes(command.type) && observation && observation.elements) {
    const el = observation.elements.find(e => e.selector === command.selector);
    if (el && el.text && el.text !== 'No label') {
      const label = el.text.length > 50 ? el.text.substring(0, 47) + '...' : el.text;
      description = command.type === 'click' ? `Click "${label}"` : command.type === 'hover' ? `Hover "${label}"` : command.type === 'select' ? `Select in "${label}"` : command.type === 'extract' ? `Extract from "${label}"` : `Type into "${label}"`;
    } else {
      description = `${command.type} element`;
    }
  } else if (command.type === 'navigate' && command.url) {
    try { description = `Navigate to ${new URL(command.url).hostname}`; } catch (e) { description = `Navigate to ${command.url}`; }
  } else if (command.type === 'scroll') {
    description = `Scroll ${(command.amount || 0) >= 0 ? 'down' : 'up'}`;
  } else if (command.type === 'execute_js') {
    description = `Run custom JS`;
  } else if (command.type === 'press_key') {
    description = `Press ${command.key || 'Enter'}`;
  } else if (command.type === 'wait_for_text') {
    description = `Wait for text: "${(command.text || '').substring(0, 40)}"`;
  } else if (command.type === 'wait_for_element') {
    description = `Wait for element`;
  } else if (command.type === 'wait_for_navigation') {
    description = `Wait for navigation`;
  } else {
    description = `${command.type}`;
  }
  chrome.runtime.sendMessage({ action: 'agent_action', payload: { type: command.type, description, stepNumber } }).catch(() => {});
}

function sendActionResult(stepNumber, result, isError) {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  chrome.runtime.sendMessage({ action: 'agent_action_result', stepNumber, result: resultStr.substring(0, 120), isError: !!isError }).catch(() => {});
}

// ========== Utilities ==========
async function enforceRateLimit() {
  const delayNeeded = Math.max(0, CONFIG.minDelayBetweenCalls - (Date.now() - lastApiCallTime));
  if (delayNeeded > 0) await sleep(delayNeeded);
  lastApiCallTime = Date.now();
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForPageLoad(tabId) {
  const tab = await new Promise(resolve => { chrome.tabs.get(tabId, (i) => { resolve(chrome.runtime.lastError ? null : i); }); });
  if (!tab || tab.status === 'complete') return;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, CONFIG.pageLoadTimeout);
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timeout); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function createContentScriptListener(tabId, timeout = 3000) {
  let timer, listener, resolved = false;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => { if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); resolve(false); }, timeout);
    listener = (msg, sender) => {
      if (msg.action === 'content_script_ready' && sender.tab && sender.tab.id === tabId) {
        if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); clearTimeout(timer); resolve(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
  return { promise, cancel() { if (resolved) return; resolved = true; chrome.runtime.onMessage.removeListener(listener); clearTimeout(timer); } };
}

async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      if (i < maxRetries - 1) {
        const csListener = createContentScriptListener(tabId, 2000);
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await csListener.promise; } catch (e) { csListener.cancel(); }
        await sleep(500 * (i + 1));
      } else { throw err; }
    }
  }
}

// ========== Platform Context Detection ==========
// Detects which UI the agent is currently operating in based on the page URL
// and goal text, then injects platform-specific behavioral guidance.
// Specifics (IPs, credentials, zone names, rule names) are intentionally NOT
// hardcoded here — those come from the user's goal/Context Memory. This
// function only provides UI interaction patterns for each platform type.

function getPlatformContext(currentUrl, goal) {
  const url  = (currentUrl || '').toLowerCase();
  const text = (goal || '').toLowerCase();

  // ── SonicWall ──────────────────────────────────────────────────────────────
  const isSonicWall =
    url.includes('sonicwall') ||
    text.includes('sonicwall') ||
    text.includes('sonicos') ||
    // Management UI fingerprint: SonicWall serves its UI from the firewall IP
    // with paths like /ui/, #/dashboard, or just the root after login
    /\/ui\b|#\/dashboard|#\/firewall|#\/network|#\/security/.test(url);

  if (isSonicWall) {
    return `
PLATFORM: SonicWall Management UI (SonicOS)
UI-SPECIFIC RULES — follow these exactly:

DROPDOWNS: SonicWall uses Angular custom dropdowns, NOT native <select> elements.
  - To select a value: first CLICK the dropdown trigger to open the list, then CLICK the desired option.
  - Never use the "select" action on SonicWall dropdowns — it only works on native HTML <select> and will silently fail here.
  - If a dropdown doesn't open on first click, try hover then click.

SAVING CHANGES: Every policy/object change requires an explicit commit step.
  - After editing a rule or object, look for an "Accept", "Apply", "OK", or "Save" button and click it.
  - Changes shown on screen are NOT saved until committed — always confirm before moving on.
  - After committing, wait for the success toast/banner before proceeding.

LOG PAGES: Log > View and Connection Monitor pages are slow to populate.
  - After navigating to a log page, use wait_for_text with a 30000ms timeout before reading.
  - Filter inputs may need a click to focus before type will work.
  - Export/download buttons generate CSV files — note the filename in a "note" action.

NAVIGATION: SonicWall uses SPA hash routing (#/path).
  - After clicking a nav item, wait 2-3 seconds for the panel to render before scanning elements.
  - If a panel seems empty, use scroll to reveal lazy-loaded content, then read_page again.

POLICY RULES TABLE: Click a rule row to open its edit dialog.
  - The edit icon (pencil) or the row itself opens the edit form.
  - Rule order matters: note the row number/position as well as the rule name.

SESSION EXPIRY: If you see a login form mid-task, the session expired.
  - The management URL and credentials are in the goal/context — re-login and resume.

IFRAMES: Some SonicWall panels (especially older 6.5 UI) embed content in iframes.
  - If expected elements aren't found, try scrolling or waiting — they may be in a same-origin iframe that the scanner will pick up automatically.
  - Cross-origin iframes cannot be read — note this and use read_page on the outer frame instead.
`;
  }

  // ── Fortinet / FortiGate ───────────────────────────────────────────────────
  const isFortinet =
    url.includes('fortinet') || url.includes('fortigate') || url.includes('fortimanager') ||
    text.includes('fortinet') || text.includes('fortigate');

  if (isFortinet) {
    return `
PLATFORM: Fortinet / FortiGate Management UI
UI-SPECIFIC RULES:
  - Dropdowns are custom widgets — click to open, then click the option (not native select).
  - After policy changes, click Apply and wait for the green confirmation banner.
  - Log pages use virtual scrolling — scroll down to load more entries.
  - Tables have inline edit icons (pencil); click the icon not the row to edit.
  - Session timeout is short — if a login page appears, re-authenticate using goal credentials.
`;
  }

  // ── Cisco (FMC / ASDM / ISE / Meraki) ────────────────────────────────────
  const isCisco =
    url.includes('cisco') || url.includes('/asdm') || url.includes('/fmc') ||
    url.includes('meraki') || url.includes('.ise.') ||
    text.includes('cisco asa') || text.includes('firepower') || text.includes('meraki') ||
    text.includes('cisco ise');

  if (isCisco) {
    return `
PLATFORM: Cisco Management UI (ASA/FMC/Meraki/ISE)
UI-SPECIFIC RULES:
  - ASDM uses Java — if the UI is Java-based, use execute_js sparingly; DOM interaction is limited.
  - FMC uses custom React components — dropdowns need click-to-open then click-option.
  - Meraki dashboard: standard web UI, most actions work normally; wait for AJAX to settle after saves.
  - Always look for a Deploy or Commit button after policy changes — pending changes are staged, not live.
  - Log tables use pagination — note the page number when extracting log entries.
`;
  }

  // ── Palo Alto (PAN-OS / Panorama) ─────────────────────────────────────────
  const isPaloAlto =
    url.includes('paloalto') || url.includes('panorama') || url.includes('/php/rest/pan') ||
    text.includes('palo alto') || text.includes('pan-os') || text.includes('panorama');

  if (isPaloAlto) {
    return `
PLATFORM: Palo Alto Networks (PAN-OS / Panorama)
UI-SPECIFIC RULES:
  - After any change, a "Commit" step is required — look for the Commit button (top right) and click it.
  - Dropdowns are Ext JS widgets — click the dropdown arrow, then click the option.
  - Tabs within panels are clickable text — click the tab label to switch views.
  - Log Viewer uses AJAX pagination — wait for spinner to disappear before extracting log data.
  - Object names are case-sensitive — extract exact names as shown on screen.
`;
  }

  // ── Generic enterprise/network device UI ──────────────────────────────────
  const isNetworkDevice =
    text.includes('firewall') || text.includes('router') || text.includes('switch') ||
    text.includes('access point') || text.includes('management ui') ||
    text.includes('admin panel') || text.includes('web ui');

  if (isNetworkDevice) {
    return `
PLATFORM: Network/Security Device Management UI (generic)
UI-SPECIFIC RULES:
  - Many network device UIs use custom dropdowns — if "select" fails, try click-to-open then click-option.
  - Changes are often staged — look for Apply, Save, Commit, or Accept buttons after edits.
  - Log pages may be slow to load — use wait_for_text with generous timeouts (20000–30000ms).
  - Session timeouts are common — if a login form appears, re-authenticate using credentials from the goal.
  - Table rows often open edit dialogs on click — click the row or its edit icon to modify entries.
`;
  }

  return ''; // No platform-specific context needed
}

// ========== API ==========
function supportsVision(model) {
  if (!model) return false;
  const vm = ['glm-4.5v', 'glm-4.6v', 'glm-5v', 'gpt-4o', 'gpt-4-vision', 'claude-3', 'claude-4', 'gemini', 'qwen-vl', 'llava'];
  return vm.some(v => model.toLowerCase().includes(v));
}

// Detect whether the configured endpoint is the native Anthropic Messages API.
// OpenRouter/proxy endpoints that happen to serve Claude models use OpenAI format,
// so only direct api.anthropic.com calls need special handling.
function isAnthropicEndpoint(endpoint) {
  return endpoint && endpoint.includes('api.anthropic.com');
}

async function callLLMWithRetry(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl = '', retryCount = 0) {
  try { return await callLLM(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl); }
  catch (err) {
    const msg = err.message || '';
    const isRetryable = (msg.includes('429') || msg.includes('502') || msg.includes('503') || msg.includes('timed out') || msg.includes('AbortError') || msg.includes('Failed to fetch')) && retryCount < CONFIG.maxRetries;
    if (isRetryable) {
      const baseDelay = msg.includes('429') ? CONFIG.retryDelay : CONFIG.retryDelay / 2;
      const delay = Math.min(baseDelay * Math.pow(2, retryCount) + Math.floor(Math.random() * 2000), CONFIG.maxRetryDelay);
      sendSilentUpdate(`⚠️ Retrying in ${Math.round(delay/1000)}s...`, stepCount);
      await sleep(delay);
      return callLLMWithRetry(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, retryCount + 1);
    }
    throw err;
  }
}

// trimmedElements: the capped/cleaned element list built in the main loop
// totalElementCount: the raw count before trimming (for the prompt header)
async function callLLM(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl = '') {
  const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  const endpoint = settings.api_endpoint || 'https://api.z.ai/api/paas/v4/chat/completions';
  const apiKey = settings.api_key;
  const model = settings.model || 'glm-5.1';
  if (!apiKey) throw new Error('API key not configured. Set it in extension settings.');
  apiCallCount++;

  const last_action = history.length > 0 ? history[history.length - 1].action : null;
  const last_result = history.length > 0 ? history[history.length - 1].result : null;

  // Runbook detection — expanded to catch IT investigation prompts, phase-based workflows,
  // and any structured multi-step prompt a technician might paste in.
  const isRunbook = /STEP\s+\d|PHASE\s+\d|INVESTIGATION|RUNBOOK|Navigation:|Success Indicator|TICKET|checkpoint|rollback|decision tree|Phase [0-9]|what has been tried|fastest.*resolution/i.test(goal);

  const runbookCtx = isRunbook ? `
RUNBOOK / INVESTIGATION MODE ACTIVE
You are executing a structured, multi-phase IT investigation. Rules for this mode:
1. NEVER finish early — complete ALL phases listed in the goal before calling "finish".
2. Use "note" actions liberally to document every finding: IPs, zone names, rule IDs, log entries, FQDN lists, any value observed on screen.
3. Use "extract" to save key values (client IP, rule name, zone, etc.) to memory for later reference via {{key}}.
4. Navigate to each UI location specified. Read the page after every navigation before acting.
5. If a page has a form or filter, fill it in before reading results.
6. Follow the phase order exactly. Complete each phase fully before advancing.
7. At the end, call "finish" with a COMPLETE ticket-ready summary: all phases covered, all findings listed, the exact change made (or recommended), and rollback steps.
8. Do NOT skip phases because you think you found the answer early — document ALL phases as instructed.
` : '';

  // Navigation fatigue detection — DISABLED in runbook mode.
  // IT investigations legitimately navigate 20+ times (one per UI section per phase).
  // Firing the finish-early warning during a runbook would corrupt the investigation.
  const navigateCount = history.filter(h => h.action.type === 'navigate').length;
  const extractCount = history.filter(h => ['extract', 'extract_list'].includes(h.action.type)).length;
  const noteCount = history.filter(h => h.action.type === 'note').length;

  // Only apply navigation fatigue for non-runbook, pure research tasks.
  // For runbooks: suppress entirely so all phases can complete.
  const finishCtx = isRunbook ? '' :
    (navigateCount >= 3 && extractCount === 0 && noteCount === 0)
    ? `\n⚠️ HARD STOP — You navigated ${navigateCount} times without extracting or noting anything. You MUST use \"extract\", \"note\", or \"finish\" NOW. Do NOT navigate again.\n`
    : (navigateCount >= 5 && extractCount === 0 && noteCount === 0)
    ? `\n⚠️ FINISH NOW — ${navigateCount} navigates with nothing recorded. Use your memory and finish with a comprehensive answer. Include ACTUAL content.\n`
    : '';

  // Platform-specific UI guidance — injected automatically based on current URL + goal.
  // Specifics (IPs, credentials, zones) come from the goal; this provides UI behavior rules only.
  const platformCtx = getPlatformContext(currentUrl, goal);

  // Self-healing: strategy shift prompt
  let strategyCtx = '';
  if (consecutiveFailures >= CONFIG.strategyShiftThreshold) {
    strategyCtx = `\n⚠️ STRATEGY SHIFT REQUIRED — You have failed ${consecutiveFailures} times in a row.\nApproaches already tried: ${currentStrategies.join(', ')}\nYou MUST try a COMPLETELY DIFFERENT approach. Consider:\n- Using "execute_js" to write custom JavaScript to accomplish the task\n- Scrolling to find different elements\n- Navigating to a different page\n- Using "extract" + memory to build data step by step\nDo NOT repeat the same failed action.\n`;
  }

  // Self-learning: inject relevant patterns
  const patterns = await getRelevantPatterns(goal);
  const patternCtx = patterns.length > 0
    ? `\nPAST SUCCESSFUL PATTERNS (similar tasks):\n${patterns.map((p, i) => `${i+1}. "${p.goal}" → ${p.steps.map(s => s.type).join(' → ')}`).join('\n')}\n`
    : '';

  // Memory context
  const memoryKeys = Object.keys(agentMemory);
  const memoryCtx = memoryKeys.length > 0
    ? `\nAGENT MEMORY (data extracted from pages, use {{key}} to reference):\n${JSON.stringify(agentMemory, null, 2)}\n`
    : '';

  // Inject plan context if a plan was generated
  let planCtx = '';
  if (agentPlan && agentPlan.length > 0) {
    const planLines = agentPlan.map((step, i) => {
      const marker = i < currentPlanStep ? '✅' : i === currentPlanStep ? '▶️' : '⬜';
      return `${marker} ${i + 1}. ${step}`;
    }).join('\n');
    planCtx = `\nEXECUTION PLAN (your roadmap — follow in order):\n${planLines}\n\nCURRENT PLAN STEP: ${currentPlanStep + 1} — "${agentPlan[currentPlanStep] || 'All steps complete'}"\nWhen the current plan step is fully done, include "advance_plan": true in your JSON response.\n`;
  }

  // Build prompt — trimmedElements was already prepared in the main loop
  const prompt = `You are Sentinel Override v3, an autonomous browser agent. You can create tools, extract data, and solve ANY web task.
${runbookCtx}${platformCtx}${planCtx}${strategyCtx}${finishCtx}${patternCtx}${memoryCtx}
Current step: ${stepCount}
Goal: ${goal}

CURRENT PAGE CONTENT:
${pageContent}

AVAILABLE INTERACTIVE ELEMENTS (use ONLY these selectors — ${trimmedElements.length} of ${totalElementCount} shown, prioritized by type):
${JSON.stringify(trimmedElements, null, 2)}

RECENT HISTORY (last ${isRunbook ? 12 : CONFIG.historyWindow} steps${isRunbook ? ' — extended for runbook context' : ''}):
${JSON.stringify(history.slice(isRunbook ? -12 : -CONFIG.historyWindow).map(h => ({
  step: h.step,
  action: {
    type: h.action.type,
    // Trim full nth-of-type CSS paths to last 60 chars — the LLM needs intent,
    // not the full DOM path. Saves ~100 tokens per history entry.
    selector: h.action.selector
      ? (h.action.selector.length > 60 ? '…' + h.action.selector.slice(-60) : h.action.selector)
      : undefined,
    text: h.action.text,
    url: h.action.url
  },
  result: typeof h.result === 'string' ? h.result.substring(0, 200) : h.result
})), null, 2)}

${last_action && last_result && String(last_result).includes('not found') ? 'CRITICAL: Last action FAILED. You MUST pick a selector from the AVAILABLE INTERACTIVE ELEMENTS list.' : ''}

RULES:
1. **READ BEFORE YOU ACT** — Always "read_page" or "extract" BEFORE navigating. You CANNOT extract data from a page you already left!
2. **EXTRACT OR FINISH** — After reading a page, either "extract" key data to memory OR "finish" with the answer. NEVER just navigate away.
3. **MAX 2 NAVIGATES** — For research tasks, visit at most 2 sites. Extract everything, then finish.
4. **FINISH EARLY** — If you have enough data to answer the question, FINISH immediately. Do NOT browse more sites "just in case".
5. **NO VAGUE SUMMARIES** — Include ACTUAL TEXT, names, numbers, URLs, prices. "Found articles" is useless. "Article 'X' by Y says Z" is useful.
6. Use "extract" + memory to carry data between pages. Reference with {{key}}.
7. If standard actions fail, use "execute_js" to write custom code to handle it.
8. For dropdowns: use "select". For hover menus: use "hover" then "click".
9. One action per step. Return ONLY valid JSON.
10. **PREFERRED WORKFLOW**: read_page → extract/note → read_page → extract/note → finish (4-6 steps total)

Actions available:
1. { "type": "click", "selector": "FROM_LIST" } — Click element
2. { "type": "type", "selector": "FROM_LIST", "text": "TEXT" } — Type text (supports {{memory_key}})
3. { "type": "navigate", "url": "URL" } — Go to URL (supports {{memory_key}})
4. { "type": "scroll", "amount": INTEGER } — Scroll up/down
5. { "type": "select", "selector": "FROM_LIST", "value": "OPTION" } — Select dropdown option
6. { "type": "hover", "selector": "FROM_LIST" } — Hover over element
7. { "type": "press_key", "key": "Enter|Tab|Escape|ArrowDown|..." } — Press keyboard key
8. { "type": "extract", "key": "memory_key", "selector": "FROM_LIST", "attribute": "text|href|value|..." } — Extract one value to memory
9. { "type": "extract_list", "key": "memory_key", "selector": "CSS_CONTAINER", "fields": { "title": "h2", "price": ".price", "reviews": ".review-count" }, "limit": 10 } — POWERFUL: extract structured data from ALL matching containers in one step. Use for product grids, search results, listings. selector is a raw CSS selector (not from the elements list) that matches each repeated card/row.
10. { "type": "wait_for_text", "text": "TEXT", "timeout": 5000 } — Wait until text appears
11. { "type": "wait_for_element", "selector": "FROM_LIST", "timeout": 5000 } — Wait until element exists
12. { "type": "wait_for_navigation", "timeout": 5000 } — Wait for URL change
13. { "type": "execute_js", "code": "JS_CODE" } — Run custom JavaScript on the page. Use to handle ANY complex UI. Return value is captured.
14. { "type": "read_page" } — Re-read page content
15. { "type": "note", "text": "FINDINGS" } — Record findings without page interaction
16. { "type": "finish", "summary": "FULL DETAILED REPORT with actual text, names, numbers, URLs, comparisons, and analysis" } — Task complete. Your summary is the ONLY output the user sees. Make it COUNT: specific data, not vague descriptions. For research: write a FULL multi-paragraph answer as if explaining to a colleague.

Return ONLY a JSON object. No markdown, no explanation.`;

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeout);

  // Build request body (OpenAI-compatible vs native Anthropic)
  const useAnthropic = isAnthropicEndpoint(endpoint);
  let requestBody, requestHeaders;

  if (useAnthropic) {
    const userContent = (supportsVision(model) && base64Image)
      ? [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } }
        ]
      : prompt;
    requestBody = JSON.stringify({
      model,
      max_tokens: 8000,
      temperature: 0.3,
      system: 'You are Sentinel Override, a precise web automation agent. Return ONLY valid JSON.',
      messages: [{ role: 'user', content: userContent }]
    });
    requestHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
  } else {
    requestBody = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are Sentinel Override, a precise web automation agent. Return ONLY valid JSON.' },
        { role: 'user', content: (supportsVision(model) && base64Image)
            ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }]
            : prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 8000
    });
    requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
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

  // Parse response (Anthropic vs OpenAI format)
  let responseText;
  if (useAnthropic) {
    const block = data.content && data.content.find(b => b.type === 'text');
    if (!block) throw new Error(`Anthropic API returned no text block: ${JSON.stringify(data).slice(0, 500)}`);
    responseText = block.text;
  } else {
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error(`API returned no valid response: ${data.error?.message || JSON.stringify(data).slice(0, 500)}`);
    }
    responseText = data.choices[0].message.content;
  }
  return parseLLMResponse(responseText);
}

// ========== Response Parsing ==========
function extractFirstJsonObject(str) {
  const start = str.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return str.substring(start, i + 1); }
  }
  return null;
}

function parseLLMResponse(content) {
  try {
    let jsonStr = content.trim();
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) jsonStr = match[1].trim();
    }
    const firstObj = extractFirstJsonObject(jsonStr);
    if (firstObj) jsonStr = firstObj;
    let parsed = JSON.parse(jsonStr);
    if (!parsed.type && parsed.action && typeof parsed.action === 'object') parsed = parsed.action;
    if (!parsed.type && parsed.command && typeof parsed.command === 'object') parsed = parsed.command;
    if (!parsed.type && parsed.next_action && typeof parsed.next_action === 'object') parsed = parsed.next_action;
    if (!parsed.type) throw new Error('Missing type field');
    const validTypes = ['click', 'type', 'navigate', 'scroll', 'select', 'hover', 'press_key',
      'extract', 'extract_list', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
      'execute_js', 'read_page', 'note', 'finish'];
    if (!validTypes.includes(parsed.type)) throw new Error('Invalid command type: ' + parsed.type);
    return parsed;
  } catch (err) {
    console.error('Failed to parse LLM response:', err, 'Content:', content);
    return { type: 'note', text: `⚠️ Parse error (will retry): ${err.message}` };
  }
}

// ========== Validation ==========
function isValidUrl(url) {
  try { const p = new URL(url); return ['http:', 'https:'].includes(p.protocol); } catch { return false; }
}

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
