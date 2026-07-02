import { buildProgressSummary, shouldSummarize, compactHistory } from '../background/agent-summarizer.js';

describe('agent-summarizer', () => {
  describe('buildProgressSummary', () => {
    test('returns empty for empty history', () => {
      expect(buildProgressSummary([], {}, 1)).toBe('');
    });

    test('returns summary with memory keys', () => {
      const history = [{ step: 1, action: { type: 'navigate' }, result: 'OK' }];
      const memory = { page_content: 'Hello world' };
      const result = buildProgressSummary(history, memory, 8);
      expect(result).toContain('PROGRESS SUMMARY');
      expect(result).toContain('page_content');
      expect(result).toContain('Hello world');
    });

    test('includes action counts', () => {
      const history = [
        { step: 1, action: { type: 'navigate' }, result: 'OK' },
        { step: 2, action: { type: 'execute_js' }, result: 'OK' },
        { step: 3, action: { type: 'execute_js' }, result: 'OK' },
      ];
      const result = buildProgressSummary(history, { key: 'val' }, 3);
      expect(result).toContain('navigate(1)');
      expect(result).toContain('execute_js(2)');
    });

    test('detects failures', () => {
      const history = [
        { step: 1, action: { type: 'click' }, result: 'failed: not found' },
      ];
      const result = buildProgressSummary(history, { key: 'val' }, 1);
      expect(result).toContain('1 failed');
    });
  });

  describe('shouldSummarize', () => {
    test('returns true every 8 steps', () => {
      expect(shouldSummarize(8)).toBe(true);
      expect(shouldSummarize(16)).toBe(true);
      expect(shouldSummarize(24)).toBe(true);
    });

    test('returns false for non-8 steps', () => {
      expect(shouldSummarize(1)).toBe(false);
      expect(shouldSummarize(7)).toBe(false);
      expect(shouldSummarize(9)).toBe(false);
    });

    test('returns false for 0', () => {
      expect(shouldSummarize(0)).toBe(false);
    });
  });

  describe('compactHistory', () => {
    test('returns short history unchanged', () => {
      const history = [{ step: 1 }, { step: 2 }];
      expect(compactHistory(history, 'summary')).toBe(history);
    });

    test('compacts long history', () => {
      const history = [];
      for (let i = 1; i <= 10; i++) {
        history.push({ step: i, action: { type: 'test' }, result: 'OK' });
      }
      const result = compactHistory(history, 'SUMMARY TEXT');
      expect(result.length).toBeLessThan(history.length);
      expect(result[0].action._isSummary).toBe(true);
      expect(result[0].result).toBe('SUMMARY TEXT');
    });
  });
});
