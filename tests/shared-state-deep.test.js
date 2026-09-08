// tests/shared-state-deep.test.js
// Deep tests for background/shared-state.js — SPA transitions, keepalive, notifyIfEnabled.

import { jest } from '@jest/globals';

// Mock chrome APIs
const mockSessionStorage = { set: jest.fn(), remove: jest.fn() };
const mockLocalStorage = { get: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockRuntime = { getPlatformInfo: jest.fn() };

global.chrome = {
  storage: {
    session: mockSessionStorage,
    local: mockLocalStorage,
  },
  notifications: mockNotifications,
  runtime: mockRuntime,
};

// We need to reimport for each test group since module-level state persists
let setSPATransitionPending, isSPATransitionPending, clearSPATransition;
let startSwKeepalive, stopSwKeepalive, notifyIfEnabled;

describe('shared-state: SPA transition flags', () => {
  beforeAll(async () => {
    const mod = await import('../background/shared-state.js');
    setSPATransitionPending = mod.setSPATransitionPending;
    isSPATransitionPending = mod.isSPATransitionPending;
    clearSPATransition = mod.clearSPATransition;
    startSwKeepalive = mod.startSwKeepalive;
    stopSwKeepalive = mod.stopSwKeepalive;
    notifyIfEnabled = mod.notifyIfEnabled;
  });

  afterEach(() => {
    clearSPATransition();
    jest.clearAllMocks();
    // Clean up any keepalive intervals
    jest.useRealTimers();
  });

  test('initial state is not pending', () => {
    expect(isSPATransitionPending()).toBe(false);
  });

  test('setSPATransitionPending sets flag to true', () => {
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
  });

  test('clearSPATransition sets flag to false', () => {
    setSPATransitionPending();
    clearSPATransition();
    expect(isSPATransitionPending()).toBe(false);
  });

  test('clearSPATransition is safe when not pending', () => {
    expect(() => clearSPATransition()).not.toThrow();
    expect(isSPATransitionPending()).toBe(false);
  });

  test('multiple sets keep flag true', () => {
    setSPATransitionPending();
    setSPATransitionPending();
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
  });

  test('set after clear works', () => {
    setSPATransitionPending();
    clearSPATransition();
    setSPATransitionPending();
    expect(isSPATransitionPending()).toBe(true);
  });
});

describe('shared-state: keepalive reference counting', () => {
  beforeAll(async () => {
    const mod = await import('../background/shared-state.js');
    startSwKeepalive = mod.startSwKeepalive;
    stopSwKeepalive = mod.stopSwKeepalive;
  });

  afterEach(() => {
    // Clean up all keepalives
    try { stopSwKeepalive('test-a'); } catch {}
    try { stopSwKeepalive('test-b'); } catch {}
    try { stopSwKeepalive('default'); } catch {}
    mockSessionStorage.set.mockClear();
    mockSessionStorage.remove.mockClear();
    mockRuntime.getPlatformInfo.mockClear();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('start with default name calls tick immediately', () => {
    startSwKeepalive('default');
    // tick should have been called
    expect(mockSessionStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_default': expect.any(Number) })
    );
  });

  test('start with custom name uses that name in storage key', () => {
    startSwKeepalive('custom-name');
    expect(mockSessionStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_custom-name': expect.any(Number) })
    );
  });

  test('start with empty string defaults to "default"', () => {
    startSwKeepalive('');
    expect(mockSessionStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_default': expect.any(Number) })
    );
  });

  test('start with null defaults to "default"', () => {
    startSwKeepalive(null);
    expect(mockSessionStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_default': expect.any(Number) })
    );
  });

  test('start with non-string defaults to "default"', () => {
    startSwKeepalive(123);
    expect(mockSessionStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({ '_sw_keepalive_default': expect.any(Number) })
    );
  });

  test('stop clears session storage key', () => {
    startSwKeepalive('test-stop');
    mockSessionStorage.set.mockClear();
    stopSwKeepalive('test-stop');
    expect(mockSessionStorage.remove).toHaveBeenCalledWith('_sw_keepalive_test-stop');
  });

  test('stop with empty string defaults to default', () => {
    startSwKeepalive('default');
    mockSessionStorage.remove.mockClear();
    stopSwKeepalive('');
    expect(mockSessionStorage.remove).toHaveBeenCalledWith('_sw_keepalive_default');
  });
});

describe('shared-state: notifyIfEnabled', () => {
  beforeAll(async () => {
    const mod = await import('../background/shared-state.js');
    notifyIfEnabled = mod.notifyIfEnabled;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('no-ops when sound not enabled', async () => {
    mockLocalStorage.get.mockResolvedValue({ sentinelSoundEnabled: false });
    await notifyIfEnabled({ title: 'Test', message: 'Hello' });
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });

  test('fires when sound enabled (opts form)', async () => {
    mockLocalStorage.get.mockResolvedValue({ sentinelSoundEnabled: true });
    mockNotifications.create.mockResolvedValue('notif-id');
    await notifyIfEnabled({ title: 'Test', message: 'Hello' });
    expect(mockNotifications.create).toHaveBeenCalledWith({ title: 'Test', message: 'Hello' });
  });

  test('fires when sound enabled (id + opts form)', async () => {
    mockLocalStorage.get.mockResolvedValue({ sentinelSoundEnabled: true });
    mockNotifications.create.mockResolvedValue('notif-id');
    await notifyIfEnabled('my-id', { title: 'Test', message: 'Hello' });
    expect(mockNotifications.create).toHaveBeenCalledWith('my-id', { title: 'Test', message: 'Hello' });
  });

  test('handles storage error gracefully', async () => {
    mockLocalStorage.get.mockRejectedValue(new Error('Storage unavailable'));
    await notifyIfEnabled({ title: 'Test' });
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });

  test('handles notifications error gracefully', async () => {
    mockLocalStorage.get.mockResolvedValue({ sentinelSoundEnabled: true });
    mockNotifications.create.mockRejectedValue(new Error('No permission'));
    await expect(notifyIfEnabled({ title: 'Test' })).resolves.not.toThrow();
  });

  test('defaults to false when storage returns empty', async () => {
    mockLocalStorage.get.mockResolvedValue({});
    await notifyIfEnabled({ title: 'Test' });
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });
});
