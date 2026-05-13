// background/platforms/datto_rmm.js
// Datto RMM + Autotask PSA — v3.38.0
//
// Covers:
//   - Datto RMM (centrastage.net / dattormm.com) — Angular SPA, left sidebar
//   - Autotask PSA (autotask.net) — separate product, integrated with Datto RMM
//
// Both products are owned by Kaseya. They are separate UIs; detect() covers
// both so the agent gets relevant hints whichever surface is open.

export const dattoRmm = {
  id: 'datto_rmm',
  label: 'Datto RMM / Autotask PSA',
  memoryKeyPrefix: 'datto_',

  detect(url, goal) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (/centrastage\.net|dattormm\.com|datto\.com\/rmm/i.test(host)) return true;
      if (/autotask\.net|atask\.net/i.test(host)) return true;
    } catch (e) {}
    return /\b(?:datto\s+rmm|autotask|centrastage|datto\s+rmm)\b/i.test(String(goal || ''));
  },

  pageTypes: [
    // Datto RMM pages
    { name: 'datto-sites',       urlMatch: /\/sites|\/site$/i,                   hint: 'Datto RMM Sites list. All managed client sites. Click site to enter.' },
    { name: 'datto-devices',     urlMatch: /\/devices|\/device$/i,               hint: 'Datto RMM device list for the current site. Filter by status, type, agent version.' },
    { name: 'datto-device',      urlMatch: /\/device\/\d+|deviceId=\d+/i,        hint: 'Individual device. Tabs: Overview, Activity, Alerts, Software, Quick Jobs.' },
    { name: 'datto-alerts',      urlMatch: /\/alerts|\/alert$/i,                 hint: 'Alert queue. Unresolved / resolved. Mass-acknowledge via checkbox + action bar.' },
    { name: 'datto-jobs',        urlMatch: /\/jobs|\/job$/i,                     hint: 'Scheduled and quick jobs. Run a component/script on devices here.' },
    { name: 'datto-policies',    urlMatch: /\/policies|\/policy$/i,              hint: 'Policy management. Monitoring, patching, and backup policies.' },
    { name: 'datto-components',  urlMatch: /\/components|\/component$/i,         hint: 'Component library. Scripts, monitors, software installers.' },

    // Autotask PSA pages
    { name: 'at-dashboard',      urlMatch: /autotask.*\/#dashboard|\/Dispatcher/i, hint: 'Autotask dashboard. My Tickets widget, dispatch calendar.' },
    { name: 'at-tickets',        urlMatch: /autotask.*\/Ticket|ServiceDesk/i,      hint: 'Autotask ticket queue. Filter by queue, status, assignee.' },
    { name: 'at-ticket-detail',  urlMatch: /autotask.*\/Ticket\/\d+/i,             hint: 'Individual Autotask ticket. Time entries on the Time & Expense tab.' },
    { name: 'at-companies',      urlMatch: /autotask.*\/Account|\/Company/i,       hint: 'Autotask accounts (companies). Search by name.' },
    { name: 'at-projects',       urlMatch: /autotask.*\/Project/i,                 hint: 'Autotask projects. Milestones and tasks.' },
  ],

  knownSelectors: {
    // Datto RMM global chrome
    leftNav:                   '.sidenav, [id*="sidebar"], nav.left-nav, .sidebar-container',
    searchBox:                 'input[placeholder*="Search" i], input[type="search"]',
    siteSelector:              '.site-selector, [data-test="site-selector"], select[name*="site" i]',

    // Device list
    deviceTable:               'table.devices-table, [data-test="devices-grid"], .device-list',
    deviceRow:                 'tr[data-device-id], tr.device-row, [data-test="device-row"]',
    deviceName:                'td[data-field="hostname"], td.device-name, [data-test="device-name"]',
    deviceStatusIcon:          'td[data-field="status"] .icon, .status-indicator, [data-test="device-status"]',

    // Alert management
    alertTable:                '.alerts-table, [data-test="alerts-grid"]',
    alertRow:                  'tr[data-alert-id], tr.alert-row',
    alertCheckbox:             'input[type="checkbox"][data-row], td.checkbox-cell input',
    alertAckBtn:               'button:has-text("Acknowledge"), button[data-test="ack-alert"], [title*="Acknowledge" i]',
    alertResolveBtn:           'button:has-text("Resolve"), button[data-test="resolve-alert"]',
    alertCreateTicketBtn:      'button:has-text("Create Ticket"), [data-test="create-ticket"]',

    // Quick Jobs / Run Script
    quickJobBtn:               'button:has-text("Quick Job"), button[data-test="quick-job"], [title*="Quick Job" i]',
    componentSelect:           'select[name="component"], [data-test="component-select"]',
    jobRunBtn:                 'button[type="submit"]:has-text("Run"), button[data-test="run-job"]',
    jobOutputPane:             '.job-output, [data-test="job-output"], pre.output',

    // Autotask selectors
    atTicketGrid:              '.ticket-grid, #ticketTable, [id*="TicketTable"]',
    atTicketRow:               'tr[data-ticket-id], tr.ticketRow',
    atNewTicketBtn:            'button:has-text("New Ticket"), a:has-text("New"), [id*="newTicket"]',
    atTicketStatus:            'select[name*="Status"], [id*="Status"]',
    atTicketQueue:             'select[name*="Queue"], [id*="Queue"]',
    atSaveBtn:                 'button:has-text("Save"), [id*="Save"], input[type="submit"][value*="Save" i]',
    atTimeEntryTab:            'a[href*="TimeEntry"], li[data-tab="time"]',
    atAddTimeBtn:              'button:has-text("Add Time"), button:has-text("Add"), [id*="addTime"]',
  },

  commandInterface: {
    // Datto RMM Quick Job → run a component/script on the device
    inputSelector:    '.code-editor textarea, [data-test="script-input"], textarea[name="script"]',
    typeSelect:       'select[name="language"], [data-test="script-language"]',
    submitSelector:   'button[type="submit"]:has-text("Run"), button[data-test="run-job"]',
    outputSelector:   '.job-output, [data-test="job-output"], pre.output',
    outputReadyText:  'Completed',
    outputTimeoutMs:  30000,
    commandTypes: {
      powershell: 'PowerShell',
      cmd:        'Batch',
      bash:       'Shell',
    },
  },

  waitStrings: {
    pageReady:       'Dashboard',
    commandComplete: 'Completed',
    loginPrompt:     'Username',
  },

  commitFlow: ['Save', 'Apply'],
  sessionExpiredText: 'Your session has expired',

  hints: [
    'Datto RMM uses Angular dropdowns — click to open, then click the desired option.',
    'To run a quick job on a device: open the device, click Quick Jobs or the Run button, select the component, click Run.',
    'Alert bulk actions: check the checkboxes in the alert list, then use the toolbar (Acknowledge, Resolve, Create Ticket).',
    'Autotask PSA is a separate product from Datto RMM — it has its own login at autotask.net.',
    'Autotask uses ASP.NET custom controls — click to open dropdowns, type to search in lookup fields.',
    'Time entries in Autotask are on the "Time & Expense" tab of each ticket.',
  ],

  mismatchHints: [
    { pattern: /autotask/i, onbox: 'Autotask PSA', nsm: 'Autotask is a different product from Datto RMM. They share Kaseya ownership but are separate UIs.' },
  ],
};
