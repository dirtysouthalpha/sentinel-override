// background/platforms/autotask.js
// Autotask PSA (Datto Autotask) — v21.7.0
//
// Autotask is served from numbered regional pods (ww1..ww19.autotask.net), so
// detection matches the domain rather than a fixed host. The UI is a frameset-era
// app modernised in place: a left module menu, grid views, and detail pages that
// open in tabs within the workspace. Primary MSP surfaces: Service Desk tickets,
// CRM companies/contacts, Contracts, Projects, and Time Entry.

const _AT_HOST_RE = /(^|\.)autotask\.(net|com)$/i;
const _AT_PATH_RE = /\/Mvc\/|\/Autotask\/|ServiceDesk|CRM\//i;
const _AT_GOAL_RE = /\b(?:autotask|datto\s+psa|at\s+psa)\b/i;

export const autotask = {
  priority: 115,
  id: 'autotask',
  label: 'Autotask PSA',
  memoryKeyPrefix: 'at_',

  detect(url, goal) {
    if (!url && !goal) return false;
    try {
      const u = new URL(url);
      if (_AT_HOST_RE.test(u.hostname)) return true;
      if (/autotask/i.test(u.hostname) && _AT_PATH_RE.test(u.pathname)) return true;
    } catch (_e) { /* fall through to goal matching */ }
    return _AT_GOAL_RE.test(String(goal || ''));
  },

  pageTypes: [
    { name: 'at-service-desk', urlMatch: /ServiceDesk|TicketGrid|\/Ticket\/Search/i, hint: 'Service Desk queue. Grid of tickets with a filter bar above it. Column headers sort. The New Ticket button sits in the toolbar.' },
    { name: 'at-ticket', urlMatch: /TicketDetail|\/Ticket\/\d+|ticketID=\d+/i, hint: 'Ticket detail. Tabs: General, Time Entries, Notes, Attachments, To-Dos. Status and queue are dropdowns in the header; Save is top-right and must be clicked or edits are lost.' },
    { name: 'at-companies', urlMatch: /CRM\/Search|AccountSearch|\/Company\/Search/i, hint: 'Company (Account) search. Filter by name, type, or territory.' },
    { name: 'at-company-detail', urlMatch: /AccountDetail|\/Company\/\d+|accountID=\d+/i, hint: 'Company record. Tabs: General, Contacts, Configuration Items, Contracts, Tickets, Opportunities.' },
    { name: 'at-contracts', urlMatch: /Contract|\/Contracts/i, hint: 'Contracts. Block hours, retainers, and recurring services with their remaining balances.' },
    { name: 'at-config-items', urlMatch: /ConfigurationItem|InstalledProduct/i, hint: 'Configuration Items (devices/assets) attached to a company.' },
    { name: 'at-projects', urlMatch: /Project|\/Projects/i, hint: 'Projects. Task list, phases, and Gantt view.' },
    { name: 'at-time-entry', urlMatch: /TimeEntry|Timesheet/i, hint: 'Time entry / timesheet. Hours are logged against a ticket, task, or contract.' },
    { name: 'at-dashboard', urlMatch: /Dashboard|\/Home|MyWorkspace/i, hint: 'Autotask workspace home. Widgets for my tickets, queues, and time.' },
  ],

  knownSelectors: {
    moduleMenu: '#MenuButton, .at-module-menu, [aria-label*="menu" i]',
    globalSearch: 'input[type="search"], #GlobalSearch, [placeholder*="Search" i]',
    saveButton: 'button[title*="Save" i], input[value="Save"], .at-save',
    gridRows: 'tr.GridRow, tr[id*="Row"], .at-grid-row',
    statusField: 'select[name*="Status" i], [aria-label*="Status" i]',
  },

  waitStrings: ['Loading', 'Please wait', 'Processing'],

  commitFlow: 'Autotask detail pages do not autosave. After changing any field, click Save (or Save & Close) in the toolbar and wait for the grid or detail header to refresh before treating the change as applied.',

  sessionExpiredText: ['Your session has expired', 'Please log in', 'Session Timeout'],

  knownGotchas: [
    'Autotask runs on numbered regional pods (ww1..ww19.autotask.net). The pod in the URL is account-specific — never assume ww1, follow whatever the current tab shows.',
    'Much of the older UI renders inside iframes. If an element cannot be found on the top document, look inside the content frame before concluding it is absent.',
    'Ticket numbers use the form T20260101.0001 (date-ordered), which is not the internal ticketID in the URL. Quote the T-number to humans and use the id for navigation.',
    'Leaving a detail page with unsaved edits raises a browser confirm dialog. Handle the dialog rather than treating the navigation as failed.',
  ],

  liveDataCaveats: 'Grid views cache. After creating or editing a ticket, refresh the grid before asserting the change is present — a stale grid will show the pre-edit values.',

  workflowHints: [
    {
      match: /ticket.*status|update.*ticket|change.*status|close.*ticket|resolve.*ticket/i,
      hint: 'Phase 1: Open Service Desk and locate the ticket, by T-number in global search or by filtering the queue. Phase 2: Open the ticket detail. Phase 3: Change Status (and Queue/Resource if asked) using the header dropdowns. Phase 4: Click Save and wait for the header to refresh. Verify the new status is displayed before reporting success. Save the T-number and final status to memory key at_ticket_<number>.',
    },
    {
      match: /create.*ticket|new.*ticket|log.*ticket|raise.*ticket/i,
      hint: 'Phase 1: From Service Desk, click New Ticket. Phase 2: Set Company first — it filters the Contact and Configuration Item pickers. Phase 3: Fill Title, Description, Priority, Queue, and Issue/Sub-Issue type. Phase 4: Save, then read back the generated T-number from the header and save it to memory key at_new_ticket.',
    },
    {
      match: /time.*entry|log.*time|enter.*hours|timesheet|billable/i,
      hint: 'Phase 1: Open the ticket or task the time belongs to. Phase 2: Use the Time Entries tab > New, or the global Time Entry form. Phase 3: Set date, hours, work type, and role — work type decides billability, so do not leave it defaulted. Phase 4: Add the summary notes, Save, and confirm the entry appears in the tab.',
    },
    {
      match: /contract|block.*hour|retainer|remaining.*hours|contract.*balance/i,
      hint: 'Phase 1: Open the company record via CRM. Phase 2: Contracts tab. Phase 3: Open the active contract and read period, block hours purchased, hours consumed, and remaining balance. Phase 4: Note the contract end date — an expiring contract is usually the reason the question is being asked. Save to memory key at_contract_<company>.',
    },
    {
      match: /configuration.*item|installed.*product|asset.*list|device.*list/i,
      hint: 'Phase 1: Open the company record. Phase 2: Configuration Items tab. Phase 3: Extract product name, serial number, reference title, and any warranty/expiry dates. Phase 4: Filter to Active items unless the goal explicitly asks for retired ones. Save to memory key at_config_items_<company>.',
    },
  ],
};
