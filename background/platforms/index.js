// background/platforms/index.js
// Platform profile registry — GENERATED FILE, DO NOT EDIT BY HAND.
//
// Regenerate with:  node scripts/generate-platform-registry.cjs
// CI fails if this file does not match the profiles on disk.
//
// To add a platform, drop a profile in this directory exporting an object with
// an `id`, a `priority` and a `detect(url, goal)`, then regenerate. The
// Adaptive Prompts engine (background/adaptive-prompts.js) iterates this list in
// order and picks the FIRST profile whose detect() returns true, so a specific
// profile needs a lower priority than any catch-all that would also match it.

import { sonicwallNsm } from './sonicwall_nsm.js';
import { sonicwallOnbox } from './sonicwall_onbox.js';
import { m365Admin } from './m365_admin.js';
import { teamsAdmin } from './teams_admin.js';
import { fortigate } from './fortigate.js';
import { itglue } from './itglue.js';
import { aruba } from './aruba.js';
import { ambioViewlinc } from './ambio_viewlinc.js';
import { screenconnect } from './screenconnect.js';
import { ninjarmm } from './ninjarmm.js';
import { connectwiseManage } from './connectwise_manage.js';
import { autotask } from './autotask.js';
import { dattoRmm } from './datto_rmm.js';
import { cisco } from './cisco.js';
import { paloalto } from './paloalto.js';
import { sentinelone } from './sentinelone.js';
import { nvd } from './nvd.js';
import { virustotal } from './virustotal.js';
import { huntress } from './huntress.js';
import { freshservice } from './freshservice.js';
import { networkDevice } from './network_device.js';

const PROFILES = [
  sonicwallNsm,          // 10
  sonicwallOnbox,        // 20
  m365Admin,             // 30
  teamsAdmin,            // 40
  fortigate,             // 50
  itglue,                // 60
  aruba,                 // 70
  ambioViewlinc,         // 80
  screenconnect,         // 90
  ninjarmm,              // 100
  connectwiseManage,     // 110
  autotask,              // 115
  dattoRmm,              // 120
  cisco,                 // 130
  paloalto,              // 140
  sentinelone,           // 150
  nvd,                   // 160
  virustotal,            // 170
  huntress,              // 180
  freshservice,          // 195
  networkDevice,         // 9999
];

/**
 * Resolve the best-matching platform profile for the current URL and goal.
 * Iterates PROFILES in order and returns the first whose detect() returns true.
 * @param {string} currentUrl - The active tab's URL.
 * @param {string} goal - The user's goal text.
 * @returns {object|null} The matching platform profile, or null if none matched.
 */
export function getPlatformProfile(currentUrl, goal) {
  for (const p of PROFILES) {
    try {
      if (p && typeof p.detect === 'function' && p.detect(currentUrl, goal)) return p;
    } catch (_e) {
      console.warn('[Sentinel] Platform detect error (profile:', p && p.id, '):', typeof _e === 'object' && _e !== null && typeof _e.message === 'string' ? _e.message : String(_e));
      continue;
    }
  }
  return null;
}

/**
 * Inspect a goal for menu paths that don't match the detected profile's surface.
 * Returns hints that map on-box menu paths to their cloud-portal equivalents.
 * @param {object} profile - The matched platform profile with mismatchHints array.
 * @param {string} goal - The user's goal text.
 * @returns {Array<{onbox: string, target: string}>} Mismatch hints found in the goal.
 */
export function findMismatchHints(profile, goal) {
  if (!profile || !Array.isArray(profile.mismatchHints) || !goal) return [];
  const hits = [];
  for (const hint of profile.mismatchHints) {
    try {
      if (hint && hint.pattern && hint.pattern.test(goal)) {
        hits.push({ onbox: hint.onbox, target: hint.nsm });
      }
    } catch (_e) { /* skip bad pattern */ }
  }
  return hits;
}

/**
 * Lightweight listing of all registered platform profiles.
 * Returns id, label, and memoryKeyPrefix for each profile.
 * @returns {Array<{id: string, label: string, memoryKeyPrefix: string}>}
 */
export function listAllProfiles() {
  return PROFILES.map(p => ({ id: p.id, label: p.label, memoryKeyPrefix: p.memoryKeyPrefix }));
}
