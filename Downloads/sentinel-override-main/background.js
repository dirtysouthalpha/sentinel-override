import { ProviderFactory } from './providers/factory.js';

let agentRunning = false;
let agentTabId = null;
let pendingApproval = null;
let apiCallCount = 0;
let lastApiCallTime = 0;
let sessionCost = 0.0;
let costLog = [];
let currentPlan = null;
let currentStepIndex = 0;

// Cached provider instance — rebuilt when settings change
let _cachedProvider = null;
let _cachedProviderKey = '';

async function getProvider() {
  const settings = await chrome.storage.local.get(['api_endpoint', 'api_key', 'model']);
  const key = (settings.api_endpoint || '') + '|' + (settings.api_key || '') + '|' + (settings.model || '');
  if (_cachedProvider && _cachedProviderKey === key) return _cachedProvider;
  _cachedProvider = ProviderFactory.create({
    endpoint: settings.api_endpoint || '',
    apiKey: settings.api_key || '',
    model: settings.model || ''
  });
  _cachedProviderKey = key;
  return _cachedProvider;
}

function invalidateProviderCache() {
  _cachedProvider = null;
  _cachedProviderKey = '';
}

// Invalidate provider cache when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.api_endpoint || changes.api_key || changes.model)) {
    invalidateProviderCache();
  }
});

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
    const parsed = new URL(url);
    for (const domain in SITE_PATTERNS) {
      if (parsed.hostname.includes(domain)) return SITE_PATTERNS[domain];
    }
  } catch (e) {}
  return null;
}

// ========== Auto-Tool Generation ==========
async function generateMissingTool(error, step, workingTabId) {
  sendSilentUpdate('[Auto-Tool] Generating workaround for: ' + (error.message || String(error)).substring(0, 60));
  try {
    const provider = await getProvider();
    const genPrompt = 'A browser step failed. ERROR: ' + (error.message || String(error)) + '. STEP: ' + step.description + '. Generate a short JavaScript snippet (max 15 lines) to work around this. Use creative selectors (text content, aria-label, title). Return ONLY the code, no markdown.';
    const result = await provider.chat(
      [{ role: 'user', content: genPrompt }],
      { max_tokens: 400, temperature: 0.3 }
    );
    let script = result.content;
    script = script.replace(/```javascript?\n?/gi, '').replace(/```\n?/g, '').trim();
    if (script.length < 5) return null;
    sendSilentUpdate('[Auto-Tool] Script generated (' + script.length + ' chars), injecting...');
    const results = await chrome.scripting.executeScript({
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
  const prompt = savedShortcuts[name];
  if (prompt) chrome.runtime.sendMessage({ action: 'plan_task', goal: prompt }).catch(function() {});
}

function getContextSummary() {
  const completed = taskContext.completedSteps.length;
  const data = Object.entries(taskContext.intermediateData).slice(-5);
  const fails = taskContext.failedAttempts.slice(-3);
  return 'Goal: ' + taskContext.goal + '\nSteps done: ' + completed + '\nData: ' + data.map(function(d) { return d[0] + '=' + String(d[1]).substring(0, 40); }).join(', ') + '\nFailures: ' + fails.map(function(f) { return f.error.substring(0, 60); }).join(' | ');
}


// ========== Action Button Handler ==========
chrome.action.onClicked.addListener((tab) => {
  // Open sidebar for this specific tab only
  chrome.sidePanel.open({ tabId: tab.id });
});

// Configuration for rate limiting
const CONFIG = {
  minDelayBetweenCalls: 2000,
  maxRetries: 3,
  retryDelay: 5000,
  screenshotQuality: 30,
  batchActions: true,
  maxSteps: 50,
  stepTimeoutMs: 60000
};

// ========== COST SAFETY — Provider-aware ==========
const COST_SAFETY = {
  MAX_PER_CALL_COST: 1.00,
  MAX_SESSION_COST: 5.00,
  WARN_THRESHOLD: 1.00
};

async function callLLMSimple(prompt, opts = {}) {
  const provider = await getProvider();
  const settings = await chrome.storage.local.get(['model']);
  const model = opts.model || settings.model || provider.getDefaultModel();

  const messages = [{ role: 'user', content: prompt }];
  const result = await provider.chat(messages, { ...opts, model });
  return result.content;
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
  const provider = await getProvider();
  const settings = await chrome.storage.local.get(['model']);
  const model = settings.model || provider.getDefaultModel();

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
  }

  sendSilentUpdate('[Analysis] Generating analysis...');

  const template = getAnalysisTemplate(userPrompt + ' ' + (pageContext ? pageContext.content : ''));
  if (template) {
    sendSilentUpdate('[Analysis] Using ' + template.name + ' template...');
  }

  const messages = buildAnalysisMessages(userPrompt, pageContext, template);

  await enforceRateLimit();

  console.log('[Analysis] Provider:', provider.name, 'Model:', model);

  const result = await provider.chat(messages, { model, temperature: 0.4, max_tokens: 4096 });
  const analysisResult = result.content;

  // Track cost using provider rate table
  const cost = provider.calculateCost(model, result.usage.inputTokens, result.usage.outputTokens);
  sessionCost += cost;
  logApiCall(model, result.usage.inputTokens, result.usage.outputTokens, cost, 'OK', null);

  if (sessionCost >= COST_SAFETY.WARN_THRESHOLD) {
    console.warn('[COST] Session has spent $' + sessionCost.toFixed(4) + ' so far.');
  }

  analysisHistory.push({
    user: userPrompt,
    assistant: analysisResult,
    timestamp: new Date().toISOString(),
    url: pageContext ? pageContext.url : 'no-page'
  });

  await saveAnalysisHistory();

  const suggestions = generateFollowUpSuggestions(analysisResult, template);

  if (analysisHistory.length > MAX_ANALYSIS_HISTORY * 2) {
    analysisHistory = analysisHistory.slice(-MAX_ANALYSIS_HISTORY);
  }

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
                    sendResponse({result: 'Error executing command type "' + (cmd.type || 'unknown') + '": ' + chrome.runtime.lastError.message});
                } else {
                    sendResponse(res || {result: 'No response from content script for command type "' + (cmd.type || 'unknown') + '"'});
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
  let consecutiveErrors = 0;

  await chrome.storage.local.remove(['agent_history']).catch(() => {});

  while (!finished && agentRunning) {
    try {
      stepCount++;

      if (stepCount > CONFIG.maxSteps) {
        sendSilentUpdate('Max steps reached (' + CONFIG.maxSteps + '). Stopping.');
        break;
      }

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
        await waitForTabLoad(tab, 15000);
        continue;
      }

      sendSilentUpdate(`[Step ${stepCount}] Observing page...`);
      await ensureContentScript(tab);
      await sendMessageWithRetry(tab, { action: 'wait_stable', timeout: 6000, quietMs: 400 }).catch(() => {});

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

      sendSilentUpdate(`[Step ${stepCount}] Capturing screen with element labels...`);
      // Set-of-marks: draw numbered overlay so the model can ground actions visually
      await sendMessageWithRetry(tab, { action: 'draw_marks' }).catch(() => {});
      // Allow the overlay to render before capture
      await sleep(80);
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
      // Remove overlay so it doesn't interfere with subsequent clicks
      await sendMessageWithRetry(tab, { action: 'clear_marks' }).catch(() => {});
      const base64Image = screenshot_data_url.split(',')[1];

      await enforceRateLimit();

      sendSilentUpdate(`[Step ${stepCount}] Consulting AI (Call #${apiCallCount + 1})...`);
      const command = await callLLMWithRetry(observation, pageContent.content, base64Image, goal, history, stepCount);

      if (command.type === 'finish') {
        finished = true;
        sendSilentUpdate(`✅ Task completed: ${command.summary || 'Goal achieved.'}`);
        break;
      }

      if (command.type === 'note') {
        sendSilentUpdate(`[Step ${stepCount}] Note: ${command.text}`);
        const noteText = command.text || command.summary || 'Internal note';
        taskContext.intermediateData['lastNote'] = noteText;
        history.push({ step: stepCount, action: command, result: 'Logged note' });
        await sleep(300);
        continue;
      }

      sendSilentUpdate(`[Step ${stepCount}] Executing: ${describeCommand(command)}`);

      let result;
      if (command.type === 'navigate') {
        let url = command.url || '';
        if (!url.match(/^https?:\/\//i)) url = 'https://' + url;
        if (!isValidUrl(url)) {
          result = 'Invalid URL: ' + url;
        } else {
          await chrome.tabs.update(tab, { url });
          const loaded = await waitForTabLoad(tab, 15000);
          result = loaded ? ('Navigated to ' + url) : ('Navigation timeout to ' + url);
        }
      } else if (command.type === 'go_back' || command.type === 'go_forward') {
        await sendMessageWithRetry(tab, { action: 'execute_command', command });
        await waitForTabLoad(tab, 8000);
        result = 'Navigated history (' + command.type + ')';
      } else if (command.type === 'read_page') {
        result = await sendMessageWithRetry(tab, { action: 'read_page' });
      } else {
        result = await executeWithStaleRetry(tab, command, observation);
      }

      history.push({ step: stepCount, action: command, result: shortenForHistory(result) });
      if (history.length > 8) history = history.slice(-8);
      consecutiveErrors = 0;
      await sleep(800);

    } catch (err) {
      console.error('Agent loop error:', err);
      consecutiveErrors++;
      sendSilentUpdate(`[Step ${stepCount}] Error: ${err.message}`);

      if (err.message.includes('was closed')) {
        agentRunning = false;
        break;
      }

      if (consecutiveErrors >= 5) {
        sendSilentUpdate('Too many consecutive errors (' + consecutiveErrors + '). Stopping.');
        break;
      }

      await sleep(3000);
    }
  }

  await chrome.storage.local.remove(['agent_history']).catch(() => {});
  agentRunning = false;
  agentTabId = null;
  console.log(`Agent completed. Total API calls: ${apiCallCount}`);
}

// ========== Navigation + injection helpers ==========
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {
    // Some pages (chrome://, view-source:) reject injection — surface clearer error
    throw new Error('Cannot inject into this page: ' + e.message);
  }
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    let poll;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };
    const cleanup = () => {
      try { chrome.webNavigation.onCompleted.removeListener(onCompleted); } catch (e) {}
      try { chrome.webNavigation.onErrorOccurred.removeListener(onError); } catch (e) {}
      clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
    const onCompleted = (details) => {
      if (details.tabId === tabId && details.frameId === 0) finish(true);
    };
    const onError = (details) => {
      if (details.tabId === tabId && details.frameId === 0) finish(false);
    };
    try {
      chrome.webNavigation.onCompleted.addListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.addListener(onError);
    } catch (e) {}
    const pollStart = Date.now();
    poll = setInterval(async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t && t.status === 'complete') {
          finish(true);
        } else if (Date.now() - pollStart > timeoutMs) {
          finish(false);
        }
      } catch (e) {
        finish(false);
      }
    }, 250);
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

async function executeWithStaleRetry(tabId, command, observation) {
  let res = await sendMessageWithRetry(tabId, { action: 'execute_command', command });
  if (res && res.ok === false && res.stale && command.id != null) {
    // Element id no longer valid — re-observe and retry by name+role from prior observation
    sendSilentUpdate('[Recover] Element became stale — re-observing and retrying.');
    const stale = (observation.elements || []).find(e => e.id === command.id);
    await sendMessageWithRetry(tabId, { action: 'wait_stable', timeout: 4000, quietMs: 300 }).catch(() => {});
    await sendMessageWithRetry(tabId, { action: 'observe_page' }).catch(() => {});
    if (stale) {
      const retryCmd = Object.assign({}, command);
      delete retryCmd.id;
      retryCmd.role = stale.role;
      retryCmd.name = stale.name;
      res = await sendMessageWithRetry(tabId, { action: 'execute_command', command: retryCmd });
    }
  }
  return res;
}

function describeCommand(cmd) {
  if (!cmd || !cmd.type) return 'unknown';
  if (cmd.type === 'click') return 'click ' + (cmd.id != null ? '#' + cmd.id : (cmd.name || cmd.selector || ''));
  if (cmd.type === 'type') return 'type into ' + (cmd.id != null ? '#' + cmd.id : (cmd.name || cmd.selector || '')) + ': "' + String(cmd.text || '').slice(0, 40) + '"';
  if (cmd.type === 'navigate') return 'navigate to ' + cmd.url;
  if (cmd.type === 'scroll') return 'scroll ' + (cmd.amount || '');
  return cmd.type;
}

function shortenForHistory(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result.slice(0, 200);
  if (typeof result === 'object') {
    const r = result.result || result.error || JSON.stringify(result);
    return String(r).slice(0, 200);
  }
  return String(result).slice(0, 200);
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
    const provider = await getProvider();
    const settings = await chrome.storage.local.get(['model']);
    const model = settings.model || provider.getDefaultModel();

    sendSilentUpdate('[Plan] Analyzing your instruction...');

    try {
      const tab = await chrome.tabs.get(workingTabId);
      const pattern = getSitePattern(tab.url || '');
      if (pattern) {
        sendSilentUpdate('[Plan] Detected platform: ' + pattern.platform);
      }
    } catch (e) {}

    const planPrompt = `You are a task decomposition assistant. Break down the following user instruction into a clear, sequential plan with 2-8 steps.\n\nUser instruction: "${goal}"\n\nReturn ONLY a JSON object with this exact structure:\n{\n  "plan_title": "Brief 5-word title",\n  "steps": [\n    {\n      "step_number": 1,\n      "action_type": "navigate|click|type|scroll|read_page|ask_user|wait",\n      "description": "Clear description of what to do"\n    }\n  ],\n  "estimated_steps": 3,\n  "warnings": []\n}\n\nRules:\n- Each step should be a single action\n- First step is usually 'navigate' to a URL\n- If user needs to provide information (like a password), use action_type "ask_user"\n- Keep descriptions brief but clear (10-20 words each)\n- Return ONLY valid JSON, no markdown, no explanations`;

    console.log('[Plan] Provider:', provider.name, 'Model:', model);

    const messages = [
      { role: 'system', content: 'You are a precise task decomposition assistant. Return ONLY valid JSON.' },
      { role: 'user', content: planPrompt }
    ];
    const result = await provider.chat(messages, { model, temperature: 0.3, max_tokens: 2000 });
    const content = result.content;

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
        await waitForTabLoad(workingTabId, 15000);
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
      
      const failCount = taskContext.failedAttempts.filter(function(f) { return f.step === step.step_number; }).length;
      if (failCount <= 1 && typeof generateMissingTool === 'function') {
        sendSilentUpdate('[Auto-Recovery] Generating workaround for step ' + step.step_number + '...');
        try {
          const recovery = await generateMissingTool(err, step, workingTabId);
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
  const provider = await getProvider();
  const settings = await chrome.storage.local.get(['model']);
  const model = settings.model || provider.getDefaultModel();

  apiCallCount++;

  const last_action = history.length > 0 ? history[history.length - 1].action : null;
  const last_result = history.length > 0 ? history[history.length - 1].result : null;
  const resultStr = typeof last_result === 'string' ? last_result : JSON.stringify(last_result);

  const ctx = getContextSummary();
  const elementList = (observation.elements || []).map(e => {
    const parts = ['[' + e.id + ']', e.role || (e.tag || '').toLowerCase()];
    if (e.name) parts.push('"' + String(e.name).replace(/\s+/g, ' ').slice(0, 80) + '"');
    if (e.type) parts.push('type=' + e.type);
    if (e.value) parts.push('value="' + String(e.value).slice(0, 30) + '"');
    if (e.placeholder) parts.push('placeholder="' + String(e.placeholder).slice(0, 30) + '"');
    if (e.disabled) parts.push('(disabled)');
    if (!e.inViewport) parts.push('(off-screen)');
    if (e.href) parts.push('-> ' + String(e.href).slice(0, 60));
    return parts.join(' ');
  }).join('\n');

  const viewport = observation.viewport || {};
  const lastFailed = last_action && resultStr && /fail|not found|error|timeout/i.test(resultStr);

  const prompt = `You are a precise browser automation agent. The screenshot shows the current page with NUMBERED COLORED BADGES on every interactive element. Use those numbers as element IDs.
Goal: ${goal}
Current step: ${stepCount}
Page: ${observation.title || ''} — ${observation.url || ''}
Viewport: ${viewport.w || 0}x${viewport.h || 0}, scrollY=${viewport.scrollY || 0}/${viewport.scrollHeight || 0}${viewport.atBottom ? ' (at bottom)' : ''}

CONTEXT: ${ctx}

PAGE TEXT (truncated):
${(pageContent || '').slice(0, 3500)}

INTERACTIVE ELEMENTS (id, role, name):
${elementList || '(none visible)'}

RECENT ACTIONS:
${JSON.stringify(history.slice(-3), null, 2)}
${lastFailed ? '\n⚠️ Last action FAILED. Pick a DIFFERENT element id, scroll, or change strategy.' : ''}

Rules:
- Output ONE action as a JSON object — nothing else.
- Always reference elements by their numeric "id" (from the badges). Never invent CSS selectors.
- If the target element isn't listed, scroll or navigate first.
- Only return {"type":"finish","summary":"..."} when the goal is fully achieved.

Available actions:
{"type":"click","id":N}
{"type":"type","id":N,"text":"...","clear":true,"submit":false}
{"type":"select","id":N,"value":"..."}
{"type":"hover","id":N}
{"type":"press_key","key":"Enter","id":N}
{"type":"scroll","amount":600}
{"type":"navigate","url":"https://..."}
{"type":"go_back"}  |  {"type":"go_forward"}
{"type":"wait_for_text","text":"...","timeout":8000}
{"type":"wait_for_element","id":N,"timeout":8000}
{"type":"extract","id":N}
{"type":"finish","summary":"..."}

Return ONLY the JSON object.`;

  // Session cost cap check
  const estimatedInputTokens = Math.max(100, Math.round(prompt.length / 3.5)) + 500;
  const estimatedCost = provider.calculateCost(model, estimatedInputTokens, 500);
  if (sessionCost + estimatedCost > COST_SAFETY.MAX_SESSION_COST) {
    const msg = 'COST SAFETY: Session budget $' + COST_SAFETY.MAX_SESSION_COST.toFixed(2) + ' would be exceeded. Current: $' + sessionCost.toFixed(4) + ', Est. this call: $' + estimatedCost.toFixed(4);
    console.error(msg);
    sendSilentUpdate(msg);
    logApiCall(model, estimatedInputTokens, 500, estimatedCost, 'BLOCKED', msg);
    throw new Error(msg);
  }

  console.log('[LLM] Provider:', provider.name, 'Model:', model);

  const result = await provider.chatWithVision(prompt, base64Image, {
    model,
    systemPrompt: 'You are a precise web automation agent. Return ONLY valid JSON. No markdown, no explanations.',
    temperature: 0.3,
    max_tokens: 500
  });

  // Track cost using provider rate table
  const cost = provider.calculateCost(model, result.usage.inputTokens, result.usage.outputTokens);
  sessionCost += cost;
  logApiCall(model, result.usage.inputTokens, result.usage.outputTokens, cost, 'OK', null);
  console.log('[COST] ' + model + ': $' + cost.toFixed(6) + ' (session total: $' + sessionCost.toFixed(4) + ')');

  if (sessionCost >= COST_SAFETY.WARN_THRESHOLD) {
    console.warn('[COST] Session has spent $' + sessionCost.toFixed(4) + ' so far.');
  }

  return parseLLMResponse(result.content);
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

    const validTypes = [
      'click', 'type', 'navigate', 'scroll', 'finish', 'read_page', 'select',
      'hover', 'extract', 'extract_list', 'note', 'press_key',
      'wait_for_text', 'wait_for_element', 'wait_for_navigation', 'wait_stable',
      'execute_js', 'go_back', 'go_forward'
    ];
    if (!validTypes.includes(parsed.type)) {
      throw new Error('Invalid command type: ' + parsed.type);
    }

    // Coerce id to number; allow elementId / element_id aliases
    if (parsed.id == null && parsed.elementId != null) parsed.id = parsed.elementId;
    if (parsed.id == null && parsed.element_id != null) parsed.id = parsed.element_id;
    if (parsed.id != null) parsed.id = Number(parsed.id);

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
