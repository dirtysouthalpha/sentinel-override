// Sentinel Override v3 -- Wait/Verify Utilities
// Condition waiting with MutationObserver + polling fallback, condition checking, sleep.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.wait = window.__sentinelUtils.wait || {};

(function() {
  const wait = window.__sentinelUtils.wait;

  // ========== Sleep ==========
  /**
   * Return a promise that resolves after the specified delay.
   * @param {number} ms - Delay in milliseconds.
   * @returns {Promise<void>}
   */
  wait.sleep = function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  // ========== Wait/Verify Logic ==========
  /**
   * Wait for a condition to become true, using MutationObserver with a
   * polling fallback. Resolves immediately if the condition is already met.
   * Times out after condition.timeout ms (default 10000).
   * @param {object} condition - Condition object with type, timeout, and type-specific fields.
   * @param {string} condition.type - 'wait_for_text', 'wait_for_element', or 'wait_for_navigation'.
   * @param {number} [condition.timeout=10000] - Maximum wait time in ms.
   * @returns {Promise<string>} Description of the result (met, timeout, etc.).
   */
  wait.handleWaitFor = function(condition) {
    const timeout = condition.timeout || 10000;
    const startTime = Date.now();

    return new Promise((resolve) => {
      if (wait.checkCondition(condition)) {
        resolve('Condition met immediately');
        return;
      }

      const observer = new MutationObserver(() => {
        if (wait.checkCondition(condition)) {
          observer.disconnect();
          clearTimeout(timer);
          resolve('Condition met after ' + (Date.now() - startTime) + 'ms');
        }
      });

      const observeTarget = document.body || document.documentElement;
      if (!observeTarget) {
        resolve('No document body to observe');
        return;
      }
      observer.observe(observeTarget, { childList: true, subtree: true });

      const pollInterval = setInterval(() => {
        if (wait.checkCondition(condition)) {
          observer.disconnect();
          clearInterval(pollInterval);
          clearTimeout(timer);
          resolve('Condition met after ' + (Date.now() - startTime) + 'ms');
        }
      }, 500);

      const timer = setTimeout(() => {
        observer.disconnect();
        clearInterval(pollInterval);
        resolve('Timeout waiting for condition (' + timeout + 'ms)');
      }, timeout);
    });
  };

  /**
   * Check whether a wait condition is currently met.
   * Supports wait_for_text (body text contains), wait_for_element (ref or selector),
   * and wait_for_navigation (URL changed).
   * @param {object} condition - The condition to check.
   * @returns {boolean} True if the condition is met.
   */
  wait.checkCondition = function(condition) {
    if (condition.type === 'wait_for_text') {
      const body = document.body;
      return body ? body.innerText.includes(condition.text) : false;
    } else if (condition.type === 'wait_for_element') {
      // (#10) Prefer ref when provided. A ref that resolves means the element
      // is still in the live DOM. If the ref is stale, fall through to selector.
      const dom = window.__sentinelUtils && window.__sentinelUtils.dom;
      if (condition.ref && dom && dom.findElementByRef) {
        const el = dom.findElementByRef(condition.ref);
        if (el) return true;
        if (!condition.selector) return false;
      }
      try {
        return !!document.querySelector(condition.selector);
      } catch {
        return false;
      }
    } else if (condition.type === 'wait_for_navigation') {
      return condition.currentUrl !== window.location.href;
    }
    return false;
  };
})();
