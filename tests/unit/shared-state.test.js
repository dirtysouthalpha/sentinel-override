// Sentinel Override v3 -- Unit tests for shared-state.js
import { describe, it, expect, beforeEach } from 'vitest';
import { setSPATransitionPending, isSPATransitionPending, clearSPATransition } from '../../background/shared-state.js';

describe('shared-state', () => {
  beforeEach(() => {
    clearSPATransition();
  });

  it('defaults to false (no transition pending)', () => {
    expect(isSPATransitionPending()).toBe(false);
  });

  it('returns true after setSPATransitionPending()', () => {
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
  });

  it('returns false after clearSPATransition()', () => {
    setSPATransitionPending();
    clearSPATransition();
    expect(isSPATransitionPending()).toBe(false);
  });

  it('can toggle multiple times', () => {
    expect(isSPATransitionPending()).toBe(false);
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
    clearSPATransition();
    expect(isSPATransitionPending()).toBe(false);
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
    clearSPATransition();
    expect(isSPATransitionPending()).toBe(false);
  });
});
