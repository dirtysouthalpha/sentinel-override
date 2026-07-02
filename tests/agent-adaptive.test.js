import { diagnoseFailure, getDomainFromUrl, extractWinningStrategy } from '../background/agent-adaptive.js';

describe('agent-adaptive', () => {
  describe('getDomainFromUrl', () => {
    test('extracts domain from URL', () => {
      expect(getDomainFromUrl('https://www.example.com/page')).toBeTruthy();
    });
    test('handles subdomain', () => {
      expect(getDomainFromUrl('https://portal.microsoft.com/dashboard')).toBe('portal.microsoft.com');
    });
    test('handles null', () => {
      expect(getDomainFromUrl(null)).toBe('unknown');
      expect(getDomainFromUrl('')).toBe('unknown');
    });
  });

  describe('diagnoseFailure', () => {
    test('returns null for null input', () => {
      expect(diagnoseFailure(null, null)).toBeFalsy();
    });
  });

  describe('extractWinningStrategy', () => {
    test('returns null for empty history', () => {
      expect(extractWinningStrategy([], 'test.com')).toBeFalsy();
    });
    test('returns null for null history', () => {
      expect(extractWinningStrategy(null, 'test.com')).toBeFalsy();
    });
  });
});
