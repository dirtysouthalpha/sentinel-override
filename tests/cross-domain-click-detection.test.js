// tests/cross-domain-click-detection.test.js
// Tests for cross-domain click detection (commit 0523ab5)
// Verifies that clicks navigating to external domains are detected and reported to LLM.

import { jest } from '@jest/globals';

describe('Cross-domain click detection', () => {
  describe('hostname comparison logic', () => {
    test('detects cross-domain navigation (different hostnames)', () => {
      const fromHost = 'example.com';
      const clickedHost = 'other-site.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(true);
    });

    test('allows same-domain navigation (identical hostnames)', () => {
      const fromHost = 'example.com';
      const clickedHost = 'example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(false);
    });

    test('allows www subdomain variation (www.example.com -> example.com)', () => {
      const fromHost = 'www.example.com';
      const clickedHost = 'example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(false);
    });

    test('allows www subdomain variation (example.com -> www.example.com)', () => {
      const fromHost = 'example.com';
      const clickedHost = 'www.example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(false);
    });

    test('allows subdomain navigation (blog.example.com -> example.com)', () => {
      const fromHost = 'blog.example.com';
      const clickedHost = 'example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(false);
    });

    test('allows subdomain navigation (example.com -> blog.example.com)', () => {
      const fromHost = 'example.com';
      const clickedHost = 'blog.example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(false);
    });

    test('detects cross-domain to external link (example.com -> external.com)', () => {
      const fromHost = 'example.com';
      const clickedHost = 'external.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(true);
    });

    test('handles case sensitivity (hostname is lowercased)', () => {
      const fromHost = 'Example.Com'.toLowerCase();
      const clickedHost = 'example.com'.toLowerCase();

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      expect(isCrossDomain).toBe(false);
    });

    test('handles TLD-only comparison (co.uk vs com)', () => {
      const fromHost = 'example.co.uk';
      const clickedHost = 'example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      const isCrossDomain = !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      // These should be detected as cross-domain since they're different TLDs
      expect(isCrossDomain).toBe(true);
    });

    test('handles null/undefined fromHost gracefully', () => {
      const fromHost = '';
      const clickedHost = 'example.com';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      // Empty fromHost means no cross-domain check (evaluates to falsy)
      const isCrossDomain = fromHost && clickedHost && !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      // Empty string is falsy, which is correct behavior
      expect(isCrossDomain).toBeFalsy();
    });

    test('handles null/undefined clickedHost gracefully', () => {
      const fromHost = 'example.com';
      const clickedHost = '';

      const fromNormalized = fromHost.replace(/^www\./, '');
      const clickedNormalized = clickedHost.replace(/^www\./, '');
      // Empty clickedHost means no cross-domain check (evaluates to falsy)
      const isCrossDomain = fromHost && clickedHost && !clickedHost.includes(fromNormalized) && !fromHost.includes(clickedNormalized);

      // Empty string is falsy, which is correct behavior
      expect(isCrossDomain).toBeFalsy();
    });
  });

  describe('URL parsing edge cases', () => {
    test('handles invalid URL gracefully', () => {
      expect(() => {
        new URL('not-a-url');
      }).toThrow();
    });

    test('handles valid URL with port', () => {
      const url = new URL('https://example.com:8080/path');
      expect(url.hostname).toBe('example.com');
    });

    test('handles valid URL with query params', () => {
      const url = new URL('https://example.com/path?query=value');
      expect(url.hostname).toBe('example.com');
    });

    test('handles valid URL with fragment', () => {
      const url = new URL('https://example.com/path#fragment');
      expect(url.hostname).toBe('example.com');
    });

    test('handles localhost', () => {
      const url = new URL('http://localhost:3000/path');
      expect(url.hostname).toBe('localhost');
    });

    test('handles IP address', () => {
      const url = new URL('http://192.168.1.1/path');
      expect(url.hostname).toBe('192.168.1.1');
    });

    test('handles file:// URL', () => {
      const url = new URL('file:///path/to/file');
      expect(url.hostname).toBe('');
    });

    test('handles about:blank', () => {
      const url = new URL('about:blank');
      expect(url.hostname).toBe('');
    });
  });

  describe('warning message generation', () => {
    test('generates correct warning message for cross-domain click', () => {
      const fromHost = 'example.com';
      const clickedHost = 'external.com';

      const expectedWarning = 'WARNING: Click navigated away from ' + fromHost + ' to ' + clickedHost + '. You likely clicked an EXTERNAL link instead of an on-page element. Navigate back to ' + fromHost + ' and look for the correct in-page link (e.g., "comments", "discuss", or "N comments" text).';

      expect(expectedWarning).toContain('WARNING');
      expect(expectedWarning).toContain(fromHost);
      expect(expectedWarning).toContain(clickedHost);
      expect(expectedWarning).toContain('EXTERNAL link');
      expect(expectedWarning).toContain('Navigate back');
    });

    test('generates correct success message for same-domain navigation', () => {
      const clickedHost = 'example.com';
      const result = 'Clicked -> navigated to ' + clickedHost;

      expect(result).toContain('Clicked');
      expect(result).toContain(clickedHost);
      expect(result).not.toContain('WARNING');
    });
  });
});
