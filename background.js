let agentRunning = false;
let agentTabId = null;  // Track which tab the agent is working on
let pendingApproval = null; // Stores pending approval decision
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

// ========== Conversation Memory for Analysis Mode ==========
let analysisHistory = [];  // Stores last N analysis turns for context continuity
const MAX_ANALYSIS_HISTORY = 10;

// ========== Persistent Memory - Load/Save Analysis History ==========
async function loadAnalysisHistory() {
  const stored = await chrome.storage.local.get(['analysisHistory']);
  if (stored.analysisHistory && Array.isArray(stored.analysisHistory)) {
    analysisHistory = stored.analysisHistory.slice(-MAX_ANALYSIS_HISTORY);
  }
}
loadAnalysisHistory();

async function saveAnalysisHistory() {
  await chrome.storage.local.set({ analysisHistory: analysisHistory.slice(-MAX_ANALYSIS_HISTORY) });
}

// ========== Analysis Templates for Common Incident Types ==========
const ANALYSIS_TEMPLATES = {
  'network': {
    name: 'Network Connectivity', keywords: ['network', 'connectivity', 'uptime', 'downtime', 'outage', 'ping', 'latency'],
    prompt: 'Analyze this network incident. Include: KEY FINDINGS, ROOT CAUSE ASSESSMENT (ranked by probability), IMMEDIATE ACTIONS, and VERDICT. Focus on connectivity patterns, interface status, and upstream/downstream issues.'
  },
  'server': {
    name: 'Server/Application', keywords: ['server', 'application', 'service', '500', 'error', 'crash', 'restart'],
    prompt: 'Analyze this server/application incident. Include: KEY FINDINGS, ROOT CAUSE ASSESSMENT (ranked by probability), IMMEDIATE ACTIONS, and VERDICT. Focus on logs, error patterns, resource utilization, and service dependencies.'
  },
  'security': {
    name: 'Security Incident', keywords: ['security', 'breach', 'unauthorized', 'access', 'login', 'malware', 'attack'],
    prompt: 'Analyze this security incident. Include: KEY FINDINGS, ROOT CAUSE ASSESSMENT (ranked by probability), IMMEDIATE ACTIONS, and VERDICT. Follow security incident response best practices and compliance requirements.'
  },
  'database': {
    name: 'Database Issue', keywords: ['database', 'db', 'query', 'sql', 'connection', 'timeout', 'deadlock'],
    prompt: 'Analyze this database incident. Include: KEY FINDINGS, ROOT CAUSE ASSESSMENT (ranked by probability), IMMEDIATE ACTIONS, and VERDICT. Focus on query performance, locking, connection pooling, and replication status.'
  }
};

function getAnalysisTemplate(text) {
  const lowerText = text.toLowerCase();
  for (const [key, template] of Object.entries(ANALYSIS_TEMPLATES)) {
    if (template.keywords.some(kw => lowerText.includes(kw))) {
      return template;
    }
  }
  return null;
}

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
    if (!data.choices || !data.choices[0] || !data.choices[0].message) return null;
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

// ---------- OpenRouter Affordable Models ----------
const OPENROUTER_AFFORDABLE = {
    'mistralai/mistral-7b-instruct-v0.2': { input: 0.10, output: 0.10 },
    'meta-llama/llama-3.2-1b-instruct': { input: 0.06, output: 0.06 },
    'cohere/command-r-plus': { input: 0.25, output: 0.25 }
};

// ---------- Poolside AI Models ----------
const POOLSIDE_MODELS = {
    'poolside/mistral-small-3-24b-instruct': { input: 0.10, output: 0.10 },
    'poolside/llama-3.3-70b-instruct': { input: 0.15, output: 0.15 },
    'poolside/qwen2.5-72b-instruct': { input: 0.12, output: 0.12 },
    'poolside/gemma-3-27b-instruct': { input: 0.08, output: 0.08 },
    'poolside/phi-4': { input: 0.10, output: 0.10 }
}
function validatePoolsideModel(modelName) {
    const cfg = POOLSIDE_MODELS[modelName];
    if (!cfg) {
        console.warn('[Poolside] Model not in list, using default safe model.');
        return 'poolside/mistral-small-3-24b-instruct';
    }
    return modelName;
}
function validateOpenRouterModel(modelName) {
    const cfg = OPENROUTER_AFFORDABLE[modelName];
    if (!cfg) {
        console.warn('[CostSafety] Model not in affordable list, using default safe model.');
        return 'mistralai/mistral-7b-instruct-v0.2';
    }
    const total = cfg.input + cfg.output;
    if (total > 0.50) {
        console.warn(`[CostSafety] Model ${modelName} exceeds $0.50/1k (currently $${total.toFixed(2)}). Falling back.`);
        return 'mistralai/mistral-7b-instruct-v0.2';
    }
    return modelName;
}

async function callLLMSimple(prompt, opts = {}) {
  const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  let model = opts.model || settings.model || 'mistralai/mistral-7b-instruct-v0.2';
  let endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  let apiKey = settings.api_key;
  
  // Handle Poolside AI endpoint
  if (endpoint.includes('poolside.ai') || endpoint.includes('platform.poolside.ai')) {
    model = validatePoolsideModel(model);
    endpoint = 'https://api.poolside.ai/v1/chat/completions';
  }
  
  if (endpoint.includes('openrouter.ai')) {
    model = validateOpenRouterModel(model);
  }
  
  const body = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts.max_tokens || 1024,
    temperature: opts.temperature || 0.3
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error('API Error: ' + resp.status + ' - ' + errorText);
  }
  const data = await resp.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid API response structure');
  }
  return data.choices[0].message.content;
}

// ========== ANALYSIS MODE — Claude-style incident analysis ==========
// System prompt for professional analysis output
const ANALYSIS_SYSTEM_PROMPT = `You are SentinelAgent, an expert technical analyst and incident responder. You produce professional-grade analysis reports that rival Claude AI in quality and structure.

## OUTPUT FORMAT RULES:
- Use markdown headers (##, ###) for sections
- Use **bold** for key findings, status values, and critical items
- Use numbered lists for prioritized actions
- Use bullet points for observations
- Use tables for structured comparisons
- Always include: KEY FINDINGS, ROOT CAUSE ASSESSMENT (ranked by probability), IMMEDIATE ACTIONS
- Be specific with numbers, percentages, IP addresses, timestamps
- Quote exact values from the data provided
- End with a clear VERDICT and next steps

## ANALYSIS STYLE:
- Start with the most critical finding
- Rank root causes from most to least probable with evidence
- Provide actionable troubleshooting steps in priority order
- Explain WHY each finding matters
- Connect symptoms to causes logically
- Use professional incident response terminology

## CONTEXT AWARENESS:
- Reference previous conversation turns when relevant
- Build on prior findings — don't repeat what's already established
- If new data contradicts previous analysis, explain what changed
- Maintain continuity across multi-turn conversations`;

// Build conversation messages for analysis mode
function buildAnalysisMessages(userPrompt, pageContext, template = null) {
  const messages = [{ role: 'system', content: ANALYSIS_SYSTEM_PROMPT }];

  // Inject recent conversation history for context continuity
  const recentHistory = analysisHistory.slice(-MAX_ANALYSIS_HISTORY);
  for (const turn of recentHistory) {
    messages.push({ role: 'user', content: turn.user });
    messages.push({ role: 'assistant', content: turn.assistant });
  }

  // Build current user message with page context
  let currentMessage = '';
  if (pageContext) {
    currentMessage = '## CURRENT PAGE CONTEXT\n' +
      'URL: ' + pageContext.url + '\n' +
      'Title: ' + pageContext.title + '\n\n' +
      '## PAGE CONTENT\n' +
      pageContext.content + '\n\n' +
      (pageContext.tables && pageContext.tables.length > 0 ? '## TABLES ON PAGE\n' + JSON.stringify(pageContext.tables, null, 2) + '\n\n' : '') +
      (pageContext.metadata && Object.keys(pageContext.metadata).length > 0 ? '## PAGE METADATA\n' + JSON.stringify(pageContext.metadata, null, 2) + '\n\n' : '');
    if (template) {
      currentMessage += '\n---\n## ANALYSIS TEMPLATE: ' + template.name + '\n' + template.prompt + '\n';
    }
    currentMessage += '\n---\n## USER REQUEST\n' + userPrompt;
  } else {
    currentMessage = userPrompt;
  }
  messages.push({ role: 'user', content: currentMessage });
  return messages;
}

// Main analysis function — returns rich markdown, not JSON
async function analyzeWithPage(userPrompt, tabId) {
  const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  const endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = settings.api_key;
  const model = settings.model || 'deepseek-v4-flash';

  if (!apiKey) {
    throw new Error('API key not configured. Please set it in extension settings.');
  }

  apiCallCount++;
  sendSilentUpdate('[Analysis] Reading page content...');

  // Extract page content from the active tab
  let pageContext = null;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
    const pageContent = await sendMessageWithRetry(tabId, { action: 'read_page' });
    const structuredData = await sendMessageWithRetry(tabId, { action: 'extract_data' });
    pageContext = {
      url: pageContent.content.split('\n')[1]?.replace('URL: ', '') || 'unknown',
      title: pageContent.content.split('\n')[0]?.replace('Page Title: ', '') || 'unknown',
      content: pageContent.content,
      tables: structuredData.tables || [],
      metadata: structuredData.metadata || {}
    };
  } catch (err) {
    console.warn('Could not read page context:', err.message);
    // Continue without page context — user may have pasted data
  }

sendSilentUpdate('[Analysis] Generating analysis...');

  // Check for analysis template match
  const template = getAnalysisTemplate(userPrompt + ' ' + (pageContext ? pageContext.content : ''));
  if (template) {
    sendSilentUpdate('[Analysis] Using ' + template.name + ' template...');
  }

  // Build messages with conversation history
  const messages = buildAnalysisMessages(userPrompt, pageContext, template);
  // Cost safety check
  const isVenice = endpoint.includes('venice.ai') || endpoint.includes('venice');
  const isZAI = endpoint.includes('z.ai');
  isOpenRouter = endpoint.includes('openrouter.ai') || endpoint.includes('openrouter');

  if (isVenice) {
    for (const prefix of COST_SAFETY.BLOCKED_MODEL_PREFIXES) {
      if (model.startsWith(prefix)) {
        throw new Error('COST SAFETY: Model "' + model + '" is BLOCKED.');
      }
    }
    if (!COST_SAFETY.VENICE_ALLOWED_MODELS.has(model)) {
      throw new Error('COST SAFETY: Model "' + model + '" is NOT in Venice whitelist.');
    }
  }

  // Rate limiting
  await enforceRateLimit();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.4,  // Slightly higher for nuanced analysis
      max_tokens: 4096   // Much higher for detailed reports
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error('API Error: ' + response.status + ' - ' + errorData);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid API response structure');
  }
  const analysisResult = data.choices[0].message.content;

  // Track cost
  if (isVenice || isOpenRouter) {
    const actualInputTokens = (data.usage && data.usage.prompt_tokens) ? data.usage.prompt_tokens : 0;
    const actualOutputTokens = (data.usage && data.usage.completion_tokens) ? data.usage.completion_tokens : 0;
    const rate = COST_SAFETY.RATES[model];
    if (rate) {
      const actualInputCost = (actualInputTokens / 1_000_000) * rate.input;
      const actualOutputCost = (actualOutputTokens / 1_000_000) * rate.output;
      const actualTotalCost = actualInputCost + actualOutputCost;
      sessionCost += actualTotalCost;
      logApiCall(model, actualInputTokens, actualOutputTokens, actualTotalCost, 'OK', null);
    }
  }
// Store in conversation history for context continuity
  analysisHistory.push({
    user: userPrompt,
    assistant: analysisResult,
    timestamp: new Date().toISOString(),
    url: pageContext ? pageContext.url : 'no-page'
  });

  // Save to persistent storage
  await saveAnalysisHistory();

  // Generate follow-up suggestions
  const suggestions = generateFollowUpSuggestions(analysisResult, template);

  // Keep history bounded
  if (analysisHistory.length > MAX_ANALYSIS_HISTORY * 2) {
    analysisHistory = analysisHistory.slice(-MAX_ANALYSIS_HISTORY);
  }

  // Return analysis result with suggestions
  return { result: analysisResult, suggestions };
}

// Generate follow-up suggestions based on analysis content
function generateFollowUpSuggestions(analysis, template) {
  const suggestions = [];
  const lowerAnalysis = analysis.toLowerCase();
  
  if (template) {
    if (template.keywords.includes('network') || template.keywords.includes('connectivity')) {
      suggestions.push('Check firewall logs for blocked connections');
      suggestions.push('Verify DNS resolution on affected hosts');
      suggestions.push('Test upstream gateway connectivity');
    }
    if (template.keywords.includes('server') || template.keywords.includes('application')) {
      suggestions.push('Review recent deployment changes');
      suggestions.push('Check system resource utilization');
      suggestions.push('Examine application error logs');
    }
    if (template.keywords.includes('security')) {
      suggestions.push('Review authentication logs');
      suggestions.push('Check for suspicious IP addresses');
      suggestions.push('Verify access control lists');
    }
  }
  
  // Generic suggestions based on content
  if (lowerAnalysis.includes('root cause')) {
    suggestions.push('What steps should I take to prevent recurrence?');
  }
  if (lowerAnalysis.includes('immediate')) {
    suggestions.push('Can you prioritize the immediate actions?');
  }
  if (lowerAnalysis.includes('verdict')) {
    suggestions.push('What monitoring should I set up for this issue?');
  }
  
  return suggestions.slice(0, 3);
}

// ---------- Claude‑style tab handling ----------
function openOrFocusTab(url) {
    chrome.tabs.query({ url: url }, function (tabs) {
        if (tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { active: true });
        } else {
            chrome.tabs.create({ url: url, active: true });
        }
    });
}

// ---------- Message routing (popup ↔ background ↔ content) ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "runPrompt") {
        callLLMSimple(request.prompt).then(resp => {
            sendResponse({ reply: resp });
            if (request.openInNewTab && resp.resultUrl) {
                openOrFocusTab(resp.resultUrl);
            }
        }).catch(err => sendResponse({ error: err.message }));
        return true; // async response
    }

    // ========== ANALYSIS MODE — Claude-style incident analysis ==========
    if (request.action === 'analyze') {
        if (agentRunning) {
            sendResponse({ status: 'Agent already running' });
            return;
        }
        agentRunning = true;

        // Get the tab to analyze
        const analyzeTabId = sender.tab ? sender.tab.id : request.tabId;
        if (!analyzeTabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    agentTabId = tabs[0].id;
                    runAnalysis(request.prompt, tabs[0].id, sendResponse);
                } else {
                    agentRunning = false;
                    sendResponse({ error: 'No active tab found' });
                }
            });
            return true;
        }
        agentTabId = analyzeTabId;
        runAnalysis(request.prompt, analyzeTabId, sendResponse);
        return true;
    }

    // Clear analysis history for fresh context
    if (request.action === 'clear_analysis_history') {
        analysisHistory = [];
        sendResponse({ status: 'Analysis history cleared' });
    }

    if (request.action === 'execute_command') {
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

        if (!sender.tab || !sender.tab.id) {
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
    } else if (request.action === 'approval_response') {
        pendingApproval = {
          approved: request.approved,
          skipped: request.skipped,
          rejected: request.rejected
        };
        sendResponse({status: 'Approval recorded'});
    }
    return false;
});

// ========== Run Analysis (Claude-style) ==========
async function runAnalysis(prompt, tabId, sendResponse) {
  try {
    sendSilentUpdate('[Analysis] Starting analysis...');
    const result = await analyzeWithPage(prompt, tabId);
    sendSilentUpdate('[Analysis] Complete');

    // Send result to popup for rendering
    chrome.runtime.sendMessage({
      action: 'analysis_result',
      result: result
    }).catch(() => {});

    agentRunning = false;
    if (sendResponse) sendResponse({ status: 'complete', result: result });
  } catch (err) {
    console.error('Analysis error:', err);
    sendSilentUpdate('[Analysis] Error: ' + err.message);

    chrome.runtime.sendMessage({
      action: 'analysis_error',
      error: err.message
    }).catch(() => {});

    agentRunning = false;
    if (sendResponse) sendResponse({ error: err.message });
  }
}

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

      const tab = workingTabId;

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
        sendSilentUpdate(`[Step ${stepCount}] Internal page detected. Navigating...`);
        await chrome.tabs.update(tab, { url: 'https://www.google.com' });
        await sleep(3000);
        continue;
      }

      sendSilentUpdate(`[Step ${stepCount}] Observing page...`);
      await chrome.scripting.executeScript({
        target: { tabId: tab },
        files: ['content.js']
      });

      let observation, pageContent;
      try {
        observation = await sendMessageWithRetry(tab, { action: 'observe_page' });
        pageContent = await sendMessageWithRetry(tab, { action: 'read_page' });
        const structuredData = await sendMessageWithRetry(tab, { action: 'extract_data' });
        taskContext.intermediateData['structured_data'] = structuredData;
      } catch (err) {
        console.error('Failed to get page data:', err);
        sendSilentUpdate(`[Step ${stepCount}] ⚠️ Error reading page: ${err.message}. Retrying...`);
        await sleep(2000);
        continue;
      }

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

      await sleep(1500);

    } catch (err) {
      console.error('Agent loop error:', err);
      sendSilentUpdate(`[Step ${stepCount}] ❌ Error: ${err.message}`);

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
  chrome.runtime.sendMessage({
    action: 'agent_update',
    text: text,
    silent: true
  }).catch(() => {
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

    try {
      var tab = await chrome.tabs.get(workingTabId);
      var pattern = getSitePattern(tab.url || '');
      if (pattern) {
        sendSilentUpdate('[Plan] Detected platform: ' + pattern.platform);
      }
    } catch (e) {}

    const planPrompt = `You are a task decomposition assistant. Break down the following user instruction into a clear, sequential plan with 2-8 steps.\n\nUser instruction: "${goal}"\n\nReturn ONLY a JSON object with this exact structure:\n{\n  "plan_title": "Brief 5-word title",\n  "steps": [\n    {\n      "step_number": 1,\n      "action_type": "navigate|click|type|scroll|read_page|ask_user|wait",\n      "description": "Clear description of what to do"\n    }\n  ],\n  "estimated_steps": 3,\n  "warnings": []\n}\n\nRules:\n- Each step should be a single action\n- First step is usually 'navigate' to a URL\n- If user needs to provide information (like a password), use action_type "ask_user"\n- Keep descriptions brief but clear (10-20 words each)\n- Return ONLY valid JSON, no markdown, no explanations`;

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
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid API response structure');
    }
    const content = data.choices[0].message.content;

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

    chrome.runtime.sendMessage({
      action: 'show_plan',
      plan: parsed,
      goal: goal
    }).catch(() => {
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
  taskContext = { goal: taskContext.goal || 'User instruction', completedSteps: [], intermediateData: {}, failedAttempts: [], currentPhase: 'executing', startTime: new Date().toISOString() };
  let history = [];

  while (currentStepIndex < plan.steps.length && agentRunning) {
    const step = plan.steps[currentStepIndex];

    try {
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
        sendSilentUpdate('[Step ' + step.step_number + '] Waiting for user input: ' + step.description);
        await sleep(1000);
      } else {
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
      
      taskContext.failedAttempts.push({ step: step.step_number, error: err.message || String(err), timestamp: new Date().toISOString() });
      
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

      chrome.runtime.sendMessage({
        action: 'step_complete',
        stepNumber: step.step_number,
        status: 'failed',
        error: err.message
      }).catch(() => {});

      sendSilentUpdate('[Step ' + step.step_number + '] Failed: ' + err.message);
      history.push({ step: step.step_number, action: step, status: 'failed', error: err.message });

      if (err.message.includes('was closed')) {
        agentRunning = false;
        break;
      }
      currentStepIndex++;
      await sleep(2000);
    }
  }

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

// ========== API Call (Automation Mode) ==========
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

  var ctx = getContextSummary();
  const prompt = `You are a skilled browser automation agent performing a multi-step task.\nCurrent step: ${stepCount}\nGoal: ${goal}\n\nCONTEXT SO FAR: ${ctx}\n\nCURRENT PAGE CONTENT:\n${pageContent}\n\nINTERACTIVE ELEMENTS:\n${JSON.stringify(observation.elements, null, 2)}\n\nCONVERSATION HISTORY (last 3 actions):\n${JSON.stringify(history.slice(-3), null, 2)}\n\n${last_action && resultStr && resultStr.includes('failed') ? 'Your last action failed. Please try a different selector or approach.' : ''}\n\nIMPORTANT: You are making step-by-step progress toward the goal.\n- Focus on ONE clear action per response\n- Reuse previous successful selectors when possible\n- If something failed, learn from it and try a different approach\n- Only return { "type": "finish" } when the goal is fully achieved\n\nBased on the current page, what is the NEXT single action to reach the goal?\n\nIf the goal is achieved, return: { "type": "finish", "summary": "Brief description of what was accomplished" }\nOtherwise, choose ONE of these actions:\n1. { "type": "click", "selector": "CSS_SELECTOR" } - Click a button or link\n2. { "type": "type", "selector": "CSS_SELECTOR", "text": "TEXT" } - Type text into a field\n3. { "type": "navigate", "url": "URL" } - Go to a different URL\n4. { "type": "scroll", "amount": INTEGER } - Scroll up (negative) or down (positive)\n5. { "type": "read_page" } - Re-read the page content to confirm state\n\nReturn ONLY a JSON object.`;

  // ===== COST SAFETY CHECK =====
  for (const prefix of COST_SAFETY.BLOCKED_MODEL_PREFIXES) {
    if (model.startsWith(prefix)) {
      const msg = 'COST SAFETY: Model "' + model + '" is BLOCKED (matches blocked prefix "' + prefix + '").';
      console.error(msg);
      sendSilentUpdate(msg);
      logApiCall(model, 0, 0, 0, 'BLOCKED', msg);
      throw new Error(msg);
    }
  }

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

  const estimatedInputTokens = Math.max(100, Math.round(prompt.length / 3.5)) + 500;
  const estimatedOutputTokens = 500;

  if (isVenice) {
    const costCheck = validateModelCost(model, estimatedInputTokens, estimatedOutputTokens);
    if (!costCheck.allowed) {
      const msg = 'COST SAFETY: ' + costCheck.reason + ' Model: ' + model + ', Est. ' + estimatedInputTokens + 'in/' + estimatedOutputTokens + 'out tokens.';
      console.error(msg);
      sendSilentUpdate(msg);
      logApiCall(model, estimatedInputTokens, estimatedOutputTokens, 0, 'BLOCKED', msg);
      throw new Error(msg);
    }

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
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid API response structure');
  }

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

    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
    }

    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    let parsed = JSON.parse(jsonStr);

    if (!parsed.type && parsed.action && typeof parsed.action === 'string') {
      parsed.type = parsed.action;
      delete parsed.action;
    }

    if (!parsed.type) {
      const summary = parsed.summary
        ? (Array.isArray(parsed.summary) ? parsed.summary.join('. ') : parsed.summary)
        : parsed.instructions || parsed.notes || parsed.description || JSON.stringify(parsed).slice(0, 200);
      return { type: 'note', text: '[Processed] ' + summary };
    }

    const validTypes = ['click', 'type', 'navigate', 'scroll', 'finish', 'read_page', 'select', 'hover', 'extract', 'extract_list', 'note', 'press_key', 'wait_for_text', 'wait_for_element', 'execute_js'];
    if (!validTypes.includes(parsed.type)) {
      throw new Error('Invalid command type: ' + parsed.type);
    }

    return parsed;
  } catch (err) {
    console.error('Failed to parse LLM response:', err.message, 'Content:', content);
    return { type: 'note', text: 'Parse error (will retry): ' + err.message };
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
