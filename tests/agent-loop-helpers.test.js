import { jest } from '@jest/globals';
import {
  buildSmartUrl,
  buildGoogleFallbackUrl,
  buildBudgetHint,
  compareHostnames,
  formatVisionHistory,
  buildVisionSystemPrompt,
  buildVisionUserContent,
  buildRunLogEntry,
  isGoalComplete,
  isPageMutating,
  normalizeGoalUrl,
  isExplicitNavigation,
} from '../background/agent-loop-helpers.js';

describe('agent-loop-helpers', () => {
  describe('buildSmartUrl', () => {
    test('builds Google search URL', () => {
      const url = buildSmartUrl('google', 'test query');
      expect(url).toBe('https://www.google.com/search?q=test%20query');
    });

    test('builds Wikipedia search URL', () => {
      const url = buildSmartUrl('wikipedia', 'MSP automation');
      expect(url).toContain('en.wikipedia.org');
      expect(url).toContain('MSP%20automation');
    });

    test('builds YouTube search URL', () => {
      const url = buildSmartUrl('youtube', 'funny cats');
      expect(url).toContain('youtube.com');
      expect(url).toContain('funny%20cats');
    });

    test('builds Amazon search URL', () => {
      const url = buildSmartUrl('amazon', 'laptop stand');
      expect(url).toContain('amazon.com');
    });

    test('builds Reddit search URL', () => {
      const url = buildSmartUrl('reddit', 'sysadmin');
      expect(url).toContain('reddit.com');
    });

    test('builds Twitter/X search URL', () => {
      const url = buildSmartUrl('twitter', 'AI news');
      expect(url).toContain('x.com');
    });

    test('builds X search URL for "x" alias', () => {
      const url = buildSmartUrl('x', 'AI news');
      expect(url).toContain('x.com');
    });

    test('builds weather.gov URL', () => {
      const url = buildSmartUrl('weather.gov', '90210');
      expect(url).toContain('forecast.weather.gov');
    });

    test('returns empty string for unknown site', () => {
      const url = buildSmartUrl('myspace', 'old news');
      expect(url).toBe('');
    });

    test('encodes special characters', () => {
      const url = buildSmartUrl('google', 'test & query <script>');
      expect(url).toContain('test%20%26%20query%20%3Cscript%3E');
    });
  });

  describe('buildGoogleFallbackUrl', () => {
    test('builds Google fallback URL', () => {
      const url = buildGoogleFallbackUrl('fallback search');
      expect(url).toBe('https://www.google.com/search?q=fallback%20search');
    });
  });

  describe('buildBudgetHint', () => {
    test('builds hint with step info', () => {
      const hint = buildBudgetHint(5, 100, 3);
      expect(hint).toContain('Current step: 5 of 100');
      expect(hint).toContain('95 remaining');
      expect(hint).toContain('3 productive');
    });

    test('calculates remaining steps correctly', () => {
      const hint = buildBudgetHint(98, 100, 50);
      expect(hint).toContain('2 remaining');
    });

    test('clamps remaining to 0 at max steps', () => {
      const hint = buildBudgetHint(100, 100, 80);
      expect(hint).toContain('0 remaining');
    });

    test('includes pacing guidance', () => {
      const hint = buildBudgetHint(1, 50, 0);
      expect(hint).toContain('productive');
      expect(hint).toContain('unproductive');
    });
  });

  describe('compareHostnames', () => {
    test('detects same hostname', () => {
      const result = compareHostnames('https://example.com/page', 'https://example.com/other');
      expect(result.alreadyThere).toBe(true);
    });

    test('detects different hostnames', () => {
      const result = compareHostnames('https://example.com', 'https://other.com');
      expect(result.alreadyThere).toBe(false);
    });

    test('ignores www prefix', () => {
      const result = compareHostnames('https://www.example.com', 'https://example.com');
      expect(result.alreadyThere).toBe(true);
    });

    test('handles subdomains', () => {
      const result = compareHostnames('https://admin.example.com', 'https://example.com');
      expect(result.alreadyThere).toBe(true);
    });

    test('handles invalid URLs gracefully', () => {
      const result = compareHostnames('not-a-url', 'also-not-a-url');
      expect(result.alreadyThere).toBe(false);
      expect(result.currentHost).toBe('');
      expect(result.targetHost).toBe('');
    });

    test('handles empty URLs', () => {
      const result = compareHostnames('', 'https://example.com');
      expect(result.alreadyThere).toBe(false);
    });
  });

  describe('formatVisionHistory', () => {
    test('formats history entries', () => {
      const history = [
        { step: 1, action: { type: 'click', index: 5 }, result: 'success' },
        { step: 2, action: { type: 'input', index: 3, text: 'hello' }, result: 'typed' },
      ];
      const formatted = formatVisionHistory(history);
      expect(formatted).toContain('Step 1: click(5)');
      expect(formatted).toContain('Step 2: input(3)');
      expect(formatted).toContain('hello');
    });

    test('limits to window size', () => {
      const history = Array.from({ length: 20 }, (_, i) => ({
        step: i + 1,
        action: { type: 'click', index: i },
        result: 'ok',
      }));
      const formatted = formatVisionHistory(history, 10);
      const lines = formatted.split('\n');
      expect(lines.length).toBe(10);
    });

    test('skips entries without action', () => {
      const history = [
        { step: 1, action: null, result: '' },
        { step: 2, action: { type: 'click', index: 1 }, result: 'ok' },
      ];
      const formatted = formatVisionHistory(history);
      expect(formatted).toContain('Step 2');
      expect(formatted).not.toContain('Step 1');
    });

    test('handles empty history', () => {
      expect(formatVisionHistory([])).toBe('');
    });

    test('truncates long text', () => {
      const longText = 'a'.repeat(100);
      const history = [
        { step: 1, action: { type: 'input', text: longText }, result: 'ok' },
      ];
      const formatted = formatVisionHistory(history);
      expect(formatted.length).toBeLessThan(200);
    });
  });

  describe('buildVisionSystemPrompt', () => {
    test('returns a non-empty string', () => {
      const prompt = buildVisionSystemPrompt();
      expect(prompt.length).toBeGreaterThan(100);
    });

    test('contains rules section', () => {
      const prompt = buildVisionSystemPrompt();
      expect(prompt).toContain('<rules>');
      expect(prompt).toContain('</rules>');
    });

    test('contains actions section', () => {
      const prompt = buildVisionSystemPrompt();
      expect(prompt).toContain('<actions>');
      expect(prompt).toContain('click(index)');
    });

    test('contains output format section', () => {
      const prompt = buildVisionSystemPrompt();
      expect(prompt).toContain('<output_format>');
    });

    test('contains visual grounding section', () => {
      const prompt = buildVisionSystemPrompt();
      expect(prompt).toContain('<visual_grounding>');
    });
  });

  describe('buildVisionUserContent', () => {
    test('builds content with goal and URL', () => {
      const content = buildVisionUserContent('Test goal', 'https://example.com', 1, 100, '[1] Button', 'Step 1: click(5)', null);
      expect(content).toContain('Goal: Test goal');
      expect(content).toContain('URL: https://example.com');
      expect(content).toContain('Step: 1/100');
    });

    test('includes element tree', () => {
      const content = buildVisionUserContent('g', 'u', 1, 10, '[1] Login button', '', null);
      expect(content).toContain('[1] Login button');
    });

    test('shows (none) for empty element tree', () => {
      const content = buildVisionUserContent('g', 'u', 1, 10, '', '', null);
      expect(content).toContain('(none)');
    });

    test('includes vision history', () => {
      const content = buildVisionUserContent('g', 'u', 1, 10, '', 'Step 1: click(5)', null);
      expect(content).toContain('Step 1: click(5)');
    });

    test('shows placeholder for empty history', () => {
      const content = buildVisionUserContent('g', 'u', 1, 10, '', '', null);
      expect(content).toContain('(first step');
    });
  });

  describe('buildRunLogEntry', () => {
    test('builds a structured log entry', () => {
      const cmd = { type: 'click', selector: '#btn', text: 'Submit', x: 10, y: 20 };
      const entry = buildRunLogEntry(5, 'https://example.com', cmd, 'success', false, 'Contoso', 'reasoning', null);
      expect(entry.step).toBe(5);
      expect(entry.kind).toBe('action');
      expect(entry.url).toBe('https://example.com');
      expect(entry.tenant).toBe('Contoso');
      expect(entry.action_type).toBe('click');
      expect(entry.action.selector).toBe('#btn');
      expect(entry.action.text).toBe('Submit');
      expect(entry.failed).toBe(false);
      expect(entry.reasoning).toBe('reasoning');
    });

    test('handles string result', () => {
      const cmd = { type: 'navigate', url: 'https://example.com' };
      const entry = buildRunLogEntry(1, 'about:blank', cmd, 'Navigated successfully', false, '', null, null);
      expect(entry.result).toBe('Navigated successfully');
    });

    test('truncates long result strings', () => {
      const longResult = 'x'.repeat(1000);
      const cmd = { type: 'extract' };
      const entry = buildRunLogEntry(1, 'u', cmd, longResult, false, '', null, null);
      expect(entry.result.length).toBe(500);
    });

    test('handles object result', () => {
      const cmd = { type: 'click' };
      const entry = buildRunLogEntry(1, 'u', cmd, { data: 'test' }, false, '', null, null);
      expect(entry.result).toContain('data');
    });

    test('marks failed actions', () => {
      const cmd = { type: 'click' };
      const entry = buildRunLogEntry(1, 'u', cmd, 'error', true, '', null, null);
      expect(entry.failed).toBe(true);
    });

    test('includes timestamp', () => {
      const cmd = { type: 'click' };
      const entry = buildRunLogEntry(1, 'u', cmd, 'ok', false, '', null, null);
      expect(entry.timestamp).toBeDefined();
      expect(typeof entry.timestamp).toBe('string');
    });
  });

  describe('isGoalComplete', () => {
    test('returns true for done command', () => {
      expect(isGoalComplete({ type: 'done' })).toBe(true);
    });

    test('returns false for non-done commands', () => {
      expect(isGoalComplete({ type: 'click' })).toBe(false);
      expect(isGoalComplete({ type: 'navigate' })).toBe(false);
    });

    test('returns false for null command', () => {
      expect(isGoalComplete(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isGoalComplete(undefined)).toBe(false);
    });
  });

  describe('isPageMutating', () => {
    test('returns true for mutating actions', () => {
      const re = /^(click|input|navigate)$/;
      expect(isPageMutating('click', re)).toBe(true);
      expect(isPageMutating('input', re)).toBe(true);
      expect(isPageMutating('navigate', re)).toBe(true);
    });

    test('returns false for non-mutating actions', () => {
      const re = /^(click|input|navigate)$/;
      expect(isPageMutating('extract', re)).toBe(false);
      expect(isPageMutating('read_page', re)).toBe(false);
      expect(isPageMutating('scroll', re)).toBe(false);
    });
  });

  describe('normalizeGoalUrl', () => {
    test('returns URL as-is if it has protocol', () => {
      expect(normalizeGoalUrl('https://example.com', null)).toBe('https://example.com');
    });

    test('adds https:// protocol', () => {
      expect(normalizeGoalUrl('example.com', null)).toBe('https://example.com');
    });

    test('uses domain match if provided', () => {
      expect(normalizeGoalUrl('example', 'example.com')).toBe('https://example.com');
    });
  });

  describe('isExplicitNavigation', () => {
    test('detects "go to" imperative', () => {
      expect(isExplicitNavigation('go to admin.microsoft.com')).toBe(true);
    });

    test('detects "navigate to" imperative', () => {
      expect(isExplicitNavigation('navigate to https://example.com')).toBe(true);
    });

    test('detects "visit" imperative', () => {
      expect(isExplicitNavigation('visit portal.azure.com')).toBe(true);
    });

    test('detects "open" imperative', () => {
      expect(isExplicitNavigation('open the admin center')).toBe(true);
    });

    test('detects "browse to" imperative', () => {
      expect(isExplicitNavigation('browse to example.com')).toBe(true);
    });

    test('detects "check" imperative', () => {
      expect(isExplicitNavigation('check the SonicWall')).toBe(true);
    });

    test('detects "begin at:" pattern', () => {
      expect(isExplicitNavigation('begin at: https://example.com')).toBe(true);
    });

    test('detects "start url:" pattern', () => {
      expect(isExplicitNavigation('start url: https://example.com')).toBe(true);
    });

    test('returns false for non-navigation goals', () => {
      expect(isExplicitNavigation('fix the broken ticket')).toBe(false);
      expect(isExplicitNavigation('user cannot reach admin.microsoft.com')).toBe(false);
    });

    test('handles non-string input', () => {
      expect(isExplicitNavigation(null)).toBe(false);
      expect(isExplicitNavigation(undefined)).toBe(false);
      expect(isExplicitNavigation(42)).toBe(false);
    });
  });
});
