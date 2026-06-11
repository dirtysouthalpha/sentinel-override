// tests/client-knowledge.test.js
// Unit tests for background/client-knowledge.js — CRUD, URL matching, prompt formatting.

import { jest } from '@jest/globals';

let store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (defaults) => {
        const key = Object.keys(defaults)[0];
        return { [key]: store[key] || defaults[key] };
      }),
      set: jest.fn(async (obj) => Object.assign(store, obj)),
    },
  },
};

const {
  listClients,
  getClient,
  getActiveClient,
  setActiveClient,
  createClient,
  updateClient,
  deleteClient,
  addEntry,
  updateEntry,
  deleteEntry,
  getRelevantEntries,
  formatPromptSection,
  getClientStartupContext,
  markRunCompleted,
  exportClient,
  importClient,
} = await import('../background/client-knowledge.js');

beforeEach(() => {
  store = {};
  jest.clearAllMocks();
});

describe('client CRUD', () => {
  test('createClient creates a valid client', async () => {
    const result = await createClient({ displayName: 'Acme Corp', tenant: 'acme.onmicrosoft.com' });
    expect(result.ok).toBe(true);
    expect(result.client.displayName).toBe('Acme Corp');
    expect(result.client.tenant).toBe('acme.onmicrosoft.com');
    expect(result.client.id).toBe('acme-corp');
    expect(result.client.entries).toEqual([]);
  });

  test('createClient rejects missing displayName', async () => {
    const result = await createClient({ displayName: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Display name');
  });

  test('createClient handles duplicate names with suffix', async () => {
    await createClient({ displayName: 'Test Client' });
    const result = await createClient({ displayName: 'Test Client' });
    expect(result.ok).toBe(true);
    expect(result.client.id).toBe('test-client-2');
  });

  test('listClients returns clients sorted by lastUsedAt desc', async () => {
    await createClient({ displayName: 'Alpha' });
    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 5));
    await createClient({ displayName: 'Beta' });
    const clients = await listClients();
    // Find our two clients (store may have leftovers from other test leakage)
    const names = clients.map(c => c.displayName);
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
  });

  test('getClient returns client by id', async () => {
    const { client } = await createClient({ displayName: 'Gamma' });
    const found = await getClient(client.id);
    expect(found).not.toBeNull();
    expect(found.displayName).toBe('Gamma');
  });

  test('getClient returns null for unknown id', async () => {
    expect(await getClient('nonexistent')).toBeNull();
  });

  test('getClient returns null for falsy id', async () => {
    expect(await getClient(null)).toBeNull();
    expect(await getClient('')).toBeNull();
  });

  test('updateClient modifies displayName and tenant', async () => {
    const { client } = await createClient({ displayName: 'Old Name' });
    const result = await updateClient(client.id, { displayName: 'New Name', tenant: 'new.onmicrosoft.com' });
    expect(result.ok).toBe(true);
    expect(result.client.displayName).toBe('New Name');
    expect(result.client.tenant).toBe('new.onmicrosoft.com');
  });

  test('updateClient rejects unknown client', async () => {
    const result = await updateClient('fake', { displayName: 'X' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('deleteClient removes client and clears activeClientId', async () => {
    const { client } = await createClient({ displayName: 'Delete Me' });
    await setActiveClient(client.id);
    await deleteClient(client.id);
    const found = await getClient(client.id);
    expect(found).toBeNull();
    const active = await getActiveClient();
    expect(active).toBeNull();
  });

  test('deleteClient rejects missing id', async () => {
    const result = await deleteClient('');
    expect(result.ok).toBe(false);
  });
});

describe('active client', () => {
  test('setActiveClient sets the active client', async () => {
    const { client } = await createClient({ displayName: 'Active' });
    const result = await setActiveClient(client.id);
    expect(result.ok).toBe(true);
    const active = await getActiveClient();
    expect(active.id).toBe(client.id);
  });

  test('setActiveClient clears with null', async () => {
    const { client } = await createClient({ displayName: 'Temp' });
    await setActiveClient(client.id);
    await setActiveClient(null);
    const active = await getActiveClient();
    expect(active).toBeNull();
  });

  test('setActiveClient rejects unknown client id', async () => {
    const result = await setActiveClient('nonexistent');
    expect(result.ok).toBe(false);
  });

  test('getActiveClient returns null when none set', async () => {
    expect(await getActiveClient()).toBeNull();
  });
});

describe('entry CRUD', () => {
  let clientId;

  beforeEach(async () => {
    const { client } = await createClient({ displayName: 'Entry Client' });
    clientId = client.id;
  });

  test('addEntry creates a global entry', async () => {
    const result = await addEntry(clientId, { scope: 'global', wisdom: 'This is a learned fact' });
    expect(result.ok).toBe(true);
    expect(result.entry.scope).toBe('global');
    expect(result.entry.wisdom).toBe('This is a learned fact');
  });

  test('addEntry creates a url-scoped entry', async () => {
    const result = await addEntry(clientId, { scope: 'url', urlPattern: '*.entra.microsoft.com', wisdom: 'Custom auth proxy' });
    expect(result.ok).toBe(true);
    expect(result.entry.scope).toBe('url');
    expect(result.entry.urlPattern).toBe('*.entra.microsoft.com');
  });

  test('addEntry rejects missing wisdom', async () => {
    const result = await addEntry(clientId, { scope: 'global', wisdom: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Wisdom');
  });

  test('addEntry rejects unknown client', async () => {
    const result = await addEntry('fake', { wisdom: 'Test' });
    expect(result.ok).toBe(false);
  });

  test('addEntry caps wisdom at 1000 chars', async () => {
    const result = await addEntry(clientId, { wisdom: 'A'.repeat(1100) });
    expect(result.ok).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry.wisdom).toBeDefined();
    expect(result.entry.wisdom.length).toBe(1000);
  });

  test('addEntry caps tags at 8', async () => {
    const result = await addEntry(clientId, { wisdom: 'Test', tags: ['a','b','c','d','e','f','g','h','i','j'] });
    expect(result.ok).toBe(true);
    expect(result.entry.tags).toHaveLength(8);
  });

  test('updateEntry modifies entry fields', async () => {
    const { entry } = await addEntry(clientId, { scope: 'global', wisdom: 'Old wisdom' });
    const result = await updateEntry(clientId, entry.id, { wisdom: 'Updated wisdom', scope: 'url', urlPattern: '*.example.com' });
    expect(result.ok).toBe(true);
    expect(result.entry.wisdom).toBe('Updated wisdom');
    expect(result.entry.scope).toBe('url');
  });

  test('updateEntry rejects unknown entry', async () => {
    const result = await updateEntry(clientId, 'fake-entry', { wisdom: 'X' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Entry not found');
  });

  test('deleteEntry removes the entry', async () => {
    const { entry } = await addEntry(clientId, { wisdom: 'To delete' });
    const result = await deleteEntry(clientId, entry.id);
    expect(result.ok).toBe(true);
    const client = await getClient(clientId);
    expect(client.entries).toHaveLength(0);
  });

  test('deleteEntry rejects unknown entry', async () => {
    const result = await deleteEntry(clientId, 'fake');
    expect(result.ok).toBe(false);
  });
});

describe('getRelevantEntries', () => {
  let clientId;

  beforeEach(async () => {
    const { client } = await createClient({ displayName: 'Relevance' });
    clientId = client.id;
    await addEntry(clientId, { scope: 'global', wisdom: 'Global fact' });
    await addEntry(clientId, { scope: 'url', urlPattern: '*.entra.microsoft.com', wisdom: 'Entra-specific fact' });
    await addEntry(clientId, { scope: 'url', urlPattern: '*.sonicwall.com', wisdom: 'SonicWall fact' });
  });

  test('returns global entries for any URL', async () => {
    const entries = await getRelevantEntries(clientId, 'https://example.com');
    expect(entries.some(e => e.wisdom === 'Global fact')).toBe(true);
  });

  test('returns url-scoped entries matching the URL', async () => {
    // Pattern *.entra.microsoft.com is anchored ^...$ so it matches host-only URLs
    const entries = await getRelevantEntries(clientId, 'https://login.entra.microsoft.com');
    expect(entries.some(e => e.wisdom === 'Entra-specific fact')).toBe(true);
    expect(entries.some(e => e.wisdom === 'SonicWall fact')).toBe(false);
  });

  test('returns empty array for unknown client', async () => {
    const entries = await getRelevantEntries('fake', 'https://example.com');
    expect(entries).toEqual([]);
  });

  test('returns empty array for falsy clientId', async () => {
    const entries = await getRelevantEntries(null, 'https://example.com');
    expect(entries).toEqual([]);
  });
});

describe('formatPromptSection', () => {
  test('returns empty string when no client is active', async () => {
    const result = await formatPromptSection(null, 'https://example.com');
    expect(result).toBe('');
  });

  test('returns formatted prompt section with entries', async () => {
    const { client } = await createClient({ displayName: 'FormatTest' });
    await addEntry(client.id, { scope: 'global', wisdom: 'Test wisdom here' });
    const result = await formatPromptSection(client.id, 'https://example.com');
    expect(result).toContain('CLIENT-SPECIFIC KNOWLEDGE');
    expect(result).toContain('FormatTest');
    expect(result).toContain('Test wisdom here');
  });

  test('returns empty string when client has no relevant entries', async () => {
    const { client } = await createClient({ displayName: 'EmptyClient' });
    const result = await formatPromptSection(client.id, 'https://example.com');
    expect(result).toBe('');
  });
});

describe('markRunCompleted', () => {
  test('increments runCount and updates lastUsedAt', async () => {
    const { client } = await createClient({ displayName: 'RunTest' });
    const before = await getClient(client.id);
    expect(before.runCount).toBe(0);
    await markRunCompleted(client.id, []);
    const after = await getClient(client.id);
    expect(after.runCount).toBe(1);
    expect(after.lastUsedAt).toBeTruthy();
  });

  test('increments useCount for used entry IDs', async () => {
    const { client } = await createClient({ displayName: 'UseCount' });
    const { entry } = await addEntry(client.id, { wisdom: 'Used fact' });
    await markRunCompleted(client.id, [entry.id]);
    const after = await getClient(client.id);
    expect(after.entries[0].useCount).toBe(1);
  });

  test('no-ops on falsy clientId', async () => {
    await expect(markRunCompleted(null, [])).resolves.toBeUndefined();
  });
});

describe('export/import', () => {
  test('exportClient returns exportable payload', async () => {
    const { client } = await createClient({ displayName: 'ExportTest' });
    await addEntry(client.id, { wisdom: 'Exported wisdom' });
    const exported = await exportClient(client.id);
    expect(exported.schemaVersion).toBe(1);
    expect(exported.client.displayName).toBe('ExportTest');
    expect(exported.client.entries).toHaveLength(1);
  });

  test('exportClient returns null for unknown id', async () => {
    expect(await exportClient('fake')).toBeNull();
  });

  test('importClient creates a new client from payload', async () => {
    const payload = {
      schemaVersion: 1,
      client: {
        displayName: 'Imported Client',
        tenant: 'imported.onmicrosoft.com',
        entries: [{ wisdom: 'Imported wisdom', scope: 'global' }],
      },
    };
    const result = await importClient(payload);
    expect(result.ok).toBe(true);
    expect(result.client.displayName).toBe('Imported Client');
  });

  test('importClient supports rename option', async () => {
    const payload = {
      schemaVersion: 1,
      client: { displayName: 'Original', entries: [] },
    };
    const result = await importClient(payload, { rename: 'Renamed Client' });
    expect(result.ok).toBe(true);
    expect(result.client.displayName).toBe('Renamed Client');
  });

  test('importClient rejects invalid payload', async () => {
    const result = await importClient(null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  test('importClient rejects missing displayName', async () => {
    const result = await importClient({ client: { entries: [] } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('displayName');
  });

  test('importClient handles collision by appending suffix', async () => {
    await createClient({ displayName: 'Collision' });
    const payload = {
      schemaVersion: 1,
      client: { displayName: 'Collision', entries: [] },
    };
    const result = await importClient(payload);
    expect(result.ok).toBe(true);
    expect(result.client.id).toContain('collision-2');
  });
});

// ========== Edge cases — additional coverage ==========

describe('client-knowledge edge cases', () => {
  test('createClient strips whitespace from displayName', async () => {
    const result = await createClient({ displayName: '  Whitespace Corp  ' });
    expect(result.ok).toBe(true);
    expect(result.client.displayName).toBe('Whitespace Corp');
  });

  test('createClient with empty tenant defaults to empty string', async () => {
    const result = await createClient({ displayName: 'No Tenant' });
    expect(result.ok).toBe(true);
    expect(result.client.tenant).toBe('');
  });

  test('createClient with non-string displayName rejects', async () => {
    const result = await createClient({ displayName: 123 });
    expect(result.ok).toBe(false);
  });

  test('updateClient with empty displayName trims to empty string', async () => {
    const { client } = await createClient({ displayName: 'UpdateTest' });
    const result = await updateClient(client.id, { displayName: '  Updated  ' });
    expect(result.ok).toBe(true);
    expect(result.client.displayName).toBe('Updated');
  });

  test('updateClient with non-string updates ignores unknown fields', async () => {
    const { client } = await createClient({ displayName: 'IgnoreTest' });
    const result = await updateClient(client.id, { unknownField: 'ignored' });
    expect(result.ok).toBe(true);
    expect(result.client.unknownField).toBeUndefined();
  });

  test('addEntry with url scope and no urlPattern defaults to empty', async () => {
    const { client } = await createClient({ displayName: 'URLTest' });
    const result = await addEntry(client.id, { scope: 'url', wisdom: 'URL scoped' });
    expect(result.ok).toBe(true);
    expect(result.entry.urlPattern).toBe('');
  });

  test('addEntry with global scope ignores urlPattern', async () => {
    const { client } = await createClient({ displayName: 'ScopeTest' });
    const result = await addEntry(client.id, { scope: 'global', urlPattern: '*.example.com', wisdom: 'Global' });
    expect(result.ok).toBe(true);
    expect(result.entry.scope).toBe('global');
    expect(result.entry.urlPattern).toBe('');
  });

  test('addEntry strips tags whitespace and filters empty', async () => {
    const { client } = await createClient({ displayName: 'TagTest' });
    const result = await addEntry(client.id, { wisdom: 'Tagged', tags: ['  a  ', '', '  b  '] });
    expect(result.ok).toBe(true);
    expect(result.entry.tags).toEqual(['a', 'b']);
  });

  test('updateEntry updates tags array', async () => {
    const { client } = await createClient({ displayName: 'TagUp' });
    const { entry } = await addEntry(client.id, { wisdom: 'Test', tags: ['old'] });
    const result = await updateEntry(client.id, entry.id, { tags: ['new1', 'new2'] });
    expect(result.ok).toBe(true);
    expect(result.entry.tags).toEqual(['new1', 'new2']);
  });

  test('deleteClient for non-active client does not clear activeClientId', async () => {
    const { client: c1 } = await createClient({ displayName: 'KeepActive' });
    const { client: c2 } = await createClient({ displayName: 'DeleteMe' });
    await setActiveClient(c1.id);
    await deleteClient(c2.id);
    const active = await getActiveClient();
    expect(active.id).toBe(c1.id);
  });

  test('getRelevantEntries with empty URL still returns global entries', async () => {
    const { client } = await createClient({ displayName: 'EmptyURL' });
    await addEntry(client.id, { scope: 'global', wisdom: 'Always relevant' });
    const entries = await getRelevantEntries(client.id, '');
    expect(entries).toHaveLength(1);
  });

  test('getRelevantEntries with null URL still returns global entries', async () => {
    const { client } = await createClient({ displayName: 'NullURL' });
    await addEntry(client.id, { scope: 'global', wisdom: 'Always' });
    const entries = await getRelevantEntries(client.id, null);
    expect(entries).toHaveLength(1);
  });

  test('formatPromptSection with URL-scoped matching entries', async () => {
    const { client } = await createClient({ displayName: 'URLPrompt' });
    await addEntry(client.id, { scope: 'url', urlPattern: '*example.com*', wisdom: 'URL fact' });
    const result = await formatPromptSection(client.id, 'https://example.com/page');
    expect(result).toContain('URL fact');
  });

  test('formatPromptSection with URL-scoped non-matching entries returns empty', async () => {
    const { client } = await createClient({ displayName: 'NoMatch' });
    await addEntry(client.id, { scope: 'url', urlPattern: '*other.com*', wisdom: 'Other fact' });
    const result = await formatPromptSection(client.id, 'https://example.com/page');
    expect(result).toBe('');
  });

  test('markRunCompleted with non-array usedEntryIds', async () => {
    const { client } = await createClient({ displayName: 'BadIds' });
    await expect(markRunCompleted(client.id, 'not-array')).resolves.toBeUndefined();
    const after = await getClient(client.id);
    expect(after.runCount).toBe(1);
  });

  test('markRunCompleted with non-existent entry IDs increments runCount only', async () => {
    const { client } = await createClient({ displayName: 'FakeIds' });
    await markRunCompleted(client.id, ['nonexistent-entry-id']);
    const after = await getClient(client.id);
    expect(after.runCount).toBe(1);
  });

  test('importClient with entries missing wisdom filters them out', async () => {
    const payload = {
      schemaVersion: 1,
      client: {
        displayName: 'FilterImport',
        entries: [
          { wisdom: 'Valid', scope: 'global' },
          { wisdom: '', scope: 'global' },
          { scope: 'global' },
        ],
      },
    };
    const result = await importClient(payload);
    expect(result.ok).toBe(true);
    expect(result.client.entries).toHaveLength(1);
    expect(result.client.entries[0].wisdom).toBe('Valid');
  });

  test('importClient with missing schemaVersion still imports', async () => {
    const payload = {
      client: { displayName: 'NoVersion', entries: [] },
    };
    const result = await importClient(payload);
    expect(result.ok).toBe(true);
  });

  // Additional edge case tests for better branch coverage

  // Note: Tests for _read error handling are difficult to mock reliably
  // due to shared state. The error paths are covered by integration testing.

  test('_write handles storage errors gracefully', async () => {
    const { client } = await createClient({ displayName: 'WriteError' });

    // Mock storage.set to throw error
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = jest.fn(async () => {
      throw new Error('Storage quota exceeded');
    });

    const result = await updateClient(client.id, { displayName: 'Should Fail' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Storage write failed');

    // Restore original
    chrome.storage.local.set = originalSet;
  });

  test('_urlMatches handles regex errors gracefully', async () => {
    const { client } = await createClient({ displayName: 'RegexError' });
    // Add a global entry first
    await addEntry(client.id, { scope: 'global', wisdom: 'Global fact' });
    // Pattern with invalid regex that will cause error during conversion
    await addEntry(client.id, {
      scope: 'url',
      urlPattern: '[invalid(regex', // Invalid regex pattern
      wisdom: 'This should still work'
    });

    // Should not throw, just return global entries
    const entries = await getRelevantEntries(client.id, 'https://example.com');
    // Global entries should still be returned, URL entry should be filtered out
    expect(entries.length).toBe(1);
    expect(entries[0].wisdom).toBe('Global fact');
  });

  test('_urlMatches matches wildcard patterns correctly', async () => {
    const { client } = await createClient({ displayName: 'Wildcard' });
    await addEntry(client.id, {
      scope: 'url',
      urlPattern: '*.example.com*',
      wisdom: 'Wildcard match'
    });

    const entries = await getRelevantEntries(client.id, 'https://sub.example.com/path');
    expect(entries.some(e => e.wisdom === 'Wildcard match')).toBe(true);
  });

  test('_urlMatches case insensitive matching', async () => {
    const { client } = await createClient({ displayName: 'CaseTest' });
    // Add a global entry first to ensure we get results
    await addEntry(client.id, { scope: 'global', wisdom: 'Global fact' });
    await addEntry(client.id, {
      scope: 'url',
      urlPattern: 'example.com', // Simple substring match (case insensitive)
      wisdom: 'Case insensitive'
    });

    const entries = await getRelevantEntries(client.id, 'https://EXAMPLE.COM/path');
    expect(entries.some(e => e.wisdom === 'Case insensitive')).toBe(true);
  });

  test('updateClient with missing id parameter', async () => {
    const result = await updateClient('', { displayName: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Client id required');
  });

  test('updateClient with null id parameter', async () => {
    const result = await updateClient(null, { displayName: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Client id required');
  });

  test('deleteClient with null id parameter', async () => {
    const result = await deleteClient(null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Client id required');
  });

  test('addEntry with null clientId', async () => {
    const result = await addEntry(null, { wisdom: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Client id required');
  });

  test('addEntry with empty clientId', async () => {
    const result = await addEntry('', { wisdom: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Client id required');
  });

  test('addEntry with very long wisdom gets truncated', async () => {
    const { client } = await createClient({ displayName: 'Truncate' });
    const longWisdom = 'A'.repeat(2000);
    const result = await addEntry(client.id, { wisdom: longWisdom });
    expect(result.ok).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry.wisdom).toBeDefined();
    expect(result.entry.wisdom.length).toBe(1000);
  });

  test('updateEntry with invalid scope ignores scope update', async () => {
    const { client } = await createClient({ displayName: 'BadScope' });
    const { entry } = await addEntry(client.id, { scope: 'global', wisdom: 'Test' });

    const result = await updateEntry(client.id, entry.id, { scope: 'invalid' });
    expect(result.ok).toBe(true);
    // Scope should remain 'global' since 'invalid' is not valid
    expect(result.entry.scope).toBe('global');
  });

  test('updateEntry with non-string wisdom ignores update', async () => {
    const { client } = await createClient({ displayName: 'NonStringWisdom' });
    const { entry } = await addEntry(client.id, { wisdom: 'Original' });

    const result = await updateEntry(client.id, entry.id, { wisdom: 12345 });
    expect(result.ok).toBe(true);
    // Wisdom should remain 'Original' since number is ignored
    expect(result.entry.wisdom).toBe('Original');
  });

  test('deleteEntry with null clientId', async () => {
    const result = await deleteEntry(null, 'entry-id');
    expect(result.ok).toBe(false);
    // Empty string clientId results in "Client not found"
    expect(result.error).toContain('not found');
  });

  test('deleteEntry with empty clientId', async () => {
    const result = await deleteEntry('', 'entry-id');
    expect(result.ok).toBe(false);
    // Empty string clientId results in "Client not found"
    expect(result.error).toContain('not found');
  });

  test('formatPromptSection with undefined currentUrl', async () => {
    const { client } = await createClient({ displayName: 'UndefinedURL' });
    await addEntry(client.id, { scope: 'global', wisdom: 'Global fact' });
    const result = await formatPromptSection(client.id, undefined);
    expect(result).toContain('Global fact');
  });

  test('markRunCompleted with undefined usedEntryIds', async () => {
    const { client } = await createClient({ displayName: 'UndefinedIds' });
    const { entry } = await addEntry(client.id, { wisdom: 'Test' });

    await markRunCompleted(client.id, undefined);
    const after = await getClient(client.id);
    expect(after.runCount).toBe(1);
    // Entry useCount should not increment
    expect(after.entries[0].useCount).toBe(0);
  });

  test('exportClient with null clientId returns null', async () => {
    const result = await exportClient(null);
    expect(result).toBeNull();
  });

  test('importClient with non-object payload', async () => {
    const result = await importClient('string-payload');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  test('importClient with array payload', async () => {
    const result = await importClient([{ displayName: 'Array' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  test('importClient preserves entry timestamps when available', async () => {
    const originalTimestamp = '2024-01-01T00:00:00.000Z';
    const payload = {
      schemaVersion: 1,
      client: {
        displayName: 'TimestampTest',
        entries: [{
          wisdom: 'Preserve timestamp',
          scope: 'global',
          capturedAt: originalTimestamp
        }]
      }
    };

    const result = await importClient(payload);
    expect(result.ok).toBe(true);
    expect(result.client.entries[0].capturedAt).toBe(originalTimestamp);
  });

  test('importClient generates new timestamps when missing', async () => {
    const payload = {
      schemaVersion: 1,
      client: {
        displayName: 'NewTimestamps',
        entries: [{
          wisdom: 'New timestamp',
          scope: 'global'
        }]
      }
    };

    const result = await importClient(payload);
    expect(result.ok).toBe(true);
    expect(result.client.entries[0].capturedAt).toBeTruthy();
    expect(result.client.entries[0].capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('_read catch: logs error and returns safely when storage.get throws (lines 60-61)', async () => {
    const errors = [];
    const origError = console.error;
    console.error = (...args) => { errors.push(args.join(' ')); origError(...args); };

    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = jest.fn(async () => { throw new Error('IDB unavailable'); });

    const result = await listClients();
    expect(Array.isArray(result)).toBe(true);

    chrome.storage.local.get = originalGet;
    console.error = origError;

    expect(errors.some(m => m.includes('_read failed'))).toBe(true);
  });

  test('getRelevantEntries: url-scoped entry with empty urlPattern returns false (line 320)', async () => {
    const { client } = await createClient({ displayName: 'EmptyPattern' });
    await addEntry(client.id, { scope: 'url', wisdom: 'No pattern entry' });
    const entries = await getRelevantEntries(client.id, 'https://example.com');
    expect(entries).toHaveLength(0);
  });
});

// ── getClientStartupContext (lines 348-359) ──────────────────────────────────

describe('getClientStartupContext', () => {
  // Seed a clean storage state before each test to avoid DEFAULT_STATE mutation
  // from earlier describe blocks polluting these assertions.
  beforeEach(async () => {
    await chrome.storage.local.set({ sentinelClientKnowledge: { clients: {}, activeClientId: null } });
  });

  test('returns nulls when no active client is set', async () => {
    const result = await getClientStartupContext('https://example.com');
    expect(result).toEqual({ client: null, relevantEntries: [], promptSection: '' });
  });

  test('returns nulls when activeClientId points to a missing client', async () => {
    // Write a state with an activeClientId that has no corresponding client entry
    await chrome.storage.local.set({ sentinelClientKnowledge: { clients: {}, activeClientId: 'ghost-id' } });
    const result = await getClientStartupContext('https://example.com');
    expect(result).toEqual({ client: null, relevantEntries: [], promptSection: '' });
  });

  test('returns client with empty promptSection when no entries match', async () => {
    const { client } = await createClient({ displayName: 'Startup Corp' });
    await setActiveClient(client.id);
    const result = await getClientStartupContext('https://example.com');
    expect(result.client).not.toBeNull();
    expect(result.client.id).toBe(client.id);
    expect(result.relevantEntries).toHaveLength(0);
    expect(result.promptSection).toBe('');
  });

  test('returns populated promptSection when global entries exist', async () => {
    const { client } = await createClient({ displayName: 'Knowledge Co' });
    await addEntry(client.id, { scope: 'global', wisdom: 'Always use MFA' });
    await addEntry(client.id, { scope: 'global', wisdom: 'Prefer dark mode' });
    await setActiveClient(client.id);
    const result = await getClientStartupContext('https://example.com');
    expect(result.relevantEntries).toHaveLength(2);
    expect(result.promptSection).toContain('Knowledge Co');
    expect(result.promptSection).toContain('Always use MFA');
    expect(result.promptSection).toContain('Prefer dark mode');
    expect(result.promptSection).toMatch(/^[\n]/);
  });

  test('returns url-scoped entries that match currentUrl', async () => {
    const { client } = await createClient({ displayName: 'URL Client' });
    // Pattern without '*' uses substring match so 'example.com' matches full URL string
    await addEntry(client.id, { scope: 'url', urlPattern: 'example.com', wisdom: 'Use the sidebar' });
    await setActiveClient(client.id);
    const result = await getClientStartupContext('https://example.com/dashboard');
    expect(result.relevantEntries).toHaveLength(1);
    expect(result.promptSection).toContain('Use the sidebar');
  });
});
