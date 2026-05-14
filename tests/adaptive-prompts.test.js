// tests/adaptive-prompts.test.js
// Unit tests for background/adaptive-prompts.js — extractJsonObject, rewriteGoalForPlatform.

import { jest } from '@jest/globals';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        for (const k of Object.keys(keys)) {
          result[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
        }
        return result;
      }),
    },
  },
};

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({ endpoint: 'https://api.test.com/v1', apiKey: 'test-key', model: 'test-model' })),
}));

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => null),
  findMismatchHints: jest.fn(() => []),
}));

// extractJsonObject is not exported — test it via the rewriteGoalForPlatform path,
// but we can still test the main exported function thoroughly.

const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

const { getPlatformProfile } = await import('../background/platforms/index.js');
const { getActiveProvider } = await import('../background/provider-registry.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
});

describe('rewriteGoalForPlatform', () => {
  test('returns adapted=false for goal too short', async () => {
    const result = await rewriteGoalForPlatform('short', 'https://example.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('too short');
  });

  test('returns adapted=false for non-string goal', async () => {
    const result = await rewriteGoalForPlatform(null, 'https://example.com');
    expect(result.adapted).toBe(false);
  });

  test('returns adapted=false when no platform profile matches', async () => {
    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network', 'https://example.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no matching platform');
  });

  test('returns adapted=false when provider has no API key', async () => {
    getPlatformProfile.mockReturnValueOnce({
      id: 'test-platform',
      label: 'Test Platform',
      memoryKeyPrefix: 'test',
      liveDataCaveats: 'None',
      knownGotchas: 'None',
      rewriteInstructions: 'Use cloud menus',
      waitStrings: {},
      pageTypes: [],
      workflowHints: [],
    });
    getActiveProvider.mockResolvedValueOnce({ endpoint: '', apiKey: '', model: '' });

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance', 'https://test.example.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no active provider');
    expect(result.platform).toEqual({ id: 'test-platform', label: 'Test Platform', memoryKeyPrefix: 'test' });
  });

  test('returns result with platform info when profile matches', async () => {
    getPlatformProfile.mockReturnValueOnce({
      id: 'sonicwall-nsm',
      label: 'SonicWall NSM',
      memoryKeyPrefix: 'nsm',
      liveDataCaveats: 'Data may be cached',
      knownGotchas: 'UI loads slowly',
      rewriteInstructions: 'Use NSM cloud menus',
      waitStrings: {},
      pageTypes: [],
      workflowHints: [],
    });
    getActiveProvider.mockResolvedValueOnce({ endpoint: '', apiKey: '', model: '' });

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the SonicWall NSM portal for compliance issues', 'https://sonicwall.com');
    expect(result.platform).toEqual({ id: 'sonicwall-nsm', label: 'SonicWall NSM', memoryKeyPrefix: 'nsm' });
  });

  test('returns original goal as adaptedGoal when not adapted', async () => {
    const result = await rewriteGoalForPlatform('short', 'https://example.com');
    expect(result.adaptedGoal).toBe('short');
    expect(result.originalGoal).toBe('short');
  });

  test('always returns durationMs', async () => {
    const result = await rewriteGoalForPlatform('short', 'https://example.com');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns mismatchHints from findMismatchHints', async () => {
    getPlatformProfile.mockReturnValueOnce({
      id: 'test', label: 'Test', memoryKeyPrefix: 't',
      liveDataCaveats: '', knownGotchas: '', rewriteInstructions: '',
      waitStrings: {}, pageTypes: [], workflowHints: [],
    });
    const { findMismatchHints } = await import('../background/platforms/index.js');
    findMismatchHints.mockReturnValueOnce([{ onbox: 'Manage > Firewall', target: 'Security > Firewall' }]);
    getActiveProvider.mockResolvedValueOnce({ endpoint: '', apiKey: '', model: '' });

    const result = await rewriteGoalForPlatform('Navigate to Manage > Firewall and check the rules on the SonicWall appliance for compliance', 'https://test.com');
    expect(result.mismatchHints).toHaveLength(1);
  });

  test('skips rewrite when expansionMode=off and no mismatches and no preflight', async () => {
    getPlatformProfile.mockReturnValueOnce({
      id: 'test', label: 'Test', memoryKeyPrefix: 't',
      liveDataCaveats: '', knownGotchas: '', rewriteInstructions: '',
      waitStrings: {}, pageTypes: [], workflowHints: [],
      needsTargetSelection: false,
    });

    const result = await rewriteGoalForPlatform('Investigate the configuration on the portal', 'https://test.com', {}, 'off');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('adaptation disabled');
  });
});
