// background/platforms/teams_admin.js
// Teams Admin Center platform profile — v3.45.0
//
// Covers admin.teams.microsoft.com — Teams app management, permission policies,
// setup policies, calling policies, meeting policies, and per-user policy
// assignment.
//
// MSP failure mode this profile addresses: Teams Admin Center is a SEPARATE
// portal from M365 Admin Center (admin.microsoft.com). The agent frequently
// tries to manage Teams app policies from the M365 admin center, which
// doesn't have those controls. This profile guides it to the right portal
// and provides the correct navigation paths for the most common MSP goals:
// checking app status (Allowed/Blocked), permission policies, setup policies,
// and per-user policy assignments.
//
// Copilot-specific knowledge: In Teams, Microsoft 365 Copilot appears as
// "Microsoft 365 Copilot" or "Copilot" in the app catalog. Its availability
// depends on: (1) app status in Manage apps, (2) permission policy allowing
// it, (3) setup policy pinning/installation, (4) user having a Copilot-
// capable license (M365 E3/E5, Business Premium/Standard with Copilot add-on).

// Precompile regex patterns for hot-path detection
const _TEAMS_GOAL_RE = /\b(teams\s+app|teams\s+admin|teams\s+polic(?:y|ies)|app\s+permission\s+polic(?:y|ies)|setup\s+polic(?:y|ies)|copilot.*teams|teams.*copilot|teams.*app.*status|teams.*manage.*apps)/i;
const _TEAMS_APP_STATUS_RE = /(check.*app.*status|is.*app.*blocked|copilot.*allowed|copilot.*blocked|manage.*apps|app.*catalog)/i;
const _TEAMS_PERMISSION_RE = /(permission.*polic|app.*permission.*polic|allow.*block.*app)/i;
const _TEAMS_SETUP_RE = /(setup.*polic|pinned.*apps|app.*installation|app.*pin)/i;
const _TEAMS_USER_RE = /(user.*polic|user.*assigned|nick.*polic|assigned.*polic.*user|per.user.*polic)/i;
const _TEAMS_MEETING_RE = /(meeting.*polic|teams.*meeting|lobby.*bypass|who.*bypass.*lobby)/i;
const _TEAMS_CALLING_RE = /(calling.*polic|call.*park|call.*forward|teams.*calling)/i;

export const teamsAdmin = {
  priority: 40,
  id: 'teams_admin',
  label: 'Teams Admin Center',
  memoryKeyPrefix: 'teams_',

  detect(url, goal) {
    if (!url && !goal) return false;
    try {
      const host = new URL(url).host.toLowerCase();
      if (host.includes('admin.teams.microsoft.com')) return true;
    } catch (_e) { /* fall through */ }
    if (goal && _TEAMS_GOAL_RE.test(goal)) return true;
    return false;
  },

  inferSurface(goal) {
    const t = String(goal || '').toLowerCase();
    if (_TEAMS_PERMISSION_RE.test(t)) return 'app-permission';
    if (_TEAMS_SETUP_RE.test(t)) return 'app-setup';
    if (_TEAMS_USER_RE.test(t)) return 'users';
    if (_TEAMS_MEETING_RE.test(t)) return 'meeting-policies';
    if (_TEAMS_CALLING_RE.test(t)) return 'calling-policies';
    if (_TEAMS_APP_STATUS_RE.test(t)) return 'manage-apps';
    return 'manage-apps';
  },

  surfaceUrls: {
    'manage-apps':       'https://admin.teams.microsoft.com/policies/app-app',
    'app-permission':    'https://admin.teams.microsoft.com/policies/app-permission',
    'app-setup':         'https://admin.teams.microsoft.com/policies/app-setup',
    'users':             'https://admin.teams.microsoft.com/users',
    'meeting-policies':  'https://admin.teams.microsoft.com/policies/meetings',
    'calling-policies':  'https://admin.teams.microsoft.com/policies/calling',
    'home':              'https://admin.teams.microsoft.com/',
  },

  pageTypes: [
    { name: 'teams-home',         urlMatch: /admin\.teams\.microsoft\.com\/?(?:#|$)/i, hint: 'Teams Admin Center root. Left nav: Dashboard, Teams, Users, Teams apps, Meetings, Voice, Policies.' },
    { name: 'manage-apps',        urlMatch: /admin\.teams\.microsoft\.com\/policies\/app-app/i, hint: 'Teams apps > Manage apps. Full app catalog with search. Columns: App name, Status (Allowed/Blocked), Publisher, Categories. Search for app name to check its status.' },
    { name: 'app-detail',         urlMatch: /admin\.teams\.microsoft\.com\/policies\/app-app\/(?:view|detail)/i, hint: 'Individual app detail page. Shows permissions, categories, versions. Check Status field at top.' },
    { name: 'app-permission',     urlMatch: /admin\.teams\.microsoft\.com\/policies\/app-permission/i, hint: 'App permission policies. Lists all policies (Global, custom). Click a policy to see allowed/blocked app lists.' },
    { name: 'app-permission-detail', urlMatch: /admin\.teams\.microsoft\.com\/policies\/app-permission\/detail/i, hint: 'Individual permission policy detail. Shows Microsoft apps, 3rd party apps, and custom apps — each with Allow All / Block All / Allow Specific lists.' },
    { name: 'app-setup',          urlMatch: /admin\.teams\.microsoft\.com\/policies\/app-setup/i, hint: 'App setup policies. Controls pinned apps and whether users can upload custom apps. Click a policy to see pinned app list.' },
    { name: 'app-setup-detail',   urlMatch: /admin\.teams\.microsoft\.com\/policies\/app-setup\/detail/i, hint: 'Individual setup policy detail. Shows installed apps (auto-install) and pinned apps (sidebar).' },
    { name: 'teams-users',        urlMatch: /admin\.teams\.microsoft\.com\/users/i, hint: 'Teams users list. Search by name or email. Click user to see assigned policies.' },
    { name: 'teams-user-detail',  urlMatch: /admin\.teams\.microsoft\.com\/users\/.*(?:detail|edit)/i, hint: 'User detail page. Shows Assigned policies tab: app setup policy, app permission policy, calling policy, meeting policy.' },
    { name: 'meeting-policies',   urlMatch: /admin\.teams\.microsoft\.com\/policies\/meetings/i, hint: 'Meeting policies. Controls lobby bypass, who can present, recording.' },
    { name: 'calling-policies',   urlMatch: /admin\.teams\.microsoft\.com\/policies\/calling/i, hint: 'Calling policies. Controls private calls, call forwarding, voicemail, delegation.' },
  ],

  knownSelectors: {
    leftNav:                  'nav[role="navigation"], .ms-Nav, [class*="sidebar"][class*="nav"]',
    pageTitle:                'h1, [role="heading"][aria-level="1"], .page-title',
    searchBar:                'input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]',
    appCatalogTable:          '[role="grid"][aria-label*="app" i], .ms-DetailsList, table[aria-label*="app" i]',
    appCatalogSearchInput:    'input[placeholder*="Search" i], input[aria-label*="Search" i]',
    appCatalogRow:            'div[role="row"][aria-rowindex]:not([aria-rowindex="1"]), tr[class*="app"]',
    appStatusColumn:          'div[data-automationid="Status"], div[aria-colindex]:nth-child([0-9]+)',
    permissionPolicyTable:    '[role="grid"][aria-label*="permission" i], .ms-DetailsList',
    permissionPolicyRow:      'div[role="row"][aria-rowindex]:not([aria-rowindex="1"])',
    permissionPolicyNameLink: 'a[href*="app-permission"], button[class*="link"]',
    setupPolicyTable:         '[role="grid"][aria-label*="setup" i], .ms-DetailsList',
    setupPolicyRow:           'div[role="row"][aria-rowindex]:not([aria-rowindex="1"])',
    setupPolicyPinnedApps:    '[aria-label*="pinned" i], [data-automationid*="pinned"]',
    setupPolicyInstalledApps: '[aria-label*="installed" i], [data-automationid*="installed"]',
    usersTable:               '[role="grid"][aria-label*="user" i], .ms-DetailsList',
    usersSearchInput:         'input[placeholder*="Search" i], input[aria-label*="search" i], input[aria-label*="filter" i]',
    userRow:                  'div[role="row"][aria-rowindex]:not([aria-rowindex="1"])',
    userAssignedPoliciesTab:  '[role="tab"][aria-label*="Assigned" i], button:has-text("Assigned policies")',
    userAppPermissionPolicy:  '[aria-label*="App permission policy" i], [data-automationid*="appPermissionPolicy"]',
    userAppSetupPolicy:       '[aria-label*="App setup policy" i], [data-automationid*="appSetupPolicy"]',
    userCallingPolicy:        '[aria-label*="Calling policy" i], [data-automationid*="callingPolicy"]',
    userMeetingPolicy:        '[aria-label*="Meeting policy" i], [data-automationid*="meetingPolicy"]',
    navManageApps:            'a[href*="app-app"], button:has-text("Manage apps")',
    navPermissionPolicies:    'a[href*="app-permission"], button:has-text("Permission policies")',
    navSetupPolicies:         'a[href*="app-setup"], button:has-text("Setup policies")',
    navUsers:                 'a[href*="/users"], button:has-text("Users")',
    navMeetings:              'a[href*="meetings"], button:has-text("Meetings")',
    navCalling:               'a[href*="calling"], button:has-text("Calling")',
    dialogOkButton:           'div[role="dialog"] button[type="submit"], div[role="dialog"] .ms-Button--primary',
    dialogCancelButton:       'div[role="dialog"] button[aria-label="Cancel" i]',
    detailsPanel:             '[data-automationid="detailsPaneOuter"], [role="complementary"]',
    saveButton:               'button.ms-Button--primary:has-text("Save"), button[aria-label="Save" i]',
    toastAlert:               'div[role="alert"], .ms-MessageBar',
  },

  waitStrings: {
    appsListLoaded:         ['App name', 'Status', 'Publisher', 'Categories', 'Showing'],
    appFound:               ['Copilot', 'Microsoft 365 Copilot', 'Allowed', 'Blocked'],
    policyListLoaded:       ['Policy name', 'Global', 'Assigned', 'Create policy'],
    permissionPolicyDetail: ['Microsoft apps', 'Third-party apps', 'Custom apps', 'Allow all', 'Block all'],
    setupPolicyDetail:      ['Pinned apps', 'Installed apps', 'User pinning', 'Upload custom apps'],
    usersListLoaded:        ['Display name', 'Email', 'Policy name', 'Assigned'],
    userDetailsLoaded:      ['App setup policy', 'App permission policy', 'Calling policy', 'Meeting policy'],
    saveSucceeded:          ['saved', 'updated', 'success', 'successfully', 'has been'],
    saveFailed:             ['error', 'failed', 'cannot', "couldn't", 'permission'],
    sessionExpired:         ['Sign in again', 'session has expired', 'Please sign in'],
  },

  mismatchHints: [
    {
      pattern: /\b(teams\s+app|copilot.*teams|teams.*copilot|app\s+permission|setup\s+policy|pinned\s+app)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'admin.teams.microsoft.com — Teams apps > Manage apps for app status; Permission policies for allowed/blocked; Setup policies for pinned apps',
    },
    {
      pattern: /\b(teams.*meeting|lobby.*bypass|who.*present)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'admin.teams.microsoft.com — Meetings > Meeting policies for lobby bypass, presenter controls, recording policies',
    },
    {
      pattern: /\b(teams.*calling|call.*forward|voicemail.*teams)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'admin.teams.microsoft.com — Voice > Calling policies for call forwarding, delegation, voicemail',
    },
    {
      pattern: /\b(teams.*user.*polic|nick.*policies|user.*assigned.*polic)\b/i,
      onbox: 'M365 Admin Center',
      nsm: 'admin.teams.microsoft.com — Users > search user > Assigned policies tab to view all assigned Teams policies',
    },
  ],

  needsTargetSelection: false,
  preflightInstructions: '',

  liveDataCaveats: [
    'Teams Admin Center app catalog updates can take 5-30 minutes to reflect policy changes. If an app still shows as Allowed immediately after blocking, wait and re-check.',
    'Per-user policy assignment changes can take 10-30 minutes to propagate to the Teams client. Users may need to sign out and back in to Teams.',
    'Copilot for Teams requires both the app to be allowed AND the user to have a Copilot-capable license. Check both: Teams Admin Center for app/policy status, and M365 Admin Center for license assignment.',
    'The Global (Org-wide default) policy applies to all users who don\'t have a custom policy explicitly assigned. Check both Global and any custom policies.',
    'Teams Admin Center is a separate SPA from M365 Admin Center — each loads independently with 3-8s load times. Use wait_for_text before scraping.',
    'The app catalog table is virtualized (Fluent DetailsList) — only ~30-50 rows are in the DOM at any time. Use search to find specific apps rather than scrolling.',
  ].join(' '),

  knownGotchas: [
    'Teams Admin Center (admin.teams.microsoft.com) is SEPARATE from M365 Admin Center (admin.microsoft.com). Copilot app policies are ONLY in Teams Admin Center.',
    'Navigation path for app status: Teams apps > Manage apps. URL: admin.teams.microsoft.com/policies/app-app.',
    'Navigation path for permission policies: Teams apps > Permission policies. URL: admin.teams.microsoft.com/policies/app-permission. The Global policy applies to most users.',
    'Navigation path for setup policies: Teams apps > Setup policies. URL: admin.teams.microsoft.com/policies/app-setup. Controls whether apps are pinned to the sidebar and auto-installed.',
    'Navigation path for user policies: Users > search for user > click name > Assigned policies tab. Shows which permission policy, setup policy, calling policy, and meeting policy the user has.',
    'Copilot appears in the app catalog as "Microsoft 365 Copilot" or "Copilot". Search for both terms if one doesn\'t return results.',
    'App status values: "Allowed" means available for assignment; "Blocked" means blocked org-wide (nobody can use it).',
    'Built on Fluent UI / FluentUI React (same framework as M365 Admin Center). Prefer selectors: [data-automationid="..."], [aria-label="..."], role="button"/"menuitem"/"row".',
    'Save buttons on Fluent UI panels use ms-Button--primary or text "Save". After ANY save: wait for toast confirmation (role="alert"), then re-read the panel to verify.',
    'The Global (Org-wide default) permission policy CANNOT be deleted — only modified. Custom policies can be created and assigned to specific users or groups.',
    'Setup policy "User pinning" toggle controls whether users can pin their own apps. If disabled and Copilot is not in the admin-pinned list, users won\'t see Copilot even if the permission policy allows it.',
    'Common navigation paths (verified 2026-05): Manage apps: admin.teams.microsoft.com/policies/app-app. Permission policies: /app-permission. Setup policies: /app-setup. Users: /users.',
    'Copilot investigation checklist: (1) Check Copilot app status in Manage apps — must be Allowed. (2) Check the user\'s permission policy — Copilot must be in the allowed list. (3) Check the user\'s setup policy — if Copilot is not pinned and user pinning is disabled, they won\'t see it. (4) Check M365 Admin Center for Copilot license assignment.',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for Teams Admin Center:
- Inspect the goal text to detect which surface it targets: Manage apps (status), Permission policies, Setup policies, Users (per-user policies), Meeting policies, or Calling policies.
- Add a Phase 0 navigate step to the correct URL: admin.teams.microsoft.com/policies/app-app for status, /app-permission for permission policies, /app-setup for setup policies, /users for user policies.
- Memory keys must begin with 'teams_' (e.g., 'teams_copilot_status', 'teams_permission_policy_global').
- For Copilot investigations, always check ALL FOUR dimensions: (1) app status, (2) permission policy, (3) setup policy, (4) user license in M365 Admin.
- When the goal mentions a specific user, navigate to Users > search by name > Assigned policies tab.
- Preserve the user's deliverable structure exactly.`,

  workflowHints: [
    {
      match: /copilot.*teams|teams.*copilot|copilot.*not.*showing|copilot.*missing|cannot.*add.*copilot/i,
      hint: 'Copilot Teams investigation requires checking 4 areas. Phase 1: admin.teams.microsoft.com/policies/app-app (Manage apps). Search for Copilot. Read Status column — must be Allowed. Phase 2: admin.teams.microsoft.com/policies/app-permission. Click Global policy. Check if Copilot is allowed. Phase 3: admin.teams.microsoft.com/policies/app-setup. Click Global policy. Check if Copilot is pinned or user pinning enabled. Phase 4: admin.teams.microsoft.com/users, search user, Assigned policies tab. ALSO check M365 Admin Center for Copilot license.',
    },
    {
      match: /check.*app.*status|is.*app.*blocked|app.*allowed|app.*blocked/i,
      hint: 'Phase 1: Navigate to admin.teams.microsoft.com/policies/app-app. Phase 2: Search for the app by name. Phase 3: Read the Status column — Allowed or Blocked. Phase 4: Click the app name for detailed info.',
    },
    {
      match: /permission.*polic|app.*permission|allow.*block.*specific/i,
      hint: 'Phase 1: Navigate to admin.teams.microsoft.com/policies/app-permission. Phase 2: Click the policy name (Global is default). Phase 3: Check each section: Microsoft apps, Third-party apps, Custom apps. Each has Allow All / Block All / Allow Specific. Phase 4: Look for target app in the allowed list.',
    },
    {
      match: /setup.*polic|pinned.*apps|app.*pin|app.*install/i,
      hint: 'Phase 1: Navigate to admin.teams.microsoft.com/policies/app-setup. Phase 2: Click the policy name (Global is default). Phase 3: Check Pinned apps list. Phase 4: Check Installed apps list. Phase 5: Check User pinning toggle.',
    },
    {
      match: /user.*policies|assigned.*policies|nick.*policies|what.*policy.*does.*user/i,
      hint: 'Phase 1: Navigate to admin.teams.microsoft.com/users. Phase 2: Search for the user. Phase 3: Click the user name. Phase 4: Click Assigned policies tab. Phase 5: Document: App setup policy, App permission policy, Calling policy, Meeting policy.',
    },
    {
      match: /meeting.*polic|lobby.*bypass|who.*present|teams.*meeting/i,
      hint: 'Phase 1: Navigate to admin.teams.microsoft.com/policies/meetings. Phase 2: Click the policy name. Phase 3: Check Automatically admit people for lobby bypass. Phase 4: Check Who can present.',
    },
  ],
};
