// Centralized shared state for agent-engine internals.
// Allows tab/CDP modules to access shared state without circular imports.
export const sharedState = {
  cdpFallbackActive: false,
  lastNukeClean: false,
  pageWasReady: false,
  cachedObservation: null,
  pageStagnation: 0,
  // Reset function for new agent runs
  reset() {
    this.cdpFallbackActive = false;
    this.lastNukeClean = false;
    this.pageWasReady = false;
    this.cachedObservation = null;
    this.pageStagnation = 0;
  }
};
