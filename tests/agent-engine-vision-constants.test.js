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
  // VISION_DISCOVER is a multi-line template literal — grab the whole block.
  const discoverBlock = (() => {
    const m = typeof src === 'string' ? src.match(/const VISION_DISCOVER = `([\s\S]*?)`;/) : null;
    return m ? m[1] : '';
  })();

  it('is defined', () => {
    expect(discoverBlock).toBeTruthy();
  });

  it('stamps data-sentinel-index on each element', () => {
    expect(discoverBlock).toContain("e.setAttribute('data-sentinel-index', String(index))");
  });

  it('stores element references in window.__sentinelElements', () => {
    expect(discoverBlock).toContain('window.__sentinelElements.set(index, e)');
  });

  it('caps at 150 elements', () => {
    expect(discoverBlock).toContain('var CAP = 150');
    expect(discoverBlock).toContain('filtered.slice(0, CAP)');
  });

  it('ranks by salience before capping (keeps likely targets when over cap)', () => {
    expect(discoverBlock).toContain('_salience');
    // sort by descending salience, then restore DOM order for stable numbering
    expect(discoverBlock).toContain('b._sal - a._sal');
    expect(discoverBlock).toContain('a._ord - b._ord');
  });
});

describe('VISION_SOM (grounding-tuned overlay)', () => {
  // VISION_SOM is now a multi-line template literal, so grab the whole block.
  const somBlock = (() => {
    const m = typeof src === 'string' ? src.match(/const VISION_SOM = `([\s\S]*?)`;/) : null;
    return m ? m[1] : '';
  })();

  it('is defined', () => {
    expect(somBlock).toBeTruthy();
  });

  it('uses a large bold font so numerals survive JPEG compression', () => {
    expect(somBlock).toContain("ctx.font = 'bold 16px monospace'");
  });

  it('scales label width with digit count so 2-/3-digit indices never clip', () => {
    expect(somBlock).toContain('label.length * 10');
  });

  it('performs collision avoidance so labels do not stack', () => {
    expect(somBlock).toContain('function collides');
    expect(somBlock).toContain('placed.push');
  });

  it('still stamps the canvas with the expected overlay id', () => {
    expect(somBlock).toContain("canvas.id = 'sentinel-som-overlay'");
  });
});

describe('VISION_CLEAR', () => {
  const constLine = (typeof src === 'string' ? src.split('\n') : []).find(l => l.startsWith('const VISION_CLEAR'));

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
// Now uses escapeJsString helper function
// ═══════════════════════════════════════════════════════════════════
describe('vision type action _safeText escaping uses escapeJsString', () => {
  // Find the _safeText assignment line in the vision type handler
  const safeTextLine = (typeof src === 'string' ? src.split('\n') : []).find(l => l.includes('const _safeText') && l.includes('escapeJsString'));

  it('_safeText line exists', () => {
    expect(safeTextLine).toBeTruthy();
  });

  it('uses escapeJsString helper', () => {
    expect(safeTextLine).toContain('escapeJsString');
  });

  it('passes single quote for escaping', () => {
    expect(safeTextLine).toContain("'");
  });
});

describe('escapeJsString helper function', () => {
  it('is defined', () => {
    expect(src).toContain('function escapeJsString');
  });

  it('escapes all special characters with single regex', () => {
    expect(src).toContain('.replace(');
    expect(src).toContain('case \'\\\\\'');
  });

  it('uses switch for character replacement', () => {
    expect(src).toContain('case \'\\\\\'');
    expect(src).toContain('return \'\\\\\\\\\'');
  });

  it('handles newline characters', () => {
    expect(src).toContain("case '\\n':");
    expect(src).toContain("return '\\\\n'");
  });

  it('handles carriage returns', () => {
    expect(src).toContain("case '\\r':");
    expect(src).toContain("return '\\\\r'");
  });

  it('handles tabs', () => {
    expect(src).toContain("case '\\t':");
    expect(src).toContain("return '\\\\t'");
  });

  it('supports quote parameter for escaping', () => {
    expect(src).toContain('quoteChar');
    expect(src).toContain('quote ===');
  });
});
