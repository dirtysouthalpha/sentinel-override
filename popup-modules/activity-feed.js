// Live Activity Feed — shows real-time agent thinking/acting flow
// Collapsible panel between chat messages and input area
// Loaded as traditional <script> — attaches to window for testability.

(function () {
  const FEED_ICONS = {
    observe: '\u{1F50D}',
    thinking: '\u{1F914}',
    acting: '\u26A1',
    result: '\u2705',
    error: '\u274C',
    navigate: '\u{1F310}',
    click: '\u{1F446}',
    type: '\u2328\uFE0F',
    scroll: '\u{1F4DC}',
    extract: '\u{1F4CB}',
    note: '\u{1F4DD}',
    finish: '\u{1F3C1}',
    wait: '\u231B',
  };

  const FEED_COLORS = {
    observe: '#4a9eff',
    thinking: '#9b59b6',
    acting: '#ff6b00',
    result: '#4caf50',
    error: '#f44336',
  };

  /**
   * Escape HTML special characters to prevent XSS in feed entries.
   */
  function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Create the feed container DOM if it doesn't exist yet.
   * Inserts the feed between chat-container and input-area.
   * @returns {HTMLElement|null} The feed element or null if DOM not ready
   */
  function initActivityFeed() {
    let feed = document.getElementById('activity-feed');
    if (!feed) {
      feed = document.createElement('div');
      feed.id = 'activity-feed';
      feed.className = 'activity-feed collapsed';

      // Build collapsible header
      const header = document.createElement('div');
      header.className = 'activity-feed-header';
      header.innerHTML = '<span>Live Activity</span><span class="feed-collapse-icon">\u25BE</span>';
      header.addEventListener('click', function () {
        feed.classList.toggle('collapsed');
      });
      feed.appendChild(header);

      // Entry list container
      const list = document.createElement('div');
      list.className = 'activity-feed-list';
      feed.appendChild(list);

      // Insert between chat-container and input-area
      const inputArea = document.getElementById('input-area');
      if (inputArea && inputArea.parentNode) {
        inputArea.parentNode.insertBefore(feed, inputArea);
      } else {
        // Fallback: append to body
        document.body.appendChild(feed);
      }
    }
    return feed;
  }

  /**
   * Add a single timestamped event to the feed.
   * @param {string} category - Event category
   * @param {string} label - Human-readable label
   * @param {string|object|null} detail - Optional detail
   */
  function addFeedEvent(category, label, detail) {
    if (detail === undefined) detail = null;
    const feed = initActivityFeed();
    if (!feed) return;

    const list = feed.querySelector('.activity-feed-list') || feed;

    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const icon = FEED_ICONS[category] || '\u2022';
    const color = FEED_COLORS[category] || 'var(--text-secondary)';

    const entry = document.createElement('div');
    entry.className = 'feed-entry';
    entry.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:4px 12px;font-size:12px;font-family:var(--font-mono, monospace);border-left:2px solid ' + color + ';margin:2px 0;animation:feedSlideIn 0.2s ease-out;';

    entry.innerHTML =
      '<span class="feed-time" style="color:var(--text-tertiary, #888);font-size:10px;flex-shrink:0;padding-top:1px;">' + time + '</span>' +
      '<span class="feed-icon" style="flex-shrink:0;">' + icon + '</span>' +
      '<span class="feed-label" style="color:' + (category === 'error' ? FEED_COLORS.error : 'var(--text-primary, #fff)') + ';flex:1;">' + escapeHtml(label) + '</span>';

    if (detail) {
      const detailEl = document.createElement('div');
      detailEl.className = 'feed-detail';
      detailEl.style.cssText = 'font-size:11px;color:var(--text-tertiary, #888);margin-left:52px;margin-top:2px;padding-bottom:2px;';
      detailEl.textContent =
        typeof detail === 'string' ? detail : JSON.stringify(detail).substring(0, 200);
      entry.appendChild(detailEl);
    }

    list.appendChild(entry);

    // Auto-scroll to bottom, keep max 50 entries
    while (list.children.length > 50) {
      list.removeChild(list.firstChild);
    }

    if (feed.classList.contains('collapsed')) return;
    feed.scrollTop = feed.scrollHeight;
  }

  /**
   * Clear all entries from the feed.
   */
  function clearFeed() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    const list = feed.querySelector('.activity-feed-list');
    if (list) {
      list.innerHTML = '';
    } else {
      feed.innerHTML = '';
    }
  }

  /**
   * Show or hide the activity feed panel.
   * @param {boolean} visible
   */
  function setFeedVisible(visible) {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    if (visible) {
      feed.classList.add('visible');
      feed.style.display = 'block';
    } else {
      feed.classList.remove('visible');
      feed.style.display = 'none';
    }
  }

  /**
   * Toggle the collapsed state of the feed.
   */
  function toggleFeedCollapse() {
    const feed = document.getElementById('activity-feed');
    if (feed) feed.classList.toggle('collapsed');
  }

  /**
   * Get the current count of feed entries (for testing/debugging).
   * @returns {number}
   */
  function getFeedEntryCount() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return 0;
    const list = feed.querySelector('.activity-feed-list');
    return list ? list.children.length : 0;
  }

  // Expose to global scope for both browser <script> and test environments
  const FEED_CONSTANTS = { FEED_ICONS, FEED_COLORS };

  if (typeof window !== 'undefined') {
    window.FEED_ICONS = FEED_ICONS;
    window.FEED_COLORS = FEED_COLORS;
    window.initActivityFeed = initActivityFeed;
    window.addFeedEvent = addFeedEvent;
    window.clearFeed = clearFeed;
    window.setFeedVisible = setFeedVisible;
    window.toggleFeedCollapse = toggleFeedCollapse;
    window.getFeedEntryCount = getFeedEntryCount;
    window.FEED_CONSTANTS = FEED_CONSTANTS;
    window.escapeHtml = escapeHtml;
  }

  // Also support CommonJS for Node test environments (vm sandbox / require)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      FEED_ICONS,
      FEED_COLORS,
      initActivityFeed,
      addFeedEvent,
      clearFeed,
      setFeedVisible,
      toggleFeedCollapse,
      getFeedEntryCount,
      escapeHtml,
    };
  }
})();
