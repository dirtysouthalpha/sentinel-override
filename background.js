let agentRunning = false;
let agentTabId = null;  // Track which tab the agent is working on
let apiCallCount = 0;
let lastApiCallTime = 0;
let sessionCost = 0.0;  // Track cumulative spend per session
let costLog = [];       // Audit trail of all API calls
let isOpenRouter = false; // Tracks if current endpoint is OpenRouter
let currentPlan = null;   // Stores the current decomposed plan
let currentStepIndex = 0; // Tracks which step we're executing


// ========== Task Context — Goal Retention ==========
let taskContext = {
  goal: null,
  completedSteps: [],
  intermediateData: {},
  failedAttempts: [],
  currentPhase: 'idle',
  startTime: null
};

// ========== Shortcuts ==========
let savedShortcuts = {};

// ========== Site-Specific Knowledge ==========
const SITE_PATTERNS = {
  'github.com': { platform: 'github', loginSelector: '#login_field', passwordSelector: '#password' },
  'gmail.com': { platform: 'gmail', searchSelector: 'input[type="search"]' },
  'google.com': { platform: 'google', searchSelector: 'input[name="q"]' },
  'calendar.google.com': { platform: 'google-calendar' }
};

function getSitePattern(url) {
  try {
    var parsed = new URL(url);
    for (var domain in SITE_PATTERNS) {
      if (parsed.hostname.includes(domain)) return SITE_PATTERNS[domain];
    }
  } catch (e) {}
  return null;
}

// ========== Auto-Tool Generation ==========
async function generateMissingTool(error, step, workingTabId) {
  sendSilentUpdate('[Auto-Tool] Generating workaround for: ' + (error.message || String(error)).substring(0, 60));
  var settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  var endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  var apiKey = settings.api_key;
  var model = settings.model || 'deepseek-v4-flash';
  var genPrompt = 'A browser step failed. ERROR: ' + (error.message || String(error)) + '. STEP: ' + step.description + '. Generate a short JavaScript snippet (max 15 lines) to work around this. Use creative selectors (text content, aria-label, title). Return ONLY the code, no markdown.';
  try {
    var response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: genPrompt }],
        max_tokens: 400,
        temperature: 0.3
      })
    });
    var data = await response.json();
    var script = data.choices[0].message.content;
    script = script.replace(/```javascript?\n?/gi, '').replace(/```\n?/g, '').trim();
    if (script.length < 5) return null;
    sendSilentUpdate('[Auto-Tool] Script generated (' + script.length + ' chars), injecting...');
    var results = await chrome.scripting.executeScript({
      target: { tabId: workingTabId },
      func: new Function('return (' + script + ')'),
      world: 'MAIN'
    });
    return results[0] && results[0].result ? results[0].result : { success: true };
  } catch (genError) {
    console.error('Auto-tool generation failed:', genError);
    return null;
  }
}

// ========== Shortcut Management ==========
function saveShortcut(name, prompt) {
  savedShortcuts[name] = prompt;
  chrome.storage.local.set({ savedShortcuts: savedShortcuts });
}

function executeShortcut(name) {
  var prompt = savedShortcuts[name];
  if (prompt) chrome.runtime.sendMessage({ action: 'plan_task', goal: prompt }).catch(function() {});
}

function getContextSummary() {
  var completed = taskContext.completedSteps.length;
  var data = Object.entries(taskContext.intermediateData).slice(-5);
  var fails = taskContext.failedAttempts.slice(-3);
  return 'Goal: ' + taskContext.goal + '\nSteps done: ' + completed + '\nData: ' + data.map(function(d) { return d[0] + '=' + String(d[1]).substring(0, 40); }).join(', ') + '\nFailures: ' + fails.map(function(f) { return f.error.substring(0, 60); }).join(' | ');
}


// ========== Action Button Handler ==========
chrome.action.onClicked.addListener((tab) => {
  // Open sidebar for this specific tab only
  chrome.sidePanel.open({ tabId: tab.id });
});

// Configuration for rate limiting
const CONFIG = {
  minDelayBetweenCalls: 2000,  // 2 seconds between API calls
  maxRetries: 3,               // Retry failed requests 3 times
  retryDelay: 5000,            // 5 second initial delay
  screenshotQuality: 30,       // Lower quality = smaller file = faster
  batchActions: true,          // Group similar actions together
};

// ========== HARD-CODED COST SAFETY ==========
// These limits are enforced in code and cannot be bypassed by prompt
const COST_SAFETY = {
  // Hard whitelist — only these models allowed via Venice
  VENICE_ALLOWED_MODELS: new Set([
    'gemma-4-uncensored',
    'grok-41-fast',
    'google-gemma-4-31b-it',
    'google-gemma-4-26b-a4b-it',
    'deepseek-v4-flash',
    'google-gemma-3-27b-it',
    'mistral-small-3-2-24b-instruct',
    'qwen3-5-9b',
    'e2ee-qwen-2-5-7b-p',
    'e2ee-gpt-oss-20b-p',
    'openai-gpt-oss-120b',
    'nvidia-nemotron-3-nano-30b-a3b',
    'zai-org-glm-4.7-flash',
  ]),

  // Hard block list — never allowed on Venice (prefix match)
  BLOCKED_MODEL_PREFIXES: [
    'gpt-4', 'gpt-5', 'o1', 'o3',
    'claude-opus', 'claude-sonnet',
    'gemini-pro', 'gemini-ultra',
    'grok-4-20',
    'deepseek-v4-pro',
    'llama-3.3', 'llama-3.1-405b',
    'hermes-3-llama',
    'kimi-k2',
  ],

  // Hard cost limits (in dollars)
  MAX_INPUT_COST: 0.50,
  MAX_OUTPUT_COST: 0.50,
  MAX_TOTAL_COST: 1.00,
  MAX_SESSION_COST: 5.00,

  // Venice rate table (per 1M tokens) — from docs.venice.ai
  RATES: {
    'gemma-4-uncensored': { input: 0.16, output: 0.50 },
    'grok-41-fast': { input: 0.23, output: 0.57, cache_read: 0.06 },
    'google-gemma-4-31b-it': { input: 0.17, output: 0.50 },
    'google-gemma-4-26b-a4b-it': { input: 0.16, output: 0.50 },
    'deepseek-v4-flash': { input: 0.17, output: 0.35 },
    'google-gemma-3-27b-it': { input: 0.12, output: 0.20 },
    'mistral-small-3-2-24b-instruct': { input: 0.09, output: 0.25 },
    'qwen3-5-9b': { input: 0.10, output: 0.15 },
    'e2ee-qwen-2-5-7b-p': { input: 0.05, output: 0.13 },
    'e2ee-gpt-oss-20b-p': { input: 0.05, output: 0.19 },
    'openai-gpt-oss-120b': { input: 0.07, output: 0.30 },
    'nvidia-nemotron-3-nano-30b-a3b': { input: 0.07, output: 0.30 },
    'zai-org-glm-4.7-flash': { input: 0.13, output: 0.50 },
  }
};


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'execute_command') {
    // Execute on the specific agent tab, not the active tab
    if (!agentTabId) {
      sendResponse({result: 'No agent tab specified'});
      return;
    }

    const tab = agentTabId;
    const cmd = request.command;

    if (cmd.type === 'navigate') {
      if (!isValidUrl(cmd.url)) {
        sendResponse({result: 'Invalid URL provided'});
        return;
      }
      chrome.tabs.update(tab, { url: cmd.url }, () => {
        sendResponse({result: 'Navigated to ' + cmd.url});
      });
      return;
    }

    chrome.scripting.executeScript({
      target: {tabId: tab},
      files: ['content.js']
    }, () => {
      chrome.tabs.sendMessage(tab, { action: 'execute_command', command: cmd }, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({result: 'Error: ' + chrome.runtime.lastError.message});
        } else {
          sendResponse(res || {result: 'No response from content script'});
        }
      });
    });
    return true;
  } else if (request.action === 'run_agent_loop') {
    if (agentRunning) {
      sendResponse({status: 'Agent already running'});
      return;
    }

    // Get the tab where the command came from
    if (!sender.tab || !sender.tab.id) {
      // If sender.tab is not available, get the active tab
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs && tabs.length > 0) {
          agentTabId = tabs[0].id;
          agentRunning = true;
          apiCallCount = 0;
          sessionCost = 0.0;
          costLog = [];
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
    sessionCost = 0.0;
    costLog = [];
    runAgentLoop(request.goal, agentTabId);
    sendResponse({status: 'Agent started in background'});
  } else if (request.action === 'stop_agent_loop') {
    agentRunning = false;
    agentTabId = null;
    sessionCost = 0.0;
    sendResponse({status: 'Agent stopped'});
  } else if (request.action === 'plan_task') {
    if (agentRunning) {
      sendResponse({status: 'Agent already running'});
      return;
    }
    agentRunning = true;
    agentTabId = sender.tab ? sender.tab.id : request.tabId;
    if (!agentTabId) {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs && tabs.length > 0) {
          agentTabId = tabs[0].id;
          planTask(request.goal, agentTabId);
          sendResponse({status: 'Planning started'});
        } else {
          agentRunning = false;
          sendResponse({status: 'Error: No active tab'});
        }
      });
      return true;
    }
    planTask(request.goal, agentTabId);
    sendResponse({status: 'Planning started'});
  } else if (request.action === 'execute_plan') {
    if (!currentPlan) {
      sendResponse({status: 'No plan to execute'});
      return;
    }
    currentStepIndex = 0;
    agentRunning = true;
    executePlan(currentPlan, agentTabId || request.tabId);
    sendResponse({status: 'Executing plan'});
  } else if (request.action === 'reject_plan') {
    currentPlan = null;
    currentStepIndex = 0;
    agentRunning = false;
    sendResponse({status: 'Plan rejected'});
  }
});

async function runAgentLoop(goal, workingTabId) {
  console.log('Agent starting loop for goal:', goal);
  console.log('Working on tab:', workingTabId);
  taskContext = { goal: goal, completedSteps: [], intermediateData: {}, failedAttempts: [], currentPhase: 'executing', startTime: new Date().toISOString() };
  let finished = false;
  let history = [];
  let stepCount = 0;

  const stored = await chrome.storage.local.get(['agent_history']);
  if (stored.agent_history) {
    history = stored.agent_history;
  }

  while (!finished && agentRunning) {
    try {
      stepCount++;

      // Always work on the agent's assigned tab, not the active one
      const tab = workingTabId;

      // Get tab info to check current URL
      const tabInfo = await new Promise(resolve => {
        chrome.tabs.get(tab, (info) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(info);
          }
        });
      });

      if (!tabInfo) {
        throw new Error('Agent tab was closed');
      }

      if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('edge://') || tabInfo.url.startsWith('about:')) {
        // Send update to UI but don't show in user's face
        sendSilentUpdate(`[Step ${stepCount}] Internal page detected. Navigating...`);
        await chrome.tabs.update(tab, { url: 'https://www.google.com' });
        await sleep(3000);
        continue;
      }

      // Silent update - send to extension UI, not to user's tab
      sendSilentUpdate(`[Step ${stepCount}] Observing page...`);
      await chrome.scripting.executeScript({
        target: { tabId: tab },
        files: ['content.js']
      });

      // Get page data with retry
      let observation, pageContent;
      try {
        observation = await sendMessageWithRetry(tab, { action: 'observe_page' });
        pageContent = await sendMessageWithRetry(tab, { action: 'read_page' });
      } catch (err) {
        console.error('Failed to get page data:', err);
        sendSilentUpdate(`[Step ${stepCount}] ⚠️ Error reading page: ${err.message}. Retrying...`);
        await sleep(2000);
        continue;
      }

      // Capture screenshot with lower quality to save bandwidth
      sendSilentUpdate(`[Step ${stepCount}] Capturing screen...`);
      const screenshot_data_url = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(tabInfo.windowId, {
          format: 'jpeg',
          quality: CONFIG.screenshotQuality
        }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(dataUrl);
          }
        });
      });
      const base64Image = screenshot_data_url.split(',')[1];

      // Rate limiting before API call
      await enforceRateLimit();

      sendSilentUpdate(`[Step ${stepCount}] Consulting AI (Call #${apiCallCount + 1})...`);
      const command = await callLLMWithRetry(observation, pageContent.content, base64Image, goal, history, stepCount);

      if (command.type === 'finish') {
        finished = true;
        sendSilentUpdate(`✅ Task completed: ${command.summary}`);
        break;
      }

      sendSilentUpdate(`[Step ${stepCount}] Executing: ${command.type}...`);

      let result;
      if (command.type === 'navigate') {
        if (!isValidUrl(command.url)) {
          result = 'Invalid URL: ' + command.url;
        } else {
          await chrome.tabs.update(tab, { url: command.url });
          await sleep(2000);
          result = 'Navigated to ' + command.url;
        }
      } else {
        result = await chrome.tabs.sendMessage(tab, { action: 'execute_command', command });
      }

      history.push({ step: stepCount, observation, action: command, result });
      await chrome.storage.local.set({ agent_history: history });

      // Smart pause between steps
      await sleep(1500);

    } catch (err) {
      console.error('Agent loop error:', err);
      sendSilentUpdate(`[Step ${stepCount}] ❌ Error: ${err.message}`);

      // If tab was closed, stop the agent
      if (err.message.includes('was closed')) {
        agentRunning = false;
        break;
      }

      await sleep(3000);
    }
  }

  if (finished) {
    await chrome.storage.local.set({ agent_history: [] });
  }
  agentRunning = false;
  agentTabId = null;
  console.log(`Agent completed. Total API calls: ${apiCallCount}`);
}

// ========== Silent Updates (send to UI, not interrupting user) ==========
function sendSilentUpdate(text) {
  // Only send to the sidebar panel, don't bother the user
  chrome.runtime.sendMessage({
    action: 'agent_update',
    text: text,
    silent: true  // Flag to not interrupt
  }).catch(() => {
    // Silently ignore if no receiver
    console.log(text);
  });
}

// ========== PLAN: Decompose instruction into steps ==========
async function planTask(goal, workingTabId) {
  try {
    const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
    const endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
    const apiKey = settings.api_key;
    const model = settings.model || 'deepseek-v4-flash';

    sendSilentUpdate('[Plan] Analyzing your instruction...');

    // Detect site-specific patterns for better plans
    try {
      var tab = await chrome.tabs.get(workingTabId);
      var pattern = getSitePattern(tab.url || '');
      if (pattern) {
        sendSilentUpdate('[Plan] Detected platform: ' + pattern.platform);
      }
    } catch (e) {}

    const planPrompt = `You are a task decomposition assistant. Break down the following user instruction into a clear, sequential plan with 2-8 steps.

User instruction: "${goal}"

Return ONLY a JSON object with this exact structure:
{
  "plan_title": "Brief 5-word title",
  "steps": [
    {
      "step_number": 1,
      "action_type": "navigate|click|type|scroll|read_page|ask_user|wait",
      "description": "Clear description of what to do"
    }
  ],
  "estimated_steps": 3,
  "warnings": []  // optional array of strings for potential issues
}

Rules:
- Each step should be a single action
- First step is usually 'navigate' to a URL
- If user needs to provide information (like a password), use action_type "ask_user"
- Keep descriptions brief but clear (10-20 words each)
- Return ONLY valid JSON, no markdown, no explanations`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a precise task decomposition assistant. Return ONLY valid JSON.' },
          { role: 'user', content: planPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error('Plan API error: ' + response.status);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Parse the JSON plan
    let parsed;
    try {
      let jsonStr = content.trim();
      if (jsonStr.includes('```')) {
        const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (match && match[1]) jsonStr = match[1].trim();
      }
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Failed to parse plan: ' + e.message);
    }

    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error('Plan has no steps');
    }

    currentPlan = parsed;
    currentStepIndex = 0;

    // Send plan to popup for approval
    chrome.runtime.sendMessage({
      action: 'show_plan',
      plan: parsed,
      goal: goal
    }).catch(() => {
      // Popup may not be open
      console.log('Plan ready:', parsed.plan_title);
    });

    sendSilentUpdate('[Plan] ' + parsed.plan_title + ' - ' + parsed.steps.length + ' steps');

  } catch (err) {
    console.error('Plan error:', err);
    agentRunning = false;
    chrome.runtime.sendMessage({
      action: 'plan_error',
      error: err.message
    }).catch(() => {});
    sendSilentUpdate('[Plan] Error: ' + err.message);
  }
}

// ========== EXECUTE: Run pre-planned steps ==========
async function executePlan(plan, workingTabId) {
  console.log('Executing plan:', plan.plan_title);
  console.log('Working on tab:', workingTabId);
  // Initialize task context for this execution
  taskContext = { goal: taskContext.goal || 'User instruction', completedSteps: [], intermediateData: {}, failedAttempts: [], currentPhase: 'executing', startTime: new Date().toISOString() };
  let history = [];

  while (currentStepIndex < plan.steps.length && agentRunning) {
    const step = plan.steps[currentStepIndex];

    try {
      // Send step status to popup
      chrome.runtime.sendMessage({
        action: 'step_executing',
        stepNumber: step.step_number,
        totalSteps: plan.steps.length
      }).catch(() => {});

      sendSilentUpdate('[Step ' + step.step_number + '/' + plan.steps.length + '] ' + step.description);

      if (step.action_type === 'navigate') {
        await chrome.tabs.update(workingTabId, { url: step.url || 'https://www.google.com' });
        await sleep(2500);
        taskContext.completedSteps.push({ step: step.step_number, description: step.description, result: 'navigated to ' + (step.url || 'google'), timestamp: new Date().toISOString() });
        taskContext.intermediateData['lastPage'] = step.url || 'google';
      } else if (step.action_type === 'wait') {
        await sleep((step.duration || 2) * 1000);
      } else if (step.action_type === 'ask_user') {
        // Skip - handled by user manually
        sendSilentUpdate('[Step ' + step.step_number + '] Waiting for user input: ' + step.description);
        await sleep(1000);
      } else {
        // Execute action via content script
        await chrome.scripting.executeScript({
          target: { tabId: workingTabId },
          files: ['content.js']
        });

        const result = await sendMessageWithRetry(workingTabId, {
          action: 'execute_command',
          command: {
            type: step.action_type,
            selector: step.selector || '',
            text: step.text || '',
            url: step.url || ''
          }
        });

        sendSilentUpdate('[Step ' + step.step_number + '] Done: ' + (result && result.result ? result.result : 'executed'));
      }

      // Mark step complete
      chrome.runtime.sendMessage({
        action: 'step_complete',
        stepNumber: step.step_number,
        status: 'done'
      }).catch(() => {});

      history.push({ step: step.step_number, action: step, status: 'done' });
      currentStepIndex++;
      await sleep(1000);

    } catch (err) {
      console.error('Step error:', err);
      
      // Log failure to task context
      taskContext.failedAttempts.push({ step: step.step_number, error: err.message || String(err), timestamp: new Date().toISOString() });
      
      // Try auto-tool generation once per step
      var failCount = taskContext.failedAttempts.filter(function(f) { return f.step === step.step_number; }).length;
      if (failCount <= 1 && typeof generateMissingTool === 'function') {
        sendSilentUpdate('[Auto-Recovery] Generating workaround for step ' + step.step_number + '...');
        try {
          var recovery = await generateMissingTool(err, step, workingTabId);
          if (recovery && recovery.success) {
            taskContext.completedSteps.push({ step: step.step_number, description: step.description, result: 'auto-recovered', timestamp: new Date().toISOString() });
            currentStepIndex++;
            history.push({ step: step.step_number, action: step, status: 'done', result: 'auto-recovered' });
            continue;
          }
        } catch (rErr) {
          console.log('Auto-recovery failed:', rErr.message);
        }
      }

      // Send step failure
      chrome.runtime.sendMessage({
        action: 'step_complete',
        stepNumber: step.step_number,
        status: 'failed',
        error: err.message
      }).catch(() => {});

      sendSilentUpdate('[Step ' + step.step_number + '] Failed: ' + err.message);
      history.push({ step: step.step_number, action: step, status: 'failed', error: err.message });

      // Break on critical failure
      if (err.message.includes('was closed')) {
        agentRunning = false;
        break;
      }
      currentStepIndex++;
      await sleep(2000);
    }
  }

  // Report completion
  const completedSteps = history.filter(h => h.status === 'done').length;
  const failedSteps = history.filter(h => h.status === 'failed').length;

  chrome.runtime.sendMessage({
    action: 'plan_finished',
    summary: 'Completed ' + completedSteps + '/' + plan.steps.length + ' steps' + (failedSteps > 0 ? ' (' + failedSteps + ' failed)' : ''),
    history: history,
    plan: plan
  }).catch(() => {});

  sendSilentUpdate('[Plan] Complete - ' + completedSteps + '/' + plan.steps.length + ' steps done');

  currentPlan = null;
  currentStepIndex = 0;
  agentRunning = false;
}

// ========== Rate Limiting ==========
async function enforceRateLimit() {
  const timeSinceLastCall = Date.now() - lastApiCallTime;
  const delayNeeded = Math.max(0, CONFIG.minDelayBetweenCalls - timeSinceLastCall);
  if (delayNeeded > 0) {
    console.log(`Rate limiting: waiting ${delayNeeded}ms`);
    await sleep(delayNeeded);
  }
  lastApiCallTime = Date.now();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== Retry Logic ==========
async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      if (i < maxRetries - 1) {
        await sleep(500 * (i + 1));
      } else {
        throw err;
      }
    }
  }
}

// ========== Cost Validation ==========
function validateModelCost(model, inputTokens, outputTokens) {
  const rate = COST_SAFETY.RATES[model];
  if (!rate) {
    return { allowed: false, reason: 'No rate information for model: ' + model };
  }

  const inputCost = (inputTokens / 1_000_000) * rate.input;
  const outputCost = (outputTokens / 1_000_000) * rate.output;
  const totalCost = inputCost + outputCost;

  if (inputCost > COST_SAFETY.MAX_INPUT_COST) {
    return { allowed: false, reason: 'Input cost $' + inputCost.toFixed(4) + ' exceeds limit of $' + COST_SAFETY.MAX_INPUT_COST.toFixed(2) };
  }
  if (outputCost > COST_SAFETY.MAX_OUTPUT_COST) {
    return { allowed: false, reason: 'Output cost $' + outputCost.toFixed(4) + ' exceeds limit of $' + COST_SAFETY.MAX_OUTPUT_COST.toFixed(2) };
  }
  if (totalCost > COST_SAFETY.MAX_TOTAL_COST) {
    return { allowed: false, reason: 'Total cost $' + totalCost.toFixed(4) + ' exceeds limit of $' + COST_SAFETY.MAX_TOTAL_COST.toFixed(2) };
  }

  return { allowed: true, cost: { input: inputCost, output: outputCost, total: totalCost } };
}

function logApiCall(model, inputTokens, outputTokens, cost, status, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    model: model,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    cost: cost,
    status: status,
    error: error || null
  };
  costLog.push(entry);
  if (costLog.length > 1000) costLog.shift();
  chrome.storage.local.set({ cost_log: costLog }).catch(function(err) {
    console.warn('Failed to save cost log:', err.message);
  });
}

async function callLLMWithRetry(observation, pageContent, base64Image, goal, history, stepCount, retryCount = 0) {
  try {
    return await callLLM(observation, pageContent, base64Image, goal, history, stepCount);
  } catch (err) {
    if (err.message.includes('429') && retryCount < CONFIG.maxRetries) {
      const backoffDelay = CONFIG.retryDelay * Math.pow(2, retryCount);
      console.log(`Rate limited. Waiting ${backoffDelay}ms before retry ${retryCount + 1}/${CONFIG.maxRetries}`);
      await sleep(backoffDelay);
      return callLLMWithRetry(observation, pageContent, base64Image, goal, history, stepCount, retryCount + 1);
    }
    throw err;
  }
}

// ========== API Call ==========
async function callLLM(observation, pageContent, base64Image, goal, history, stepCount) {
  const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  const endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = settings.api_key;
  const model = settings.model || 'deepseek-v4-flash';

  if (!apiKey) {
    throw new Error('API key not configured. Please set it in extension settings.');
  }

  apiCallCount++;

  const last_action = history.length > 0 ? history[history.length - 1].action : null;
  const last_result = history.length > 0 ? history[history.length - 1].result : null;
  const resultStr = typeof last_result === 'string' ? last_result : JSON.stringify(last_result);

  // Build task context summary for the LLM
  var ctx = getContextSummary();
  const prompt = `You are a skilled browser automation agent performing a multi-step task.
Current step: ${stepCount}
Goal: ${goal}

CONTEXT SO FAR: ${ctx}

CURRENT PAGE CONTENT:
${pageContent}

INTERACTIVE ELEMENTS:
${JSON.stringify(observation.elements, null, 2)}

CONVERSATION HISTORY (last 3 actions):
${JSON.stringify(history.slice(-3), null, 2)}

${last_action && resultStr && resultStr.includes('failed') ? 'Your last action failed. Please try a different selector or approach.' : ''}

IMPORTANT: You are making step-by-step progress toward the goal.
- Focus on ONE clear action per response
- Reuse previous successful selectors when possible
- If something failed, learn from it and try a different approach
- Only return { "type": "finish" } when the goal is fully achieved

Based on the current page, what is the NEXT single action to reach the goal?

If the goal is achieved, return: { "type": "finish", "summary": "Brief description of what was accomplished" }
Otherwise, choose ONE of these actions:
1. { "type": "click", "selector": "CSS_SELECTOR" } - Click a button or link
2. { "type": "type", "selector": "CSS_SELECTOR", "text": "TEXT" } - Type text into a field
3. { "type": "navigate", "url": "URL" } - Go to a different URL
4. { "type": "scroll", "amount": INTEGER } - Scroll up (negative) or down (positive)
5. { "type": "read_page" } - Re-read the page content to confirm state

Return ONLY a JSON object.`;

  // ===== COST SAFETY CHECK — Hard-coded, cannot be bypassed =====
  // Check if model is blocked by prefix
  for (const prefix of COST_SAFETY.BLOCKED_MODEL_PREFIXES) {
    if (model.startsWith(prefix)) {
      const msg = 'COST SAFETY: Model "' + model + '" is BLOCKED (matches blocked prefix "' + prefix + '").';
      console.error(msg);
      sendSilentUpdate(msg);
      logApiCall(model, 0, 0, 0, 'BLOCKED', msg);
      throw new Error(msg);
    }
  }

  // Check if model is in whitelist (for Venice endpoint)
  const isVenice = endpoint.includes('venice.ai') || endpoint.includes('venice');
  const isZAI = endpoint.includes('z.ai');
  isOpenRouter = endpoint.includes('openrouter.ai') || endpoint.includes('openrouter');
  if (isVenice && !COST_SAFETY.VENICE_ALLOWED_MODELS.has(model)) {
    const allowedList = Array.from(COST_SAFETY.VENICE_ALLOWED_MODELS).join(', ');
    const msg = 'COST SAFETY: Model "' + model + '" is NOT in Venice whitelist. Allowed: ' + allowedList;
    console.error(msg);
    sendSilentUpdate(msg);
    logApiCall(model, 0, 0, 0, 'BLOCKED', msg);
    throw new Error(msg);
  }

  // Estimate cost and enforce limits (Venice only)
  if (isVenice) {
    const estimatedInputTokens = Math.max(100, Math.round(prompt.length / 3.5)) + 500;
    const estimatedOutputTokens = 500;
    const costCheck = validateModelCost(model, estimatedInputTokens, estimatedOutputTokens);
    if (!costCheck.allowed) {
      const msg = 'COST SAFETY: ' + costCheck.reason + ' Model: ' + model + ', Est. ' + estimatedInputTokens + 'in/' + estimatedOutputTokens + 'out tokens.';
      console.error(msg);
      sendSilentUpdate(msg);
      logApiCall(model, estimatedInputTokens, estimatedOutputTokens, 0, 'BLOCKED', msg);
      throw new Error(msg);
    }

    // Check session budget
    if (sessionCost + costCheck.cost.total > COST_SAFETY.MAX_SESSION_COST) {
      const msg = 'COST SAFETY: Session budget $' + COST_SAFETY.MAX_SESSION_COST.toFixed(2) + ' would be exceeded. Current: $' + sessionCost.toFixed(4) + ', This call: $' + costCheck.cost.total.toFixed(4);
      console.error(msg);
      sendSilentUpdate(msg);
      logApiCall(model, estimatedInputTokens, estimatedOutputTokens, costCheck.cost.total, 'BLOCKED', msg);
      throw new Error(msg);
    }
  }
  // ===== END COST SAFETY CHECK =====

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: 'You are a precise web automation agent. Return ONLY valid JSON. No markdown, no explanations.' },
        { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorData}`);
  }
  const data = await response.json();

  // Track actual cost after successful call
  if (isVenice || isOpenRouter) {
    const actualInputTokens = (data.usage && data.usage.prompt_tokens) ? data.usage.prompt_tokens : estimatedInputTokens;
    const actualOutputTokens = (data.usage && data.usage.completion_tokens) ? data.usage.completion_tokens : estimatedOutputTokens;
    const rate = COST_SAFETY.RATES[model];
    if (rate) {
      const actualInputCost = (actualInputTokens / 1_000_000) * rate.input;
      const actualOutputCost = (actualOutputTokens / 1_000_000) * rate.output;
      const actualTotalCost = actualInputCost + actualOutputCost;
      sessionCost += actualTotalCost;
      logApiCall(model, actualInputTokens, actualOutputTokens, actualTotalCost, 'OK', null);
      console.log('[COST] ' + model + ': $' + actualTotalCost.toFixed(6) + ' (session total: $' + sessionCost.toFixed(4) + ')');

      // Alert if session cost is significant
      if (sessionCost >= 1.00) {
        console.warn('[COST] Session has spent $' + sessionCost.toFixed(4) + ' so far.');
      }
    }
  }

  return parseLLMResponse(data.choices[0].message.content);
}

// ========== Response Parsing ==========
function parseLLMResponse(content) {
  try {
    let jsonStr = content.trim();

    // Try to extract JSON from markdown code blocks
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
    }

    // Try to extract JSON object directly
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    if (!parsed.type) throw new Error('Missing type field in LLM response');

    const validTypes = ['click', 'type', 'navigate', 'scroll', 'finish', 'read_page'];
    if (!validTypes.includes(parsed.type)) {
      throw new Error('Invalid command type: ' + parsed.type);
    }

    return parsed;
  } catch (err) {
    console.error('Failed to parse LLM response:', err);
    console.error('Response content was:', content);
    return { type: 'finish', summary: 'Error parsing response: ' + err.message };
  }
}

// ========== Validation ==========
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
