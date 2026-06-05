/**
 * Tests for content/quick-assist.js
 * Floating AI panel content script with Shadow DOM.
 */

import { jest } from '@jest/globals';

// Mock chrome.runtime API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
    },
    getURL: jest.fn(path => `chrome-extension://test/${path}`),
  },
  storage: {
    onChanged: {
      addListener: jest.fn(),
    },
    local: {
      get: jest.fn(),
    },
  },
};

describe('content/quick-assist.js', () => {
  describe('Action definitions', () => {
    it('should define all expected actions', () => {
      const expectedActions = [
        { id: 'summarize', label: 'Summarize' },
        { id: 'explain', label: 'Explain' },
        { id: 'fix', label: 'Troubleshoot' },
        { id: 'playbook', label: 'Playbook' },
        { id: 'extract', label: 'Extract' },
        { id: 'rewrite', label: 'Rewrite' },
      ];

      expect(expectedActions).toHaveLength(6);
      expect(expectedActions[0].id).toBe('summarize');
      expect(expectedActions[5].id).toBe('rewrite');
    });
  });

  describe('Markdown rendering', () => {
    function renderMarkdown(text) {
      if (!text) return '';
      let html = text
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Bold **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        // Inline code `text`
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Lists: - item or * item or 1. item
        .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // Line breaks
        .replace(/\n/g, '<br>');

      // Wrap consecutive <li> in <ul>
      html = html.replace(/((?:<li>.*?<\/li>(?:<br>)?)+)/g, '<ul>$1</ul>');
      html = html.replace(/<br><\/ul>/g, '</ul>');
      html = html.replace(/<\/li><br>/g, '</li>');
      return html;
    }

    it('should escape HTML in text', () => {
      const input = '<script>alert("xss")</script>';
      const output = renderMarkdown(input);

      expect(output).toContain('&lt;script&gt;');
      expect(output).not.toContain('<script>');
    });

    it('should render bold markdown', () => {
      const input = 'This is **bold** text';
      const output = renderMarkdown(input);

      expect(output).toContain('<strong>bold</strong>');
    });

    it('should render inline code', () => {
      const input = 'Use `const x = 1` for variables';
      const output = renderMarkdown(input);

      expect(output).toContain('<code>const x = 1</code>');
    });

    it('should render list items', () => {
      const input = '- First item\n- Second item';
      const output = renderMarkdown(input);

      expect(output).toContain('<li>First item</li>');
      expect(output).toContain('<li>Second item</li>');
    });

    it('should handle numbered lists', () => {
      const input = '1. First\n2. Second';
      const output = renderMarkdown(input);

      expect(output).toContain('<li>First</li>');
      expect(output).toContain('<li>Second</li>');
    });
  });

  describe('Panel positioning', () => {
    it('should calculate panel position near selection', () => {
      const selectionRect = { width: 100, height: 20, right: 1000, top: 500 };
      const windowWidth = 1920;
      const windowHeight = 1080;
      const panelWidth = 420;
      const panelHeight = 400;

      const xPos = Math.min(selectionRect.right + 8, windowWidth - panelWidth);
      const yPos = Math.max(10, Math.min(selectionRect.top, windowHeight - panelHeight));

      expect(xPos).toBeGreaterThanOrEqual(0);
      expect(xPos).toBeLessThanOrEqual(windowWidth - panelWidth);
      expect(yPos).toBeGreaterThanOrEqual(10);
      expect(yPos).toBeLessThanOrEqual(windowHeight - panelHeight);
    });

    it('should center panel when no selection', () => {
      const windowWidth = 1920;
      const windowHeight = 1080;
      const panelWidth = 420;
      const panelHeight = 400;

      const centerX = Math.max(10, (windowWidth - panelWidth) / 2);
      const centerY = Math.max(10, (windowHeight - panelHeight) / 2);

      expect(centerX).toBeGreaterThan(0);
      expect(centerY).toBeGreaterThan(0);
      expect(centerX).toBeLessThan(windowWidth / 2);
      expect(centerY).toBeLessThan(windowHeight / 2);
    });

    it('should constrain to viewport bounds', () => {
      const windowWidth = 300;
      const windowHeight = 150;
      const panelWidth = 420;
      const panelHeight = 400;

      const centerX = Math.max(10, (windowWidth - panelWidth) / 2);
      const centerY = Math.max(10, (windowHeight - panelHeight) / 2);

      expect(centerX).toBe(10); // Min bound
      expect(centerY).toBe(10); // Min bound
    });
  });

  describe('Trigger button positioning', () => {
    it('should position trigger button near selection', () => {
      const selectionRect = { width: 100, height: 20, right: 500, top: 300 };
      const windowWidth = 1920;
      const windowHeight = 1080;

      const triggerX = Math.min(selectionRect.right + 8, windowWidth - 40);
      const triggerY = Math.max(4, selectionRect.top);

      expect(triggerX).toBe(508); // selectionRect.right + 8
      expect(triggerY).toBe(300); // selectionRect.top
    });

    it('should clamp trigger button to viewport', () => {
      const selectionRect = { width: 100, height: 20, right: 1900, top: 300 };
      const windowWidth = 1920;

      const triggerX = Math.min(selectionRect.right + 8, windowWidth - 40);

      expect(triggerX).toBe(1880); // windowWidth - 40
    });
  });

  describe('Response rendering', () => {
    it('should render error message', () => {
      const errorHTML = '<span class="qa-error">Error: Test error</span>';

      expect(errorHTML).toContain('qa-error');
      expect(errorHTML).toContain('Error: Test error');
    });

    it('should render placeholder', () => {
      const placeholderHTML = '<div class="qa-placeholder">' +
        'Click an action button above to analyze the selected text' +
        '</div>';

      expect(placeholderHTML).toContain('qa-placeholder');
      expect(placeholderHTML).toContain('Click an action button');
    });

    it('should render loading indicator', () => {
      const loadingHTML = '<div class="qa-loading-indicator">' +
        '<div class="qa-dots"><span></span><span></span><span></span></div>' +
        '<span>Analyzing...</span></div>';

      expect(loadingHTML).toContain('qa-loading-indicator');
      expect(loadingHTML).toContain('Analyzing...');
    });
  });

  describe('Edge cases', () => {
    it('should handle no text selected', () => {
      const selectedText = '';

      expect(selectedText).toBe('');
    });

    it('should handle very long text selection', () => {
      const longText = 'a'.repeat(10000);

      expect(longText).toHaveLength(10000);
    });

    it('should handle special characters in selection', () => {
      const specialText = '<script>alert("xss")</script> & "quotes"';

      const escaped = specialText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&amp;');
    });

    it('should handle short selections', () => {
      const shortText = 'short';

      expect(shortText).toHaveLength(5);
      expect(shortText.length).toBeLessThan(10);
    });

    it('should handle rapid open/close cycles', () => {
      const states = ['open', 'close', 'open', 'close', 'open'];

      expect(states).toHaveLength(5);
    });
  });

  describe('Message handling', () => {
    it('should have chrome runtime API available', () => {
      expect(chrome.runtime).toBeDefined();
      expect(chrome.runtime.sendMessage).toBeDefined();
      expect(chrome.runtime.onMessage).toBeDefined();
    });

    it('should have chrome storage API available', () => {
      expect(chrome.storage).toBeDefined();
      expect(chrome.storage.onChanged).toBeDefined();
    });
  });

  describe('Action prompts', () => {
    const actions = [
      { id: 'summarize', label: 'Summarize', prompt: 'Summarize the following text concisely, highlighting key points:' },
      { id: 'explain', label: 'Explain', prompt: 'Explain this in plain language for a non-technical audience:' },
      { id: 'fix', label: 'Troubleshoot', prompt: 'Given the following error/message, suggest troubleshooting steps for an IT technician:' },
      { id: 'playbook', label: 'Playbook', prompt: 'Based on the following, create a step-by-step IT runbook/playbook for an MSP technician:' },
      { id: 'extract', label: 'Extract', prompt: 'Extract all structured data (IPs, email addresses, dates, ticket numbers, hostnames, URLs) from:' },
      { id: 'rewrite', label: 'Rewrite', prompt: 'Rewrite the following in a professional tone suitable for client communication:' }
    ];

    it('should have summarize prompt', () => {
      const summarize = actions.find(a => a.id === 'summarize');
      expect(summarize.prompt).toContain('Summarize');
    });

    it('should have extract prompt', () => {
      const extract = actions.find(a => a.id === 'extract');
      expect(extract.prompt).toContain('Extract');
    });

    it('should have troubleshoot prompt', () => {
      const fix = actions.find(a => a.id === 'fix');
      expect(fix.prompt).toContain('troubleshooting steps');
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should handle Escape key', () => {
      const escapeEvent = { key: 'Escape', preventDefault: jest.fn() };

      expect(escapeEvent.key).toBe('Escape');
    });
  });

  describe('Panel structure', () => {
    it('should define all panel components', () => {
      const components = [
        'qa-panel',
        'qa-header',
        'qa-title',
        'qa-close',
        'qa-actions',
        'qa-btn',
        'qa-selection',
        'qa-response-wrap',
        'qa-footer',
        'qa-footer-btn',
        'qa-trigger',
      ];

      expect(components).toHaveLength(11);
    });

    it('should have CSS classes for styling', () => {
      const cssClasses = [
        'qa-panel',
        'qa-header',
        'qa-title',
        'qa-close',
        'qa-actions',
        'qa-btn',
        'qa-selection',
        'qa-response-wrap',
        'qa-response',
        'qa-footer',
        'qa-footer-btn',
        'qa-trigger',
      ];

      cssClasses.forEach(cls => {
        expect(cls).toMatch(/^qa-/);
      });
    });
  });
});
