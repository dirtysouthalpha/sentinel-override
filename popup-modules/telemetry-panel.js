// popup-modules/telemetry-panel.js
// Live Telemetry Panel — v3.25.0
//
// Slide-up panel from the bottom of the side panel showing every internal
// event in real time. Solves the "black box" problem: when the agent
// appears stuck, the user opens this panel to see exactly what's happening.
//
// Subscribes to chrome.runtime telemetry_event messages emitted by
// background/telemetry.js. Each event: {ts, seq, category, level, message,
// payload}. Renders into a circular buffer (last 500 events in memory).
//
// Features:
//   - Filter chips: All / LLM / Skills / Platform / Memory / Page / Errors
//   - Free-text search
//   - Pause auto-scroll toggle
//   - Copy all + Clear all
//   - Per-event expand for full payload (JSON pretty-print)
//   - Verbosity selector mirrored from Settings (Quiet/Normal/Verbose/Debug)
//
// Rail button toggles the panel.

(function setupTelemetryPanel() {
  const MAX_BUFFER = 500;
  const events = [];           // Circular buffer
  let activeFilter = 'all';    // 'all' | category id
  let searchQuery = '';
  let autoScroll = true;
  let panelOpen = false;

  // --------- DOM Helpers ---------

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function _formatTs(ts) {
    if (!ts) return '--:--:--';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return hh + ':' + mm + ':' + ss + '.' + ms;
  }

  function _categoryBadgeColor(cat) {
    return {
      llm:       '#7aa2f7',
      skill:     '#9ece6a',
      platform:  '#bb9af7',
      memory:    '#e0af68',
      cdp:       '#7dcfff',
      page:      '#73daca',
      sleep:     '#565f89',
      storage:   '#a9b1d6',
      network:   '#ff9e64',
      lifecycle: '#f7768e',
      error:     '#f44',
    }[cat] || '#888';
  }

  function _levelDotColor(level) {
    return {
      error: '#f44',
      warn:  '#e0af68',
      info:  '#7aa2f7',
      debug: '#a9b1d6',
      trace: '#565f89',
    }[level] || '#888';
  }

  // --------- Buffer + Rendering ---------

  function _addEvent(ev) {
    events.push(ev);
    while (events.length > MAX_BUFFER) events.shift();
    if (panelOpen) _renderIncremental(ev);
  }

  function _eventMatchesFilter(ev) {
    if (activeFilter === 'all') {
      // 'all' shows everything EXCEPT pure trace by default — too noisy.
      return ev.level !== 'trace';
    }
    if (activeFilter === 'errors') {
      return ev.level === 'error' || ev.level === 'warn';
    }
    return ev.category === activeFilter;
  }

  function _eventMatchesSearch(ev) {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if ((ev.message || '').toLowerCase().includes(q)) return true;
    if ((ev.category || '').toLowerCase().includes(q)) return true;
    if (ev.payload) {
      try {
        if (JSON.stringify(ev.payload).toLowerCase().includes(q)) return true;
      } catch (e) {}
    }
    return false;
  }

  function _renderEvent(ev) {
    const div = document.createElement('div');
    div.className = 'telem-event';
    div.dataset.category = ev.category;
    div.dataset.level = ev.level;
    div.style.cssText = 'display:flex; gap:6px; padding:3px 8px; border-bottom:1px solid rgba(255,255,255,0.04); font-size:11px; line-height:1.45; cursor:' + (ev.payload ? 'pointer' : 'default') + ';';

    const ts = document.createElement('span');
    ts.style.cssText = 'color:var(--text-tertiary, #777); font-family:monospace; font-size:10px; flex-shrink:0; min-width:84px;';
    ts.textContent = _formatTs(ev.ts);
    div.appendChild(ts);

    const dot = document.createElement('span');
    dot.style.cssText = 'flex-shrink:0; width:6px; height:6px; border-radius:50%; background:' + _levelDotColor(ev.level) + '; margin-top:6px;';
    div.appendChild(dot);

    const badge = document.createElement('span');
    badge.style.cssText = 'flex-shrink:0; padding:1px 5px; font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; border-radius:3px; background:rgba(255,255,255,0.06); color:' + _categoryBadgeColor(ev.category) + ';';
    badge.textContent = ev.category;
    div.appendChild(badge);

    const msg = document.createElement('span');
    msg.style.cssText = 'flex:1; min-width:0; color:var(--text-primary, #fff); word-break:break-word;';
    msg.textContent = ev.message || '';
    div.appendChild(msg);

    if (ev.payload) {
      const expandable = document.createElement('pre');
      expandable.style.cssText = 'display:none; flex-basis:100%; margin:4px 0 4px 90px; padding:6px 8px; background:rgba(0,0,0,0.25); border-radius:3px; font-family:monospace; font-size:10px; line-height:1.4; color:var(--text-secondary, #aaa); white-space:pre-wrap; word-break:break-word; max-height:200px; overflow:auto;';
      try { expandable.textContent = JSON.stringify(ev.payload, null, 2); } catch (e) { expandable.textContent = String(ev.payload); }
      div.appendChild(expandable);
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'PRE') return;
        expandable.style.display = expandable.style.display === 'none' ? 'block' : 'none';
      });
    }

    return div;
  }

  function _renderIncremental(ev) {
    if (!_eventMatchesFilter(ev) || !_eventMatchesSearch(ev)) return;
    const list = document.getElementById('telemList');
    if (!list) return;
    const node = _renderEvent(ev);
    list.appendChild(node);

    // Keep list size bounded in DOM (last 250 visible)
    while (list.childElementCount > 250) {
      list.firstElementChild.remove();
    }
    if (autoScroll) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function _renderAll() {
    const list = document.getElementById('telemList');
    if (!list) return;
    list.innerHTML = '';
    const filtered = events.filter(e => _eventMatchesFilter(e) && _eventMatchesSearch(e));
    const slice = filtered.slice(-250);
    for (const ev of slice) {
      list.appendChild(_renderEvent(ev));
    }
    if (autoScroll) list.scrollTop = list.scrollHeight;
    _updateCountBadge();
  }

  function _updateCountBadge() {
    const badge = document.getElementById('telemCountBadge');
    if (!badge) return;
    const filtered = events.filter(e => _eventMatchesFilter(e) && _eventMatchesSearch(e));
    badge.textContent = filtered.length + ' / ' + events.length;
  }

  // --------- Panel UI ---------

  function _buildPanel() {
    if (document.getElementById('telemetry-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'telemetry-panel';
    panel.style.cssText = [
      'position:fixed',
      'left:42px',                                  // Past the rail
      'right:0',
      'bottom:0',
      'height:40vh',
      'background:var(--bg-secondary, #161616)',
      'border-top:1px solid var(--accent-primary, #ff6b00)',
      'box-shadow:0 -4px 16px rgba(0,0,0,0.4)',
      'z-index:200',
      'display:none',
      'flex-direction:column',
      'transition:transform 180ms ease-out',
      'transform:translateY(0)',
    ].join(';');

    panel.innerHTML = `
      <!-- Header bar with filters + controls -->
      <div id="telemHeader" style="display:flex; align-items:center; gap:6px; padding:6px 10px; background:var(--bg-tertiary, #1f1f1f); border-bottom:1px solid var(--border-color, rgba(255,255,255,0.06)); flex-shrink:0;">
        <span style="font-size:11px; font-weight:600; letter-spacing:0.5px; color:var(--accent-primary, #ff6b00); text-transform:uppercase; flex-shrink:0;">Telemetry</span>
        <span id="telemCountBadge" style="font-size:10px; color:var(--text-tertiary, #777); flex-shrink:0;">0 / 0</span>
        <input type="text" id="telemSearch" placeholder="Search…" style="flex:1; min-width:60px; padding:3px 8px; font-size:11px; background:var(--bg-input, rgba(255,255,255,0.04)); border:1px solid var(--border-color, rgba(255,255,255,0.10)); border-radius:4px; color:var(--text-primary, #fff);">
        <button id="telemPauseBtn" title="Pause auto-scroll" style="flex-shrink:0; padding:3px 8px; font-size:10px; background:var(--bg-input); color:var(--text-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;">⏸ Auto-scroll</button>
        <button id="telemCopyBtn" title="Copy filtered events to clipboard" style="flex-shrink:0; padding:3px 8px; font-size:10px; background:var(--bg-input); color:var(--text-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;">Copy</button>
        <button id="telemClearBtn" title="Clear buffer" style="flex-shrink:0; padding:3px 8px; font-size:10px; background:var(--bg-input); color:var(--text-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;">Clear</button>
        <button id="telemCloseBtn" title="Close panel" style="flex-shrink:0; padding:3px 8px; font-size:14px; background:transparent; color:var(--text-secondary); border:none; cursor:pointer; line-height:1;">×</button>
      </div>

      <!-- Filter chips -->
      <div id="telemFilters" style="display:flex; flex-wrap:wrap; gap:4px; padding:5px 10px; background:var(--bg-secondary); border-bottom:1px solid var(--border-color, rgba(255,255,255,0.06)); flex-shrink:0;">
      </div>

      <!-- Event list -->
      <div id="telemList" style="flex:1; overflow-y:auto; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding:4px 0;"></div>

      <!-- Footer / hint -->
      <div style="padding:4px 10px; font-size:10px; color:var(--text-tertiary, #777); background:var(--bg-tertiary, #1f1f1f); border-top:1px solid var(--border-color, rgba(255,255,255,0.06)); flex-shrink:0;">
        Click any row to expand payload. Verbosity set in Settings.
      </div>
    `;
    document.body.appendChild(panel);

    _buildFilterChips();
    _wirePanelControls();
  }

  function _buildFilterChips() {
    const filtersBar = document.getElementById('telemFilters');
    if (!filtersBar) return;
    const chips = [
      { id: 'all', label: 'All' },
      { id: 'errors', label: 'Errors+Warn' },
      { id: 'llm', label: 'LLM' },
      { id: 'skill', label: 'Skills' },
      { id: 'platform', label: 'Platform' },
      { id: 'memory', label: 'Memory' },
      { id: 'page', label: 'Page' },
      { id: 'lifecycle', label: 'Lifecycle' },
      { id: 'cdp', label: 'CDP' },
      { id: 'network', label: 'Network' },
      { id: 'storage', label: 'Storage' },
    ];
    filtersBar.innerHTML = chips.map(c =>
      `<button class="telem-chip" data-filter="${c.id}" style="padding:2px 8px; font-size:10px; background:${c.id === activeFilter ? 'var(--accent-primary, #ff6b00)' : 'var(--bg-input, rgba(255,255,255,0.04))'}; color:${c.id === activeFilter ? '#fff' : 'var(--text-secondary, #aaa)'}; border:1px solid ${c.id === activeFilter ? 'var(--accent-primary, #ff6b00)' : 'var(--border-color, rgba(255,255,255,0.10))'}; border-radius:10px; cursor:pointer;">${c.label}</button>`
    ).join('');
    filtersBar.querySelectorAll('.telem-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        _buildFilterChips();
        _renderAll();
      });
    });
  }

  function _wirePanelControls() {
    const searchInput = document.getElementById('telemSearch');
    if (searchInput) {
      let _searchDebounce = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => {
          searchQuery = searchInput.value.trim();
          _renderAll();
        }, 150);
      });
    }
    const pauseBtn = document.getElementById('telemPauseBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        autoScroll = !autoScroll;
        pauseBtn.textContent = autoScroll ? '⏸ Auto-scroll' : '▶ Auto-scroll';
        if (autoScroll) {
          const list = document.getElementById('telemList');
          if (list) list.scrollTop = list.scrollHeight;
        }
      });
    }
    const copyBtn = document.getElementById('telemCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const filtered = events.filter(e => _eventMatchesFilter(e) && _eventMatchesSearch(e));
        const text = filtered.map(e =>
          _formatTs(e.ts) + ' [' + e.level + '/' + e.category + '] ' + e.message +
          (e.payload ? '  ' + JSON.stringify(e.payload) : '')
        ).join('\n');
        try {
          navigator.clipboard.writeText(text);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
        } catch (e) {}
      });
    }
    const clearBtn = document.getElementById('telemClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        events.length = 0;
        const list = document.getElementById('telemList');
        if (list) list.innerHTML = '';
        _updateCountBadge();
      });
    }
    const closeBtn = document.getElementById('telemCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', togglePanel);
    }

    // Detect user scroll to pause auto-scroll
    const list = document.getElementById('telemList');
    if (list) {
      list.addEventListener('scroll', () => {
        const nearBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 40;
        if (!nearBottom && autoScroll) {
          autoScroll = false;
          const pauseBtn = document.getElementById('telemPauseBtn');
          if (pauseBtn) pauseBtn.textContent = '▶ Auto-scroll';
        } else if (nearBottom && !autoScroll) {
          autoScroll = true;
          const pauseBtn = document.getElementById('telemPauseBtn');
          if (pauseBtn) pauseBtn.textContent = '⏸ Auto-scroll';
        }
      });
    }
  }

  function togglePanel() {
    _buildPanel();
    const panel = document.getElementById('telemetry-panel');
    if (!panel) return;
    panelOpen = panel.style.display === 'flex';
    if (panelOpen) {
      panel.style.display = 'none';
      panelOpen = false;
    } else {
      panel.style.display = 'flex';
      panelOpen = true;
      _renderAll();
    }
  }

  // --------- Subscribe ---------

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'telemetry_event') {
        _addEvent(message);
      }
    });
  } catch (e) {}

  // --------- Wire rail button ---------

  function init() {
    const railBtn = document.getElementById('telemetryRailBtn');
    if (railBtn) railBtn.addEventListener('click', togglePanel);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for keyboard shortcut / command-palette integration later
  try {
    window.__sentinelTelemetry = { toggle: togglePanel, eventCount: () => events.length };
  } catch (e) {}
})();
