// background/platforms/screenconnect.js
// ConnectWise ScreenConnect (Control) — v3.37.0
//
// Covers the hosted cloud instance (instance.screenconnect.com) and on-premise
// deployments (any host with /Host#Access, /Host#Support, /Backstage paths).
// The web UI is a SPA built on Kendo UI. The command runner tab is accessed
// via the "Toolbox" tab inside an active session window.

export const screenconnect = {
  id: 'screenconnect',
  label: 'ConnectWise ScreenConnect (Control)',
  memoryKeyPrefix: 'screenconnect_',

  detect(url, goal) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (/screenconnect\.com|connectwise\.com\/control/i.test(host)) return true;
      if (/\/Host#Access|\/Host#Support|\/Backstage|\/Host#Join/i.test(u.href)) return true;
    } catch (e) {}
    return /\b(?:screenconnect|control\.connectwise|sc\.local|schost)\b/i.test(String(goal || ''));
  },

  pageTypes: [
    { name: 'sc-dashboard',   urlMatch: /\/Host#Access|\/Host$/i,            hint: 'ScreenConnect Access page. Lists all managed machines. Search box at top-right.' },
    { name: 'sc-support',     urlMatch: /\/Host#Support/i,                   hint: 'ScreenConnect Support queue. Active and waiting sessions.' },
    { name: 'sc-session',     urlMatch: /\/Backstage|Session\.aspx/i,         hint: 'Active session window. Toolbox tab provides command runner.' },
    { name: 'sc-admin',       urlMatch: /\/Administration/i,                  hint: 'ScreenConnect Admin panel. User roles, security, extensions.' },
    { name: 'sc-reports',     urlMatch: /\/Report/i,                          hint: 'ScreenConnect Reports.' },
  ],

  knownSelectors: {
    // Dashboard / machine list
    searchBox:             'input.filter-input, input[placeholder*="Filter" i], input[placeholder*="Search" i]',
    machineRow:            'tr.session-row, [data-session-id], .session-entry',
    connectBtn:            'a[title*="Join" i], button[title*="Connect" i], .join-session-link',
    machineNameCell:       'td.name-cell, [data-column="Name"], .session-name',

    // Session window (Backstage)
    toolboxTab:            '[data-tab="Toolbox"], .tab-label:has-text("Toolbox")',
    commandTypeSelect:     'select[name="commandType"], .command-type-select, #commandType',
    commandInput:          'textarea[name="command"], #commandInput, .command-input textarea',
    commandRunBtn:         'button[type="submit"]:has-text("Run"), input[value="Run"], .run-command-btn',
    commandOutput:         '#commandOutput, .command-output, pre.output',
    commandOutputLoading:  '.running-indicator, .spinner, [class*="loading"]',
  },

  commandInterface: {
    // Selectors for run_remote_command dispatch
    inputSelector:      'textarea[name="command"], #commandInput, .command-input textarea',
    typeSelect:         'select[name="commandType"], .command-type-select',
    submitSelector:     'button[type="submit"]:has-text("Run"), input[value="Run"], .run-command-btn',
    outputSelector:     '#commandOutput, .command-output, pre.output',
    outputReadyText:    null,            // No stable "done" text; rely on timeout
    outputTimeoutMs:    15000,
    commandTypes: {
      powershell: 'PowerShell',
      cmd:        'Command',
      bash:       'Shell',
    },
  },

  waitStrings: {
    sessionReady:    'Connected',
    commandComplete: null,
  },

  commitFlow: [],
  sessionExpiredText: 'Session has expired',

  hints: [
    'ScreenConnect sessions open in a new tab or popup window.',
    'To run a command: navigate to the active session, click the Toolbox tab, select the command type, enter the command, and click Run.',
    'The command output appears in the output pane below the input. Allow up to 15 seconds for results.',
    'Machine names in the access list are in the "Name" column. Use the search box to filter by name, IP, or tag.',
  ],
};
