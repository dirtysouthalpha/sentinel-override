// tests/investigation-checklist.test.js
// Unit tests for background/investigation-checklist.js
//
// Coverage:
//   parseInvestigationChecklist — numbered sections, sub-tasks, document items
//   isInvestigationGoal — quick boolean check
//   formatChecklistForPrompt — LLM directive formatting
//   updateChecklistStatus — section status mutation
//   getChecklistProgress — completion calculation
//   formatFindingsForReport — final report formatting

import {
  parseInvestigationChecklist,
  isInvestigationGoal,
  formatChecklistForPrompt,
  updateChecklistStatus,
  getChecklistProgress,
  formatFindingsForReport,
} from '../background/investigation-checklist.js';

// The exact investigation prompt from the user's example
const NICK_GIVENS_COPILOT_PROMPT = `You are investigating why Nick Givens cannot add Copilot to his Teams chat/group.
Navigate through the M365 admin centers and check:
1. Microsoft 365 Admin Center - Check Copilot service status
2. Teams Admin Center - Check app status, permission policies, setup policies
3. Users → Active Users → Find Nick Givens - Check licenses and policies
4. Teams Apps Specific Details - Document restrictions
WHAT TO DOCUMENT: Copilot service status, app status, policies, visibility`;

// ═══════════════════════════════════════════════════════════
// parseInvestigationChecklist
// ═══════════════════════════════════════════════════════════
describe('parseInvestigationChecklist', () => {
  test('parses Nick Givens Copilot prompt into 4 sections', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    expect(checklist.sections).toHaveLength(4);
    expect(checklist.isInvestigation).toBe(true);
  });

  test('section 1 is M365 Admin Center', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    expect(checklist.sections[0].id).toBe(1);
    expect(checklist.sections[0].title).toContain('Microsoft 365 Admin Center');
    expect(checklist.sections[0].title).toContain('Copilot service status');
  });

  test('section 2 is Teams Admin Center', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    expect(checklist.sections[1].id).toBe(2);
    expect(checklist.sections[1].title).toContain('Teams Admin Center');
    expect(checklist.sections[1].title).toContain('app status');
  });

  test('section 3 is Users/Nick Givens', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    expect(checklist.sections[2].id).toBe(3);
    expect(checklist.sections[2].title).toContain('Nick Givens');
  });

  test('section 4 is Teams Apps Details', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    expect(checklist.sections[3].id).toBe(4);
    expect(checklist.sections[3].title).toContain('restrictions');
  });

  test('extracts WHAT TO DOCUMENT items', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    expect(checklist.documentItems.length).toBeGreaterThanOrEqual(4);
    expect(checklist.documentItems.some(item => item.includes('Copilot service status'))).toBe(true);
    expect(checklist.documentItems.some(item => item.includes('app status'))).toBe(true);
    expect(checklist.documentItems.some(item => item.includes('policies'))).toBe(true);
    expect(checklist.documentItems.some(item => item.includes('visibility'))).toBe(true);
  });

  test('all sections start with status pending', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    for (const section of checklist.sections) {
      expect(section.status).toBe('pending');
      expect(section.findings).toBeNull();
    }
  });

  test('returns isInvestigation=false for non-investigation goals', () => {
    const checklist = parseInvestigationChecklist('Click the submit button on the form');
    expect(checklist.isInvestigation).toBe(false);
    expect(checklist.sections).toHaveLength(0);
  });

  test('returns isInvestigation=false for single-section prompts', () => {
    const checklist = parseInvestigationChecklist('1. Do one thing');
    expect(checklist.isInvestigation).toBe(false);
    expect(checklist.sections).toHaveLength(1);
  });

  test('parses prompt with sub-tasks (bullet points)', () => {
    const prompt = `Investigate network issue:
1. Check router
   - Verify uptime
   - Check firmware version
2. Check switch
   - Log in to web UI
   - Check port status
WHAT TO CHECK: uptime, firmware, ports`;
    const checklist = parseInvestigationChecklist(prompt);
    expect(checklist.sections).toHaveLength(2);
    expect(checklist.isInvestigation).toBe(true);
  });

  test('handles empty goal gracefully', () => {
    const checklist = parseInvestigationChecklist('');
    expect(checklist.sections).toHaveLength(0);
    expect(checklist.isInvestigation).toBe(false);
    expect(checklist.documentItems).toHaveLength(0);
  });

  test('handles null/undefined goal gracefully', () => {
    const checklist1 = parseInvestigationChecklist(null);
    expect(checklist1.sections).toHaveLength(0);
    const checklist2 = parseInvestigationChecklist(undefined);
    expect(checklist2.sections).toHaveLength(0);
  });

  test('totalTasks counts sections plus sub-tasks', () => {
    const prompt = `Investigate:
1. Check A
   - Sub-task 1
   - Sub-task 2
2. Check B`;
    const checklist = parseInvestigationChecklist(prompt);
    // 2 sections + 2 sub-tasks = 4 total tasks
    expect(checklist.totalTasks).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════
// isInvestigationGoal
// ═══════════════════════════════════════════════════════════
describe('isInvestigationGoal', () => {
  test('returns true for Nick Givens Copilot prompt', () => {
    expect(isInvestigationGoal(NICK_GIVENS_COPILOT_PROMPT)).toBe(true);
  });

  test('returns true for any 2+ numbered section prompt', () => {
    expect(isInvestigationGoal('1. Do A\n2. Do B\n3. Do C')).toBe(true);
  });

  test('returns false for simple goal', () => {
    expect(isInvestigationGoal('Click the submit button')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isInvestigationGoal('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// formatChecklistForPrompt
// ═══════════════════════════════════════════════════════════
describe('formatChecklistForPrompt', () => {
  test('formats Nick Givens checklist with all sections', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    const formatted = formatChecklistForPrompt(checklist);
    
    expect(formatted).toContain('INVESTIGATION CHECKLIST');
    expect(formatted).toContain('1.');
    expect(formatted).toContain('2.');
    expect(formatted).toContain('3.');
    expect(formatted).toContain('4.');
    expect(formatted).toContain('Microsoft 365 Admin Center');
    expect(formatted).toContain('Teams Admin Center');
    expect(formatted).toContain('Nick Givens');
  });

  test('includes REQUIRED DOCUMENTATION section', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    const formatted = formatChecklistForPrompt(checklist);
    
    expect(formatted).toContain('REQUIRED DOCUMENTATION');
    expect(formatted).toContain('Copilot service status');
    expect(formatted).toContain('visibility');
  });

  test('does not include REQUIRED DOCUMENTATION when no items', () => {
    const checklist = parseInvestigationChecklist('1. Do A\n2. Do B');
    const formatted = formatChecklistForPrompt(checklist);
    expect(formatted).not.toContain('REQUIRED DOCUMENTATION');
  });

  test('includes tracking instruction', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    const formatted = formatChecklistForPrompt(checklist);
    expect(formatted).toContain('Track Progress');
  });
});

// ═══════════════════════════════════════════════════════════
// updateChecklistStatus
// ═══════════════════════════════════════════════════════════
describe('updateChecklistStatus', () => {
  test('updates section status to in_progress', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'in_progress');
    expect(checklist.sections[0].status).toBe('in_progress');
  });

  test('updates section status to done with findings', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 2, 'done', 'Copilot app status: Allowed');
    expect(checklist.sections[1].status).toBe('done');
    expect(checklist.sections[1].findings).toBe('Copilot app status: Allowed');
  });

  test('does not crash for invalid section id', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 999, 'done', 'nothing');
    // Should not throw, sections unchanged
    expect(checklist.sections).toHaveLength(4);
  });

  test('sets findings to null when findings param is null', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'done', null);
    expect(checklist.sections[0].status).toBe('done');
    expect(checklist.sections[0].findings).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// getChecklistProgress
// ═══════════════════════════════════════════════════════════
describe('getChecklistProgress', () => {
  test('returns 0% for fresh checklist', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    const progress = getChecklistProgress(checklist);
    expect(progress.done).toBe(0);
    expect(progress.total).toBe(4);
    expect(progress.percentage).toBe(0);
  });

  test('returns 25% after one section done', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'done', 'found something');
    const progress = getChecklistProgress(checklist);
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(4);
    expect(progress.percentage).toBe(25);
  });

  test('returns 100% when all sections done', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'done', 'a');
    updateChecklistStatus(checklist, 2, 'done', 'b');
    updateChecklistStatus(checklist, 3, 'done', 'c');
    updateChecklistStatus(checklist, 4, 'done', 'd');
    const progress = getChecklistProgress(checklist);
    expect(progress.done).toBe(4);
    expect(progress.total).toBe(4);
    expect(progress.percentage).toBe(100);
  });

  test('does not count in_progress as done', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'in_progress');
    updateChecklistStatus(checklist, 2, 'done', 'b');
    const progress = getChecklistProgress(checklist);
    expect(progress.done).toBe(1);
    expect(progress.percentage).toBe(25);
  });

  test('handles empty checklist', () => {
    const checklist = { sections: [] };
    const progress = getChecklistProgress(checklist);
    expect(progress.done).toBe(0);
    expect(progress.total).toBe(0);
    expect(progress.percentage).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// formatFindingsForReport
// ═══════════════════════════════════════════════════════════
describe('formatFindingsForReport', () => {
  test('includes all section titles in report', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    const report = formatFindingsForReport(checklist);
    
    expect(report).toContain('Microsoft 365 Admin Center');
    expect(report).toContain('Teams Admin Center');
    expect(report).toContain('Nick Givens');
  });

  test('includes findings text when present', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'done', 'Copilot service is active and healthy');
    const report = formatFindingsForReport(checklist);
    expect(report).toContain('Copilot service is active and healthy');
  });

  test('includes progress summary', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'done', 'a');
    updateChecklistStatus(checklist, 2, 'done', 'b');
    const report = formatFindingsForReport(checklist);
    expect(report).toContain('2/4');
    expect(report).toContain('50%');
  });

  test('includes document items section', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    const report = formatFindingsForReport(checklist);
    expect(report).toContain('Required Documentation');
  });

  test('shows status icons for different states', () => {
    const checklist = parseInvestigationChecklist(NICK_GIVENS_COPILOT_PROMPT);
    updateChecklistStatus(checklist, 1, 'done', 'found it');
    updateChecklistStatus(checklist, 2, 'in_progress');
    const report = formatFindingsForReport(checklist);
    // Done section should have checkmark emoji
    expect(report).toContain('✅');
  });
});
