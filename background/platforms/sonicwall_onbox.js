// background/platforms/sonicwall_onbox.js
// SonicWall on-box web admin (SonicOS) — v3.15.0
//
// The legacy firewall web admin. Different menu structure than NSM; this is
// the surface most MSP investigation prompts naturally assume.

export const sonicwallOnbox = {
  id: 'sonicwall_onbox',
  label: 'SonicWall on-box web admin (SonicOS)',
  memoryKeyPrefix: 'sonicwall_',

  // Match SonicOS web admin URLs: typically a private/public WAN IP with the
  // /sonicui/, /main.html, or /auth.html paths. Best-effort — operators often
  // use plain IPs.
  detect(url, goal) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.host;
      // Skip NSM hosts explicitly — they belong to the NSM profile.
      if (/(^|\.)nsm[\w.-]*\.sonicwall\.com$|cloud\.sonicwall\.com$/i.test(host)) return false;
      // SonicOS URL patterns
      if (/\/sonicui\/|\/main\.html|\/auth\.html|\/getsystem|\/getlogout/i.test(u.pathname + u.search)) return true;
      // Title hint
      if (/sonicwall|sonicos|gen5|gen6|gen7|tz\d|nsa\d|soho/i.test(String(goal || '')) && /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(host)) return true;
    } catch (e) {}
    return false;
  },

  mismatchHints: [],  // on-box is the canonical surface; no on-box-to-X mismatches

  needsTargetSelection: false,
  preflightInstructions: '',

  liveDataCaveats: 'On-box web admin is the canonical source of LIVE data — active sessions, current license seat usage, real-time logs all live here. NSM is for trend/config; the firewall is for "what is happening right now."',

  knownGotchas: [
    'Some pages load via XHR; wait for the right-pane content to appear before reading.',
    'Older SonicOS firmware (5.9, 6.2) put VPN status under VPN > Settings and clientless under Users > Status. Newer firmware (6.5+, 7.x) moved VPN status to VPN > Base Settings or VPN > Currently Active VPN Tunnels.',
    'When extracting tables, prefer one execute_js dump over per-row clicks.',
    'Some commit actions require a follow-up "Apply" or "Accept" button click — always verify with a read after.',
  ].join(' '),

  rewriteInstructions: `When rewriting goals for SonicWall on-box admin:
- The user's prompt is likely already correct for this surface — make minimal changes.
- Memory keys must begin with 'sonicwall_'.
- Add firmware-version-aware notes only when a menu was renamed across versions (VPN > Settings vs VPN > Base Settings).
- Preserve the user's deliverable structure exactly.`
};
