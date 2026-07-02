import { isComplexGoal, parseDecomposition } from '../background/agent-orchestrator.js';

describe('agent-orchestrator', () => {
  describe('isComplexGoal', () => {
    test('returns false for short goals', () => {
      expect(isComplexGoal('Go to example.com and extract data')).toBe(false);
    });

    test('returns true for numbered sections', () => {
      const goal = 'Investigate the website example.com and complete these tasks:\n\n1. List the top 3 stories\n2. Count how many mention AI\n3. Find the newest story';
      expect(isComplexGoal(goal)).toBe(true);
    });

    test('returns true for multiple Navigate to', () => {
      const goal = 'Navigate to page1.com and extract X. Then Navigate to page2.com and extract Y. Navigate to page3.com and extract Z.';
      expect(isComplexGoal(goal)).toBe(true);
    });

    test('returns false for null', () => {
      expect(isComplexGoal(null)).toBe(false);
      expect(isComplexGoal(undefined)).toBe(false);
      expect(isComplexGoal('')).toBe(false);
    });
  });

  describe('parseDecomposition', () => {
    test('parses valid JSON', () => {
      const response = JSON.stringify({
        subtasks: [
          { title: 'Task 1', goal: 'Do thing 1', context: 'Context 1' },
          { title: 'Task 2', goal: 'Do thing 2', context: 'Context 2' },
        ]
      });
      const result = parseDecomposition(response);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Task 1');
    });

    test('returns null for invalid input', () => {
      expect(parseDecomposition(null)).toBeNull();
      expect(parseDecomposition('')).toBeNull();
      expect(parseDecomposition('not json')).toBeNull();
    });

    test('returns null for no subtasks', () => {
      expect(parseDecomposition(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });
  });
});
