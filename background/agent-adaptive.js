// Sentinel Override v21.6.54 - Agent Adaptive Intelligence
// Layer 1: Failure Diagnosis Engine
// Layer 3: Cross-Run Learning

import { getErrorMessage } from './error-utils.js';

// ========== Layer 1: Failure Diagnosis Engine ==========

const DIAGNOSIS_STRATEGIES = [
  {
    pattern: /not clickable|element not found|not found|no element/i,
    strategy: 'CLICK_FAILED',
    suggestion: 'Element may be behind an overlay, inside a shadow DOM, or require scrolling. Try: (1) scroll_to(element) first, (2) use click_at(x, y) with coordinates from the screenshot, (3) use keyboard Tab+Enter navigation, or (4) execute_js to click directly: document.querySelector(selector).click()'
  },
  {
    pattern: /angular|react|vue|spa|not rendered|loading/i,
    strategy: 'SPA_TIMING',
    suggestion: 'Page is a SPA that has not finished rendering. Wait longer before acting. Try: execute_js with a delay before extracting.'
  },
  {
    pattern: /iframe|cross-origin|blocked|access denied/i,
    strategy: 'IFRAME_BLOCKED',
    suggestion: 'Content is inside a cross-origin iframe. Standard execute_js cannot reach it. The iframe extractor should fire automatically.'
  },
  {
    pattern: /timeout|timed out|waiting/i,
    strategy: 'TIMEOUT',
    suggestion: 'Page or element is slow to load. Add explicit wait. Try: wait_for_element or execute_js with a delay.'
  },
  {
    pattern: /auth|login|sign in|permission|403|401/i,
    strategy: 'AUTH_WALL',
    suggestion: 'Page requires authentication. The agent cannot log in for you. Navigate to the login page, wait for user to log in, then retry.'
  },
  {
    pattern: /captcha|challenge|robot|human/i,
    strategy: 'CAPTCHA',
    suggestion: 'CAPTCHA detected. The agent cannot solve CAPTCHAs. Try navigating directly to the target URL to bypass.'
  },
  {
    pattern: /stale|detached|reference|no longer valid/i,
    strategy: 'STALE_ELEMENT',
    suggestion: 'The page changed since the element was observed. Re-observe the page and use the fresh element list.'
  }
];

export function diagnoseFailure(actionType, errorMessage, pageUrl, stepCount) {
  if (!actionType && !errorMessage) return null;
  const msg = String(errorMessage || '').toLowerCase();
  const url = String(pageUrl || '').toLowerCase();

  for (const diag of DIAGNOSIS_STRATEGIES) {
    if (diag.pattern.test(msg)) {
      return { strategy: diag.strategy, suggestion: diag.suggestion, confidence: 0.8 };
    }
  }

  if (url.includes('entra.microsoft') || url.includes('portal.azure') || url.includes('admin.microsoft')) {
    if (actionType === 'click') {
      return {
        strategy: 'MS_DYNAMIC_MENU',
        suggestion: 'Microsoft Angular menus require full event sequences. Try: execute_js to dispatch mousedown+mouseup+click events, or use keyboard navigation.',
        confidence: 0.7
      };
    }
    if (actionType === 'execute_js' || actionType === 'extract') {
      return {
        strategy: 'MS_IFRAME_CONTENT',
        suggestion: 'Microsoft portals load content inside cross-origin iframes. Try: the iframe extraction path or navigate to specific deep-link URLs.',
        confidence: 0.75
      };
    }
  }

  if (url.includes('sonicwall') || url.includes('firewall')) {
    if (actionType === 'click') {
      return {
        strategy: 'FIREWALL_MENU',
        suggestion: 'Firewall interfaces often use framesets. Try: execute_js to find the navigation frame, or navigate directly to the target URL path.',
        confidence: 0.6
      };
    }
  }

  return {
    strategy: 'GENERIC_RETRY',
    suggestion: 'Action failed. Try an alternative approach: different selector, keyboard navigation, or direct URL navigation.',
    confidence: 0.4
  };
}

export function buildDiagnosticMessage(diagnosis, actionType, attemptCount) {
  return '[DIAGNOSTIC ALERT] The last ' + attemptCount + ' ' + actionType + ' actions failed. Diagnosis: ' + diagnosis.strategy + '. RECOMMENDED: ' + diagnosis.suggestion + ' Try a different approach on this step.';
}

// ========== Layer 3: Cross-Run Learning ==========

export async function saveDomainStrategy(domain, strategy) {
  if (!domain || !strategy) return;
  try {
    const key = 'domain_strategy_' + domain.replace(/[^a-z0-9.]/gi, '_');
    const existing = await chrome.storage.local.get(key);
    const existingData = existing[key];

    const updated = {
      domain,
      strategies: existingData && Array.isArray(existingData.strategies) ? existingData.strategies : [],
      lastUpdated: Date.now(),
      runCount: (existingData && existingData.runCount || 0) + 1
    };

    const strategyKey = JSON.stringify(strategy).substring(0, 200);
    const isDuplicate = updated.strategies.some(function(s) { return JSON.stringify(s).substring(0, 200) === strategyKey; });
    if (!isDuplicate) {
      updated.strategies.unshift(strategy);
      if (updated.strategies.length > 5) updated.strategies.pop();
    }

    await chrome.storage.local.set({ [key]: updated });
    console.debug('[Sentinel/Adaptive] Saved strategy for', domain);
  } catch (e) {
    console.warn('[Sentinel/Adaptive] Failed to save strategy:', getErrorMessage(e));
  }
}

export async function getDomainStrategy(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    var domain;
    try { domain = new URL(url).hostname; } catch (_) { return ''; }
    if (!domain) return '';

    const key = 'domain_strategy_' + domain.replace(/[^a-z0-9.]/gi, '_');
    const data = await chrome.storage.local.get(key);
    const stored = data[key];

    if (!stored || !stored.strategies || stored.strategies.length === 0) return '';

    const strategyLines = [];
    for (var i = 0; i < stored.strategies.length; i++) {
      var s = stored.strategies[i];
      strategyLines.push((i + 1) + '. Extraction: ' + (s.extractMethod || 'default') + ' | Navigation: ' + (s.navigationMethod || 'default') + ' | Notes: ' + (s.notes || 'none') + ' | Steps: ' + (s.stepCount || '?'));
    }

    return '[DOMAIN LEARNING] You have ' + stored.runCount + ' previous runs on ' + domain + '. Winning strategies:\n' + strategyLines.join('\n') + '\nUse these insights to work more efficiently on this site.';
  } catch (e) {
    console.warn('[Sentinel/Adaptive] Failed to load strategy:', getErrorMessage(e));
    return '';
  }
}

export function extractWinningStrategy(domain, history, agentMemory, stepCount) {
  if (!history || !Array.isArray(history) || history.length === 0) return null;

  const successfulActions = history.filter(function(h) {
    return h && h.result && typeof h.result === 'string' && !h.result.startsWith('BLOCKED') && !h.result.startsWith('Error');
  });

  const extractActions = successfulActions.filter(function(h) {
    return h.action && (h.action.type === 'execute_js' || h.action.type === 'extract');
  });
  const extractMethod = extractActions.length > 0
    ? (extractActions[0].action.type === 'execute_js' ? 'execute_js' : 'extract')
    : 'none';

  const navActions = successfulActions.filter(function(h) {
    return h.action && h.action.type === 'navigate';
  });
  const navigationMethod = navActions.length > 0 ? 'direct_url' : 'menu_click';

  const dataKeys = Object.keys(agentMemory || {}).filter(function(k) {
    return k !== 'orchestrator_combined_report';
  });

  const notes = successfulActions
    .filter(function(h) { return h.action && h.action.type === 'note' && h.action.text; })
    .map(function(h) { return h.action.text.substring(0, 100); })
    .join('; ').substring(0, 300);

  return {
    domain,
    extractMethod,
    navigationMethod,
    stepCount,
    dataKeysExtracted: dataKeys.length,
    notes: notes || 'No notes recorded',
    savedAt: Date.now()
  };
}

export function getDomainFromUrl(url) {
  if (!url) return 'unknown';
  try {
    return new URL(url).hostname;
  } catch (_) {
    return 'unknown';
  }
}
