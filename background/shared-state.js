// background/shared-state.js
// Mutable shared state for cross-module flags.
// Kept separate from message-protocol.js (pure utility, no state).
//
// This module exists because content.js sends SPA transition messages to
// the background, and index.js needs to set a flag that agent-engine.js
// reads at the top of each loop iteration. Placing this flag in
// message-protocol.js would violate its "no state" design constraint.
// A dedicated shared-state module keeps the dependency graph clean:
//   index.js  --> shared-state.js  <-- agent-engine.js
// No circular imports.

let _spaTransitionPending = false;

/** Mark that an SPA page transition occurred while the agent is running. */
export function setSPATransitionPending() { _spaTransitionPending = true; }

/** Check whether a pending SPA transition needs to be handled. */
export function isSPATransitionPending() { return _spaTransitionPending; }

/** Clear the SPA transition flag after it has been handled. */
export function clearSPATransition() { _spaTransitionPending = false; }

// (3.11.3) Centralized "fire a desktop notification only if the user enabled
// sound notifications" helper. Default: OFF — Sentinel runs silently unless
// the user opts in via Settings > Sound notifications. Replaces direct
// chrome.notifications.create() calls site-wide so a single toggle silences
// every site at once.
//
// Accepts either form chrome.notifications.create supports:
//   notifyIfEnabled(opts)            — auto-generated id
//   notifyIfEnabled(id, opts)        — caller-supplied id
export async function notifyIfEnabled(idOrOpts, optsIfId) {
  try {
    const { sentinelSoundEnabled } = await chrome.storage.local.get({ sentinelSoundEnabled: false });
    if (!sentinelSoundEnabled) return;
    if (typeof idOrOpts === 'string') {
      chrome.notifications.create(idOrOpts, optsIfId);
    } else {
      chrome.notifications.create(idOrOpts);
    }
  } catch (e) { /* notifications permission optional / storage unavailable */ }
}
