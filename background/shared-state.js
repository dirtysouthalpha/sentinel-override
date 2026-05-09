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
