// background/platforms/index.js
// Platform profile registry — v3.22.0
//
// Adds new platforms by importing the profile here and registering it. The
// Adaptive Prompts engine (background/adaptive-prompts.js) iterates the list
// in order and picks the FIRST profile whose `detect(url, goal)` returns true.
//
// Order matters: more-specific profiles must come before fallback profiles
// (e.g., sonicwall_nsm before sonicwall_onbox).

import { sonicwallNsm } from './sonicwall_nsm.js';
import { sonicwallOnbox } from './sonicwall_onbox.js';
import { m365Admin } from './m365_admin.js';
import { fortigate } from './fortigate.js';
import { itglue } from './itglue.js';
import { aruba } from './aruba.js';
import { ambioViewlinc } from './ambio_viewlinc.js';
import { screenconnect } from './screenconnect.js';
import { ninjarmm } from './ninjarmm.js';

const PROFILES = [
  // Most-specific first. NSM before on-box, ITG before generic. Aruba covers
  // Central + Instant + OS-CX in one profile and lives after Microsoft/Sonic
  // because those have stricter URL matches.
  // (3.36.0) ambioViewlinc detects on the specific 192.168.100.x server +
  // viewlinc/oq keyword combo, so it slots before the catch-alls.
  // (3.37.0) ScreenConnect and NinjaRMM added for run_remote_command support.
  sonicwallNsm,
  sonicwallOnbox,
  m365Admin,
  fortigate,
  itglue,
  aruba,
  ambioViewlinc,
  screenconnect,
  ninjarmm,
];

/** Resolve the best-matching platform profile for the current goal+URL. Returns null if none match. */
export function getPlatformProfile(currentUrl, goal) {
  for (const p of PROFILES) {
    try {
      if (p && typeof p.detect === 'function' && p.detect(currentUrl, goal)) return p;
    } catch (e) {
      // Detection regex failed — skip this profile, don't crash the lookup.
      continue;
    }
  }
  return null;
}

/** Inspect a goal for menu paths that don't match the detected profile's surface. */
export function findMismatchHints(profile, goal) {
  if (!profile || !Array.isArray(profile.mismatchHints) || !goal) return [];
  const hits = [];
  for (const hint of profile.mismatchHints) {
    try {
      if (hint && hint.pattern && hint.pattern.test(goal)) {
        hits.push({ onbox: hint.onbox, target: hint.nsm });
      }
    } catch (e) { /* skip bad pattern */ }
  }
  return hits;
}

/** Lightweight listing for UI surfaces (e.g., a future "platform profiles" settings page). */
export function listAllProfiles() {
  return PROFILES.map(p => ({ id: p.id, label: p.label, memoryKeyPrefix: p.memoryKeyPrefix }));
}
