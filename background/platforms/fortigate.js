// background/platforms/fortigate.js
// FortiGate / FortiManager web admin — v3.15.0

export const fortigate = {
  id: 'fortigate',
  label: 'FortiGate / FortiManager',
  memoryKeyPrefix: 'fortigate_',

  detect(url, goal) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.host.toLowerCase();
      const path = u.pathname.toLowerCase();
      if (/fortinet|fortigate|fortimanager/i.test(host)) return true;
      if (/\/ng\/|\/p\/login/.test(path) && /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(host)) return true;
    } catch (e) {}
    return /\b(fortigate|fortimanager|fortinet|fortiweb)\b/i.test(String(goal || ''));
  },

  mismatchHints: [],

  needsTargetSelection: false,
  preflightInstructions: '',

  liveDataCaveats: 'FortiGate web admin shows live data per device. FortiManager is the multi-tenant management layer — drill into a specific FortiGate first via Device Manager.',

  knownGotchas: [
    'Default left-nav state varies by ADOM (administrative domain). Set the correct ADOM via the top-bar dropdown before navigating.',
    'Log views require a search filter to populate — empty filter often shows nothing.',
    'Policy rules are objects with separate "Disabled" and "Enabled" states distinct from "Action: Deny".',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for FortiGate / FortiManager:
- If user is on FortiManager and goal references device-specific menus, add Phase 0 to drill into Device Manager > [target device].
- Memory keys must begin with 'fortigate_'.
- Preserve the user's deliverable structure exactly.`
};
