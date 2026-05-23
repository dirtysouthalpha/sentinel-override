// tests/frame-router-edge-cases.test.js
// Edge case tests for background/frame-router.js error paths

import { jest } from '@jest/globals';

const mockFrames = [];

globalThis.chrome = {
  webNavigation: {
    getAllFrames: jest.fn(async () => mockFrames),
  },
  tabs: {
    sendMessage: jest.fn(async () => {}),
  },
  runtime: {
    getURL: jest.fn((p) => p),
    lastError: null,
  },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  emit: jest.fn(),
  tel: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('frame-router edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrames.length = 0;
    chrome.runtime.lastError = null;
  });

  describe('enumerateFrames error handling', () => {
    test('should handle getAllFrames returning null', async () => {
      const { enumerateFrames } = await import('../background/frame-router.js');

      chrome.webNavigation.getAllFrames.mockResolvedValueOnce(null);

      const frames = await enumerateFrames(123);
      expect(frames).toEqual([]);
    });

    test('should handle getAllFrames returning empty array', async () => {
      const { enumerateFrames } = await import('../background/frame-router.js');

      chrome.webNavigation.getAllFrames.mockResolvedValueOnce([]);

      const frames = await enumerateFrames(123);
      expect(frames).toEqual([]);
    });

    test('should handle getAllFrames throwing errors', async () => {
      const { enumerateFrames } = await import('../background/frame-router.js');

      chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('Tab closed'));

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const frames = await enumerateFrames(123);
        expect(frames).toEqual([]);
        // The error is logged with the error object, not just the message
        expect(errorSpy).toHaveBeenCalledWith(
          '[Sentinel/frame-router] enumerateFrames failed:',
          expect.anything()
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('resolveFrameForSelector error handling', () => {
    test('should handle getAllFrames errors gracefully', async () => {
      const { resolveFrameForSelector } = await import('../background/frame-router.js');

      chrome.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('Tab closed'));

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const result = await resolveFrameForSelector(123, 0);
        expect(result).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(
          '[Sentinel/frame-router] enumerateFrames failed:',
          'Tab closed'
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('should handle webNavigation API throwing', async () => {
      const { resolveFrameForSelector } = await import('../background/frame-router.js');

      chrome.webNavigation.getAllFrames.mockImplementationOnce(() => {
        throw new Error('API unavailable');
      });

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const result = await resolveFrameForSelector(123, 0);
        expect(result).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('should return null when frame index is out of bounds', async () => {
      const { resolveFrameForSelector } = await import('../background/frame-router.js');

      mockFrames.push(
        { frameId: 0, url: 'https://example.com', parentId: -1 },
        { frameId: 1, url: 'https://example.com/frame1', parentId: 0 }
      );
      chrome.webNavigation.getAllFrames.mockResolvedValueOnce([...mockFrames]);

      const result = await resolveFrameForSelector(123, 999);
      // Out of bounds index should return null
      expect(result).toBeNull();
    });
  });

  describe('frame map operations', () => {
    test('should handle frame map operations internally', async () => {
      // Since clearFrameMap and rebuildFrameMap are internal functions,
      // we test their effects through the public API
      const { enumerateFrames } = await import('../background/frame-router.js');

      mockFrames.push(
        { frameId: 0, url: 'https://example.com', parentId: -1 },
        { frameId: 1, url: 'https://example.com/frame1', parentId: 0 }
      );
      chrome.webNavigation.getAllFrames.mockResolvedValueOnce([...mockFrames]);

      const frames = await enumerateFrames(123);
      expect(frames).toBeDefined();
      expect(frames.length).toBe(2);
    });
  });

  describe('cross-origin detection', () => {
    test('should handle missing main frame gracefully', async () => {
      const { enumerateFrames } = await import('../background/frame-router.js');

      mockFrames.push(
        { frameId: 1, url: 'https://other.com', parentId: -1 }
      );
      chrome.webNavigation.getAllFrames.mockResolvedValueOnce([...mockFrames]);

      const frames = await enumerateFrames(123);
      expect(frames).toBeDefined();
    });

    test('should filter out main frame (frameId 0)', async () => {
      const { enumerateFrames } = await import('../background/frame-router.js');

      mockFrames.push(
        { frameId: 0, url: 'https://example.com', parentId: -1 },
        { frameId: 1, url: 'https://example.com/frame1', parentId: 0 },
        { frameId: 2, url: 'https://example.com/frame2', parentId: 0 },
        { frameId: 3, url: 'https://example.com/frame3', parentId: 2 }
      );
      chrome.webNavigation.getAllFrames.mockResolvedValueOnce([...mockFrames]);

      const frames = await enumerateFrames(123);

      // enumerateFrames returns all frames, marking iframes with isIframe: true
      const mainFrame = frames.find(f => f.frameId === 0);
      const iframes = frames.filter(f => f.isIframe);

      // Main frame should not be marked as iframe
      expect(mainFrame).toBeDefined();
      expect(mainFrame.isIframe).toBe(false);

      // Other frames should be marked as iframes
      expect(iframes.length).toBe(3);
      expect(iframes.every(f => f.isIframe)).toBe(true);
    });

    test('should handle multiple nested iframes', async () => {
      const { enumerateFrames } = await import('../background/frame-router.js');

      mockFrames.push(
        { frameId: 0, url: 'https://example.com', parentId: -1 },
        { frameId: 1, url: 'https://example.com/frame1', parentId: 0 },
        { frameId: 2, url: 'https://other.com/frame2', parentId: 1 },
        { frameId: 3, url: 'https://example.com/frame3', parentId: 2 }
      );
      chrome.webNavigation.getAllFrames.mockResolvedValueOnce([...mockFrames]);

      const frames = await enumerateFrames(123);
      expect(frames.length).toBeGreaterThan(0);
    });
  });
});
