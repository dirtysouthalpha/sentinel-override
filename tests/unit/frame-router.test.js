// Sentinel Override v3 -- Unit tests for background/frame-router.js
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

describe('frame-router', () => {
  let chrome;

  beforeAll(() => {
    chrome = setupChromeMock();
  });

  let enumerateFrames, resolveFrameForSelector, executeInFrame;

  beforeAll(async () => {
    const mod = await import('../../background/frame-router.js');
    enumerateFrames = mod.enumerateFrames;
    resolveFrameForSelector = mod.resolveFrameForSelector;
    executeInFrame = mod.executeInFrame;
  });

  // ========== enumerateFrames ==========
  describe('enumerateFrames', () => {
    it('returns empty array when no frames', async () => {
      // Mock returns [{ frameId: 0, url: 'about:blank' }] by default
      // Override to return empty
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [];
      const result = await enumerateFrames(1);
      expect(result).toEqual([]);
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('returns empty array on error', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => { throw new Error('fail'); };
      const result = await enumerateFrames(1);
      expect(result).toEqual([]);
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('returns main frame with isIframe=false', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'https://example.com' },
      ];
      const result = await enumerateFrames(1);
      expect(result).toHaveLength(1);
      expect(result[0].isIframe).toBe(false);
      expect(result[0].isCrossOrigin).toBe(false);
      expect(result[0].frameId).toBe(0);
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('detects same-origin iframes', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'https://example.com' },
        { frameId: 1, parentId: 0, url: 'https://example.com/embed' },
      ];
      const result = await enumerateFrames(1);
      expect(result).toHaveLength(2);
      expect(result[1].isIframe).toBe(true);
      expect(result[1].isCrossOrigin).toBe(false);
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('detects cross-origin iframes', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'https://example.com' },
        { frameId: 1, parentId: 0, url: 'https://other.com/widget' },
      ];
      const result = await enumerateFrames(1);
      expect(result[1].isCrossOrigin).toBe(true);
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('handles invalid URLs gracefully', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'not-a-valid-url' },
        { frameId: 1, parentId: 0, url: 'also-invalid' },
      ];
      const result = await enumerateFrames(1);
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('not-a-valid-url');
      chrome.webNavigation.getAllFrames = origGetAll;
    });
  });

  // ========== resolveFrameForSelector ==========
  describe('resolveFrameForSelector', () => {
    it('returns null for invalid frame index', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'https://example.com' },
      ];
      const result = await resolveFrameForSelector(1, 0);
      expect(result).toBeNull();
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('returns null for negative index', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'https://example.com' },
        { frameId: 1, parentId: 0, url: 'https://example.com/iframe' },
      ];
      const result = await resolveFrameForSelector(1, -1);
      expect(result).toBeNull();
      chrome.webNavigation.getAllFrames = origGetAll;
    });

    it('returns frameId for valid index', async () => {
      const origGetAll = chrome.webNavigation.getAllFrames;
      chrome.webNavigation.getAllFrames = async () => [
        { frameId: 0, parentId: -1, url: 'https://example.com' },
        { frameId: 5, parentId: 0, url: 'https://example.com/iframe' },
        { frameId: 10, parentId: 0, url: 'https://other.com/widget' },
      ];
      const result = await resolveFrameForSelector(1, 0);
      expect(result).toBe(5);
      const result2 = await resolveFrameForSelector(1, 1);
      expect(result2).toBe(10);
      chrome.webNavigation.getAllFrames = origGetAll;
    });
  });

  // ========== executeInFrame ==========
  describe('executeInFrame', () => {
    it('returns error for missing tabId', async () => {
      const result = await executeInFrame(null, 1, { type: 'click' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('returns error for missing frameId', async () => {
      const result = await executeInFrame(1, null, { type: 'click' });
      expect(result.ok).toBe(false);
    });

    it('returns error for missing command', async () => {
      const result = await executeInFrame(1, 1, null);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing command type');
    });

    it('returns error for command without type', async () => {
      const result = await executeInFrame(1, 1, { foo: 'bar' });
      expect(result.ok).toBe(false);
    });

    it('returns error when scripting fails', async () => {
      // Default mock returns empty array which triggers "No result" error
      const result = await executeInFrame(1, 1, { type: 'click' });
      expect(result.ok).toBe(false);
    });
  });
});
