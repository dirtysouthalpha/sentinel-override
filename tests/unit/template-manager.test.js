// Sentinel Override v3 -- Unit tests for background/template-manager.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';
import {
  extractParameters,
  loadTemplates,
  saveTemplates,
  listTemplates,
  getTemplate,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  resolveTemplateGoal,
  updateTemplateUsage,
} from '../../background/template-manager.js';

describe('template-manager', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
  });

  // ========== extractParameters ==========

  describe('extractParameters', () => {
    it('returns empty array for non-string input', () => {
      expect(extractParameters(null)).toEqual([]);
      expect(extractParameters(undefined)).toEqual([]);
      expect(extractParameters(123)).toEqual([]);
      expect(extractParameters({})).toEqual([]);
    });

    it('returns empty array for string with no placeholders', () => {
      expect(extractParameters('Hello world')).toEqual([]);
    });

    it('extracts a single parameter', () => {
      const result = extractParameters('Search for ::query::');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: 'query', label: 'Query', defaultValue: '' });
    });

    it('extracts multiple different parameters', () => {
      const result = extractParameters('Search ::query:: in ::location::');
      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('query');
      expect(result[1].key).toBe('location');
    });

    it('deduplicates repeated parameters', () => {
      const result = extractParameters('Use ::name:: and also ::name:: again');
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('name');
    });

    it('title-cases labels with underscores', () => {
      const result = extractParameters('Enter ::first_name:: and ::last_name::');
      expect(result[0].label).toBe('First Name');
      expect(result[1].label).toBe('Last Name');
    });

    it('returns empty array for empty string', () => {
      expect(extractParameters('')).toEqual([]);
    });
  });

  // ========== loadTemplates / saveTemplates ==========

  describe('loadTemplates', () => {
    it('returns empty object when no templates stored', async () => {
      const templates = await loadTemplates();
      expect(templates).toEqual({});
    });

    it('returns stored templates', async () => {
      const data = { abc: { id: 'abc', name: 'Test' } };
      await chromeMock.storage.local.set({ sentinel_templates: data });
      const templates = await loadTemplates();
      expect(templates).toEqual(data);
    });
  });

  describe('saveTemplates', () => {
    it('persists templates to storage', async () => {
      const data = { xyz: { id: 'xyz', name: 'Saved' } };
      await saveTemplates(data);
      const stored = await chromeMock.storage.local.get(['sentinel_templates']);
      expect(stored.sentinel_templates).toEqual(data);
    });
  });

  // ========== listTemplates ==========

  describe('listTemplates', () => {
    it('returns empty array when no templates', async () => {
      const list = await listTemplates();
      expect(list).toEqual([]);
    });

    it('returns templates sorted by updatedAt descending', async () => {
      const templates = {
        a: { id: 'a', name: 'Old', updatedAt: 1000 },
        b: { id: 'b', name: 'New', updatedAt: 3000 },
        c: { id: 'c', name: 'Mid', updatedAt: 2000 },
      };
      await chromeMock.storage.local.set({ sentinel_templates: templates });
      const list = await listTemplates();
      expect(list[0].id).toBe('b');
      expect(list[1].id).toBe('c');
      expect(list[2].id).toBe('a');
    });
  });

  // ========== getTemplate ==========

  describe('getTemplate', () => {
    it('returns null for falsy id', async () => {
      expect(await getTemplate(null)).toBeNull();
      expect(await getTemplate('')).toBeNull();
      expect(await getTemplate(undefined)).toBeNull();
    });

    it('returns null for non-string id', async () => {
      expect(await getTemplate(123)).toBeNull();
    });

    it('returns null when template not found', async () => {
      expect(await getTemplate('nonexistent')).toBeNull();
    });

    it('returns the template when found', async () => {
      const tpl = { id: 'abc', name: 'Found' };
      await chromeMock.storage.local.set({ sentinel_templates: { abc: tpl } });
      const result = await getTemplate('abc');
      expect(result).toEqual(tpl);
    });
  });

  // ========== saveTemplate (Create) ==========

  describe('saveTemplate', () => {
    it('throws if templateData is not an object', async () => {
      await expect(saveTemplate(null)).rejects.toThrow('Template data must be an object');
      await expect(saveTemplate('string')).rejects.toThrow('Template data must be an object');
      await expect(saveTemplate(undefined)).rejects.toThrow('Template data must be an object');
    });

    it('throws if name is missing or empty', async () => {
      await expect(saveTemplate({ goal: 'do stuff' })).rejects.toThrow('Template name is required');
      await expect(saveTemplate({ name: '', goal: 'do stuff' })).rejects.toThrow('Template name is required');
      await expect(saveTemplate({ name: '   ', goal: 'do stuff' })).rejects.toThrow('Template name is required');
    });

    it('throws if goal is missing or empty', async () => {
      await expect(saveTemplate({ name: 'Test' })).rejects.toThrow('Template goal is required');
      await expect(saveTemplate({ name: 'Test', goal: '' })).rejects.toThrow('Template goal is required');
      await expect(saveTemplate({ name: 'Test', goal: '   ' })).rejects.toThrow('Template goal is required');
    });

    it('creates a template with auto-extracted params', async () => {
      const tpl = await saveTemplate({
        name: 'Search',
        goal: 'Search for ::query:: in ::location::',
      });

      expect(tpl.id).toBeDefined();
      expect(tpl.name).toBe('Search');
      expect(tpl.goal).toBe('Search for ::query:: in ::location::');
      expect(tpl.params).toHaveLength(2);
      expect(tpl.params[0].key).toBe('query');
      expect(tpl.params[1].key).toBe('location');
      expect(tpl.tags).toEqual([]);
      expect(tpl.createdAt).toBeDefined();
      expect(tpl.updatedAt).toBeDefined();
      expect(tpl.lastUsedAt).toBeNull();
      expect(tpl.runCount).toBe(0);
    });

    it('creates a template with explicit params', async () => {
      const params = [{ key: 'custom', label: 'Custom', defaultValue: 'hi' }];
      const tpl = await saveTemplate({
        name: 'Custom',
        goal: 'Do something',
        params,
      });
      expect(tpl.params).toEqual(params);
    });

    it('creates a template with tags', async () => {
      const tpl = await saveTemplate({
        name: 'Tagged',
        goal: 'Goal text',
        tags: ['search', 'demo'],
      });
      expect(tpl.tags).toEqual(['search', 'demo']);
    });

    it('defaults tags to empty array if not an array', async () => {
      const tpl = await saveTemplate({
        name: 'NoTags',
        goal: 'Goal',
        tags: 'not-an-array',
      });
      expect(tpl.tags).toEqual([]);
    });

    it('persists the template to storage', async () => {
      const tpl = await saveTemplate({ name: 'Persist', goal: 'Goal' });
      const stored = await chromeMock.storage.local.get(['sentinel_templates']);
      expect(stored.sentinel_templates[tpl.id]).toEqual(tpl);
    });

    it('trims the name', async () => {
      const tpl = await saveTemplate({ name: '  Trimmed  ', goal: 'Goal' });
      expect(tpl.name).toBe('Trimmed');
    });
  });

  // ========== updateTemplate ==========

  describe('updateTemplate', () => {
    it('throws if id is missing or not a string', async () => {
      await expect(updateTemplate(null, {})).rejects.toThrow('Template ID is required');
      await expect(updateTemplate('', {})).rejects.toThrow('Template ID is required');
      await expect(updateTemplate(123, {})).rejects.toThrow('Template ID is required');
    });

    it('throws if updates is not an object', async () => {
      await expect(updateTemplate('abc', null)).rejects.toThrow('Update data must be an object');
      await expect(updateTemplate('abc', 'string')).rejects.toThrow('Update data must be an object');
    });

    it('throws if template not found', async () => {
      await expect(updateTemplate('nonexistent', { name: 'X' })).rejects.toThrow('Template not found');
    });

    it('updates the name', async () => {
      const tpl = await saveTemplate({ name: 'Original', goal: 'Goal' });
      const updated = await updateTemplate(tpl.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
    });

    it('throws when updating name to empty string', async () => {
      const tpl = await saveTemplate({ name: 'Original', goal: 'Goal' });
      await expect(updateTemplate(tpl.id, { name: '' })).rejects.toThrow('Template name must be a non-empty string');
      await expect(updateTemplate(tpl.id, { name: '   ' })).rejects.toThrow('Template name must be a non-empty string');
    });

    it('updates the goal and re-extracts params', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Original goal' });
      const updated = await updateTemplate(tpl.id, { goal: 'New ::param1:: and ::param2::' });
      expect(updated.goal).toBe('New ::param1:: and ::param2::');
      expect(updated.params).toHaveLength(2);
      expect(updated.params[0].key).toBe('param1');
    });

    it('throws when updating goal to empty string', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal' });
      await expect(updateTemplate(tpl.id, { goal: '' })).rejects.toThrow('Template goal must be a non-empty string');
    });

    it('uses explicit params when provided alongside goal', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Original' });
      const explicitParams = [{ key: 'x', label: 'X', defaultValue: 'val' }];
      const updated = await updateTemplate(tpl.id, {
        goal: 'New goal ::x::',
        params: explicitParams,
      });
      expect(updated.params).toEqual(explicitParams);
    });

    it('updates params directly', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal' });
      const newParams = [{ key: 'a', label: 'A', defaultValue: '' }];
      const updated = await updateTemplate(tpl.id, { params: newParams });
      expect(updated.params).toEqual(newParams);
    });

    it('throws if params is not an array', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal' });
      await expect(updateTemplate(tpl.id, { params: 'bad' })).rejects.toThrow('Params must be an array');
    });

    it('updates tags with array', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal' });
      const updated = await updateTemplate(tpl.id, { tags: ['new-tag'] });
      expect(updated.tags).toEqual(['new-tag']);
    });

    it('sets tags to empty array if not an array', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal', tags: ['old'] });
      const updated = await updateTemplate(tpl.id, { tags: 'not-array' });
      expect(updated.tags).toEqual([]);
    });

    it('updates updatedAt timestamp', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal' });
      const originalUpdatedAt = tpl.updatedAt;
      // Small delay to ensure different timestamp
      const updated = await updateTemplate(tpl.id, { name: 'Updated' });
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('persists updates to storage', async () => {
      const tpl = await saveTemplate({ name: 'Test', goal: 'Goal' });
      await updateTemplate(tpl.id, { name: 'Changed' });
      const stored = await getTemplate(tpl.id);
      expect(stored.name).toBe('Changed');
    });
  });

  // ========== deleteTemplate ==========

  describe('deleteTemplate', () => {
    it('throws if id is missing or not a string', async () => {
      await expect(deleteTemplate(null)).rejects.toThrow('Template ID is required');
      await expect(deleteTemplate('')).rejects.toThrow('Template ID is required');
      await expect(deleteTemplate(123)).rejects.toThrow('Template ID is required');
    });

    it('throws if template not found', async () => {
      await expect(deleteTemplate('nonexistent')).rejects.toThrow('Template not found');
    });

    it('deletes an existing template', async () => {
      const tpl = await saveTemplate({ name: 'ToDelete', goal: 'Goal' });
      await deleteTemplate(tpl.id);
      const stored = await getTemplate(tpl.id);
      expect(stored).toBeNull();
    });
  });

  // ========== resolveTemplateGoal ==========

  describe('resolveTemplateGoal', () => {
    it('throws if templateId is missing or not a string', async () => {
      await expect(resolveTemplateGoal(null, {})).rejects.toThrow('Template ID is required');
      await expect(resolveTemplateGoal('', {})).rejects.toThrow('Template ID is required');
    });

    it('throws if template not found', async () => {
      await expect(resolveTemplateGoal('nonexistent', {})).rejects.toThrow('Template not found');
    });

    it('substitutes provided param values', async () => {
      const tpl = await saveTemplate({
        name: 'Search',
        goal: 'Search for ::query:: in ::location::',
      });
      const resolved = await resolveTemplateGoal(tpl.id, {
        query: 'cats',
        location: 'Paris',
      });
      expect(resolved).toBe('Search for cats in Paris');
    });

    it('uses default value when param value not provided', async () => {
      const tpl = await saveTemplate({
        name: 'Greet',
        goal: 'Hello ::name::',
        params: [{ key: 'name', label: 'Name', defaultValue: 'World' }],
      });
      const resolved = await resolveTemplateGoal(tpl.id, {});
      expect(resolved).toBe('Hello World');
    });

    it('leaves placeholder when no value and no default', async () => {
      const tpl = await saveTemplate({
        name: 'Partial',
        goal: 'Fill ::unknown:: later',
      });
      const resolved = await resolveTemplateGoal(tpl.id, {});
      expect(resolved).toBe('Fill ::unknown:: later');
    });

    it('prefers provided value over default', async () => {
      const tpl = await saveTemplate({
        name: 'Greet',
        goal: 'Hello ::name::',
        params: [{ key: 'name', label: 'Name', defaultValue: 'World' }],
      });
      const resolved = await resolveTemplateGoal(tpl.id, { name: 'Alice' });
      expect(resolved).toBe('Hello Alice');
    });

    it('treats empty-string value as missing (uses default)', async () => {
      const tpl = await saveTemplate({
        name: 'Greet',
        goal: 'Hello ::name::',
        params: [{ key: 'name', label: 'Name', defaultValue: 'Fallback' }],
      });
      const resolved = await resolveTemplateGoal(tpl.id, { name: '' });
      expect(resolved).toBe('Hello Fallback');
    });

    it('treats whitespace-only value as missing', async () => {
      const tpl = await saveTemplate({
        name: 'Greet',
        goal: 'Hello ::name::',
        params: [{ key: 'name', label: 'Name', defaultValue: 'Fallback' }],
      });
      const resolved = await resolveTemplateGoal(tpl.id, { name: '   ' });
      expect(resolved).toBe('Hello Fallback');
    });

    it('defaults paramValues to empty object if null', async () => {
      const tpl = await saveTemplate({
        name: 'Static',
        goal: 'No placeholders here',
      });
      const resolved = await resolveTemplateGoal(tpl.id, null);
      expect(resolved).toBe('No placeholders here');
    });

    it('updates lastUsedAt and increments runCount', async () => {
      const tpl = await saveTemplate({
        name: 'Track',
        goal: 'Track usage ::val::',
      });
      expect(tpl.lastUsedAt).toBeNull();
      expect(tpl.runCount).toBe(0);

      await resolveTemplateGoal(tpl.id, { val: 'test' });

      const stored = await getTemplate(tpl.id);
      expect(stored.lastUsedAt).toBeGreaterThan(0);
      expect(stored.runCount).toBe(1);
    });

    it('increments runCount on successive calls', async () => {
      const tpl = await saveTemplate({ name: 'Count', goal: 'Goal' });
      await resolveTemplateGoal(tpl.id, {});
      await resolveTemplateGoal(tpl.id, {});
      await resolveTemplateGoal(tpl.id, {});
      const stored = await getTemplate(tpl.id);
      expect(stored.runCount).toBe(3);
    });
  });

  // ========== updateTemplateUsage ==========

  describe('updateTemplateUsage', () => {
    it('does nothing if templateId is falsy or not a string', async () => {
      // Should not throw
      await updateTemplateUsage(null);
      await updateTemplateUsage('');
      await updateTemplateUsage(undefined);
      await updateTemplateUsage(123);
    });

    it('does nothing if template not found', async () => {
      // Should not throw
      await updateTemplateUsage('nonexistent');
    });

    it('sets lastUsedAt and increments runCount', async () => {
      const tpl = await saveTemplate({ name: 'Usage', goal: 'Goal' });
      expect(tpl.lastUsedAt).toBeNull();
      expect(tpl.runCount).toBe(0);

      await updateTemplateUsage(tpl.id);

      const stored = await getTemplate(tpl.id);
      expect(stored.lastUsedAt).toBeGreaterThan(0);
      expect(stored.runCount).toBe(1);
    });

    it('increments runCount from existing value', async () => {
      const tpl = await saveTemplate({ name: 'Usage', goal: 'Goal' });
      await updateTemplateUsage(tpl.id);
      await updateTemplateUsage(tpl.id);
      const stored = await getTemplate(tpl.id);
      expect(stored.runCount).toBe(2);
    });
  });

  // ========== Integration-style: full CRUD cycle ==========

  describe('full CRUD cycle', () => {
    it('create, read, update, resolve, delete', async () => {
      // Create
      const created = await saveTemplate({
        name: 'Full Cycle',
        goal: 'Process ::item:: with ::action::',
        tags: ['integration'],
      });
      expect(created.id).toBeDefined();

      // Read
      const read = await getTemplate(created.id);
      expect(read.name).toBe('Full Cycle');

      // List
      const all = await listTemplates();
      expect(all).toHaveLength(1);

      // Update
      const updated = await updateTemplate(created.id, {
        name: 'Updated Cycle',
        goal: 'Process ::item:: differently',
      });
      expect(updated.name).toBe('Updated Cycle');
      expect(updated.params).toHaveLength(1);
      expect(updated.params[0].key).toBe('item');

      // Resolve
      const resolved = await resolveTemplateGoal(created.id, { item: 'document' });
      expect(resolved).toBe('Process document differently');

      // Verify usage tracking
      const afterResolve = await getTemplate(created.id);
      expect(afterResolve.runCount).toBe(1);
      expect(afterResolve.lastUsedAt).toBeGreaterThan(0);

      // Delete
      await deleteTemplate(created.id);
      const deleted = await getTemplate(created.id);
      expect(deleted).toBeNull();
    });
  });
});
