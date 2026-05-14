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
