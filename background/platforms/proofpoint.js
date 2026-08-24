// background/platforms/proofpoint.js
// Proofpoint admin consoles — v3.50.0
//
// Covers the pods: people*.proofpoint.com (People/Centralized admin — the main
// MSP console), app.ppe.encryption... hosts, and proofpoint.com login
// (login.proofpoint.com SSO wall).
//
// MSP failure mode this profile addresses: Proofpoint is POD-hosted
// (us/uk/eu/ap pod subdomains differ per tenant), the admin UI mixes an older
// Angular table UI with newer pages, and the high-value ticket actions
// (release quarantined mail, find a message in smart search, inspect
// smart fighters) are each one specific blade. Detection matches any
// *.proofpoint.com host so the pod variance is covered.

// Precompile regex patterns for hot-path detection
const _PP_HOST_RE = /(^|\.)proofpoint\.com$|(^|\.)proofpoint(appliance|ess)\.com$/i;
const _PP_GOAL_RE = /\bproofpoint\b|\bsmart\s+search\b|\brelease\s+quarant/i;

export const proofpoint = {
  priority: 34,
  id: 'proofpoint',
  label: 'Proofpoint (People/Centralized admin)',
  memoryKeyPrefix: 'pp_',

  detect(url, goal) {
    if (!url && !goal) return false;
    try {
      const host = new URL(url).host.toLowerCase();
      if (_PP_HOST_RE.test(host)) return true;
    } catch (_e) { /* fall through */ }
    return _PP_GOAL_RE.test(String(goal || ''));
  },

  pageTypes: [
    { name: 'pp-login', urlMatch: /\/login|\/sign-?in/i, hint: 'Proofpoint SSO wall. Some tenants need the org-specific pod URL; if login loops, the tenant pod may differ from the bookmark.' },
    { name: 'pp-smart-fighters', urlMatch: /\/smart-?fighters|\/users/i, hint: 'Very Attacked People (VAPs / smart fighters): per-user risk ranking from org click data.' },
    { name: 'pp-smart-search', urlMatch: /\/smart-?search|\/search/i, hint: 'Smart Search: query quarantines, delivered mail, and blocked mail by sender/recipient/subject/time. THIS is where "did the message arrive" tickets get answered.' },
    { name: 'pp-quarantine', urlMatch: /\/quarantine/i, hint: 'Quarantine lists by policy. Row actions: Release / Release & Approve / Delete. Release notifies the recipient; Approve safelists the sender.' },
    { name: 'pp-smart- fighters', urlMatch: /\/smart-?fighters|\/users/i, hint: 'Very Attacked People (VAPs / smart fighters): per-user risk ranking from org click data.' },
    { name: 'pp-email-config', urlMatch: /\/email-?protection|\/policies/i, hint: 'Email Protection config: policies (filtering, outbound), sender lists, routing/connectors. Changes here affect the whole tenant — note before/after in the ticket.' },
    { name: 'pp-logging', urlMatch: /\/logs|\/status/i, hint: 'Log Search / message log: raw delivery events with policy verdicts — the ground truth when Smart Search and the user disagree.' },
  ],

  knownSelectors: {
    // Nav rail (consistent across pods)
    leftNav: 'nav, [class*="sidebar"], aside[class*="nav"], ul[class*="menu"]',
    navSearch: 'input[aria-label*="Search" i], input[placeholder*="Search" i], [class*="search"] input',
    // Smart Search
    smartSearchFields: 'input[aria-label*="Sender" i], input[aria-label*="Recipient" i], input[name*="sender" i], input[name*="recipient" i]',
    smartSearchSubmit: 'button:has-text("Search"), button[type="submit"], button[aria-label*="Search" i]',
    searchTimeRange: 'select[name*="time"], [class*="daterange"] button, [role="combobox"]',
    resultTable: 'table, [class*="results"], [role="grid"]',
    resultRowExpand: 'button[aria-label*="Expand" i], [class*="chevron"], a:has-text("Details")',
    // Quarantine
    quarantineRow: 'tr[class*="row"], [role="row"]',
    quarantineReleaseButton: 'button:has-text("Release"), a:has-text("Release"), button[aria-label*="Release" i]',
    quarantineApproveButton: 'button:has-text("Approve"), button:has-text("Release and Approve"), a:has-text("Approve")',
    quarantineDeleteButton: 'button:has-text("Delete"), button[aria-label*="Delete" i]',
    quarantineSelectAll: 'input[type="checkbox"][aria-label*="Select all" i], thead input[type="checkbox"]',
    // Generic chrome
    saveButton: 'button:has-text("Save"), button:has-text("Apply"), button[type="submit"]',
    cancelButton: 'button:has-text("Cancel"), button:has-text("Close")',
    toast: '[class*="toast"], [class*="notification"], [role="status"]',
    paginationNext: 'button[aria-label*="Next" i], a[aria-label*="Next" i], [class*="pagination"] button:last-child',
  },

  waitStrings: {
    pageLoaded: ['Dashboard', 'Smart Search', 'Quarantine', 'Email Protection', 'Sign in'],
    searchRendered: ['Sender', 'Recipient', 'Subject', 'Time', 'Search'],
    resultsRendered: ['Delivered', 'Quarantined', 'Blocked', 'Result', 'No results'],
    releaseSucceeded: ['released', 'Released', 'success'],
    releaseFailed: ['error', 'failed', 'not permitted'],
  },

  mismatchHints: [
    { match: /release|unblock|false ?positive/i, hint: 'Releases happen from Quarantine rows or Smart Search result details — find the message FIRST, then use its inline Release action.' },
    { match: /did .*(email|message).*(arrive|come|deliver)|where.*(message|email)/i, hint: 'Delivery questions = Smart Search by recipient + time window; the verdict column answers delivered/quarantined/blocked.' },
    { match: /spam|block|allow ?list|sender/i, hint: 'Sender allow/block lists live under Email Protection policies — changes are tenant-wide.' },
    { match: /phish|clicked|smart ?fighter|vap/i, hint: 'Per-user risk = smart fighters page; individual reported emails are under Email Submissions.' },
  ],

  needsTargetSelection: false,
  preflightInstructions: '',

  knownGotchas: [
    'Pod tenancy: each customer lives on a pod (people-us/prove-*.proofpoint.com etc.). A bookmark from another tenant can look logged-out or empty — check the pod subdomain matches the customer.',
    'Smart Search default time window is short (often 24h); widen the range before concluding a message never arrived.',
    'Quarantine Release vs Release-and-Approve: the second safelists the sender tenant-wide — pick deliberately and say which in the ticket.',
    'Some pods still serve the older Angular tables with no aria-labels; fall back to row position + vision overlays when selectors miss.',
    'Log Search can lag real delivery by minutes — for "just happened" tickets, note the delay rather than reporting absence.',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for Proofpoint:
- Convert "where did the email go" into: Smart Search → recipient + time window → report verdict.
- Convert "release from quarantine" into: find message → confirm recipient/sender → Release (state whether Approve was included).
- Keep the pod/customer name if present; never widen sender blocks without explicit instruction.`,
};
