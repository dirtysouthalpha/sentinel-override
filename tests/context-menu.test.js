/**
 * Sentinel Override — Context Menu Tests
 * Tests for context menu installation and click handling
 */

import { jest } from '@jest/globals';

// Mock chrome API - must be set before import
const mockCreate = jest.fn();
const mockRemoveAll = jest.fn((callback) => {
  callback?.();
});
const mockGetURL = jest.fn((path) => `chrome-extension://test/${path}`);

global.chrome = {
  contextMenus: {
    removeAll: mockRemoveAll,
    create: mockCreate,
  },
  runtime: {
    getURL: mockGetURL,
  },
};

import { installContextMenus, handleMenuClick } from '../background/context-menu.js';

describe('context-menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('installContextMenus', () => {
    it('should remove existing menus before creating new ones', () => {
      installContextMenus();

      expect(mockRemoveAll).toHaveBeenCalled();
    });

    it('should create parent menu', () => {
      installContextMenus();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-parent',
          title: '🛡️ Sentinel Override',
          contexts: ['page', 'selection', 'link'],
        })
      );
    });

    it('should create all child menu items', () => {
      installContextMenus();

      // Check for sentinel-analyze
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-analyze',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-extract
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-extract',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-fill-form
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-fill-form',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-screenshot
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-screenshot',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-summarize
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-summarize',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-monitor
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-monitor',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-record
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-record',
          parentId: 'sentinel-parent',
        })
      );

      // Check for sentinel-quick-assist
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-quick-assist',
          parentId: 'sentinel-parent',
        })
      );
    });

    it('should create separator', () => {
      installContextMenus();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-sep',
          parentId: 'sentinel-parent',
          type: 'separator',
        })
      );
    });

    it('should create run macro menu item', () => {
      installContextMenus();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-run-macro',
          parentId: 'sentinel-parent',
          title: '▶️ Run Macro...',
        })
      );
    });

    it('should create export report menu item', () => {
      installContextMenus();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sentinel-export-report',
          parentId: 'sentinel-parent',
          title: '📊 Export Run Report',
        })
      );
    });
  });

  describe('handleMenuClick', () => {
    const mockTab = { id: 123, url: 'https://example.com' };

    it('should return null for unknown menu items', () => {
      const result = handleMenuClick(
        { menuItemId: 'unknown-item' },
        mockTab
      );

      expect(result).toBeNull();
    });

    it('should handle analyze action', () => {
      const result = handleMenuClick(
        {
          menuItemId: 'sentinel-analyze',
          selectionText: 'selected text',
          linkUrl: 'https://link.com',
        },
        mockTab
      );

      expect(result).toEqual({
        action: 'analyze',
        params: {
          selectionText: 'selected text',
          linkUrl: 'https://link.com',
          pageUrl: 'https://example.com',
          tabId: 123,
        },
      });
    });

    it('should handle extract action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-extract', selectionText: 'data to extract' },
        mockTab
      );

      expect(result).toEqual({
        action: 'extract',
        params: {
          selectionText: 'data to extract',
          tabId: 123,
        },
      });
    });

    it('should handle fill form action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-fill-form' },
        mockTab
      );

      expect(result).toEqual({
        action: 'fill_form',
        params: { tabId: 123 },
      });
    });

    it('should handle screenshot action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-screenshot' },
        mockTab
      );

      expect(result).toEqual({
        action: 'screenshot',
        params: { tabId: 123 },
      });
    });

    it('should handle summarize action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-summarize' },
        mockTab
      );

      expect(result).toEqual({
        action: 'summarize',
        params: { pageUrl: 'https://example.com', tabId: 123 },
      });
    });

    it('should handle monitor changes action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-monitor', selectionText: 'watch this' },
        mockTab
      );

      expect(result).toEqual({
        action: 'monitor_changes',
        params: {
          selectionText: 'watch this',
          tabId: 123,
        },
      });
    });

    it('should handle start recording action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-record' },
        mockTab
      );

      expect(result).toEqual({
        action: 'start_recording',
        params: { tabId: 123 },
      });
    });

    it('should handle run macro action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-run-macro' },
        mockTab
      );

      expect(result).toEqual({
        action: 'run_macro',
        params: { tabId: 123 },
      });
    });

    it('should handle export report action', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-export-report' },
        mockTab
      );

      expect(result).toEqual({
        action: 'export_report',
        params: { tabId: 123 },
      });
    });

    it('should handle quick assist action', () => {
      const result = handleMenuClick(
        {
          menuItemId: 'sentinel-quick-assist',
          selectionText: 'help with this',
        },
        mockTab
      );

      expect(result).toEqual({
        action: 'quick_assist',
        params: {
          selectionText: 'help with this',
          pageUrl: 'https://example.com',
          tabId: 123,
        },
      });
    });

    it('should handle missing tab gracefully', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-screenshot' },
        null
      );

      expect(result).toEqual({
        action: 'screenshot',
        params: { tabId: undefined },
      });
    });

    it('should handle missing selection text', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-extract' },
        mockTab
      );

      expect(result).toEqual({
        action: 'extract',
        params: {
          selectionText: '',
          tabId: 123,
        },
      });
    });

    it('should handle missing link URL', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-analyze' },
        mockTab
      );

      expect(result).toEqual({
        action: 'analyze',
        params: {
          selectionText: '',
          linkUrl: '',
          pageUrl: 'https://example.com',
          tabId: 123,
        },
      });
    });

    it('should handle missing tab URL', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-summarize' },
        { id: 123 }
      );

      expect(result).toEqual({
        action: 'summarize',
        params: { pageUrl: '', tabId: 123 },
      });
    });

    it('should handle monitor action without selection text', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-monitor' },
        mockTab
      );

      expect(result).toEqual({
        action: 'monitor_changes',
        params: { selectionText: '', tabId: 123 },
      });
    });

    it('should handle quick assist action without selection text', () => {
      const result = handleMenuClick(
        { menuItemId: 'sentinel-quick-assist' },
        mockTab
      );

      expect(result).toEqual({
        action: 'quick_assist',
        params: { selectionText: '', pageUrl: 'https://example.com', tabId: 123 },
      });
    });
  });
});
