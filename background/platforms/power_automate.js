// background/platforms/power_automate.js
// Power Automate (make.powerautomate.com) + legacy flow.microsoft.com — v3.50.0
//
// Covers: cloud flows list/detail/editor, solutions view, connections,
// Power Apps maker portal overlap (make.powerapps.com shares the shell).
//
// MSP failure mode this profile addresses: the maker portal is a heavily
// client-rendered canvas SPA — DOM elements appear late, buttons are
// Fluent/web-component widgets, and the flow editor nests designer panes in
// iframes. Blind clicks race the SPA. The selectors below target the stable
// shell chrome; the wait strings cover the slow-loading states.

// Precompile regex patterns for hot-path detection
const _PA_HOST_RE = /(^|\.)make\.powerautomate\.com$|(^|\.)make\.powerapps\.com$|(^|\.)flow\.microsoft\.com$|(^|\.)powerautomate\.microsoft\.com$/i;
const _PA_GOAL_RE = /\b(power\s*automate|cloud\s*flow|flow\s+(?:runs?|history|disabled|failed)|turn\s+(?:on|off)\s+(?:the\s+)?flow)\b/i;

export const powerAutomate = {
  priority: 32,
  id: 'power_automate',
  label: 'Power Automate (maker portal)',
  memoryKeyPrefix: 'pa_',

  detect(url, goal) {
    if (!url && !goal) return false;
    try {
      const host = new URL(url).host.toLowerCase();
      if (_PA_HOST_RE.test(host)) return true;
    } catch (_e) { /* fall through */ }
    return _PA_GOAL_RE.test(String(goal || ''));
  },

  pageTypes: [
    { name: 'pa-home', urlMatch: /\/environments\//i, hint: 'Maker portal home. Environment picker is top-right — verify the environment BEFORE touching any flow; MSPs host many tenants here.' },
    { name: 'pa-flows-list', urlMatch: /\/cloudflows\b|\/list\?type=cloudflows/i, hint: 'Cloud flows list. Filter row + status pills (Running/Failed/Suspended). Row kebab (⋯) has Turn off/on; name link opens detail.' },
    { name: 'pa-flow-detail', urlMatch: /\/cloudflows\/([0-9a-f-]{20,})/i, hint: 'Flow detail: definition canvas + Runs history tab. Run status chips (Succeeded/Failed/Timed-out) link to the run detail with per-action inputs/outputs.' },
    { name: 'pa-run-detail', urlMatch: /\/runs\/([0-9a-f-]{20,})/i, hint: 'Single run detail: per-action cards with green/red status, expandable raw inputs/outputs JSON — the place to diagnose a failed action.' },
    { name: 'pa-editor', urlMatch: /\/edit(?:\/)?$/i, hint: 'Flow designer: actions as stacked cards, +/- insert between steps, right pane for parameters. New actions load from a searchable panel — search beats scrolling the taxonomy tree.' },
    { name: 'pa-connections', urlMatch: /\/connections\b/i, hint: 'Connections list: per-connector auth entries. A flow failing with 401/timeout usually means a broken/expired connection reference — fix here, not in the flow.' },
    { name: 'pa-solutions', urlMatch: /\/solutions\b/i, hint: 'Solutions (ALM) view: flows inside managed/unmanaged solution layers. Editing a flow inside a managed solution warns — prefer unmanaged or a dev environment.' },
  ],

  knownSelectors: {
    // Shell chrome (stable across the maker portals)
    environmentPicker: '[data-automationid="EnvironmentSelector"], button[aria-label*="environment" i], .environment-switcher, [class*="environment"] [role="combobox"]',
    globalSearch: '[aria-label*="Search" i] input, input[data-automationid="SearchBox"], [class*="searchBox"] input',
    appLauncher: 'button[aria-label*="App launcher" i], [data-automationid="appLauncher"]',
    settingsGear: 'button[aria-label*="Settings" i][role="button"], [data-automationid="SettingsButton"]',
    // Flows list
    flowsNewButton: 'button:has-text("New flow"), button:has-text("Create")',
    flowsFilterBar: '[role="search"], input[aria-label*="Search flows" i], [class*="commandBar"] input',
    flowsRefresh: 'button[aria-label*="Refresh" i], button:has-text("Refresh")',
    rowKebab: 'button[aria-label*="More options" i], button[aria-label*="More commands" i], [data-automationid="RowMenu"]',
    rowNameLink: 'a[class*="flowName"], [role="row"] a, [data-automationid="FlowName"]',
    statusPill: '[class*="statusPill"], [role="gridcell"] [class*="badge"], span[class*="status"]',
    // Detail / runs
    runsTab: 'button:has-text("Runs"), [role="tab"]:has-text("Runs"), a:has-text("Runs history")',
    runStatusChip: 'button[class*="runStatus"], [class*="statusChip"], [data-automationid*="RunStatus"]',
    editButton: 'button:has-text("Edit"), button[aria-label*="Edit" i]',
    turnOnToggle: 'button:has-text("Turn on"), button[aria-label*="Turn on" i]',
    turnOffToggle: 'button:has-text("Turn off"), button[aria-label*="Turn off" i]',
    // Editor
    addActionPlus: 'button[aria-label*="Insert a new step" i], button[aria-label*="Add an action" i], [class*="insertPlus"]',
    actionSearchInput: 'input[aria-label*="Search actions" i], input[placeholder*="Search" i][class*="panel"]',
    actionCard: '[class*="actionCard"], [data-automationid="ActionCard"]',
    actionExpandChevron: 'button[aria-label*="Expand" i], [class*="chevron"]',
    saveFlow: 'button:has-text("Save"), button[aria-label*="Save" i]',
    // Fail-closed dialog handling (Fluent dialogs)
    dialogConfirm: '[role="dialog"] button:has-text("Confirm"), [role="dialog"] button:has-text("OK"), [role="alertdialog"] button:has-text("Yes")',
    dialogDismiss: '[role="dialog"] button[aria-label*="Close" i], [role="dialog"] button:has-text("Cancel")',
  },

  waitStrings: {
    pageLoaded: ['My flows', 'Cloud flows', 'Solutions', 'Connections', 'Sign in'],
    listRendered: ['Status', 'Modified', 'Name', 'Turn off', 'Suspended', 'Running'],
    runDetailRendered: ['Succeeded', 'Failed', 'Inputs', 'Outputs', 'Duration'],
    editorRendered: ['New step', 'Insert a new step', 'Save', 'Flow checker'],
    saveSucceeded: ['saved', 'Saved', 'successfully'],
    saveFailed: ['error', 'failed', 'validation', 'not authorized'],
  },

  mismatchHints: [
    { match: /resubmit|re-?run/i, hint: 'Resubmitting runs lives on the RUN detail page (per-run Resubmit button), not the flow detail canvas.' },
    { match: /turn (on|off)|disable|enable/i, hint: 'On/off is the row kebab (⋯) on the flows LIST, or the top command bar on flow DETAIL.' },
    { match: /connection|401|unauthorized|expired/i, hint: 'Auth failures are usually the CONNECTION reference — check Connections before editing the flow.' },
    { match: /export|import|solution/i, hint: 'Solutions view handles ALM export/import; unmanaged flows export as zip packages.' },
  ],

  needsTargetSelection: false,
  preflightInstructions: '',

  knownGotchas: [
    'Verify the ENVIRONMENT (top-right picker) matches the tenant before acting — MSP partners land in the default environment of the wrong tenant constantly.',
    'The list is virtualized: use the filter/search box, not scrolling, to find a flow by name.',
    'Runs history can take 10-30s to populate after navigation; wait for status chips before asserting anything.',
    'Run-detail inputs/outputs are collapsed by default and some are marked Secure — a hidden value is expected, not a bug.',
    'Editing flows that live in a MANAGED solution warns on save; prefer editing the unmanaged layer or note the warning in ticket notes.',
    // From Premier client-automation ticket history (#1146006/#1147432):
    'For "inventory/backfill/monitor" client automations: RECON FIRST, READ-ONLY — build a flow inventory table (name, type Instant/Automated, On/Off, last run + status + duration) before proposing changes. "There should be more entries" complaints are usually historical backfill gaps, not broken flows.',
    'A client complaint that conflates two asks (file inventory vs content extraction) is common on this portal — decode them separately and confirm which one the ticket is about before building.',
    'Long-running backfill flows (10+ min) are normal for recursive OneDrive/SharePoint imports — judge by last-run status, not duration.',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for Power Automate:
- Name the exact flow if given; keep any flow GUID intact.
- Route resubmit/rerun goals to run detail; on/off goals to the list row kebab.
- For failures, sequence: open flow → Runs tab → newest failed run → expand failed action → report action name + error before proposing a fix.`,
};
