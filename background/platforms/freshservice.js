// background/platforms/freshservice.js
// Freshservice (Freshworks ITSM) — v21.7.0
//
// Freshservice is a per-tenant subdomain SPA (<tenant>.freshservice.com) built
// around ITIL objects: Tickets (incidents/service requests), Problems, Changes,
// Releases, Assets (CMDB), and Solutions (KB). Agent-facing URLs live under /a/;
// the older helpdesk routes are still reachable and are treated the same here.

const _FS_HOST_RE = /(^|\.)freshservice\.com$/i;
const _FS_GOAL_RE = /\b(?:freshservice|fresh\s+service|freshworks\s+itsm)\b/i;

export const freshservice = {
  priority: 195,
  id: 'freshservice',
  label: 'Freshservice (ITSM)',
  memoryKeyPrefix: 'fs_',

  detect(url, goal) {
    if (!url && !goal) return false;
    try {
      if (_FS_HOST_RE.test(new URL(url).hostname)) return true;
    } catch (_e) { /* fall through to goal matching */ }
    return _FS_GOAL_RE.test(String(goal || ''));
  },

  pageTypes: [
    { name: 'fs-tickets', urlMatch: /\/a\/tickets\/filters|\/helpdesk\/tickets$|\/a\/tickets$/i, hint: 'Ticket list. Left rail holds saved filters/views; bulk actions appear once rows are checked.' },
    { name: 'fs-ticket', urlMatch: /\/a\/tickets\/\d+|\/helpdesk\/tickets\/\d+/i, hint: 'Ticket detail. Properties panel on the right (Status, Priority, Group, Agent, Category). Reply and Add Note are separate actions — Note can be public or private.' },
    { name: 'fs-problems', urlMatch: /\/a\/problems/i, hint: 'Problems. Root-cause records linked to one or more incidents.' },
    { name: 'fs-changes', urlMatch: /\/a\/changes/i, hint: 'Changes. Planning, risk, and approval workflow tabs. A change usually cannot progress until approvals are recorded.' },
    { name: 'fs-releases', urlMatch: /\/a\/releases/i, hint: 'Releases. Build and rollout records, typically linked to changes.' },
    { name: 'fs-assets', urlMatch: /\/a\/assets|\/cmdb/i, hint: 'Assets (CMDB). Each asset has type, impact, and relationships to other CIs.' },
    { name: 'fs-solutions', urlMatch: /\/a\/solutions|\/support\/solutions/i, hint: 'Solutions (knowledge base). Category > folder > article hierarchy; articles have a draft/published state.' },
    { name: 'fs-catalog', urlMatch: /\/a\/catalog|service_catalog/i, hint: 'Service catalogue. Request items with their own forms and approval flows.' },
    { name: 'fs-admin', urlMatch: /\/a\/admin/i, hint: 'Admin. Workflow automator, SLA policies, agent and group configuration.' },
    { name: 'fs-dashboard', urlMatch: /\/a\/dashboard|\/a\/reports/i, hint: 'Dashboards and analytics.' },
  ],

  knownSelectors: {
    newTicket: 'a[href*="tickets/new"], button[data-test-id*="new" i]',
    ticketRows: '[data-test-id*="ticket-row"], .ticket-list__item, tr[data-ticket-id]',
    propertiesPanel: '.ticket-properties, [data-test-id*="properties" i], aside',
    statusField: '[data-test-id*="status" i], select[name*="status" i]',
    replyButton: 'button[data-test-id*="reply" i], .reply-button',
    noteButton: 'button[data-test-id*="note" i], .add-note',
    searchBox: 'input[type="search"], [placeholder*="Search" i]',
  },

  waitStrings: ['Loading', 'Please wait', 'Saving'],

  commitFlow: 'Property changes in the right-hand panel save individually and show a brief toast; there is no single Save for the page. Replies and notes only send when their own Send/Add button is clicked. Wait for the toast or the updated activity entry before treating a change as applied.',

  sessionExpiredText: ['Your session has expired', 'Sign in to your account', 'Please log in'],

  knownGotchas: [
    'The tenant subdomain is account-specific (<tenant>.freshservice.com). Take it from the current tab — never construct a URL against a guessed tenant.',
    'Reply and Note are different actions with different visibility. A Note defaults to private; a Reply emails the requester. Choosing wrong either leaks internal commentary or silently fails to notify.',
    'The ticket list is filter-scoped. A ticket missing from the view is usually filtered out, not absent — clear or widen the filter before reporting it does not exist.',
    'Status names are configurable per tenant. Read the actual dropdown options rather than assuming the defaults (Open / Pending / Resolved / Closed).',
    'Changes gate on approvals. A change that will not move to the next stage is normally awaiting an approver, not broken.',
  ],

  liveDataCaveats: 'List views paginate at 30 by default and are filter-scoped, so a count read off one page is not the total. Use the reported result count rather than counting rows.',

  workflowHints: [
    {
      match: /ticket.*status|update.*ticket|change.*status|close.*ticket|resolve.*ticket/i,
      hint: 'Phase 1: Open the ticket, by id in the URL or via search. Phase 2: In the right-hand properties panel set Status (and Group/Agent if asked). Phase 3: Wait for the save toast. Phase 4: Confirm the activity feed records the change before reporting success. Save ticket id and final status to memory key fs_ticket_<id>.',
    },
    {
      match: /create.*ticket|new.*ticket|log.*incident|raise.*request/i,
      hint: 'Phase 1: Click New > Ticket. Phase 2: Set Requester first — it drives department and asset associations. Phase 3: Fill Subject, Description, Category, Priority, and Group. Phase 4: Create, then read the new ticket id from the URL and save it to memory key fs_new_ticket.',
    },
    {
      match: /reply|respond.*ticket|note.*ticket|update.*requester|add.*note/i,
      hint: 'Phase 1: Open the ticket. Phase 2: Decide deliberately between Reply (emails the requester) and Add Note (internal by default) — confirm which the goal intends before acting. Phase 3: Compose, then click the action button. Phase 4: Verify the entry appears in the activity feed with the expected public/private marker.',
    },
    {
      match: /asset|cmdb|configuration.*item|hardware.*list|device.*inventory/i,
      hint: 'Phase 1: Open Assets. Phase 2: Filter by asset type, department, or search by name/serial. Phase 3: Open the asset for display name, asset tag, type, impact, assigned user, and location. Phase 4: Check the Relationships tab for dependent CIs when the goal concerns impact. Save to memory key fs_asset_<name>.',
    },
    {
      match: /change.*request|approval|cab|change.*management|schedule.*change/i,
      hint: 'Phase 1: Open Changes and locate the record. Phase 2: Read planning fields — reason, impact, risk, and the planned start/end. Phase 3: Check the Approvals tab for who has approved and who is outstanding; a stalled change is almost always waiting on an approver. Phase 4: Report status, blocking approver, and planned window. Save to memory key fs_change_<id>.',
    },
    {
      match: /sla|breach|overdue|response.*time|resolution.*time/i,
      hint: 'Phase 1: Open the ticket list and filter to the relevant group or view. Phase 2: Sort by Due By, or apply an overdue filter. Phase 3: For each breaching ticket capture id, subject, priority, agent, and how far past due it is. Phase 4: Read the SLA policy from the ticket to explain which target applied. Save to memory key fs_sla_breaches.',
    },
  ],
};
