// Sentinel Override v3 -- Wait/Verify Utilities
// Condition waiting with MutationObserver + polling fallback, condition checking, sleep.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.wait = window.__sentinelUtils.wait || {};

(function() {
  const wait = window.__sentinelUtils.wait;

  // ========== Sleep ==========
  wait.sleep = function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  // ========== Wait/Verify Logic ==========
  wait.handleWaitFor = function(condition) {
    const timeout = condition.timeout || 10000;
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Check immediately first
      if (wait.checkCondition(condition)) {
        resolve('Condition met immediately');
        return;
      }

      // Set up MutationObserver
      const observer = new MutationObserver(() => {
        if (wait.checkCondition(condition)) {
          observer.disconnect();
          clearTimeout(timer);
          resolve('Condition met after ' + (Date.now() - startTime) + 'ms');
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      // Also poll every 500ms as backup
      const pollInterval = setInterval(() => {
        if (wait.checkCondition(condition)) {
          observer.disconnect();
          clearInterval(pollInterval);
          clearTimeout(timer);
          resolve('Condition met after ' + (Date.now() - startTime) + 'ms');
        }
      }, 500);

      // Timeout
      const timer = setTimeout(() => {
        observer.disconnect();
        clearInterval(pollInterval);
        resolve('Timeout waiting for condition (' + timeout + 'ms)');
      }, timeout);
    });
  };

  wait.checkCondition = function(condition) {
    if (condition.type === 'wait_for_text') {
      return document.body.innerText.includes(condition.text);
    } else if (condition.type === 'wait_for_element') {
      try {
        return !!document.querySelector(condition.selector);
      } catch (e) {
        return false;
      }
    } else if (condition.type === 'wait_for_navigation') {
      return condition.currentUrl !== window.location.href;
    }
    return false;
  };
})();

export const wait = window.__sentinelUtils.wait;
