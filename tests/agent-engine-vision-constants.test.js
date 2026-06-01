// tests/agent-engine-vision-constants.test.js
// Verifies that the VISION_DISCOVER and VISION_CLEAR inline scripts
// contain the DOM-attribute code needed for vision mode to work.
// Reads agent-engine.js source directly — these constants are not exported.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../background/agent-engine.js'), 'utf8');

describe('VISION_DISCOVER', () => {
  const constLine = src.split('\n').find(l => l.startsWith('const VISION_DISCOVER'));

  it('is defined', () => {
    expect(constLine).toBeTruthy();
  });

  it('stamps data-sentinel-index on each element', () => {
    expect(constLine).toContain("e.setAttribute('data-sentinel-index', String(index))");
  });

  it('stores element references in window.__sentinelElements', () => {
    expect(constLine).toContain('window.__sentinelElements.set(index, e)');
  });

  it('caps at 150 elements', () => {
    expect(constLine).toContain('filtered.slice(0, 150)');
  });
});

describe('VISION_CLEAR', () => {
  const constLine = src.split('\n').find(l => l.startsWith('const VISION_CLEAR'));

  it('is defined', () => {
    expect(constLine).toBeTruthy();
  });

  it('removes the sentinel-som-overlay canvas', () => {
    expect(constLine).toContain("getElementById('sentinel-som-overlay')");
    expect(constLine).toContain('overlay.remove()');
  });

  it('removes data-sentinel-index attributes from all tagged elements', () => {
    expect(constLine).toContain("querySelectorAll('[data-sentinel-index]')");
    expect(constLine).toContain("removeAttribute('data-sentinel-index')");
  });
});

describe('VISION_EXECUTE dead code removal', () => {
  it('VISION_EXECUTE constant has been removed (no longer needed)', () => {
    expect(src).not.toContain('const VISION_EXECUTE');
  });

  it('_visionExecuteAction function has been removed (no longer needed)', () => {
    expect(src).not.toContain('async function _visionExecuteAction');
  });

  it('_visionParseResponse function has been removed (no longer needed)', () => {
    expect(src).not.toContain('function _visionParseResponse');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vision index guard — Number.isInteger + > 0 (Bug #3 fix)
// ═══════════════════════════════════════════════════════════════════
describe('vision index guard uses Number.isInteger and > 0', () => {
  it('guard uses Number.isInteger to reject NaN and null-derived 0', () => {
    expect(src).toContain(
      'Number.isInteger(command._visionIndex) && command._visionIndex > 0'
    );
  });

  it('old guard "command._visionIndex !== undefined" is no longer used alone', () => {
    // Ensure the weaker form is not present — the fix replaces it entirely
    expect(src).not.toContain('command._visionIndex !== undefined');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vision type CDP string escaping — \r and \t (Bug #2 fix)
// ═══════════════════════════════════════════════════════════════════
describe('vision type action _safeText escaping includes \\r and \\t', () => {
  // Find the _safeText assignment line in the vision type handler
  const safeTextLine = src.split('\n').find(l => l.includes('const _safeText') && l.includes('replace'));

  it('_safeText line exists', () => {
    expect(safeTextLine).toBeTruthy();
  });

  it('escapes carriage return (\\r)', () => {
    expect(safeTextLine).toContain('\\r');
  });

  it('escapes tab (\\t)', () => {
    expect(safeTextLine).toContain('\\t');
  });

  it('escapes newline (\\n)', () => {
    expect(safeTextLine).toContain('\\n');
  });

  it('escapes backslash', () => {
    expect(safeTextLine).toContain('\\/g');
  });
});
