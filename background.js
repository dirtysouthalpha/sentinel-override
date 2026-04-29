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
  startTime: null,
  sessionId: null,
  memory: {}  // Persistent memory across the session
};

// Session management
const SESSION_STORAGE_KEY = 'sentinel_agent_session_v2';
const MAX_SESSION_HISTORY = 50; // Keep last 50 steps in history

// ========== Session Persistence ==========
async function saveSessionState() {
  const sessionData = {
    taskContext: taskContext,
    conversationHistory: conversationHistory,
    apiCallCount: apiCallCount,
    sessionCost: sessionCost,
    costLog: costLog.slice(-100), // Keep last 100 log entries
    primaryAgentTabId: primaryAgentTabId,
    primaryAgentWindowId: primaryAgentWindowId,
    timestamp: Date.now()
  };
  try {
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sessionData });
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

async function loadSessionState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SESSION_STORAGE_KEY], (result) => {
      if (result[SESSION_STORAGE_KEY]) {
        const data = result[SESSION_STORAGE_KEY];
        // Only restore if session is less than 2 hours old
        if (Date.now() - data.timestamp < 2 * 60 * 60 * 1000) {
          taskContext = { ...taskContext, ...data.taskContext };
          conversationHistory = data.conversationHistory || [];
          apiCallCount = data.apiCallCount || 0;
          sessionCost = data.sessionCost || 0;
          costLog = data.costLog || [];
          primaryAgentTabId = data.primaryAgentTabId;
          primaryAgentWindowId = data.primaryAgentWindowId;
          resolve(true);
        }
      }
      resolve(false);
    });
  });
}

async function clearSessionState() {
  try {
    await chrome.storage.local.remove([SESSION_STORAGE_KEY]);
  } catch (e) {}
  // Reset in-memory state
  taskContext = {
    goal: null,
    completedSteps: [],
    intermediateData: {},
    failedAttempts: [],
    currentPhase: 'idle',
    startTime: null,
    sessionId: null,
    memory: {}
  };
  conversationHistory = [];
  apiCallCount = 0;
  sessionCost = 0.0;
  costLog = [];
}

// Generate unique session ID
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ========== Site-Specific Knowledge ==========
const SITE_PATTERNS = {
  'github.com': { platform: 'github', loginSelector: '#login_field', passwordSelector: '#password' },
  'gmail.com': { platform: 'gmail', searchSelector: 'input[type="search"]' },
  'google.com': { platform: 'google', searchSelector: 'input[name="q"]' },
  'calendar.google.com': { platform: 'google-calendar' },
  'portal.instant-on.hpe.com': { 
    platform: 'aruba-instant-on',
    restrictions: 'NO browser back/forward - use portal left menu, tabs, breadcrumbs only',
    deviceListSelector: '[data-testid="device-list"]',
    alertListSelector: '[data-testid="alert-list"]'
  },
  'instant-on.hpe.com': { 
    platform: 'aruba-instant-on',
    restrictions: 'Portal-only navigation via menus and tabs'
  }
};

const INVESTIGATION_RESTRICTIONS = {
  'aruba-instant-on': `
CRITICAL NAVIGATION RESTRICTIONS - MUST FOLLOW:
1. Do NOT instruct the user to use browser Back or Forward buttons (breaks portal session)
2. Only use in-portal navigation: left menu, tabs, breadcrumbs, and direct clicks within pages
3. Never say "go back" or "navigate back" - instead say "return to [specific page]" via menu
4. Use precise selector language for portal elements`,
  'default': `
Navigation Guidelines:
- Prefer in-page navigation over browser controls
- Use specific element labels and text for actions`
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

// ========== Task Type Detection ==========
function detectTaskType(goal) {
  const goalLower = goal.toLowerCase();
  
  // Network/infrastructure investigation patterns
  const investigationKeywords = ['investigate', 'troubleshoot', 'diagnos', 'outage', 'offline', 'failure', 'root cause', 'impact', 'cause of'];
  if (investigationKeywords.some(kw => goalLower.includes(kw))) {
    return 'investigation';
  }
  
  // Coding patterns
  const codingKeywords = ['code', 'function', 'class', 'method', 'algorithm', 'debug', 'fix', 'implement', 'create'];
  if (codingKeywords.some(kw => goalLower.includes(kw))) {
    return 'coding';
  }
  
  // Research patterns
  const researchKeywords = ['research', 'find', 'look up', 'search', 'learn about', 'explain', 'understand'];
  if (researchKeywords.some(kw => goalLower.includes(kw))) {
    return 'research';
  }
  
  // Navigation patterns
  const navKeywords = ['go to', 'open', 'visit', 'navigate', 'load', 'find'];
  if (navKeywords.some(kw => goalLower.includes(kw))) {
    return 'navigation';
  }
  
  return 'general';
}

// Smart model selection based on task type
async function getOptimalModel(taskType, settings) {
  const endpoint = settings.api_endpoint || '';
  const preferredModels = settings.preferred_models || {};
  
  // Default model mappings - optimized for each task type
  const modelMap = {
    investigation: preferredModels.investigation || 'deepseek-v4-flash',
    coding: preferredModels.coding || 'google-gemma-4-31b-it',
    research: preferredModels.research || 'mistral-small-3-2-24b-instruct',
    navigation: preferredModels.navigation || 'qwen3-5-9b',
    general: preferredModels.general || 'deepseek-v4-flash'
  };
  
  return modelMap[taskType] || modelMap.general;
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

// ========== Investigation Guidance System ==========
const INVESTIGATION_TEMPLATES = {
  network_outage: {
    title: "Network Outage Investigation",
    questions: [
      "What is the current time zone shown in the portal?",
      "What are the 2-3 most recent Major/Active alerts?",
      "Which devices went offline and at what exact times?",
      "Were multiple devices affected simultaneously?",
      "What is the PoE power budget vs current draw?",
      "Are there any uplink errors or port flaps?",
      "What is the pattern - power event or connectivity issue?"
    ],
    steps: [
      "Identify all offline devices and their types",
      "Determine exact timestamps of outages",
      "Check PoE power status on affected switches",
      "Verify uplink status on core devices",
      "Look for power-related events in logs",
      "Rank root causes by likelihood"
    ]
  },
  default: {
    title: "General Investigation",
    questions: [
      "What are the key facts vs assumptions?",
      "What is the timeline of events?",
      "What evidence supports each hypothesis?",
      "What data is missing or needs verification?"
    ],
    steps: [
      "Gather all available evidence",
      "Separate facts from inferences",
      "Build timeline of events",
      "Identify root cause candidates",
      "Recommend next actions"
    ]
  }
};

function getInvestigationGuidance(goal) {
  const goalLower = goal.toLowerCase();
  let template = INVESTIGATION_TEMPLATES.default;
  
  if (goalLower.includes('outage') || goalLower.includes('offline') || goalLower.includes('network')) {
    template = INVESTIGATION_TEMPLATES.network_outage;
  }
  
  return {
    title: template.title,
    instructions: "Follow this structured investigation:\n\n" + 
      template.questions.map((q, i) => `Question ${i+1}: ${q}`).join('\n') +
      "\n\nProvide output in FACT/INFERENCE format with timeline and next actions.",
    steps: template.steps
  };
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
    // model identifier : { input_per_1k, output_per_1k }
    'mistralai/mistral-7b-instruct-v0.2': { input: 0.10, output: 0.10 }, // $0.20 per 1k tokens total
    'meta-llama/llama-3.2-1b-instruct': { input: 0.06, output: 0.06 },   // $0.12 per 1k tokens total
    'cohere/command-r-plus': { input: 0.25, output: 0.25 }               // $0.50 per 1k tokens total
};

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
  const endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = settings.api_key;
  // Only validate model if using OpenRouter endpoint
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
  const data = await resp.json();
  return data.choices[0].message.content;
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

// ---------- Research Tab Management ----------
let researchTabs = new Map(); // Store research tabs by query
let researchTabData = new Map(); // Store scraped data from research tabs
let activeResearchTabs = new Set(); // Track currently open research tab IDs

// Track the initial agent tab - NEVER changed once set
let primaryAgentTabId = null; // This is the tab the agent stays on
let primaryAgentWindowId = null; // Track window for research tabs to open in same window

// Auto-research triggers - keywords that should trigger automatic research
const AUTO_RESEARCH_TRIGGERS = [
  { keywords: ['outage', 'offline', 'intermittent', 'network failure', 'uptime', 'down'], 
    queries: ['Aruba Instant On device offline troubleshooting', 'network switch power event recovery', 'network outage root cause analysis'] },
  { keywords: ['poe', 'power budget', 'power denied', 'poached', 'powered device'], 
    queries: ['PoE power budget calculation', 'PoE port power denial troubleshooting', 'VoIP phone power cycling causes'] },
  { keywords: ['uplink', 'port error', 'link flap', 'interface down'], 
    queries: ['network uplink troubleshooting', 'link flap diagnosis', 'switch port error analysis'] },
  { keywords: ['voip', 'phone', 'polycom', 'desk phone'], 
    queries: ['VoIP phone PoE requirements', 'Polycom VVX reboot causes', 'VoIP call quality troubleshooting'] },
  { keywords: ['investigat', 'troubleshoot', 'diagnos', 'root cause'], 
    queries: ['IT infrastructure incident response', 'network monitoring best practices'] }
];

function openResearchTab(query, purpose = 'research') {
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    return new Promise((resolve) => {
        chrome.tabs.create({ 
            url: searchUrl, 
            active: false,
            windowId: primaryAgentWindowId || undefined
        }, (tab) => {
            researchTabs.set(query, { 
                tabId: tab.id, 
                openedAt: Date.now(),
                purpose: purpose
            });
            sendSilentUpdate(`[Research] Opened research tab for: ${query}`);
            resolve(tab.id);
        });
    });
}

// Enhanced research tab with auto-scraping capability
async function openResearchTabWithScraping(query, purpose = 'research') {
    const tabId = await openResearchTab(query, purpose);
    
    // Wait for page to load and scrape content
    setTimeout(async () => {
        try {
            const results = await chrome.tabs.sendMessage(tabId, { 
                action: 'scrape_page', 
                options: { maxDepth: 3, includeLinks: true } 
            });
            if (results && results.content) {
                researchTabData.set(tabId, {
                    query: query,
                    scrapedAt: Date.now(),
                    content: results.content,
                    links: results.links || []
                });
                sendSilentUpdate(`[Research] Scraped content from research tab: ${query}`);
            }
        } catch (e) {
            console.log('Could not scrape research tab:', e.message);
        }
    }, 3000);
    
    return tabId;
}

function closeResearchTabs() {
    researchTabs.forEach((info, query) => {
        chrome.tabs.remove(info.tabId).catch(() => {});
    });
    researchTabs.clear();
    researchTabData.clear();
    activeResearchTabs.clear();
    sendSilentUpdate('[Research] All research tabs closed');
}

function getResearchTabs() {
    return Array.from(researchTabs.entries()).map(([query, info]) => ({
        query,
        tabId: info.tabId,
        openedAt: info.openedAt,
        purpose: info.purpose
    }));
}

// Get all scraped research data
function getResearchData() {
    return Array.from(researchTabData.entries()).map(([tabId, data]) => ({
        tabId,
        query: data.query,
        content: data.content,
        links: data.links
    }));
}

// Get aggregated research summary
function getResearchSummary() {
    const data = getResearchData();
    if (data.length === 0) return '';
    
    return `
RESEARCH SUMMARY (from ${data.length} research tabs):
${data.map(r => `
## ${r.query}
${r.content ? r.content.mainContent?.substring(0, 500) + '...' : 'No content'}
`).join('\n')}`;
}

// Close specific research tab
function closeResearchTab(tabId) {
    researchTabs.delete(researchTabs.get(tabId));
    researchTabData.delete(tabId);
    activeResearchTabs.delete(tabId);
    chrome.tabs.remove(tabId).catch(() => {});
}

// Auto-trigger research based on goal keywords
async function checkAndTriggerAutoResearch(goal) {
    const goalLower = goal.toLowerCase();
    const triggeredQueries = [];
    
    // Enhanced keyword detection for investigation mode
    const investigationKeywords = ['investigat', 'troubleshoot', 'diagnos', 'root cause', 'outage', 'offline', 'failure'];
    const isInvestigation = investigationKeywords.some(kw => goalLower.includes(kw));
    
    for (const trigger of AUTO_RESEARCH_TRIGGERS) {
        const hasKeyword = trigger.keywords.some(kw => goalLower.includes(kw));
        if (hasKeyword && trigger.queries.length > 0) {
            // For investigations, open more tabs (up to 5 total)
            const maxTabs = isInvestigation ? Math.min(5, trigger.queries.length) : 2;
            const queriesToOpen = trigger.queries.slice(0, maxTabs);
            
            for (const query of queriesToOpen) {
                if (!triggeredQueries.includes(query) && researchTabs.size < 10) {
                    await openResearchTabWithScraping(query, 'auto-research');
                    triggeredQueries.push(query);
                }
            }
        }
    }
    
    return triggeredQueries;
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
    return false;
});

async function runAgentLoop(goal, workingTabId) {
  console.log('Agent starting loop for goal:', goal);
  console.log('Working on tab:', workingTabId);
  
  // CRITICAL: Set the primary tab ONCE at the start of the session
  // This is the tab the agent will NEVER leave (stay stuck to it)
  if (!primaryAgentTabId) {
    primaryAgentTabId = workingTabId;
    primaryAgentWindowId = (await new Promise(resolve => {
      chrome.tabs.get(workingTabId, (tab) => resolve(tab ? tab.windowId : null));
    }));
    console.log('Primary agent tab set to:', primaryAgentTabId, 'in window:', primaryAgentWindowId);
  }
  
  // Initialize or restore session
  if (!taskContext.sessionId) {
    taskContext = { 
      goal: goal, 
      completedSteps: [], 
      intermediateData: {}, 
      failedAttempts: [], 
      currentPhase: 'executing', 
      startTime: new Date().toISOString(),
      sessionId: generateSessionId(),
      memory: {}
    };
    conversationHistory = [];
    await clearSessionState(); // Clear old session data
  } else {
    taskContext.goal = goal;
    taskContext.currentPhase = 'executing';
    taskContext.startTime = new Date().toISOString();
  }
  
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

      // CRITICAL: Always work on the PRIMARY agent tab, never change it
      // The agent stays on the initial tab throughout the session
      const tab = primaryAgentTabId;

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

      // Get page data in parallel with retry
      let observation, pageContent;
      try {
        // Parallel execution: observe page, read page, and extract data
        const [obsResult, contentResult, structuredResult] = await Promise.all([
          sendMessageWithRetry(tab, { action: 'observe_page' }),
          sendMessageWithRetry(tab, { action: 'read_page' }),
          sendMessageWithRetry(tab, { action: 'extract_data' })
        ]);
        observation = obsResult;
        pageContent = contentResult;
        taskContext.intermediateData['structured_data'] = structuredResult;
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
      
      // Get research data from open research tabs
      const researchData = getResearchData();
      const autoResearchQueries = await checkAndTriggerAutoResearch(goal);
      
      const command = await callLLMWithRetry(observation, pageContent.content, base64Image, goal, history, stepCount, researchData, autoResearchQueries);

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
      } else if (command.type === 'research') {
        // Open a research tab without switching the agent's tab
        await openResearchTab(command.query, command.purpose || 'research');
        result = 'Opened research tab for: ' + command.query;
        // Don't add to history - it's auxiliary info
        continue;
      } else {
        result = await chrome.tabs.sendMessage(tab, { action: 'execute_command', command });
      }

      history.push({ step: stepCount, observation, action: command, result });
      await chrome.storage.local.set({ agent_history: history });
      
      // Save session state periodically
      await saveSessionState();

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

    // Detect investigation mode from goal
    const goalLower = goal.toLowerCase();
    const isInvestigation = goalLower.includes('investigat') || 
                           goalLower.includes('outage') || 
                           goalLower.includes('offline') ||
                           goalLower.includes('root cause') ||
                           goalLower.includes('why did') ||
                           goalLower.includes('what happened');

    // Detect site-specific patterns for better plans
    let siteRestrictions = '';
    try {
      var tab = await chrome.tabs.get(workingTabId);
      var pattern = getSitePattern(tab.url || '');
      if (pattern) {
        sendSilentUpdate('[Plan] Detected platform: ' + pattern.platform);
        if (pattern.restrictions) {
          siteRestrictions = '\n\nSITE-SPECIFIC RESTRICTIONS:\n' + pattern.restrictions;
        }
        // Add investigation-specific restrictions for known platforms
        if (isInvestigation && INVESTIGATION_RESTRICTIONS[pattern.platform]) {
          siteRestrictions += '\n\n' + INVESTIGATION_RESTRICTIONS[pattern.platform];
        }
      }
    } catch (e) {}

    // Get investigation guidance if applicable
    let investigationGuidance = null;
    if (isInvestigation) {
      investigationGuidance = getInvestigationGuidance(goal);
      sendSilentUpdate('[Plan] Investigation mode detected: ' + investigationGuidance.title);
    }

    // Build plan prompt with investigation guidance
    let extraInstructions = '';
    if (investigationGuidance) {
      extraInstructions = `

INVESTIGATION MODE SPECIFIC INSTRUCTIONS:
${investigationGuidance.instructions}

CRITICAL NAVIGATION RESTRICTIONS for this investigation:
- Do NOT instruct the user to use browser Back or Forward buttons
- Only use in-portal navigation: left menu, tabs, breadcrumbs, and direct clicks within pages
`;
    }

    const planPrompt = `You are a task decomposition assistant. Break down the following user instruction into a clear, sequential plan with 2-8 steps.

User instruction: "${goal}"${extraInstructions}${siteRestrictions}

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

// ========== Research Integration ==========
function formatResearchContext(researchData, autoResearchQueries) {
    if (!researchData || researchData.length === 0) return '';
    
    return `
RESEARCH CONTEXT (from opened research tabs):
${researchData.map(r => `
Query: ${r.query}
Content: ${r.content ? r.content.substring(0, 500) + '...' : 'No content scraped'}
`).join('\n')}

Auto-research queries already triggered: ${autoResearchQueries.join(', ')}`;
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

async function callLLMWithRetry(observation, pageContent, base64Image, goal, history, stepCount, researchData = null, autoResearchQueries = [], retryCount = 0) {
  try {
    return await callLLM(observation, pageContent, base64Image, goal, history, stepCount, researchData, autoResearchQueries);
  } catch (err) {
    if (err.message.includes('429') && retryCount < CONFIG.maxRetries) {
      const backoffDelay = CONFIG.retryDelay * Math.pow(2, retryCount);
      console.log(`Rate limited. Waiting ${backoffDelay}ms before retry ${retryCount + 1}/${CONFIG.maxRetries}`);
      await sleep(backoffDelay);
      return callLLMWithRetry(observation, pageContent, base64Image, goal, history, stepCount, researchData, autoResearchQueries, retryCount + 1);
    }
    throw err;
  }
}

// ========== API Call ==========
async function callLLM(observation, pageContent, base64Image, goal, history, stepCount, researchData = null, autoResearchQueries = []) {
  const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model', 'preferred_models']);
  const endpoint = settings.api_endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = settings.api_key;
  
  // Detect task type and select optimal model
  const taskType = detectTaskType(goal);
  const model = await getOptimalModel(taskType, settings);

  if (!apiKey) {
    throw new Error('API key not configured. Please set it in extension settings.');
  }

  apiCallCount++;

  const last_action = history.length > 0 ? history[history.length - 1].action : null;
  const last_result = history.length > 0 ? history[history.length - 1].result : null;
  const resultStr = typeof last_result === 'string' ? last_result : JSON.stringify(last_result);

  // Build task context summary for the LLM
  var ctx = getContextSummary();
  
  // Format research context
  const researchContext = formatResearchContext(researchData, autoResearchQueries);
  
  const prompt = `You are a skilled browser automation agent performing a multi-step task.
Current step: ${stepCount}
Goal: ${goal}

CRITICAL NAVIGATION RULES:
- You are STAYING ON THIS TAB (ID: ${primaryAgentTabId || 'unknown'}) throughout the entire session
- Research tabs are opened in separate background tabs - DO NOT navigate the primary tab
- Use in-page navigation only: clicks on links, buttons, form submissions
- NEVER use browser Back/Forward buttons - they break portal sessions
- Navigate via menus, tabs, breadcrumbs, and direct element clicks only

CONTEXT SOFAR: ${ctx}${researchContext}

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
- Keep the primary tab stable - open research in background tabs if needed

Based on the current page, what is the NEXT single action to reach the goal?

If the goal is achieved, return: { "type": "finish", "summary": "Brief description of what was accomplished" }
Otherwise, choose ONE of these actions:
1. { "type": "click", "selector": "CSS_SELECTOR" } - Click a button or link
2. { "type": "type", "selector": "CSS_SELECTOR", "text": "TEXT" } - Type text into a field
3. { "type": "navigate", "url": "URL" } - Go to a different URL
4. { "type": "scroll", "amount": INTEGER } - Scroll up (negative) or down (positive)
5. { "type": "read_page" } - Re-read the page content to confirm state
6. { "type": "research", "query": "search terms", "purpose": "optional purpose note" } - Open a research tab to look up info (keeps agent on current tab)
7. { "type": "extract", "selector": "CSS_SELECTOR" } - Extract text content from elements
8. { "type": "extract_list", "selectors": ["sel1", "sel2"] } - Extract multiple specific values

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

    let parsed = JSON.parse(jsonStr);

    // Fix 1: If the LLM returned {action: 'click', ...} instead of {type: 'click', ...}
    if (!parsed.type && parsed.action && typeof parsed.action === 'string') {
      parsed.type = parsed.action;
      delete parsed.action;
    }

    // Fix 2: If the LLM returned a plan/status object with no type field (e.g. {current_step: 2, instructions: '...'})
    // Convert it to a 'note' action so the agent continues gracefully
    if (!parsed.type) {
      const summary = parsed.summary
        ? (Array.isArray(parsed.summary) ? parsed.summary.join('. ') : parsed.summary)
        : parsed.instructions || parsed.notes || parsed.description || JSON.stringify(parsed).slice(0, 200);
      return { type: 'note', text: '[Processed] ' + summary };
    }

    const validTypes = ['click', 'type', 'navigate', 'scroll', 'finish', 'read_page', 'select', 'hover', 'extract', 'extract_list', 'note', 'press_key', 'wait_for_text', 'wait_for_element', 'execute_js', 'research', 'wait'];
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
