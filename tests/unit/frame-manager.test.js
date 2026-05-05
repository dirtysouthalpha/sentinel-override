// Sentinel Override v3 -- Unit tests for content/frame-manager.js
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

describe('frame-manager', () => {
  let frame;

  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    await import('../../content/dom-utils.js');
    await import('../../content/frame-manager.js');
    frame = window.__sentinelUtils.frame;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('exports frame from window.__sentinelUtils.frame', () => {
    expect(frame).toBeDefined();
    expect(frame.scanIframes).toBeInstanceOf(Function);
    expect(frame.findInIframe).toBeInstanceOf(Function);
    expect(frame.getIframeInfo).toBeInstanceOf(Function);
  });

  describe('scanIframes', () => {
    it('returns empty result for null document', () => {
      const result = frame.scanIframes(null);
      expect(result.elements).toEqual([]);
      expect(result.iframeCount).toBe(0);
      expect(result.crossOriginCount).toBe(0);
    });

    it('returns empty result when no iframes present', () => {
      document.body.innerHTML = '<div>No iframes here</div>';
      const result = frame.scanIframes(document);
      expect(result.elements).toEqual([]);
      expect(result.iframeCount).toBe(0);
    });

    it('counts same-origin iframes', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'about:blank';
      document.body.appendChild(iframe);

      const result = frame.scanIframes(document);
      expect(result.iframeCount).toBe(1);
    });
  });

  describe('findInIframe', () => {
    it('returns null for non-frame selector', () => {
      expect(frame.findInIframe(document, '#my-element')).toBeNull();
    });

    it('returns null for null selector', () => {
      expect(frame.findInIframe(document, null)).toBeNull();
    });

    it('returns null for invalid frame index', () => {
      expect(frame.findInIframe(document, 'frame:abc:element')).toBeNull();
    });

    it('returns null when no iframe at index', () => {
      const result = frame.findInIframe(document, 'frame:0:#element');
      expect(result).toBeNull();
    });
  });

  describe('getIframeInfo', () => {
    it('returns empty array for null document', () => {
      expect(frame.getIframeInfo(null)).toEqual([]);
    });

    it('returns empty array when no iframes', () => {
      document.body.innerHTML = '<div>No iframes</div>';
      expect(frame.getIframeInfo(document)).toEqual([]);
    });

    it('returns info for each iframe', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com/frame';
      document.body.appendChild(iframe);

      const info = frame.getIframeInfo(document);
      expect(info.length).toBe(1);
      expect(info[0].src).toBe('https://example.com/frame');
      expect(info[0].index).toBe(0);
      expect(typeof info[0].width).toBe('number');
      expect(typeof info[0].height).toBe('number');
    });

    it('detects same-origin iframes', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'about:blank';
      document.body.appendChild(iframe);

      const info = frame.getIframeInfo(document);
      expect(info[0].sameOrigin).toBe(true);
    });
  });
});
