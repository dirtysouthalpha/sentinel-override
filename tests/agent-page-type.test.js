import { getPageStrategyHint } from '../background/agent-page-type.js';

describe('agent-page-type', () => {
  describe('getPageStrategyHint', () => {
    test('returns empty string for low confidence', () => {
      expect(getPageStrategyHint({ type: 'data_table', confidence: 0.3 })).toBe('');
    });

    test('returns hint for data_table', () => {
      const result = getPageStrategyHint({ type: 'data_table', confidence: 0.9, details: { dataRowCount: 47 } });
      expect(result).toContain('DATA TABLE');
      expect(result).toContain('47');
    });

    test('returns hint for login_form', () => {
      const result = getPageStrategyHint({ type: 'login_form', confidence: 0.95, details: {} });
      expect(result).toContain('LOGIN');
    });

    test('returns hint for dashboard', () => {
      const result = getPageStrategyHint({ type: 'dashboard', confidence: 0.85, details: { iframeCount: 2 } });
      expect(result).toContain('DASHBOARD');
      expect(result).toContain('iframes');
    });

    test('returns hint for loading_or_empty', () => {
      const result = getPageStrategyHint({ type: 'loading_or_empty', confidence: 0.7, details: {} });
      expect(result).toContain('LOADING');
    });

    test('returns empty for null input', () => {
      expect(getPageStrategyHint(null)).toBe('');
    });

    test('returns empty for unknown type', () => {
      expect(getPageStrategyHint({ type: 'unknown', confidence: 0.9 })).toBe('');
    });
  });
});
