// tests/adaptive-prompts.test.js
// Unit tests for background/adaptive-prompts.js — extractJsonObject (via API path), rewriteGoalForPlatform.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({
    endpoint: 'https://api.test.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    buildHeaders: (apiKey) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }),
    buildBody: (model, sys, usr, opts = {}) => ({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
      temperature: opts.temperature || 0.3,
    }),
  })),
}));

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => null),
  findMismatchHints: jest.fn(() => []),
}));

import { rewriteGoalForPlatform } from '../background/adaptive-prompts.js';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        if (keys && typeof keys === 'object') {
          for (const k of Object.keys(keys)) {
            result[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
          }
        }
        return result;
      }),
    },
  },
};

const BASE_PROFILE = {
  id: 'test-platform',
  label: 'Test Platform',
  memoryKeyPrefix: 'test',
  liveDataCaveats: 'Data may be cached',
  knownGotchas: 'UI loads slowly',
  rewriteInstructions: 'Use cloud menus',
  waitStrings: {},
  pageTypes: [],
  workflowHints: [],
};

let getPlatformProfile, findMismatchHints, getActiveProvider;

// Helper to get mocked modules
async function getMockedModules() {
  const { getPlatformProfile: gpp, findMismatchHints: fmh } = await import('../background/platforms/index.js');
  const { getActiveProvider: gap } = await import('../background/provider-registry.js');
  return { getPlatformProfile: gpp, findMismatchHints: fmh, getActiveProvider: gap };
}

function mockProviderWithApiKey() {
  return {
    id: 'openai',
    endpoint: 'https://api.test.com/v1/chat/completions',
    apiKey: 'sk-test-key',
    model: 'gpt-4o',
    buildHeaders: (apiKey) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }),
    buildBody: (model, sys, usr, opts = {}) => ({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
      temperature: opts.temperature || 0.3,
      max_tokens: opts.maxTokens || 4000
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || '',
  };
}

beforeEach(async () => {
  storageData = {};
  jest.clearAllMocks();
  if (globalThis.fetch) delete globalThis.fetch;
  const mocks = await getMockedModules();
  getPlatformProfile = mocks.getPlatformProfile;
  findMismatchHints = mocks.findMismatchHints;
  getActiveProvider = mocks.getActiveProvider;
});

// ========== Early return paths ==========

describe.skip('rewriteGoalForPlatform — early returns', () => {
  test('returns adapted=false for goal too short', async () => {
    const result = await rewriteGoalForPlatform('short', 'https://example.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('too short');
  });

  test('returns adapted=false for non-string goal', async () => {
    const result = await rewriteGoalForPlatform(null, 'https://example.com');
    expect(result.adapted).toBe(false);
  });

  test('returns adapted=false for empty string goal', async () => {
    const result = await rewriteGoalForPlatform('', 'https://example.com');
    expect(result.adapted).toBe(false);
  });

  test('returns adapted=false when no platform profile matches', async () => {
    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network', 'https://example.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no matching platform profile');
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

  test('returns result with platform info when profile matches', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      id: 'sonicwall-nsm',
      label: 'SonicWall NSM',
      memoryKeyPrefix: 'nsm',
    });
    getActiveProvider.mockResolvedValueOnce({ endpoint: '', apiKey: '', model: '' });

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the SonicWall NSM portal for compliance issues', 'https://sonicwall.com');
    expect(result.platform).toEqual({ id: 'sonicwall-nsm', label: 'SonicWall NSM', memoryKeyPrefix: 'nsm' });
  });

  test('returns mismatchHints from findMismatchHints', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    findMismatchHints.mockReturnValueOnce([{ onbox: 'Manage > Firewall', target: 'Security > Firewall' }]);
    getActiveProvider.mockResolvedValueOnce({ endpoint: '', apiKey: '', model: '' });

    const result = await rewriteGoalForPlatform('Navigate to Manage > Firewall and check the rules on the SonicWall appliance for compliance', 'https://test.com');
    expect(result.mismatchHints).toHaveLength(1);
  });

  test('skips rewrite when expansionMode=off and no mismatches and no preflight', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      needsTargetSelection: false,
    });

    const result = await rewriteGoalForPlatform('Investigate the configuration on the portal', 'https://test.com', {}, 'off');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('adaptation disabled');
  });

  test('returns adapted=false when provider has no API key', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce({ endpoint: '', apiKey: '', model: '' });

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance', 'https://test.example.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no active provider');
    expect(result.platform).toEqual({ id: 'test-platform', label: 'Test Platform', memoryKeyPrefix: 'test' });
  });
});

// ========== API call paths (testing extractJsonObject via fetch mock) ==========

describe.skip('rewriteGoalForPlatform — API call paths', () => {
  test('successful adaptation returns adapted=true with adapted goal', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: '=== ADAPTED FOR Test Platform ===\n\nInvestigate the configuration using cloud menus.',
              summary: '- Updated menu paths\n- Added wait steps'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
    expect(result.adaptedGoal).toContain('ADAPTED FOR Test Platform');
    expect(result.summary).toContain('Updated menu paths');
  });

  test('handles no_adaptation_needed response', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              no_adaptation_needed: true,
              reason: 'Goal already correctly written for this platform'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no adaptation needed');
  });

  test('handles API error response', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({})
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('rewriter API 429');
  });

  test('handles empty content from API', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('empty content');
  });

  test('handles non-JSON response content', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'This is not JSON at all' } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('not valid JSON');
  });

  test('handles JSON with code fences', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '```json\n{"adapted_goal": "Rewritten goal that is at least twenty characters long", "summary": "changes made"}\n```'
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
    expect(result.adaptedGoal).toBe('Rewritten goal that is at least twenty characters long');
  });

  test('handles JSON with code fences (no json label)', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '```\n{"adapted_goal": "Another adapted goal that is at least twenty characters", "summary": "changes"}\n```'
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles JSON with control characters', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    const jsonWithControlChars = '{"adapted_goal": "Goal with \x01control\x02 chars that is long enough for testing", "summary": "cleaned"}';
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: jsonWithControlChars } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
    expect(result.adaptedGoal).toContain('Goal with');
  });

  test('handles JSON embedded in prose text', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'Here is the result:\n{"adapted_goal": "An adapted goal embedded in text that is long enough", "summary": "embedded"}\nHope that helps!'
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('rejects adapted_goal that is too short', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ adapted_goal: 'too short', summary: 'changes' })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no adapted_goal');
  });

  test('rejects response where adapted_goal is not a string', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ adapted_goal: 123, summary: 'changes' })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('no adapted_goal');
  });

  test('defaults summary to empty string when not provided', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ adapted_goal: 'A properly adapted goal that is long enough for the test validation' })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
    expect(result.summary).toBe('');
  });

  test('handles fetch network error', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => { throw new Error('Network failure'); });

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('Network failure');
  });

  test('handles AbortError (timeout)', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    globalThis.fetch = jest.fn(async () => { throw abortErr; });

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(false);
    expect(result.error).toContain('aborted');
  });
});

// ========== Prompt construction (verified via fetch call args) ==========

describe.skip('rewriteGoalForPlatform — prompt construction', () => {
  test('sends system and user content to API', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of prompt construction', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.test.com/v1/chat/completions');
    const body = JSON.parse(opts.body);
    // System prompt should contain rewriter instructions
    expect(body.messages[0].content).toContain('Adaptive Prompts rewriter');
    // User prompt should contain platform block and original goal
    expect(body.messages[1].content).toContain('DETECTED PLATFORM: Test Platform');
    expect(body.messages[1].content).toContain('Investigate the firewall configuration');
  });

  test('includes technician info in prompt', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of technician info prompt construction', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform(
      'Investigate the firewall configuration on the network appliance for compliance checking',
      'https://test.com',
      { name: 'Brandon Goolsby', company: 'Premier Networx', phone: '706-426-6313', email: 'support@test.com' }
    );

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Brandon Goolsby');
    expect(body.messages[0].content).toContain('Premier Networx');
    expect(body.messages[0].content).toContain('706-426-6313');
    expect(body.messages[0].content).toContain('support@test.com');
  });

  test('includes mismatch hints in prompt', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    findMismatchHints.mockReturnValueOnce([
      { onbox: 'Manage > Firewall', target: 'Security > Firewall' },
      { onbox: 'Device > VPN', target: 'Network > VPN' }
    ]);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of mismatch hints in prompt construction', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('MENU MISMATCHES');
    expect(body.messages[1].content).toContain('Manage > Firewall');
    expect(body.messages[1].content).toContain('Security > Firewall');
  });

  test('includes waitStrings in prompt when present', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      waitStrings: {
        pageLoad: ['Dashboard', 'Overview'],
        navigation: ['Devices', 'Policies']
      }
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of wait strings in prompt construction', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('NAVIGATION SIGNALS');
    expect(body.messages[1].content).toContain('Dashboard');
  });

  test('includes pageTypes in prompt when present', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      pageTypes: [
        { name: 'Dashboard', hint: 'Main overview page' },
        { name: 'Firewall', hint: 'Firewall rules page' }
      ]
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of page types in prompt construction', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('KNOWN SUB-PAGES');
    expect(body.messages[1].content).toContain('Main overview page');
  });

  test('includes workflow scaffold when goal matches', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      workflowHints: [
        {
          match: /firewall/i,
          hint: 'Phase 1: Navigate to Firewall\nPhase 2: Review rules\nPhase 3: Generate report'
        }
      ]
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of workflow scaffold in prompt construction', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('WORKFLOW SCAFFOLD');
    expect(body.messages[1].content).toContain('Phase 1: Navigate to Firewall');
  });

  test('skips workflow scaffold when goal does not match', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      workflowHints: [
        {
          match: /vpn/i,
          hint: 'Phase 1: Navigate to VPN\nPhase 2: Check tunnels'
        }
      ]
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation that no workflow scaffold appears', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).not.toContain('WORKFLOW SCAFFOLD');
  });

  test('includes preflight instructions when needsTargetSelection is true', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      needsTargetSelection: true,
      preflightInstructions: 'Phase 0: Select the target device from the device list before proceeding.'
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of preflight instructions in prompt', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('PRE-FLIGHT');
    expect(body.messages[1].content).toContain('Phase 0: Select the target device');
  });
});

// ========== Expansion modes ==========

describe.skip('rewriteGoalForPlatform — expansion modes', () => {
  test('light expansion mode is included in system prompt', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of light expansion mode', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com', {}, 'light');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('EXPANSION: LIGHT');
  });

  test('full expansion mode is included in system prompt', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of full expansion mode in the system prompt', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com', {}, 'full');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('EXPANSION: FULL');
  });

  test('off expansion mode proceeds when needsTargetSelection is true', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      needsTargetSelection: true,
      preflightInstructions: 'Select target device first.'
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of off mode with preflight requirements', summary: 'ok' }) } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com', {}, 'off');
    expect(result.adapted).toBe(true);
  });

  test('off expansion mode proceeds when mismatches exist', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    findMismatchHints.mockReturnValueOnce([{ onbox: 'Manage > Firewall', target: 'Security > Firewall' }]);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of off mode with mismatches detected in the system', summary: 'ok' }) } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com', {}, 'off');
    expect(result.adapted).toBe(true);
  });
});

// ========== Anthropic provider path ==========

describe.skip('rewriteGoalForPlatform — anthropic provider', () => {
  function mockAnthropicProvider() {
    return {
      id: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKey: 'ant-key',
      model: 'claude-sonnet-4-6',
      supportsToolUse: true,
      buildHeaders: (apiKey) => ({
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }),
      buildBody: (model, sys, usr, opts = {}) => ({
        model,
        max_tokens: opts.maxTokens || 4000,
        temperature: opts.temperature || 0.3,
        system: [{ type: 'text', text: sys }],
        messages: [{ role: 'user', content: usr }]
      }),
      buildBodyTextWithThinking: (model, sys, usr, thinkingBudget, opts = {}) => ({
        model,
        max_tokens: (opts.maxTokens || 4000) + thinkingBudget,
        temperature: 1,
        thinking: { type: 'enabled', budget_tokens: thinkingBudget },
        system: [{ type: 'text', text: sys }],
        messages: [{ role: 'user', content: usr }]
      }),
      parseResponse: (data) => {
        const block = data.content?.find(b => b.type === 'text');
        return block ? block.text : '';
      },
    };
  }

  test('uses anthropic format for anthropic provider', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockAnthropicProvider());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of anthropic provider format in the rewrite flow', summary: 'ok' }) }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('ant-key');
  });

  test('uses thinking for complex goals with anthropic provider', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockAnthropicProvider());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of anthropic thinking mode activation in complex goals', summary: 'ok' }) }]
      })
    }));

    const longGoal = 'Investigate the firewall configuration on the network appliance and generate a comprehensive compliance report covering all security policies, NAT rules, VPN tunnels, and access control lists with detailed findings for each section';
    await rewriteGoalForPlatform(longGoal, 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    // Complex goals (>200 chars) with thinking-capable provider should use thinking
    expect(body.thinking).toBeDefined();
    expect(body.thinking.type).toBe('enabled');
  });
});

// ========== Edge cases ==========

describe.skip('rewriteGoalForPlatform — edge cases', () => {
  test('handles URL with null currentUrl', async () => {
    getPlatformProfile.mockReturnValueOnce(null);

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance', null);
    expect(result.adapted).toBe(false);
  });

  test('handles empty pageTypes array gracefully', async () => {
    getPlatformProfile.mockReturnValueOnce({ ...BASE_PROFILE, pageTypes: [] });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of empty page types handling', summary: 'ok' }) } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles malformed pageTypes gracefully', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      pageTypes: [null, { name: '' }, { hint: 'no name' }, { name: 'Valid', hint: 'valid hint' }]
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of malformed page types handling in the system', summary: 'ok' }) } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('Valid: valid hint');
  });

  test('handles malformed waitStrings gracefully', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      waitStrings: { pageLoad: [], navigation: 'not an array' }
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of malformed wait strings handling', summary: 'ok' }) } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles malformed workflowHints gracefully', async () => {
    getPlatformProfile.mockReturnValueOnce({
      ...BASE_PROFILE,
      workflowHints: [null, { match: 'not a regex' }, { hint: 'no match' }]
    });
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of malformed workflow hints handling in the system', summary: 'ok' }) } }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('uses default expansion mode light when not specified', async () => {
    getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ adapted_goal: 'A long enough adapted goal for validation of default expansion mode being light', summary: 'ok' }) } }]
      })
    }));

    await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('EXPANSION: LIGHT');
  });
});

// ========== Edge case: malformed profile data ==========

describe.skip('rewriteGoalForPlatform — malformed profile data', () => {
  test('handles malformed waitStrings gracefully', async () => {
    const malformedProfile = {
      ...BASE_PROFILE,
      waitStrings: { malformed: 'not an array' },
    };
    getPlatformProfile.mockReturnValueOnce(malformedProfile);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: 'A long enough adapted goal for validation of malformed waitStrings handling in the system',
              summary: 'ok'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    // Should still adapt, just without the waitStrings block
    expect(result.adapted).toBe(true);
  });

  test('handles malformed pageTypes gracefully', async () => {
    const malformedProfile = {
      ...BASE_PROFILE,
      pageTypes: 'not an array',
    };
    getPlatformProfile.mockReturnValueOnce(malformedProfile);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: 'A long enough adapted goal for validation of malformed pageTypes handling in the system',
              summary: 'ok'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles malformed workflowHints gracefully', async () => {
    const malformedProfile = {
      ...BASE_PROFILE,
      workflowHints: 'not an array',
    };
    getPlatformProfile.mockReturnValueOnce(malformedProfile);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: 'A long enough adapted goal for validation of malformed workflowHints handling in the system',
              summary: 'ok'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles workflowHints with invalid RegExp match', async () => {
    const malformedProfile = {
      ...BASE_PROFILE,
      workflowHints: [{ match: 'not a regex', hint: 'test hint' }],
    };
    getPlatformProfile.mockReturnValueOnce(malformedProfile);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: 'A long enough adapted goal for validation of invalid RegExp match in workflowHints handling in the system',
              summary: 'ok'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles pageTypes with missing name or hint', async () => {
    const malformedProfile = {
      ...BASE_PROFILE,
      pageTypes: [
        { name: 'Dashboard' }, // missing hint
        { hint: 'Go to users page' }, // missing name
        null, // null entry
        { name: 'Settings', hint: 'Configure settings' }, // valid
      ],
    };
    getPlatformProfile.mockReturnValueOnce(malformedProfile);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: 'A long enough adapted goal for validation of partial pageTypes handling in the system',
              summary: 'ok'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  test('handles waitStrings with empty arrays', async () => {
    const profile = {
      ...BASE_PROFILE,
      waitStrings: {
        'Dashboard': [], // empty array
        'Users': ['user loaded'], // valid
        null: ['invalid key'], // null key
      },
    };
    getPlatformProfile.mockReturnValueOnce(profile);
    getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              adapted_goal: 'A long enough adapted goal for validation of empty waitStrings arrays handling in the system',
              summary: 'ok'
            })
          }
        }]
      })
    }));

    const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
    expect(result.adapted).toBe(true);
  });

  // ========== extractJsonObject edge cases ==========

  describe('extractJsonObject — edge cases', () => {
    test('handles incomplete JSON response (opening brace but no closing)', async () => {
      getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
      getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

      // Response with opening { but no closing } - should return null from extractJsonObject
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"adapted_goal":"incomplete json response' } }]
        })
      }));

      const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
      // Should fall back to original goal when JSON parsing fails
      expect(result.adapted).toBe(false);
      expect(result.adaptedGoal).toBe(result.originalGoal);
    });

    test('handles JSON response with extra text before and after', async () => {
      getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
      getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

      // Response with extra text around the JSON object
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Here is the result: {"adapted_goal": "A long enough adapted goal for validation of JSON extraction with extra text", "summary": "ok"} End of response' } }]
        })
      }));

      const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
      expect(result.adapted).toBe(true);
    });

    test('handles empty response content', async () => {
      getPlatformProfile.mockReturnValueOnce(BASE_PROFILE);
      getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }]
        })
      }));

      const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');
      expect(result.adapted).toBe(false);
    });
  });

  // ========== Profile parsing error handling (catch blocks) ==========

  describe.skip('rewriteGoalForPlatform — profile parsing error handling', () => {
    test('handles waitStrings Object.entries throw (line 55)', async () => {
      // Create an object that throws when Object.entries is called
      const throwingObject = {};
      Object.defineProperty(throwingObject, 'throwingProp', {
        get: function() { throw new Error('Cannot read property'); },
        enumerable: true
      });

      const badProfile = {
        ...BASE_PROFILE,
        waitStrings: throwingObject,
      };
      getPlatformProfile.mockReturnValueOnce(badProfile);
      getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                adapted_goal: 'A long enough adapted goal for validation of waitStrings error handling',
                summary: 'ok'
              })
            }
          }]
        })
      }));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Sentinel/adaptive-prompts] waitStrings parse failed:',
        expect.any(String)
      );
      consoleWarnSpy.mockRestore();

      // Should still succeed despite the parse error
      expect(result.adapted).toBe(true);
    });

    test('handles pageTypes array iteration throw (line 66)', async () => {
      // Create an array that throws during mapping
      const throwingArray = [null, { name: 'test', hint: 'valid' }];
      Object.defineProperty(throwingArray, '2', {
        get: function() { throw new Error('Cannot read property'); },
        enumerable: true
      });

      const badProfile = {
        ...BASE_PROFILE,
        pageTypes: throwingArray,
      };
      getPlatformProfile.mockReturnValueOnce(badProfile);
      getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                adapted_goal: 'A long enough adapted goal for validation of pageTypes error handling',
                summary: 'ok'
              })
            }
          }]
        })
      }));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Sentinel/adaptive-prompts] pageTypes parse failed:',
        expect.any(String)
      );
      consoleWarnSpy.mockRestore();

      // Should still succeed despite the parse error
      expect(result.adapted).toBe(true);
    });

    test('handles workflowHints RegExp.test throw (line 79)', async () => {
      // Create a RegExp that throws when .test() is called
      const throwingRegExp = /test/;
      const originalTest = throwingRegExp.test;
      throwingRegExp.test = function() { throw new Error('RegExp.test failed'); };

      const badProfile = {
        ...BASE_PROFILE,
        workflowHints: [
          {
            match: throwingRegExp,
            hint: 'test hint'
          }
        ],
      };
      getPlatformProfile.mockReturnValueOnce(badProfile);
      getActiveProvider.mockResolvedValueOnce(mockProviderWithApiKey());

      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                adapted_goal: 'A long enough adapted goal for validation of workflowHints error handling',
                summary: 'ok'
              })
            }
          }]
        })
      }));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await rewriteGoalForPlatform('Investigate the firewall configuration on the network appliance for compliance checking', 'https://test.com');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Sentinel/adaptive-prompts] workflowHints parse failed:',
        expect.any(String)
      );
      consoleWarnSpy.mockRestore();

      // Restore original test method
      throwingRegExp.test = originalTest;

      // Should still succeed despite the parse error
      expect(result.adapted).toBe(true);
    });
  });
});
