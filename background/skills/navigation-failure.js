// background/skills/navigation-failure.js
// Fires when a navigate action fails — wrong URL, network error, auth wall,
// redirect loop, or page-load timeout. The agent needs to decide whether to
// retry, try a different URL, or abandon the navigation.

import { getErrorMessage } from '../error-utils.js';

// Precompile regex patterns for navigation failure detection
const NAV_FAILURE_RE = /navigat.*fail|load.*timeout|net::|err_|dns|refused|reset|abort|unreachable/i;
const AUTH_WALL_RE = /auth|login|signin|sign.in|credential|sso|401|403/i;

export const navigationFailure = {
  id: 'navigation-failure',
  description: 'Recovery when a navigate action fails (network, timeout, auth wall)',
  priority: 78,

  matches(ctx) {
    try {
      if (!ctx || !ctx.lastResult || !ctx.lastActionFailed) return false;
      const r = (typeof ctx.lastResult === 'string' ? ctx.lastResult : String(ctx.lastResult));
      // Only fire when the last command was a navigate.
      const isNavigate = typeof ctx.lastCommand === 'object' && ctx.lastCommand !== null &&
        ctx.lastCommand.type === 'navigate';
      if (!isNavigate) return false;
      return NAV_FAILURE_RE.test(r);
    } catch (error) {
      console.error('Error in navigationFailure matches:', getErrorMessage(error));
      return false;
    }
  },

  autoApply(ctx) {
    try {
      const r = (typeof ctx.lastResult === 'string' ? ctx.lastResult : String(ctx.lastResult));
      // Auth wall: don't auto-retry, let the LLM decide.
      if (AUTH_WALL_RE.test(r)) return null;
      // Network blip: auto-retry the same URL once with a longer timeout.
      if (typeof ctx.lastCommand === 'object' && ctx.lastCommand !== null && ctx.lastCommand.url) {
        return {
          type: 'navigate',
          url: ctx.lastCommand.url,
          timeout: 15000,
          _autoAppliedBy: 'navigation-failure',
        };
      }
      return null;
    } catch (error) {
      console.error('Error in navigationFailure autoApply:', getErrorMessage(error));
      return null;
    }
  },

  promptInjection(ctx) {
    const url = (typeof ctx.lastCommand === 'object' && ctx.lastCommand !== null && ctx.lastCommand.url) || '(unknown)';
    const result = (typeof ctx.lastResult === 'string' ? ctx.lastResult : String(ctx.lastResult));
    const isAuth = AUTH_WALL_RE.test(result);
    if (isAuth) {
      return `Navigation to \`${url}\` failed with an authentication requirement (login wall / SSO / 401 / 403). The page cannot be reached without credentials. Strategies:
1. If you have a login flow, use \`execute_js\` to inject credentials from the vault, or navigate to the login page directly.
2. If the target data is behind auth and no credentials are available, finish with "[BLOCKED — authentication required]" and note the URL.
3. Try a parent or alternative URL that may be publicly accessible.`;
    }
    return `Navigation to \`${url}\` failed: ${result.slice(0, 200)}. Strategies:
1. Retry with a longer timeout (auto-applied: navigate with 15s timeout).
2. Check for typos in the URL — try the domain root first, then navigate in-page.
3. If the domain is unreachable, the target may be down or the URL may have changed. Try a search engine query to find the current URL.
4. If the failure persists after 2 retries, finish with "[BLOCKED — unreachable URL]" and note the URL.`;
  }
};
