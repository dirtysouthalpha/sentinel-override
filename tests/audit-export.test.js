import { describe, test, expect } from '@jest/globals';
import { generateAuditExport, verifyAuditExport } from '../background/audit-export.js';

describe('audit-export', () => {
  const sampleLog = [
    { timestamp: '2026-01-01T00:00:00Z', kind: 'run_start', goal: 'Test goal', url: 'https://example.com', action: 'navigate', result: 'ok' },
    { timestamp: '2026-01-01T00:00:01Z', kind: 'step', goal: 'Test goal', url: 'https://example.com', action: 'click', selector: '#btn', result: 'clicked', failed: false },
    { timestamp: '2026-01-01T00:00:02Z', kind: 'step', goal: 'Test goal', url: 'https://example.com', action: 'extract', result: 'data extracted', failed: false }
  ];

  test('generates JSON export with hash chain', () => {
    const result = generateAuditExport(sampleLog);
    expect(result.entryCount).toBe(3);
    expect(result.hash).toBeTruthy();
    expect(result.hashChain).toHaveLength(3);
    expect(result.json).toContain('integrityHash');
  });

  test('generates CSV export', () => {
    const result = generateAuditExport(sampleLog);
    expect(result.csv).toContain('seq,timestamp,kind');
    expect(result.csv.split('\n').length).toBe(4); // header + 3 entries
  });

  test('hash chain is sequential', () => {
    const result = generateAuditExport(sampleLog);
    expect(result.hashChain[0]).not.toBe(result.hashChain[1]);
    expect(result.hashChain[1]).not.toBe(result.hashChain[2]);
  });

  test('verifyAuditExport returns valid for unmodified export', () => {
    const exported = JSON.parse(generateAuditExport(sampleLog).json);
    const verification = verifyAuditExport(exported);
    expect(verification.valid).toBe(true);
    expect(verification.brokenAt).toBeNull();
  });

  test('verifyAuditExport detects tampering', () => {
    const exported = JSON.parse(generateAuditExport(sampleLog).json);
    exported.entries[1].action = 'TAMPERED';
    const verification = verifyAuditExport(exported);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBe(2);
  });

  test('handles empty log', () => {
    const result = generateAuditExport([]);
    expect(result.entryCount).toBe(0);
    expect(result.hash).toBe('EMPTY');
    expect(result.hashChain).toHaveLength(0);
  });

  test('handles null log', () => {
    const result = generateAuditExport(null);
    expect(result.json).toBe('[]');
    expect(result.hash).toBe('');
  });
});
