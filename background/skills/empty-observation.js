// background/skills/empty-observation.js
// Fires when observe_page returns < 5 elements — either the page hasn't
// loaded yet or it's a render-blocked SPA. The LLM can't pick a target if
// there are no targets in the element list.
// Recovery: wait for the page to populate, then re-observe. Two strategies:
//   • If we just navigated: wait_for_navigation (likely still loading)
//   • Otherwise: execute_js to inspect DOM directly and find anchors

export const emptyObservation = {
  id: 'empty-observation',
  description: 'Recovery when observation returns < 5 elements (page not loaded / SPA gating)',
  priority: 55,

  matches(ctx) {
    if (!ctx) return false;
    // Only fire when we have an observation but it's nearly empty
    const elemCount = Array.isArray(ctx.allElements) ? ctx.allElements.length : 0;
    const textLen = (ctx.pageText || '').length;
    // Empty + on-a-real-url qualifies; if URL is about: / chrome: / data: skip
    const url = ctx.currentUrl || '';
    if (/^(about:|chrome:|data:|file:)/i.test(url)) return false;
    return elemCount < 5 && textLen < 200;
  },

  autoApply(ctx) {
    // If the previous action was a navigate, the page is probably still
    // loading. Auto-apply wait_for_navigation with a moderate timeout.
    if (ctx.lastCommand && ctx.lastCommand.type === 'navigate') {
      return { type: 'wait_for_navigation', timeout: 8000, _autoAppliedBy: 'empty-observation' };
    }
    // Otherwise let the LLM choose between waiting and inspecting via JS.
    return null;
  },

  promptInjection(ctx) {
    return `The page observation came back nearly empty (< 5 interactive elements, < 200 chars of text). The page is either still loading or its content is rendered by an SPA framework that the standard scanner can't see yet. Strategies:

1. **Wait** — if you just navigated, give it more time: \`{type:'wait_for_text', text:'<expected loaded-state text>', timeout:10000}\` or \`{type:'wait_for_navigation', timeout:8000}\`.

2. **Inspect via JS** — bypass the scanner and read the DOM directly: \`{type:'execute_js', key:'page_audit', code:'return {tag:document.body.tagName, charCount:document.body.innerText.length, headings:Array.from(document.querySelectorAll("h1,h2,h3")).map(h=>h.innerText).slice(0,10), links:Array.from(document.querySelectorAll("a[href]")).map(a=>({t:a.innerText.trim(),h:a.href})).slice(0,15)}'}\`.

3. **Different URL** — if the page is rendered behind a route guard or shows a login wall, the URL might not be the right surface. Try a parent or sibling URL.

4. **Honest finish** — if multiple wait + JS-inspect attempts return empty, the data may simply not be reachable from this page. Finish with "[MISSING DATA — page did not populate]" and recommend a manual check.`;
  }
};
