// Sentinel Override v21.6.58 — Page Type Detection
// Classifies page structure before agent acts, enabling smarter strategies.

/**
 * Detect page type from DOM structure.
 * Returns a classification that helps the agent pick the right strategy.
 *
 * @param {object} tab - Chrome tab
 * @returns {Promise<{type: string, confidence: number, details: object}>}
 */
export async function detectPageType(tab) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const body = document.body;
        if (!body) return { type: 'empty', confidence: 1.0 };

        const url = location.href;
        const tables = document.querySelectorAll('table');
        const forms = document.querySelectorAll('form');
        const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input[type="email"], input:not([type])');
        const iframes = document.querySelectorAll('iframe');
        const navMenus = document.querySelectorAll('nav, [role="navigation"], .sidebar, .menu, .nav');
        const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
        const dataRows = document.querySelectorAll('table tr');
        const listItems = document.querySelectorAll('ul > li, ol > li, [role="listitem"]');
        const headings = document.querySelectorAll('h1, h2, h3');
        const textLength = (body.innerText || '').length;

        // Detect SPA frameworks
        const isAngular = !!(window.angular || document.querySelector('[ng-app], [ng-controller], [_ngcontent]'));
        const isReact = !!document.querySelector('[data-reactroot], [data-reactid]') || !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        const isVue = !!document.querySelector('[data-v-app], [v-cloak]') || !!window.__VUE__;

        // Detect auth walls
        const passwordField = document.querySelector('input[type="password"]');
        const isLogin = !!(passwordField && forms.length > 0 && textLength < 2000);

        // Detect dashboards (nav + iframe or nav + dynamic content)
        const isDashboard = !!(navMenus.length > 0 && (iframes.length > 0 || (isAngular && textLength > 500)));

        // Detect data tables
        const isDataTable = !!(tables.length > 0 && dataRows.length > 5);

        // Detect list/grid views
        const isListView = !!(listItems.length > 10 && tables.length === 0);

        // Detect article/content pages
        const isArticle = !!(headings.length > 2 && textLength > 3000 && tables.length === 0 && forms.length === 0);

        // Detect settings/config forms
        const isFormPage = !!(forms.length > 0 && inputs.length > 3 && !isLogin);

        // Determine type with confidence
        let type = 'generic';
        let confidence = 0.5;
        const details = {
          tableCount: tables.length,
          dataRowCount: dataRows.length,
          formCount: forms.length,
          inputCount: inputs.length,
          iframeCount: iframes.length,
          navCount: navMenus.length,
          buttonCount: buttons.length,
          listItemCount: listItems.length,
          headingCount: headings.length,
          textLength,
          isAngular, isReact, isVue,
          url
        };

        if (isLogin) { type = 'login_form'; confidence = 0.95; }
        else if (isDataTable) { type = 'data_table'; confidence = 0.9; }
        else if (isDashboard) { type = 'dashboard'; confidence = 0.85; }
        else if (isListView) { type = 'list_view'; confidence = 0.8; }
        else if (isArticle) { type = 'article'; confidence = 0.85; }
        else if (isFormPage) { type = 'settings_form'; confidence = 0.75; }
        else if (textLength < 200) { type = 'loading_or_empty'; confidence = 0.7; }
        else if (iframes.length > 3) { type = 'iframe_heavy'; confidence = 0.8; }

        return { type, confidence, details };
      }
    });

    if (result && result[0] && result[0].result) {
      return result[0].result;
    }
    return { type: 'unknown', confidence: 0, details: {} };
  } catch (e) {
    return { type: 'error', confidence: 0, details: { error: e.message } };
  }
}

/**
 * Get strategy hint for the detected page type.
 * Returns a directive string injected into the agent prompt.
 *
 * @param {{type: string, confidence: number, details: object}} pageType
 * @returns {string}
 */
export function getPageStrategyHint(pageType) {
  if (!pageType || pageType.confidence < 0.6) return '';

  const hints = {
    'login_form': '[PAGE: LOGIN] Auth required. Check if already logged in. If login form detected, finish() and report that authentication is needed.',
    'data_table': `[PAGE: DATA TABLE] ${pageType.details?.dataRowCount || 0} data rows detected. Use execute_js to extract table rows: return [...document.querySelectorAll("table tr")].map(r => r.innerText.replace(/\t/g, " | "))`,
    'dashboard': `[PAGE: DASHBOARD] Navigation menu + dynamic content detected. ${pageType.details?.iframeCount ? 'Page has iframes — content may be in iframe.' : ''} Use execute_js to extract visible text. For menu navigation, use click(index) from element list.`,
    'list_view': `[PAGE: LIST VIEW] ${pageType.details?.listItemCount || 0} list items detected. Use execute_js: return [...document.querySelectorAll("li")].map(li => li.innerText.trim()).filter(t => t.length > 0)`,
    'article': '[PAGE: ARTICLE] Content page detected. Standard execute_js with body.innerText will work well.',
    'settings_form': `[PAGE: SETTINGS FORM] ${pageType.details?.inputCount || 0} input fields detected. Read-only investigation — do NOT modify form values. Use execute_js to read current values.`,
    'loading_or_empty': '[PAGE: LOADING] Page appears empty or still loading. Wait 3 seconds then re-extract. Do NOT call done() yet.',
    'iframe_heavy': `[PAGE: IFRAME HEAVY] ${pageType.details?.iframeCount} iframes detected. Content may be in cross-origin frames. The iframe extractor should fire automatically.`,
  };

  return hints[pageType.type] || '';
}
