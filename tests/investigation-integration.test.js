// tests/investigation-integration.test.js
// Phase 3 Integration tests — verifies investigation checklist flows through
// agent-planning.js and agent-ticket-format.js correctly.

import {
  _enhanceWithInvestigationChecklist,
  getCurrentInvestigationChecklist,
  resetInvestigationChecklist,
} from '../background/agent-planning.js';
import { formatTicketFinalNotes, formatTicketOutput } from '../background/agent-ticket-format.js';

const NICK_GIVENS_GOAL = `You are investigating why Nick Givens cannot add Copilot to his Teams chat/group.
Navigate through the M365 admin centers and check:
1. Microsoft 365 Admin Center - Check Copilot service status
2. Teams Admin Center - Check app status, permission policies, setup policies
3. Users → Active Users → Find Nick Givens - Check licenses and policies
4. Teams Apps Specific Details - Document restrictions
WHAT TO DOCUMENT: Copilot service status, app status, policies, visibility`;

const TECH = {
  name: 'Test Tech',
  title: 'Senior Engineer',
  company: 'Test MSP',
  phone: '555-0100',
  email: 'tech@test.com',
};

beforeEach(() => {
  resetInvestigationChecklist();
});

// ═══════════════════════════════════════════════════════════
// _enhanceWithInvestigationChecklist
// ═══════════════════════════════════════════════════════════
describe('_enhanceWithInvestigationChecklist', () => {
  test('appends checklist directive for investigation goals', () => {
    const result = _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    expect(result.length).toBeGreaterThan(NICK_GIVENS_GOAL.length);
    expect(result).toContain('INVESTIGATION CHECKLIST');
    expect(result).toContain('REQUIRED DOCUMENTATION');
  });

  test('returns original goal for non-investigation goals', () => {
    const simpleGoal = 'Click the submit button';
    const result = _enhanceWithInvestigationChecklist(simpleGoal);
    expect(result).toBe(simpleGoal);
  });

  test('handles null/undefined gracefully', () => {
    expect(_enhanceWithInvestigationChecklist(null)).toBeNull();
    expect(_enhanceWithInvestigationChecklist(undefined)).toBeUndefined();
    expect(_enhanceWithInvestigationChecklist('')).toBe('');
  });

  test('preserves original goal text in enhanced version', () => {
    const result = _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    expect(result).toContain('Nick Givens');
    expect(result).toContain('Copilot');
    expect(result).toContain('Microsoft 365 Admin Center');
    expect(result).toContain('Teams Admin Center');
  });

  test('includes all 4 numbered sections in enhanced goal', () => {
    const result = _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
    expect(result).toContain('4.');
  });
});

// ═══════════════════════════════════════════════════════════
// getCurrentInvestigationChecklist
// ═══════════════════════════════════════════════════════════
describe('getCurrentInvestigationChecklist', () => {
  test('returns null before any enhancement', () => {
    expect(getCurrentInvestigationChecklist()).toBeNull();
  });

  test('returns parsed checklist after enhancement', () => {
    _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    const checklist = getCurrentInvestigationChecklist();
    expect(checklist).not.toBeNull();
    expect(checklist.isInvestigation).toBe(true);
    expect(checklist.sections).toHaveLength(4);
  });

  test('returns null after reset', () => {
    _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    expect(getCurrentInvestigationChecklist()).not.toBeNull();
    resetInvestigationChecklist();
    expect(getCurrentInvestigationChecklist()).toBeNull();
  });

  test('returns null for non-investigation goals', () => {
    _enhanceWithInvestigationChecklist('Simple goal');
    expect(getCurrentInvestigationChecklist()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// resetInvestigationChecklist
// ═══════════════════════════════════════════════════════════
describe('resetInvestigationChecklist', () => {
  test('clears the stored checklist', () => {
    _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    expect(getCurrentInvestigationChecklist()).not.toBeNull();
    resetInvestigationChecklist();
    expect(getCurrentInvestigationChecklist()).toBeNull();
  });

  test('is safe to call when already null', () => {
    expect(() => resetInvestigationChecklist()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// formatTicketFinalNotes with investigation checklist
// ═══════════════════════════════════════════════════════════
describe('formatTicketFinalNotes with investigation checklist', () => {
  test('includes investigation findings section when checklist provided', () => {
    const checklist = _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    const parsed = getCurrentInvestigationChecklist();
    
    const notes = formatTicketFinalNotes(
      'Investigation complete',
      NICK_GIVENS_GOAL,
      TECH,
      { investigationChecklist: parsed }
    );
    
    expect(notes).toContain('Investigation Findings Report');
    expect(notes).toContain('Microsoft 365 Admin Center');
    expect(notes).toContain('Teams Admin Center');
    expect(notes).toContain('Nick Givens');
  });

  test('does not append a fabricated all-pending checklist when none is provided', () => {
    // (audit) Previously this auto-parsed the goal into a fresh all-pending
    // checklist and appended "0% sections complete" to every finished ticket,
    // falsely reporting no progress (the engine tracks no live checklist state).
    // The findings report is now rendered only when a real checklist is supplied.
    const notes = formatTicketFinalNotes(
      'Investigation complete',
      NICK_GIVENS_GOAL,
      TECH,
      {}
    );

    expect(notes).not.toContain('Investigation Findings Report');
    expect(notes).not.toContain('sections complete');
    // The ticket body itself (and the run summary) are still present.
    expect(notes).toContain('Investigation complete');
  });

  test('does not include findings report for non-investigation goals', () => {
    const notes = formatTicketFinalNotes(
      'Task complete',
      'Click the submit button',
      TECH,
      {}
    );
    
    expect(notes).not.toContain('Investigation Findings Report');
  });

  test('includes progress percentage in report', () => {
    const parsed = getCurrentInvestigationChecklist() || (() => {
      _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
      return getCurrentInvestigationChecklist();
    })();
    
    const notes = formatTicketFinalNotes(
      'Investigation complete',
      NICK_GIVENS_GOAL,
      TECH,
      { investigationChecklist: parsed }
    );
    
    expect(notes).toContain('%');
    expect(notes).toContain('0/4');
  });

  test('formatTicketOutput routes FINAL_NOTES with checklist integration', () => {
    _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    const parsed = getCurrentInvestigationChecklist();
    
    const output = formatTicketOutput(
      'FINAL_NOTES',
      'Investigation complete',
      NICK_GIVENS_GOAL,
      TECH,
      { investigationChecklist: parsed }
    );
    
    expect(output).toContain('Final Notes');
    expect(output).toContain('Investigation Findings Report');
  });
});

// ═══════════════════════════════════════════════════════════
// End-to-end flow: enhancement → checklist → ticket format
// ═══════════════════════════════════════════════════════════
describe('End-to-end investigation flow', () => {
  test('full flow: enhance goal → store checklist → format in ticket', () => {
    // Step 1: Enhance the goal (simulates _applyAdaptivePrompts calling _enhanceWithInvestigationChecklist)
    const enhancedGoal = _enhanceWithInvestigationChecklist(NICK_GIVENS_GOAL);
    expect(enhancedGoal).toContain('INVESTIGATION CHECKLIST');
    
    // Step 2: Retrieve the parsed checklist (simulates agent-engine reading it)
    const checklist = getCurrentInvestigationChecklist();
    expect(checklist).not.toBeNull();
    expect(checklist.sections).toHaveLength(4);
    expect(checklist.documentItems.length).toBeGreaterThanOrEqual(4);
    
    // Step 3: Format in ticket output (simulates agent finishing and formatting report)
    const ticket = formatTicketFinalNotes(
      'Investigation completed successfully.',
      enhancedGoal,
      TECH,
      { investigationChecklist: checklist, stepCount: 15, apiCallCount: 8 }
    );
    
    expect(ticket).toContain('Final Notes');
    expect(ticket).toContain('Action Taken');
    expect(ticket).toContain('Investigation Findings Report');
    expect(ticket).toContain('Required Documentation');
    expect(ticket).toContain('Copilot service status');
  });
});
