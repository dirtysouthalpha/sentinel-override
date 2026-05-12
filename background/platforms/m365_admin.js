// background/platforms/m365_admin.js
// Microsoft 365 admin surfaces — v3.22.0 (expanded with full selectors)
//
// Covers admin.microsoft.com, admin.cloud.microsoft, entra.microsoft.com,
// admin.exchange.microsoft.com, security.microsoft.com, purview.microsoft.com,
// intune.microsoft.com, compliance.microsoft.com, defender.microsoft.com,
// portal.azure.com (overlap), and login.microsoftonline.com (auth wall).
//
// MSP failure mode this profile addresses: each sub-portal has its own DOM,
// its own routing, its own iframe boundaries. Without per-portal selectors,
// the agent flails on goals like "run a message trace" because the elements
// it expects on M365 Admin Center root aren't there — they're inside the
// Exchange admin sub-portal. The `inferSurface` heuristic + pageTypes
// classifier guide it to the right surface first.

export const m365Admin = {
  id: 'm365_admin',
  label: 'Microsoft 365 admin surfaces',
  memoryKeyPrefix: 'm365_',

  detect(url, goal) {
    if (!url) return false;
    try {
      const host = new URL(url).host.toLowerCase();
      const m365Hosts = [
        'admin.microsoft.com', 'admin.cloud.microsoft',
        'entra.microsoft.com', 'aad.portal.azure.com',
        'admin.exchange.microsoft.com', 'outlook.office.com',
        'security.microsoft.com', 'purview.microsoft.com',
        'compliance.microsoft.com', 'defender.microsoft.com',
        'intune.microsoft.com', 'endpoint.microsoft.com',
        'portal.azure.com', 'login.microsoftonline.com'
      ];
      if (m365Hosts.some(h => host === h || host.endsWith('.' + h))) return true;
    } catch (e) {}
    return /\b(m365|microsoft\s*365|entra|exchange\s+admin|purview|defender|intune)\b/i.test(String(goal || ''));
  },

  inferSurface(goal) {
    const t = String(goal || '').toLowerCase();
    if (/(message\s+trace|mail\s+flow|shared\s+mailbox|exchange|smtp|connector|transport\s+rule|distribution\s+(?:list|group))/i.test(t)) return 'exchange';
    if (/(sign.?in\s+log|conditional\s+access|app\s+password|service\s+principal|enterprise\s+app|entra|aad|azure\s+ad|named\s+location|mfa\s+enforcement)/i.test(t)) return 'entra';
    if (/(audit\s+log|purview|ediscovery|retention\s+policy|data\s+loss|dlp|sensitivity\s+label)/i.test(t)) return 'purview';
    if (/(defender|threat\s+hunt|incident|alert|kql|advanced\s+hunting|secure\s+score)/i.test(t)) return 'defender';
    if (/(intune|endpoint|device\s+config|compliance\s+policy|app\s+protection)/i.test(t)) return 'intune';
    return 'admin';
  },

  surfaceUrls: {
    admin: 'https://admin.cloud.microsoft/',
    entra: 'https://entra.microsoft.com/',
    exchange: 'https://admin.exchange.microsoft.com/',
    purview: 'https://purview.microsoft.com/',
    defender: 'https://security.microsoft.com/',
    intune: 'https://intune.microsoft.com/',
  },

  // (3.22.0) Page-type classifiers per sub-portal. urlMatch fires when the
  // current URL matches; the hint primes the LLM about what's available.
  pageTypes: [
    { name: 'login-wall',         urlMatch: /login\.microsoftonline\.com/i, hint: 'Microsoft sign-in wall. v3.14.1 sign-in detector should fire here; user must sign in manually.' },
    { name: 'admin-home',         urlMatch: /admin\.(cloud\.microsoft|microsoft\.com)\/?(?:#|$)/i, hint: 'M365 Admin Center root. Cards for Users, Teams, Billing, Setup. Drill into a section for full controls.' },
    { name: 'admin-users',        urlMatch: /admin\.(cloud\.microsoft|microsoft\.com)\/.*\/users\//i, hint: 'M365 user list with search, filters, license assignment.' },
    { name: 'admin-groups',       urlMatch: /admin\.(cloud\.microsoft|microsoft\.com)\/.*\/groups/i, hint: 'M365 groups list (Microsoft 365 groups, distribution lists, security groups).' },
    { name: 'entra-home',         urlMatch: /entra\.microsoft\.com\/?(?:#|$)/i, hint: 'Entra ID root. Sidebar nav: Users, Groups, Identity Protection, Conditional Access, Monitoring & health.' },
    { name: 'entra-users',        urlMatch: /entra\.microsoft\.com\/.*\/(?:Users|users)/i, hint: 'Entra users list. Click a user to see profile + sign-in logs + assigned apps.' },
    { name: 'entra-signins',      urlMatch: /entra\.microsoft\.com\/.*\/(?:SignIns|sign-?in)/i, hint: 'Sign-in logs. Filter by user, date, status (success/failure), conditional access status.' },
    { name: 'entra-cond-access',  urlMatch: /entra\.microsoft\.com\/.*\/(?:ConditionalAccess|conditional-?access)/i, hint: 'Conditional Access policies. Listing + per-policy assignments & conditions.' },
    { name: 'exchange-home',      urlMatch: /admin\.exchange\.microsoft\.com\/?(?:#|$)/i, hint: 'Exchange admin center root. Sidebar: Recipients, Mail flow, Roles & permissions, Reports.' },
    { name: 'exchange-mailflow',  urlMatch: /admin\.exchange\.microsoft\.com\/.*\/(?:mailflow|message)/i, hint: 'Mail flow > Message trace, connectors, transport rules.' },
    { name: 'exchange-trace',     urlMatch: /admin\.exchange\.microsoft\.com\/.*\/messagetrace/i, hint: 'Message trace tool. Date range + sender/recipient filters required to populate.' },
    { name: 'exchange-mailboxes', urlMatch: /admin\.exchange\.microsoft\.com\/.*\/(?:Mailboxes|recipients)/i, hint: 'Mailboxes / Shared mailboxes list. Click a row to edit permissions, delegates, mail flow.' },
    { name: 'purview-home',       urlMatch: /purview\.microsoft\.com\/?(?:#|$)/i, hint: 'Purview portal root. Audit, eDiscovery, DLP, Records management.' },
    { name: 'purview-audit',      urlMatch: /purview\.microsoft\.com\/audit/i, hint: 'Audit log search. Note: /audit/auditsearch is the correct path (NOT /auditlogsearch). 5-60 min delay after events.' },
    { name: 'defender-home',      urlMatch: /security\.microsoft\.com\/?(?:#|$)/i, hint: 'Defender XDR portal. Incidents & alerts, advanced hunting (KQL), threat analytics.' },
    { name: 'defender-incidents', urlMatch: /security\.microsoft\.com\/incidents/i, hint: 'Incidents list. Click an incident to drill into linked alerts + entities.' },
    { name: 'defender-hunting',   urlMatch: /security\.microsoft\.com\/(?:advanced-?hunting|hunting)/i, hint: 'Advanced Hunting with KQL editor. Save queries as scheduled hunts or detection rules.' },
    { name: 'intune-home',        urlMatch: /(?:intune|endpoint)\.microsoft\.com\/?(?:#|$)/i, hint: 'Intune root. Devices, Apps, Endpoint security, Reports.' },
    { name: 'azure-portal',       urlMatch: /portal\.azure\.com/i, hint: 'Azure portal — overlaps with Entra/Defender. Use service-specific portals when possible (faster, narrower).' },
  ],

  // (3.22.0) Known selectors. NOTE: M365 admin portals heavily use Web
  // Components, custom Angular widgets, and cross-origin iframes. Many
  // tables you'd want to scrape are inside iframes that block DOM access.
  // The recommended fallback is `read_network_requests` filtering for the
  // underlying graph.microsoft.com / outlook.office.com calls — those return
  // the same data as the UI in clean JSON.
  knownSelectors: {
    // Generic chrome
    leftNav:                  'nav[role="navigation"], .ms-Nav, [class*="sidebar"][class*="nav"]',
    pageTitle:                'h1, [role="heading"][aria-level="1"], .page-title',
    searchBar:                'input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]',
    tenantSwitcher:           '[aria-label*="tenant" i], .tenant-picker, [class*="tenant-switcher"]',

    // M365 Admin Center
    adminUsersListTable:      'table[aria-label*="users" i], .ms-DetailsList',
    adminUserRow:             'div[role="row"][aria-rowindex], tr[data-user-id]',
    adminUserSearchInput:     'input[placeholder*="Search active users" i], input[aria-label*="Search users" i]',
    adminAddUserButton:       'button[aria-label="Add a user" i], button:has-text("Add a user")',
    adminLicensesTab:         '[role="tab"][aria-label*="license" i], button:has-text("Licenses")',

    // Entra ID
    entraUsersTable:          '[role="grid"][aria-label*="users" i], .azc-grid-data',
    entraUserSearchInput:     'input[placeholder*="Search" i][placeholder*="user" i]',
    entraSignInsTable:        '[role="grid"][aria-label*="sign-?in" i]',
    entraSignInsDateFilter:   'button[aria-label*="date" i][aria-label*="filter" i], .azc-date-range-picker',
    entraSignInsUserFilter:   'input[aria-label*="user" i][aria-label*="filter" i]',
    entraCondAccessList:      '[role="grid"][aria-label*="policies" i], .ca-policy-list',
    entraCondAccessNewBtn:    'button[aria-label="New policy" i], button:has-text("New policy")',

    // Exchange admin
    exchangeRecipientsTable:  '.ag-root, [role="grid"][aria-label*="mailbox" i]',
    exchangeMessageTraceForm: 'form[aria-label*="message trace" i], .message-trace-form',
    exchangeDateRangeInput:   'input[type="date"], .date-range-picker input',
    exchangeSenderInput:      'input[aria-label*="sender" i], input[name*="sender" i]',
    exchangeRecipientInput:   'input[aria-label*="recipient" i], input[name*="recipient" i]',
    exchangeMessageTraceRun:  'button[aria-label="Search" i][type="submit"], button:has-text("Run trace")',

    // Purview
    purviewAuditSearchForm:   'form[aria-label*="audit" i], .audit-search-form',
    purviewAuditStartDate:    'input[aria-label*="start date" i]',
    purviewAuditEndDate:      'input[aria-label*="end date" i]',
    purviewAuditUserFilter:   'input[aria-label*="user" i], input[name="userIds"]',
    purviewAuditActivityFilter:'input[aria-label*="activit" i], select[name*="operation" i]',
    purviewAuditSearchBtn:    'button[aria-label="Search" i], button:has-text("Search")',

    // Defender
    defenderIncidentsTable:   '[role="grid"][aria-label*="incidents" i]',
    defenderIncidentRow:      'div[role="row"][aria-rowindex]:not([aria-rowindex="1"])',
    defenderKqlEditor:        '.monaco-editor, .kql-editor textarea',
    defenderKqlRunBtn:        'button[aria-label*="Run query" i], button:has-text("Run query")',

    // Common dialog patterns
    dialogOkButton:           'div[role="dialog"] button[type="submit"], div[role="dialog"] .primary, button[aria-label="Save" i]',
    dialogCancelButton:       'div[role="dialog"] button[aria-label="Cancel" i]',
    confirmYesButton:         'button[aria-label="Yes" i], button[aria-label="Confirm" i]',

    // Iframe boundaries — most admin tables ARE in iframes
    primaryIframe:            'iframe[id*="iframe"], iframe[src*="microsoft"], iframe[title*="content" i]',
  },

  waitStrings: {
    tenantLoaded:           ['Welcome', 'Microsoft 365 admin center', 'Active users', 'Total users', 'Dashboard'],
    signInLogsPopulated:    ['User sign-ins', 'Failure', 'Success', 'Conditional Access', 'No sign-ins'],
    messageTraceResults:    ['Found', 'message(s)', 'Delivered', 'Pending', 'Failed', 'Quarantined', 'No results'],
    auditSearchResults:     ['Activities', 'User', 'Operation', 'Object', 'records returned', 'No results'],
    saveSucceeded:          ['saved', 'updated', 'created', 'success', 'has been', 'successfully'],
    saveFailed:             ['error', 'failed', 'cannot', "couldn't", 'permission'],
    sessionExpired:         ['Sign in again', 'session has expired', 'Please sign in'],
  },

  mismatchHints: [
    {
      pattern: /\b(message\s+trace|mail\s+flow|shared\s+mailbox)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'admin.exchange.microsoft.com (Exchange admin center) — Mail Flow > Message Trace, Recipients > Mailboxes > Shared'
    },
    {
      pattern: /\b(sign.?in\s+log|conditional\s+access|app\s+password|named\s+location)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'entra.microsoft.com — Sign-in logs under Monitoring & health > Sign-in logs; Conditional Access under Protection > Conditional Access'
    },
    {
      pattern: /\b(audit\s+log|ediscovery|retention|dlp)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'purview.microsoft.com — Audit at /audit/auditsearch (NOT /auditlogsearch); eDiscovery at /ediscovery'
    },
  ],

  needsTargetSelection: false,
  preflightInstructions: '',

  liveDataCaveats: [
    'M365 audit log search results can take 5-60 minutes to surface after an event — if a recent event is missing, retry in 15 min, not in 30 seconds.',
    'Sign-in logs typically populate within 5 minutes; conditional access decisions appear immediately on sign-in success/failure.',
    'Cross-portal navigation: each surface (Entra / Exchange / Purview / Defender) is a separate SPA. Use open_tab labels to keep tabs straight.',
    'Sign-in popups on login.microsoftonline.com pause the agent (3.14.1 sign-in wall detector). Complete auth manually.',
    'Most admin tables render inside cross-origin iframes that block direct DOM scraping. Use read_network_requests with url_includes: "graph.microsoft.com|outlook.office.com" to capture the underlying API JSON.',
  ].join(' '),

  knownGotchas: [
    'Tenant lockdown (3.7.0) auto-flags wrong-tenant work — set Expected Microsoft tenant in Settings before sensitive operations.',
    'Some menus have moved: Purview Audit is /audit/auditsearch NOT /auditlogsearch; Defender alerts are now under Incidents & Alerts.',
    'Power Platform admin and Teams admin are SEPARATE portals: admin.powerplatform.microsoft.com and admin.teams.microsoft.com.',
    'M365 Admin Center loads heavy bundles; expect 3-8s on first navigation. Use wait_for_text against "Active users" or section header before reading.',
    'Exchange admin uses ag-grid (data tables with virtual scrolling). The DOM only contains the visible rows — scroll to load more, or use read_network_requests to capture the full result set.',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for M365 admin:
- Inspect the goal text to detect which surface it's really about (Exchange / Entra / Purview / Defender / Intune / generic admin).
- Add a Phase 0 navigate step to the correct sub-portal URL if the user's goal jumps into menus without specifying.
- Memory keys must begin with 'm365_' (or the more specific 'entra_', 'exchange_', 'purview_', 'defender_' as appropriate).
- When the goal asks for audit/sign-in/log data, prefer read_network_requests with graph.microsoft.com filter as a fallback for cross-origin iframe blockage.
- Wait_for_text on the tenant-loaded signal after navigation to avoid scraping a still-loading page.
- Preserve the user's deliverable structure exactly.`
};
