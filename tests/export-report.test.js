/**
 * Sentinel Override — Export Report Tests
 * Tests for HTML report generation from audit logs
 */

import { generateHtmlReport } from '../background/export-report.js';

// Mock truncate and escapeHtml for testing since they're not exported
// We'll test them indirectly through generateHtmlReport

describe('export-report', () => {
  describe('generateHtmlReport', () => {
    it('should generate valid HTML structure', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test goal',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:01:30Z',
        totalSteps: 0,
        status: 'completed',
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      expect(html).toContain('Sentinel Override');
    });

    it('should escape HTML in goal to prevent XSS', () => {
      const auditLog = [];
      const metadata = {
        goal: '<script>alert("XSS")</script>',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:01:00Z',
        totalSteps: 0,
        status: 'completed',
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).not.toContain('<script>alert("XSS")</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should handle missing metadata fields with defaults', () => {
      const auditLog = [];
      const metadata = {};

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('Unknown'); // default goal
      expect(html).toContain('0s'); // default duration
      expect(html).toContain('completed'); // default status
    });

    it('should format duration correctly under 1 minute', () => {
      const auditLog = [];
      const metadata = {
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:00:30Z',
        totalSteps: 5,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('30s');
      // Check that duration doesn't have minutes format (e.g., "1m 30s")
      expect(html).not.toMatch(/\d+m \d+s/);
    });

    it('should format duration correctly over 1 minute', () => {
      const auditLog = [];
      const metadata = {
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:02:45Z',
        totalSteps: 10,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('2m 45s');
    });

    it('should render audit log steps', () => {
      const auditLog = [
        {
          action: { type: 'click', params: { selector: '#button' } },
          actionFailed: false,
          duration: 150,
          result: 'Clicked successfully',
        },
        {
          action: { type: 'type', params: { text: 'test input' } },
          actionFailed: true,
          duration: 100,
          result: 'Failed: element not found',
        },
      ];
      const metadata = {
        goal: 'Test steps',
        totalSteps: 2,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('click');
      expect(html).toContain('type');
      expect(html).toContain('150ms');
      expect(html).toContain('100ms');
      expect(html).toContain('step-failed');
      expect(html).toContain('step-ok');
      expect(html).toContain('❌');
      expect(html).toContain('✅');
    });

    it('should handle action as string', () => {
      const auditLog = [
        {
          action: 'screenshot',
          actionFailed: false,
          duration: 500,
        },
      ];
      const metadata = { goal: 'Test', totalSteps: 1 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('screenshot');
    });

    it('should render screenshots as images', () => {
      const auditLog = [
        {
          action: { type: 'screenshot' },
          actionFailed: false,
          screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        },
      ];
      const metadata = { goal: 'Test screenshot', totalSteps: 1 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('<img src="data:image/jpeg;base64,/9j/4AAQSkZJRg=="');
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('screenshot');
    });

    it('should truncate long result text', () => {
      const longText = 'a'.repeat(250);
      const auditLog = [
        {
          action: { type: 'test' },
          result: longText,
        },
      ];
      const metadata = { goal: 'Test truncation', totalSteps: 1 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('…'); // ellipsis
      expect(html).not.toContain(longText); // full text should be truncated
    });

    it('should truncate long param values', () => {
      const longValue = 'x'.repeat(100);
      const auditLog = [
        {
          action: { type: 'test', params: { longParam: longValue } },
        },
      ];
      const metadata = { goal: 'Test param truncation', totalSteps: 1 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('…'); // ellipsis
    });

    it('should display trust badge for high trust scores', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test trust',
        totalSteps: 0,
        trustScore: 85,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('Trust: 85%');
      expect(html).toContain('trust-high');
      expect(html).toContain('trust-badge');
    });

    it('should display trust badge for medium trust scores', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test trust',
        totalSteps: 0,
        trustScore: 60,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('Trust: 60%');
      expect(html).toContain('trust-mid');
    });

    it('should display trust badge for low trust scores', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test trust',
        totalSteps: 0,
        trustScore: 30,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('Trust: 30%');
      expect(html).toContain('trust-low');
    });

    it('should not display trust badge when trustScore is null', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test trust',
        totalSteps: 0,
        trustScore: null,
      };

      const html = generateHtmlReport(auditLog, metadata);

      // Check that the trust badge div is not rendered (CSS class may still exist)
      expect(html).not.toContain('<div class="trust-badge');
      expect(html).not.toContain('Trust:');
    });

    it('should handle missing action params gracefully', () => {
      const auditLog = [
        {
          action: { type: 'navigate' },
          actionFailed: false,
        },
      ];
      const metadata = { goal: 'Test missing params', totalSteps: 1 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('navigate');
      expect(html).not.toContain('<span class="param">');
    });

    it('should render all CSS styles inline', () => {
      const auditLog = [];
      const metadata = { goal: 'Test CSS', totalSteps: 0 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('<style>');
      expect(html).toContain('--bg: #0f172a');
      expect(html).toContain('--brand: #818cf8');
      expect(html).toContain('--success: #34d399');
      expect(html).toContain('--error: #f87171');
    });

    it('should handle empty audit log', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Empty log test',
        startTime: '2024-01-01T00:00:00Z',
        totalSteps: 0,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('Steps');
      expect(html).toContain('0'); // step count
    });

    it('should include footer with timestamp', () => {
      const auditLog = [];
      const metadata = { goal: 'Test footer', totalSteps: 0 };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('Generated by Sentinel Override');
      expect(html).toContain('footer');
    });

    it('should handle date formatting in metadata', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test date',
        startTime: '2024-05-15T10:30:00Z',
        totalSteps: 5,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('5/15/2024'); // US locale format
    });

    it('should display N/A when startTime is missing', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test missing date',
        totalSteps: 0,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('N/A');
    });

    it('should handle null duration (no start/end time)', () => {
      const auditLog = [];
      const metadata = {
        goal: 'Test null duration',
        totalSteps: 0,
      };

      const html = generateHtmlReport(auditLog, metadata);

      expect(html).toContain('0s'); // default duration
    });
  });
});
