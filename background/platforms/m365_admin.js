// background/platforms/m365_admin.js
// Microsoft 365 admin surfaces — v3.15.0
//
// Covers admin.microsoft.com, admin.cloud.microsoft, entra.microsoft.com,
// admin.exchange.microsoft.com, security.microsoft.com, purview.microsoft.com,
// intune.microsoft.com, compliance.microsoft.com, defender.microsoft.com,
// portal.azure.com (overlap), and login.microsoftonline.com (auth wall).
//
// The most common MSP failure here: the user's prompt assumes a flat menu
// structure, but M365 admin is sharded across multiple specialized portals
// that don't share navigation. "Run a message trace" lives in Exchange admin,
// not in the M365 admin center root. "Check sign-in logs" lives in Entra,
// not in M365 admin.

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

  // Specific surface within M365 implied by the user's goal text.
  // The rewriter uses this to decide which sub-portal URL to start at.
  inferSurface(goal) {
    const t = String(goal || '').toLowerCase();
    if (/(message\s+trace|mail\s+flow|shared\s+mailbox|exchange|smtp|connector|transport\s+rule)/i.test(t)) return 'exchange';
    if (/(sign.?in\s+log|conditional\s+access|app\s+password|service\s+principal|enterprise\s+app|entra|aad|azure\s+ad)/i.test(t)) return 'entra';
    if (/(audit\s+log|purview|ediscovery|retention\s+policy|data\s+loss|dlp)/i.test(t)) return 'purview';
    if (/(defender|threat\s+hunt|incident|alert|kql|advanced\s+hunting)/i.test(t)) return 'defender';
    if (/(intune|endpoint|device\s+config|compliance\s+policy)/i.test(t)) return 'intune';
    return 'admin';  // generic M365 admin center
  },

  surfaceUrls: {
    admin: 'https://admin.cloud.microsoft/',
    entra: 'https://entra.microsoft.com/',
    exchange: 'https://admin.exchange.microsoft.com/',
    purview: 'https://purview.microsoft.com/',
    defender: 'https://security.microsoft.com/',
    intune: 'https://intune.microsoft.com/',
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
    'Cross-portal navigation: each surface (Entra / Exchange / Purview / Defender) is a separate SPA. Use open_tab labels to keep tabs straight.',
    'Sign-in popups on accounts.google.com or login.microsoftonline.com pause the agent (3.14.1 sign-in wall detector). Complete auth manually.',
    'Many tables are cross-origin iframes that block DOM scraping. Use read_network_requests with url_includes: "graph.microsoft.com" to capture the underlying Graph API JSON.',
  ].join(' '),

  knownGotchas: [
    'Tenant lockdown (3.7.0) auto-flags wrong-tenant work — set Expected Microsoft tenant in Settings before sensitive operations.',
    'Some menus have moved: Purview Audit is /audit/auditsearch NOT /auditlogsearch; Defender alerts are now under Incidents & Alerts.',
    'Power Platform admin and Teams admin are SEPARATE portals from M365 admin — admin.powerplatform.microsoft.com and admin.teams.microsoft.com.',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for M365 admin:
- Inspect the goal text to detect which surface it's really about (Exchange / Entra / Purview / Defender / Intune / generic admin).
- Add a Phase 0 navigate step to the correct sub-portal URL if the user's goal jumps into menus without specifying.
- Memory keys must begin with 'm365_' (or the more specific 'entra_', 'exchange_', 'purview_', 'defender_' as appropriate).
- When the goal asks for audit/sign-in/log data, prefer read_network_requests with graph.microsoft.com filter as a fallback for cross-origin iframe blockage.
- Preserve the user's deliverable structure exactly.`
};
