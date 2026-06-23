// Sentinel Override - CAPTCHA / Bot Detection & Auto-Recovery
// Extracted from agent-engine.js for modularity.
// CAPTCHA detection, smart recovery, universal CDP fallback, and
// auto-recovery retry ladder helpers.

import {MAX_CDP_RESULT_LENGTH, THREE_SECONDS_MS, TWO_SECONDS_MS} from './constants.js';
import {getErrorMessage, sleep} from './error-utils.js';
import {sendSilentUpdate} from './message-protocol.js';
import {cdpExecuteJs, sendMessageWithRetry} from './tab-manager.js';
import {tel} from './telemetry.js';

// Local copies of shared constants (also in agent-engine.js)
const EXTRACT_TYPE_RE = /^extract(_list)?$/;
const WWW_PREFIX_RE = /^www\./;
const REF_SELECTOR_RE = /^ref_/;
const JS_ESCAPE_RE = /[\\'"\n\r\t]/g;

const SEARCH_QUERY_RE = /(?:search|find|look).{0,5}(?:for|about|on)\s+([^,.]+)/i;
const SEARCH_SIMPLE_RE = /(?:search|find|look)\s+(?:for\s+)?["']?([^"']{3,60})/i;
const FIELD_LIST_RE = /(?:extract|find|pull|give\s+me|return)[^.]*?:\s*([^.\n]+)/i;
const FIELD_LIST_SPLIT_RE = /[,]|\s+and\s+|\s+&\s+/i;
const FIELD_PREFIX_CLEAN_RE = /^the\s+|\.$/gi;
const WHITESPACE_SPLIT_RE = /\s+/;
const NON_PRODUCTIVE_ACTIONS = new Set(['navigate', 'switch_tab', 'click', 'scroll', 'wait_for_text', 'wait_for_element', 'read_page']);
const FILLER_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'each', 'one', 'sentence', 'summary', 'whether', 'has', 'have', 'been', 'observed', 'in', 'is']);

function escapeJsString(str, quote = '"') {
  if (typeof str !== 'string') return '';
  const quoteChar = quote === '"' ? '"' : "'";
  return str.replace(JS_ESCAPE_RE, (char) => {
    switch (char) {
      case '\\': return '\\\\';
      case quoteChar: return '\\' + quoteChar;
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      default: return char;
    }
  });
}

// ========== CAPTCHA / Bot Detection (v3.65) ==========
const CAPTCHA_URL_PATTERNS = [
  /validateCaptcha/i,
  /\/captcha[/?#]/i,
  /\/challenge[/?#]/i,
  /\/bot-detect/i,
  /\/verify[/?#]/i,
  /captcha\./i,
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /cf-chl/i,
  /\/errors\//i,        // Amazon /errors/ pages
  /blocked/i,
  /\/access.denied/i,
  /\/security.check/i,
];

const CAPTCHA_TEXT_PATTERNS = [
  /verify.{0,10}(you are|you.re).{0,5}human/i,
  /not.a.robot/i,
  /prove.{0,10}(you are|you.re).{0,5}human/i,
  /are you a robot/i,
  /complete.the.security/i,
  /enter.the.characters/i,
  /type.the.characters/i,
  /solve.this.puzzle/i,
  /please.complete.this/i,
  /sorry.{0,20}interrupt/i,
  /automated.access/i,
  /bot.detect/i,
  /unusual.traffic/i,
  /our.systems.have.detected/i,
  /sorry.we.just.need/i,
  /checking.your.browser/i,
  /before.we.proceed/i,
  /human.verification/i,
  /are.you.human/i,
];

const CAPTCHA_HOST_MAP = {
  'amazon': { altUrl: 'https://www.amazon.com', searchPath: '/s?k=' },
  'google': { altUrl: 'https://www.google.com', searchPath: '/search?q=' },
  'reddit': { altUrl: 'https://www.reddit.com', searchPath: '/search/?q=' },
};

function detectCaptcha(currentUrl, pageText, elementsCount) {
  if (!currentUrl) return null;
  
  // URL-based detection
  const urlHit = CAPTCHA_URL_PATTERNS.find(p => p.test(currentUrl));
  if (urlHit) {
    // Also check if page text confirms it
    const textHit = pageText && CAPTCHA_TEXT_PATTERNS.find(p => p.test(pageText));
    // Low element count on a flagged URL is strong signal
    const lowElements = elementsCount !== undefined && elementsCount <= 5;
    return {
      matched: true,
      type: 'captcha_url',
      url: currentUrl,
      pattern: urlHit.source,
      textConfirm: !!textHit,
      lowElements: !!lowElements,
      confidence: (textHit ? 0.9 : 0.0) + (lowElements ? 0.1 : 0.0)
    };
  }
  
  // Content-based detection (only if strong signal)
  if (pageText) {
    const textHit = CAPTCHA_TEXT_PATTERNS.find(p => p.test(pageText));
    if (textHit && elementsCount !== undefined && elementsCount <= 10) {
      return {
        matched: true,
        type: 'captcha_text',
        url: currentUrl,
        pattern: textHit.source,
        textConfirm: true,
        lowElements: elementsCount <= 5,
        confidence: 0.85
      };
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// (v3.69) Smart Recovery Engine — "MacGyver Mode"
// When stuck, analyzes page + goal and generates creative solutions.
// Can construct URLs, suggest execute_js, find alternative approaches.
// ═══════════════════════════════════════════════════════════════════
function _generateSmartRecovery(goal, currentUrl, pageText, _observation, _history, _stepCount) {
  var strategies = [];
  var url = currentUrl || '';
  var text = pageText || '';

  // URL manipulation strategies
  if (/amazon/i.test(url)) {
    if (/\/s\?/i.test(url)) {
      if (!/s=review-rank/.test(url)) strategies.push('Sort by rating: add "&s=review-rank" to URL via smart_navigate');
      if (!/s=price-asc-rank/.test(url)) strategies.push('Sort by price: add "&s=price-asc-rank" to URL via smart_navigate');
      if (!/s=date-desc-rank/.test(url)) strategies.push('Sort by newest: add "&s=date-desc-rank" to URL via smart_navigate');
    }
    strategies.push('Extract products via execute_js: document.querySelectorAll(".s-result-item") for title/price/rating/link');
  }
  if (/reddit/i.test(url)) {
    strategies.push('Extract posts via execute_js: document.querySelectorAll("[data-testid=\\"post-container\\"]")');
    if (/search/i.test(url)) strategies.push('Add "&sort=top" or "&sort=relevance" to URL');
  }
  if (/google/i.test(url) && /search/i.test(url)) {
    strategies.push('Extract results via execute_js: document.querySelectorAll(".g") for title/link/snippet');
  }
  if (/youtube/i.test(url)) {
    strategies.push('Extract videos via execute_js: document.querySelectorAll("ytd-video-renderer")');
  }
  if (/cnn|bbc|nytimes|reuters/i.test(url)) {
    strategies.push('Extract articles via execute_js: document.querySelectorAll("article, h2, h3, [class*=headline]")');
  }

  // Goal-based strategies
  if (/top \d|find.*\d|list.*\d|best/i.test(goal)) {
    strategies.push('Use execute_js to extract all matching items from the page in one shot');
  }
  if (/then go to|also check|compare/i.test(goal)) {
    strategies.push('Use navigate with direct URL instead of clicking through pages');
  }

  // Direct URL construction for multi-site goals
  var siteUrls = {
    amazon: 'amazon.com/s?k=',
    reddit: 'reddit.com/search/?q=',
    youtube: 'youtube.com/results?search_query=',
    google: 'google.com/search?q='
  };
  var goalLower = typeof goal === 'string' ? goal.toLowerCase() : '';
  var urlLower = typeof url === 'string' ? url.toLowerCase() : '';
  for (const [site, siteUrl] of Object.entries(siteUrls)) {
    if (goalLower.includes(site) && !urlLower.includes(site)) {
      var qm = goal.match(SEARCH_QUERY_RE);
      if (qm && qm[1]) {
        strategies.push(`Navigate directly to https://www.${siteUrl}${encodeURIComponent(typeof qm[1] === 'string' ? qm[1].trim() : '')}`);
      }
    }
  }

  // Fallback strategies
  if (text.length > 1000) {
    strategies.push('Read the page text — you may already have enough data');
  }
  if (!strategies.length) {
    strategies.push('Use execute_js to inspect DOM and find alternative approach');
    strategies.push('Try read_page to get full content and extract what you need');
    strategies.push('Use navigate_back and try a different path');
  }

  return strategies;
}


// ═══════════════════════════════════════════════════════════════════
// (v3.69) Universal CDP Fallback Engine — "Nothing Stops the Agent"
// When content script is dead AND per-action CDP fallbacks fail,
// this translates ANY action into equivalent JavaScript via CDP.
// Includes fuzzy selector resolution (by text, aria, role, class).
// ═══════════════════════════════════════════════════════════════════
async function _universalCdpFallback(tab, cmd, opts) {
  var timeout = (opts && opts.timeout) || 5000;
  var sel = cmd.selector || (cmd.ref ? cmd.ref.replace(REF_SELECTOR_RE, '#') : '') || '';
  var textHint = cmd.text || cmd.value || '';
  
  // Build the fuzzy element finder as a self-contained JS string
  // This gets embedded into each action's JS code
  var finderCode = '(function(){'
    + `var _s=${JSON.stringify(sel)},_t=${JSON.stringify(textHint)};`
    + 'var el=null;'
    + 'try{el=document.querySelector(_s)}catch(e){}'
    + 'if(el&&el.offsetParent!==null)return el;'
    + 'if(_t){'
    +   'var _tl=_t.toLowerCase();'
    +   'var _cands=document.querySelectorAll("button,a,input,select,[role=button],[role=link],span,div");'
    +   'for(var i=0,_candsLen=_cands.length;i<_candsLen;i++){'
    +     'if(_cands[i].textContent&&_cands[i].textContent.trim().toLowerCase().indexOf(_tl)>=0&&_cands[i].offsetParent!==null)return _cands[i]'
    +   '}'
    + '}'
    + 'if(_s){'
    +   'var _parts=_s.replace(/[.#\\[\\]]/g," ").trim().split(/\\s+/);'
    +   'for(var p=0,_partsLen=_parts.length;p<_partsLen;p++){'
    +     'if(_parts[p].length>3){'
    +       'var _w=document.querySelectorAll("[class*="+_parts[p]+"],[id*="+_parts[p]+"]");'
    +       'for(var w=0,_wLen=_w.length;w<_wLen;w++){if(_w[w].offsetParent!==null)return _w[w]}'
    +     '}'
    +   '}'
    + '}'
    + 'return null'
    + '})()';

  var jsCode = '';
  
  switch (cmd.type) {
    case 'click':
    case 'double_click':
    case 'right_click': {
      var btn = cmd.type === 'right_click' ? '2' : '0';
      var detail = cmd.type === 'double_click' ? '2' : '1';
      jsCode = '(function(){'
        + `var el=${finderCode};`
        + 'if(!el)return JSON.stringify({ok:false,error:"not found"});'
        + 'el.scrollIntoView({block:"center",behavior:"instant"});'
        + `el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,button:${btn},detail:${detail}}));`
        + 'if(typeof el.click==="function")try{el.click()}catch(e){}'
        + 'return JSON.stringify({ok:true,result:"clicked "+el.tagName});'
        + '})()';
      break;
    }
    case 'type': {
      var safeText = escapeJsString(cmd.text || '', '"');
      jsCode = '(function(){'
        + `var el=${finderCode};`
        + 'if(!el)return JSON.stringify({ok:false,error:"input not found"});'
        + 'el.scrollIntoView({block:"center",behavior:"instant"});'
        + 'el.focus();'
        + 'var _s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");'
        + `if(_s)_s.set.call(el,"${safeText}");else el.value="${safeText}";`
        + 'el.dispatchEvent(new Event("input",{bubbles:true}));'
        + 'el.dispatchEvent(new Event("change",{bubbles:true}));'
        + `return JSON.stringify({ok:true,result:"typed ${safeText.length} chars"});`
        + '})()';
      break;
    }
    case 'select': {
      var safeVal = escapeJsString(cmd.value || '', '"');
      jsCode = '(function(){'
        + `var el=${finderCode};`
        + 'if(!el)return JSON.stringify({ok:false,error:"select not found"});'
        // Native select
        + 'if(el.tagName==="SELECT"&&el.options){'
        +   'for(var i=0,optsLen=el.options.length;i<optsLen;i++){'
        +     `if(el.options[i].value==="${safeVal}"||el.options[i].text.trim().toLowerCase()==="${safeVal.toLowerCase()}"){`
        +       'el.selectedIndex=i;el.value=el.options[i].value;'
        +       'el.dispatchEvent(new Event("change",{bubbles:true}));'
        +       `return JSON.stringify({ok:true,result:"selected ${safeVal}"})`
        +     '}'
        +   '}'
        + '}'
        // Custom dropdown - click to open, then find option
        + 'el.click();'
        + `var _vl="${safeVal}".toLowerCase();`
        + 'var _opts=document.querySelectorAll("[role=option],li,[data-value],.option,[class*=option],[class*=item]");'
        + 'for(var j=0,_optsLen=_opts.length;j<_optsLen;j++){'
        +   'if(_opts[j].textContent&&_opts[j].textContent.trim().toLowerCase().indexOf(_vl)>=0&&_opts[j].offsetParent!==null){'
        +     '_opts[j].click();'
        +     `return JSON.stringify({ok:true,result:"selected custom: ${safeVal}"})`
        +   '}'
        + '}'
        // Try aria listbox
        + 'var _lb=document.querySelector("[role=listbox]");'
        + 'if(_lb){var _li=_lb.querySelectorAll("[role=option]");for(var k=0,_liLen=_li.length;k<_liLen;k++){'
        +   `if(_li[k].textContent&&_li[k].textContent.trim().toLowerCase().indexOf(_vl)>=0){_li[k].click();return JSON.stringify({ok:true,result:"selected listbox: ${safeVal}"})}`
        + '}}'
        + `return JSON.stringify({ok:false,error:"option not found: ${safeVal}"});`
        + '})()';
      break;
    }
    case 'check':
    case 'check_all': {
      jsCode = `(function(){
        var el=${finderCode};
        if(!el)return JSON.stringify({ok:false,error:"checkbox not found"});
        if(el.type==="checkbox"||el.type==="radio"){el.checked=${cmd.checked !== false};el.dispatchEvent(new Event("change",{bubbles:true}));el.click();return JSON.stringify({ok:true,result:"${cmd.checked !== false ? 'checked' : 'unchecked'}"})}
        el.click();return JSON.stringify({ok:true,result:"toggled"})
      })()`;
      break;
    }
    case 'hover': {
      jsCode = `(function(){
        var el=${finderCode};
        if(!el)return JSON.stringify({ok:false,error:"hover target not found"});
        el.scrollIntoView({block:"center",behavior:"instant"});
        el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));
        el.dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}));
        return JSON.stringify({ok:true,result:"hovered"})
      })()`;
      break;
    }
    case 'scroll_to': {
      jsCode = `(function(){
        var el=${finderCode};
        if(el){el.scrollIntoView({block:"center",behavior:"instant"});return JSON.stringify({ok:true,result:"scrolled to element"})}
        window.scrollBy(0,window.innerHeight*0.8);
        return JSON.stringify({ok:true,result:"scrolled down"})
      })()`;
      break;
    }
    case 'wait_for_element':
    case 'wait_for_text': {
      var searchFor = cmd.text || cmd.value || cmd.selector || '';
      jsCode = `(function(){
        var body=(document.body&&document.body.innerText)||"";
        var _s=${JSON.stringify(searchFor)};
        if(_s&&body.indexOf(_s)>=0)return JSON.stringify({ok:true,result:"found"});
        if(_s){var _bl=body.toLowerCase(),_sl=_s.toLowerCase();if(_bl.indexOf(_sl)>=0)return JSON.stringify({ok:true,result:"found case-insensitive"})}
        // Also try finding by selector
        var _el=document.querySelector(${JSON.stringify(cmd.selector || '')});
        if(_el&&_el.offsetParent!==null)return JSON.stringify({ok:true,result:"element visible"});
        return JSON.stringify({ok:false,error:"not found: "+(typeof _s==="string"?_s:String(_s)).slice(0,50)})
      })()`;
      break;
    }
    case 'extract':
    case 'extract_list': {
      jsCode = `(function(){
        var sel=${JSON.stringify(cmd.selector || '')};
        if(sel){var els=document.querySelectorAll(sel);if(els.length){
          var items=[];for(var i=0,elsLen=els.length;i<elsLen;i++){var el=els[i];if(el&&el.textContent)items.push(el.textContent.trim().slice(0,200));}
          return JSON.stringify({ok:true,result:"extracted "+items.length,value:items})
        }}
        return JSON.stringify({ok:false,error:"nothing to extract"})
      })()`;
      break;
    }
    case 'verify': {
      jsCode = `(function(){
        var body=(document.body&&document.body.innerText)||"";
        var _c=${JSON.stringify(cmd.text || cmd.value || '')};
        if(_c&&body.indexOf(_c)>=0)return JSON.stringify({ok:true,result:"verified"});
        if(_c){var _bl=body.toLowerCase(),_cl=_c.toLowerCase();if(_bl.indexOf(_cl)>=0)return JSON.stringify({ok:true,result:"verified case-insensitive"})}
        return JSON.stringify({ok:false,error:"verification failed"})
      })()`;
      break;
    }
    default: {
      if (sel) {
        jsCode = `(function(){
          var el=${finderCode};
          if(!el)return JSON.stringify({ok:false,error:"not found for ${cmd.type}"});
          el.scrollIntoView({block:"center",behavior:"instant"});
          el.click();
          return JSON.stringify({ok:true,result:"generic fallback clicked for ${cmd.type}"})
        })()`;
      }
      break;
    }
  }
  
  if (!jsCode) return { ok: false, result: `No UFB for: ${cmd.type}` };

  var ufbRes = await cdpExecuteJs(tab, `return ${jsCode}`, { timeout: timeout });
  if (ufbRes && ufbRes.ok && ufbRes.value != null) {
    try {
      var parsed = typeof ufbRes.value === 'string' ? JSON.parse(ufbRes.value) : ufbRes.value;
      if (!parsed || typeof parsed !== 'object' || parsed === null) return { ok: true, result: String(parsed != null ? parsed : 'UFB done') };
      return { ok: parsed.ok !== false, result: parsed.result || parsed.error || 'UFB done', value: parsed.value };
    } catch(_e) {
      return { ok: true, result: String(ufbRes.value).slice(0, 200) };
    }
  }
  return { ok: false, result: 'UFB returned no result' };
}


async function recoverFromCaptcha(tab, captchaInfo, currentUrl, goal, stepCount = 0) {
  // Strategy 1: Try to click CAPTCHA checkbox/button via CDP
  try {
    const clickCode = `
      // reCAPTCHA checkbox
      const rcFrame = document.querySelector('iframe[src*="recaptcha"]');
      if (rcFrame) {
        const rcDoc = rcFrame.contentDocument || rcFrame.contentWindow.document;
        const cb = rcDoc && rcDoc.querySelector('.recaptcha-checkbox');
        if (cb) { cb.click(); return 'recaptcha_clicked'; }
      }
      // hCaptcha checkbox
      const hcFrame = document.querySelector('iframe[src*="hcaptcha"]');
      if (hcFrame) {
        const hcDoc = hcFrame.contentDocument || hcFrame.contentWindow.document;
        const cb = hcDoc && hcDoc.querySelector('#checkbox');
        if (cb) { cb.click(); return 'hcaptcha_clicked'; }
      }
      // Cloudflare Turnstile
      const cfChk = document.querySelector('.cf-turnstile input, [name="cf-turnstile-response"]');
      if (cfChk) { cfChk.click(); return 'turnstile_clicked'; }
      // Generic checkbox
      const chk = document.querySelector('input[type="checkbox"]');
      if (chk && document.body && document.body.innerText && document.body.innerText.length < 500) { chk.click(); return 'generic_checkbox'; }
      // Amazon CAPTCHA - try the input field
      const amzInput = document.querySelector('#captchacharacters');
      if (amzInput) return 'amazon_captcha_needs_input';
      return null;
    `;
    const result = await cdpExecuteJs(tab.id, clickCode, { timeout: THREE_SECONDS_MS });
    const clickedWhat = (result && result.ok) ? result.value : null;
    if (clickedWhat && clickedWhat !== 'null' && clickedWhat !== 'amazon_captcha_needs_input') {
      sendSilentUpdate(`🤖 CAPTCHA auto-solved (${clickedWhat})`, stepCount);
      try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      await sleep(TWO_SECONDS_MS); // wait for page to process
      return 'solved';
    }
  } catch (e) {
    console.warn('[Sentinel/CAPTCHA] Auto-solve attempt failed:', getErrorMessage(e));
  }
  
  // Strategy 2: Navigate to an alternative URL for the same site
  let host;
  try { host = new URL(currentUrl).hostname.replace(WWW_PREFIX_RE, ''); } catch (_urlErr) { host = ''; }
  
  for (const [key, info] of Object.entries(CAPTCHA_HOST_MAP)) {
    if (host.includes(key) && goal) {
      // Try to extract search query from goal and go directly to search results
      const searchMatch = goal.match(SEARCH_SIMPLE_RE);
      if (searchMatch && info.searchPath && searchMatch[1]) {
        const searchUrl = info.altUrl + info.searchPath + encodeURIComponent(searchMatch[1]);
        sendSilentUpdate('🔄 Bypassing CAPTCHA via direct search URL', stepCount);
        try {
          await chrome.tabs.update(tab.id, { url: searchUrl });
          try { tel.trace('sleep', 'Sleep 3000ms', { ms: THREE_SECONDS_MS }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          await sleep(THREE_SECONDS_MS);
        } catch (_navErr) {
          console.warn('[Sentinel/CAPTCHA] Navigate to search URL failed:', getErrorMessage(_navErr));
        }
        return 'bypassed';
      }
      // No search query - just go to homepage
      sendSilentUpdate('🔄 Bypassing CAPTCHA via homepage', stepCount);
      try {
        await chrome.tabs.update(tab.id, { url: info.altUrl });
        try { tel.trace('sleep', 'Sleep 3000ms', { ms: THREE_SECONDS_MS }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
        await sleep(THREE_SECONDS_MS);
      } catch (_navErr) {
        console.warn('[Sentinel/CAPTCHA] Navigate to homepage failed:', getErrorMessage(_navErr));
      }
      return 'bypassed';
    }
  }
  
  // Strategy 3: Go back and try again
  try {
    sendSilentUpdate('⬅️ CAPTCHA detected, going back', stepCount);
    await chrome.tabs.goBack(tab.id);
    try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
    await sleep(TWO_SECONDS_MS);
    return 'went_back';
  } catch (e) {
    console.warn('[Sentinel/CAPTCHA] Go back failed:', getErrorMessage(e));
  }
  
  // Strategy 4: Pause for user
  return 'needs_user';
}




// ========== v3.13.0 Auto-Recovery Helpers ==========
// Engine-side reliability layer. The LLM is good at "what's the next step";
// it's bad at "did my code actually work, and what should I try instead".
// These helpers move retry/recovery decisions OUT of the LLM and INTO the
// engine, which means: fewer wasted steps, fewer hallucinations from
// retry-go-wrong, and the LLM can focus on planning vs. error handling.

/**
 * Detect whether a raw JS-result string is unproductive (empty, error,
 * non-serializable, parsed-but-empty). Used by the retry ladder and by
 * memory hygiene at write time. Single source of truth for "this didn't work".
 */
function _isUnproductiveJsResult(raw) {
  if (raw == null) return true;
  if (typeof raw !== 'string') raw = String(raw);
  if (raw === '' || raw === 'Done') return true;
  if (raw.startsWith('JS Error:')) return true;
  if (raw.startsWith('Code execution timed out')) return true;
  if (raw.startsWith('Execution error')) return true;

  let val = raw;
  if (raw.startsWith('JS Result: ')) val = raw.substring(11);
  const trim = val.trim();

  if (trim.length < 5) return true;
  if (trim === 'undefined' || trim === 'null') return true;
  if (/^\s*\[object\s+\w+\]\s*$/i.test(trim)) return true;

  // Parsed-but-empty check
  try {
    const p = JSON.parse(trim);
    if (p === null) return true;
    if (Array.isArray(p) && !p.length) return true;
    if (typeof p === 'object') {
      let hasOwnProp = false;
      for (let key in p) {
        if (Object.prototype.hasOwnProperty.call(p, key)) {
          hasOwnProp = true;
          break;
        }
      }
      if (!hasOwnProp) return true;
    }
  } catch (_) { /* not JSON, that's fine */ }

  return false;
}

/**
 * Run a single execute_js attempt via CDP first, falling back to content
 * script if CDP attach is denied (chrome:// pages, devtools, etc.).
 * Returns the raw "JS Result: ..." string or an error string.
 */
async function _runExecuteJsOnce(tabId, code, timeout) {
  // CDP path (preferred -- bypasses page CSP)
  try {
    const cdpResult = await cdpExecuteJs(tabId, code, { timeout });
    if (cdpResult && cdpResult.ok) {
      const valStr = cdpResult.value === undefined || cdpResult.value === null
        ? ''
        : (typeof cdpResult.value === 'object'
            ? JSON.stringify(cdpResult.value).slice(0, MAX_CDP_RESULT_LENGTH)
            : String(cdpResult.value).slice(0, MAX_CDP_RESULT_LENGTH));
      return `JS Result: ${valStr}`;
    } else if (cdpResult && cdpResult.attachDenied) {
      // Fall through to content-script path
    } else if (cdpResult && cdpResult.error) {
      // Fall through too -- content script may succeed where CDP errored
    }
  } catch (_) { /* fall through */ }

  // Content-script path (fallback for chrome:// or CDP-failed sites)
  try {
    const csRes = await sendMessageWithRetry(tabId, {
      action: 'execute_command',
      command: { type: 'execute_js', code, timeout }
    });
    return csRes || 'Done';
  } catch (e) {
    return `JS Error: ${getErrorMessage(e)}`;
  }
}

/**
 * Auto-recovery retry ladder for execute_js. Tries the LLM's original code
 * first; if that returns unproductive (empty / null / [object Object] /
 * non-serializable), automatically retries with progressively more
 * conservative strategies. The LLM is NEVER asked to choose between these --
 * the engine handles it mechanically.
 *
 * Strategies (in order):
 *   1. original   -- LLM's intended code
 *   2. body_text  -- document.body.innerText (covers null-query and
 *                    selector-miss cases; LLM can parse text in finish)
 *   3. visible    -- aggregated innerText from all common visible
 *                    elements (covers SPA pages where body.innerText
 *                    misses lazy-rendered children)
 *
 * Returns { raw, strategy }. raw is the same shape the rest of the
 * pipeline expects; strategy is for logging / forensic run log.
 */
async function _runExecuteJsWithRetryLadder(tabId, originalCode, timeout) {
  // Strategy 1: LLM's original code
  let raw = await _runExecuteJsOnce(tabId, originalCode || '', timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'original' };
  }

  // Strategy 2: body.innerText fallback (covers most LLM-extraction failures)
  const FB_BODY_TEXT = 'return (document.body && document.body.innerText) ? document.body.innerText.substring(0, 8000) : "";';
  raw = await _runExecuteJsOnce(tabId, FB_BODY_TEXT, timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'body_text_fallback' };
  }

  // Strategy 3: aggregate visible-element text (SPA-heavy sites where
  // body.innerText returns just the loading state)
  const FB_VISIBLE = "return Array.from(document.querySelectorAll('h1,h2,h3,h4,p,td,li,a,span,div')).map(e => (e.innerText || '').trim()).filter(t => t && t.length > 3).slice(0, 300).join('\\n').substring(0, 8000);";
  raw = await _runExecuteJsOnce(tabId, FB_VISIBLE, timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'visible_text_fallback' };
  }

  return { raw, strategy: 'all_failed' };
}

/**
 * Memory-hygiene gate: should this candidate value be written to agentMemory?
 * Returns { ok: bool, reason: string }. Reasons help debug / log why a write
 * was rejected. Run BEFORE writing -- prevents garbage from polluting future
 * prompts and the report-generator's memory summary.
 */
function _shouldAcceptMemoryWrite(key, candidateValue, agentMemory) {
  if (!key || typeof key !== 'string') return { ok: false, reason: 'empty key' };
  if (candidateValue == null) return { ok: false, reason: 'null/undefined value' };

  const valStr = typeof candidateValue === 'string'
    ? candidateValue
    : (Array.isArray(candidateValue) || typeof candidateValue === 'object'
        ? JSON.stringify(candidateValue)
        : String(candidateValue));

  if (valStr.length < 10) return { ok: false, reason: 'value too short' };

  // Reject error-shaped strings
  if (/^(JS Error|Execution error|Code execution timed out|Element not found|JS execution failed)/i.test(valStr.trim())) {
    return { ok: false, reason: 'error-shaped value' };
  }

  // Reject [object Foo] strings
  if (/^\s*\[object\s+\w+\]\s*$/i.test(valStr.trim())) {
    return { ok: false, reason: 'non-serialized object' };
  }

  // Reject duplicates -- if an existing memory key has the EXACT same value,
  // overwriting it is meaningless and clutters the prompt.
  for (const [existingKey, ev] of Object.entries(agentMemory || {})) {
    if (existingKey === key) continue;
    const evStr = typeof ev === 'string' ? ev : JSON.stringify(ev);
    if (evStr === valStr) {
      return { ok: false, reason: `duplicates existing key ${existingKey}` };
    }
  }

  return { ok: true, reason: '' };
}

/**
 * (3.13.0) Pre-finish data-completeness check. Parse the goal text for
 * data fields the user asked for ("extract X, Y, Z for each item"), then
 * verify memory has plausible data for each. Returns null if everything's
 * present, or a string describing the gap so we can block the finish and
 * push the LLM to extract the missing piece.
 *
 * Heuristic, not authoritative -- false positives only delay finish by
 * one step, which is cheap. False negatives let a sparse report through,
 * which is the existing v3.10 hallucination gate's job. This adds a
 * complementary "did you actually get what was asked for" pass.
 */
function _checkPreFinishCompleteness(goal, agentMemory, history) {
  if (!goal || typeof goal !== 'string') return null;
  if (!agentMemory || typeof agentMemory !== 'object' || agentMemory === null) return null;
  if (!Array.isArray(history)) history = [];

  const memorySerialized = JSON.stringify(agentMemory).toLowerCase();
  const noteText = history
    .filter(h => h && h.action && h.action.type === 'note' && h.action.text)
    .map(h => String(h.action.text).toLowerCase())
    .join(' ');
  const allEvidence = `${memorySerialized} ${noteText}`;

  // Patterns we care about: "extract X" / "give me X" / "find X" + commas
  // For each: the CVE ID, CVSS v3 base score, affected FortiOS versions, ...
  const fieldListMatch = goal.match(FIELD_LIST_RE);
  if (!fieldListMatch || !fieldListMatch[1]) return null;

  const fieldList = fieldListMatch[1];
  // Split on commas / "and" / "&" -- get individual field names
  const rawFields = fieldList.split(FIELD_LIST_SPLIT_RE)
    .map(f => f.trim().replace(FIELD_PREFIX_CLEAN_RE, ''))
    .filter(f => f.length > 3 && f.length < 60);

  if (rawFields.length < 2) return null;  // not a structured field list

  // For each requested field, check whether ANY token from it appears in
  // memory or notes. This is a deliberately loose heuristic.
  const missing = [];
  for (const field of rawFields) {
    // Pull "key" tokens from the field name (skip filler words)
    const tokens = typeof field === 'string' ? field.toLowerCase().split(WHITESPACE_SPLIT_RE).filter(t => t.length > 3 && !FILLER_WORDS.has(t)) : [];
    if (!tokens.length) continue;
    // Match if ANY meaningful token from this field shows up in evidence
    const found = typeof allEvidence === 'string' && tokens.some(t => allEvidence.includes(t));
    if (!found) missing.push(field);
  }

  if (!missing.length) return null;

  // Don't fire on every gap -- only if MORE THAN HALF of asked fields are
  // missing. Otherwise the existing hallucination gate handles it via
  // [unverified] tagging.
  if (!rawFields.length || missing.length / rawFields.length < 0.5) return null;

  return `Goal asked for: ${rawFields.join(', ')}. Memory is missing token-evidence for: ${missing.join(', ')}. Try one more execute_js or extract pass before finishing -- the retry ladder will auto-fall-back to body.innerText if your selectors miss.`;
}

/**
 * URL-aware loop detector. Catches "agent did 7 navigates to 7 different
 * pages, none produced a productive memory write". Loop detection that
 * requires repeated EXACT actions is too narrow -- this version says:
 *
 *   "If 3+ of the last 4 actions are the same TYPE, and none of them
 *    resulted in a productive memory write, that is a loop. Force
 *    a strategy shift."
 *
 * Returns { isLoop: bool, type: string, count: number } so the caller can
 * inject a context-specific directive.
 */
function _detectActionTypeLoop(history, _agentMemory) {
  if (!Array.isArray(history) || history.length < 4) return { isLoop: false };
  const recent = history.slice(-4);
  const types = recent.map(h => (h && h.action && h.action.type) || '');
  // Most common type in the window
  const counts = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  let dominantType = null, dominantCount = 0;
  for (const [t, count] of Object.entries(counts)) {
    if (count > dominantCount) { dominantType = t; dominantCount = count; }
  }
  if (dominantCount < 3) return { isLoop: false };

  // Check whether THIS dominant-type window produced any productive memory.
  // A "productive" step is one that wrote a key with a usable value to memory.
  // We can't know which key was written by which step, but we can check:
  // did the memory keys count GROW during this 4-step window? If not, loop.
  // (Imperfect but conservative -- false positives only delay the run a bit.)
  // Implementation: store a memory-key-count snapshot in agent state at each
  // step and compare. For now we use a simpler heuristic: the dominant type
  // is non-modifying AND no new note/extract/execute_js-with-key happened.
  if (!NON_PRODUCTIVE_ACTIONS.has(dominantType)) return { isLoop: false };

  // Count productive actions in the window
  const recentProductive = recent.filter(h => {
    if (!h || !h.action) return false;
    const t = h.action.type;
    if (t === 'note') return true;
    if (EXTRACT_TYPE_RE.test(t)) return !!h.action.key;
    if (t === 'execute_js') return !!h.action.key;
    return false;
  });
  if (!recentProductive.length) {
    return { isLoop: true, type: dominantType, count: dominantCount };
  }

  return { isLoop: false };
}



export {
  detectCaptcha,
  _generateSmartRecovery,
  _universalCdpFallback,
  recoverFromCaptcha,
  _isUnproductiveJsResult,
  _runExecuteJsOnce,
  _runExecuteJsWithRetryLadder,
  _shouldAcceptMemoryWrite,
  _checkPreFinishCompleteness,
  _detectActionTypeLoop,
  escapeJsString,
};
