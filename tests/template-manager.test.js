// tests/template-manager.test.js
// Unit tests for background/template-manager.js pure functions.
// extractParameters has no chrome.* dependencies — safe to run in Node.

import { extractParameters } from '../background/template-manager.js';

describe('extractParameters', () => {
  test('returns empty array for non-string input', () => {
    expect(extractParameters(null)).toEqual([]);
    expect(extractParameters(undefined)).toEqual([]);
    expect(extractParameters(123)).toEqual([]);
    expect(extractParameters({})).toEqual([]);
  });

  test('returns empty array for string with no placeholders', () => {
    expect(extractParameters('Check the firewall status')).toEqual([]);
    expect(extractParameters('')).toEqual([]);
  });

  test('extracts a single ::key:: placeholder', () => {
    const result = extractParameters('Check firewall ::firewall_name:: status');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: 'firewall_name', label: 'Firewall Name', defaultValue: '' });
  });

  test('extracts multiple distinct placeholders', () => {
    const result = extractParameters('Check ::firewall_name:: policy for ::client_name::');
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('firewall_name');
    expect(result[1].key).toBe('client_name');
  });

  test('deduplicates repeated placeholders', () => {
    const result = extractParameters('Find ::device:: and check ::device:: config');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('device');
  });

  test('title-cases labels with underscores', () => {
    const result = extractParameters('Check ::vpn_tunnel_name::');
    expect(result[0].label).toBe('Vpn Tunnel Name');
  });

  test('handles placeholders adjacent to text', () => {
    const result = extractParameters('Navigate to https://::host_name::/admin');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('host_name');
  });

  test('handles multiple placeholders in sequence', () => {
    const result = extractParameters('::a::::b::::c::');
    expect(result).toHaveLength(3);
    expect(result.map(p => p.key)).toEqual(['a', 'b', 'c']);
  });

  test('each returned param has required shape', () => {
    const result = extractParameters('Check ::my_param::');
    for (const p of result) {
      expect(typeof p.key).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.defaultValue).toBe('string');
    }
  });
});
