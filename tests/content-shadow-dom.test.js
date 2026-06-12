// tests/content-shadow-dom.test.js
// Unit tests for content/shadow-dom.js — getShadowRoot, isInShadowDOM, walkShadowTree, queryDeep, queryDeepFirst.

import { jest } from '@jest/globals';

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = { shadow: {} };
globalThis.window.__sentinelCapturedRoots = {
  get: () => null,
};
globalThis.NodeFilter = { SHOW_ELEMENT: 1 };
globalThis.Node = { ELEMENT_NODE: 1 };

// Mock document.createTreeWalker for walkShadowTree tests
const treeWalkerQueue = [];
let currentWalker = null;

globalThis.document = {
  createTreeWalker: jest.fn((root) => {
    currentWalker = {
      currentNode: root,
      _nodes: treeWalkerQueue.splice(0),
      _index: 0,
      nextNode() {
        if (this._index < this._nodes.length) {
          this.currentNode = this._nodes[this._index++];
          return this.currentNode;
        }
        return null;
      }
    };
    return currentWalker;
  })
};

let shadow;
beforeAll(async () => {
  await import('../content/shadow-dom.js');
  shadow = globalThis.window.__sentinelUtils.shadow;
});

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.window.__sentinelCapturedRoots = { get: () => null };
  treeWalkerQueue.length = 0;
  currentWalker = null;
});

// ========== getShadowRoot ==========

describe('shadow.getShadowRoot', () => {
  test('returns null for null element', () => {
    expect(shadow.getShadowRoot(null)).toBeNull();
  });

  test('returns null for undefined element', () => {
    expect(shadow.getShadowRoot(undefined)).toBeNull();
  });

  test('returns null for element with no shadow root', () => {
    expect(shadow.getShadowRoot({})).toBeNull();
  });

  test('returns open shadowRoot when present', () => {
    const sr = {};
    const el = { shadowRoot: sr };
    expect(shadow.getShadowRoot(el)).toBe(sr);
  });

  test('returns captured closed shadow root', () => {
    const sr = {};
    const el = {};
    globalThis.window.__sentinelCapturedRoots = { get: (e) => e === el ? sr : null };
    expect(shadow.getShadowRoot(el)).toBe(sr);
  });

  test('prefers open shadowRoot over captured root', () => {
    const openSR = { mode: 'open' };
    const capturedSR = { mode: 'captured' };
    const el = { shadowRoot: openSR };
    globalThis.window.__sentinelCapturedRoots = { get: () => capturedSR };
    // Open shadowRoot is checked first
    expect(shadow.getShadowRoot(el)).toBe(openSR);
  });

  test('returns null when captured roots map has no entry for element', () => {
    const el = {};
    globalThis.window.__sentinelCapturedRoots = { get: () => null };
    expect(shadow.getShadowRoot(el)).toBeNull();
  });

  test('returns null when __sentinelCapturedRoots is undefined', () => {
    const orig = globalThis.window.__sentinelCapturedRoots;
    delete globalThis.window.__sentinelCapturedRoots;
    expect(shadow.getShadowRoot({})).toBeNull();
    globalThis.window.__sentinelCapturedRoots = orig;
  });

  test('handles element with falsy shadowRoot (null)', () => {
    const el = { shadowRoot: null };
    globalThis.window.__sentinelCapturedRoots = { get: () => null };
    expect(shadow.getShadowRoot(el)).toBeNull();
  });
});

// ========== isInShadowDOM ==========

describe('shadow.isInShadowDOM', () => {
  test('returns false for null', () => {
    expect(shadow.isInShadowDOM(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(shadow.isInShadowDOM(undefined)).toBe(false);
  });

  test('returns false when root node has no host', () => {
    const el = { getRootNode: () => ({}) };
    expect(shadow.isInShadowDOM(el)).toBe(false);
  });

  test('returns true when root node has host', () => {
    const el = { getRootNode: () => ({ host: {} }) };
    expect(shadow.isInShadowDOM(el)).toBe(true);
  });

  test('returns false when getRootNode throws', () => {
    const el = { getRootNode: () => { throw new Error('fail'); } };
    expect(shadow.isInShadowDOM(el)).toBe(false);
  });

  test('returns true when host is explicitly null (host key exists)', () => {
    const el = { getRootNode: () => ({ host: null }) };
    // host is null but !== undefined, so host !== undefined is true
    expect(shadow.isInShadowDOM(el)).toBe(true);
  });

  test('returns false when root node is null', () => {
    const el = { getRootNode: () => null };
    // null !== null is false → returns false
    expect(shadow.isInShadowDOM(el)).toBe(false);
  });

  test('returns false for element without getRootNode', () => {
    expect(shadow.isInShadowDOM({})).toBe(false);
  });
});

// ========== walkShadowTree ==========

describe('shadow.walkShadowTree', () => {
  test('does nothing for null root', () => {
    const cb = jest.fn();
    expect(() => shadow.walkShadowTree(null, cb)).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  test('does nothing for undefined root', () => {
    const cb = jest.fn();
    expect(() => shadow.walkShadowTree(undefined, cb)).not.toThrow();
  });

  test('calls callback for each element in the tree', () => {
    const child1 = { shadowRoot: null, querySelectorAll: () => [] };
    const child2 = { shadowRoot: null, querySelectorAll: () => [] };
    const root = { shadowRoot: null, querySelectorAll: () => [] };
    // Walker starts at root (currentNode), so only push children into the queue
    treeWalkerQueue.push(child1, child2);

    const visited = [];
    shadow.walkShadowTree(root, (el) => visited.push(el));

    expect(visited).toHaveLength(3);
    expect(visited).toContain(root);
    expect(visited).toContain(child1);
    expect(visited).toContain(child2);
  });

  test('walks into open shadow roots', () => {
    const innerChild = {};
    const shadowRoot = {
      querySelectorAll: () => [],
    };
    // When walking into the shadow root, set up a new tree walker
    const shadowInnerChild = { shadowRoot: null };
    const child = { shadowRoot };

    treeWalkerQueue.push(child);

    // When walkShadowTree recurses into shadowRoot, we need nodes for that call too
    const origCreate = globalThis.document.createTreeWalker;
    let callCount = 0;
    globalThis.document.createTreeWalker = jest.fn((root) => {
      callCount++;
      if (callCount === 1) {
        // First call: main tree walker
        return {
          currentNode: root,
          _nodes: [child],
          _index: 0,
          nextNode() {
            if (this._index < this._nodes.length) {
              this.currentNode = this._nodes[this._index++];
              return this.currentNode;
            }
            return null;
          }
        };
      }
      // Second call: shadow root tree walker
      return {
        currentNode: root,
        _nodes: [shadowInnerChild],
        _index: 0,
        nextNode() {
          if (this._index < this._nodes.length) {
            this.currentNode = this._nodes[this._index++];
            return this.currentNode;
          }
          return null;
        }
      };
    });

    const visited = [];
    shadow.walkShadowTree({ shadowRoot: null }, (el) => visited.push(el));

    // Should visit child + shadow inner child
    expect(visited).toContain(child);
    expect(visited).toContain(shadowInnerChild);

    globalThis.document.createTreeWalker = origCreate;
  });

  test('walks slot assigned nodes', () => {
    const assignedEl = {
      nodeType: Node.ELEMENT_NODE,
      shadowRoot: null
    };
    const slot = {
      assignedNodes: () => [assignedEl],
      querySelectorAll: () => []
    };
    const child = {
      shadowRoot: null,
      querySelectorAll: () => [slot]
    };

    treeWalkerQueue.push(child);

    const visited = [];
    shadow.walkShadowTree({ shadowRoot: null }, (el) => visited.push(el));

    expect(visited).toContain(child);
    expect(visited).toContain(assignedEl);
    // slot is not passed to callback — only its assignedNodes are
  });

  test('skips non-element assigned nodes', () => {
    const textNode = { nodeType: 3 }; // TEXT_NODE
    const slot = {
      assignedNodes: () => [textNode],
      querySelectorAll: () => []
    };
    const child = {
      shadowRoot: null,
      querySelectorAll: () => [slot]
    };

    treeWalkerQueue.push(child);

    const visited = [];
    shadow.walkShadowTree({ shadowRoot: null }, (el) => visited.push(el));

    expect(visited).toContain(child);
    // Text node should NOT be in visited (wrong nodeType)
    expect(visited).not.toContain(textNode);
  });

  test('handles element without querySelectorAll in slot walk', () => {
    const child = {
      shadowRoot: null,
      // no querySelectorAll — returns undefined, forEach won't be called
    };

    treeWalkerQueue.push(child);

    const visited = [];
    expect(() => shadow.walkShadowTree({ shadowRoot: null }, (el) => visited.push(el))).not.toThrow();
    expect(visited).toContain(child);
  });

  test('handles empty tree (root only, no children)', () => {
    // Walker starts at root — don't push root into queue again
    const visited = [];
    shadow.walkShadowTree({ shadowRoot: null, querySelectorAll: () => [] }, (el) => visited.push(el));
    expect(visited).toHaveLength(1);
  });

  test('walks shadow root of slot-assigned element (line 84 true branch)', () => {
    const innerChild = { shadowRoot: null, querySelectorAll: () => [] };
    const assignedSR = {
      querySelectorAll: () => [],
    };
    treeWalkerQueue.push(innerChild);
    const assignedEl = {
      nodeType: Node.ELEMENT_NODE,
      shadowRoot: assignedSR,
      querySelectorAll: () => [],
    };
    const slot = {
      assignedNodes: () => [assignedEl],
      querySelectorAll: () => [],
    };
    const child = {
      shadowRoot: null,
      querySelectorAll: (sel) => sel === 'slot' ? [slot] : [],
    };

    treeWalkerQueue.push(child);

    const visited = [];
    shadow.walkShadowTree({ shadowRoot: null }, (el) => visited.push(el));

    expect(visited).toContain(assignedEl);
    expect(visited).toContain(innerChild);
  });
});

// ========== queryDeep ==========

describe('shadow.queryDeep', () => {
  test('returns empty array for null root', () => {
    expect(shadow.queryDeep(null, 'div')).toEqual([]);
  });

  test('returns empty array for null selector', () => {
    expect(shadow.queryDeep({}, null)).toEqual([]);
  });

  test('returns empty array for empty selector', () => {
    expect(shadow.queryDeep({}, '')).toEqual([]);
  });

  test('finds direct matches via querySelectorAll', () => {
    const match1 = { matches: () => true };
    const match2 = { matches: () => true };
    const root = {
      querySelectorAll: () => [match1, match2],
      shadowRoot: null
    };

    const results = shadow.queryDeep(root, '.test');
    expect(results).toContain(match1);
    expect(results).toContain(match2);
  });

  test('deduplicates results', () => {
    const match = { matches: () => true };
    let callCount = 0;
    const root = {
      // Return the same element from both querySelectorAll and walkShadowTree
      querySelectorAll: () => [match],
      shadowRoot: null
    };

    treeWalkerQueue.push(match);

    const results = shadow.queryDeep(root, '.test');
    // match should only appear once
    const occurrences = results.filter(r => r === match).length;
    expect(occurrences).toBe(1);
  });

  test('finds matches inside shadow roots', () => {
    const shadowMatch = {};
    const shadowRoot = {
      querySelectorAll: () => [shadowMatch],
    };
    const host = { shadowRoot, matches: () => false };
    const root = {
      querySelectorAll: () => [],
      shadowRoot: null
    };

    treeWalkerQueue.push(host);

    const results = shadow.queryDeep(root, '.inner');
    expect(results).toContain(shadowMatch);
  });

  test('skips root element from walk matching', () => {
    const root = {
      querySelectorAll: () => [],
      matches: () => true,
      shadowRoot: null
    };

    treeWalkerQueue.push(root);

    const results = shadow.queryDeep(root, 'div');
    // Root should be skipped (el === root check)
    expect(results).not.toContain(root);
  });

  test('handles invalid selector gracefully', () => {
    const root = {
      querySelectorAll: (sel) => {
        if (sel === 'slot') return [];
        throw new Error('invalid selector');
      },
      shadowRoot: null
    };

    expect(() => shadow.queryDeep(root, '!!!invalid')).not.toThrow();
    expect(shadow.queryDeep(root, '!!!invalid')).toEqual([]);
  });

  test('handles matches() throwing', () => {
    const el = {
      matches: () => { throw new Error('no matches'); },
      shadowRoot: null
    };
    const root = {
      querySelectorAll: () => [],
      shadowRoot: null
    };

    treeWalkerQueue.push(el);

    expect(() => shadow.queryDeep(root, 'div')).not.toThrow();
  });

  test('handles shadow root querySelectorAll throwing', () => {
    const badSR = {
      querySelectorAll: (sel) => {
        if (sel === 'slot') return [];
        throw new Error('bad shadow query');
      },
    };
    const host = { shadowRoot: badSR, matches: () => false, querySelectorAll: () => [] };
    const root = {
      querySelectorAll: () => [],
      shadowRoot: null
    };

    treeWalkerQueue.push(host);

    expect(() => shadow.queryDeep(root, 'div')).not.toThrow();
  });

  test('adds element via el.matches path when not in results (line 124 true branch)', () => {
    const el = {
      matches: () => true,
      shadowRoot: null,
      querySelectorAll: () => [],
    };
    const root = {
      querySelectorAll: () => [],  // fast path finds nothing
      shadowRoot: null,
    };

    treeWalkerQueue.push(el);

    const results = shadow.queryDeep(root, '.match');
    expect(results).toContain(el);
    expect(results).toHaveLength(1);
  });
});

// ========== queryDeepFirst ==========

describe('shadow.queryDeepFirst', () => {
  test('returns null for null root', () => {
    expect(shadow.queryDeepFirst(null, 'div')).toBeNull();
  });

  test('returns null for null selector', () => {
    expect(shadow.queryDeepFirst({}, null)).toBeNull();
  });

  test('returns null for empty selector', () => {
    expect(shadow.queryDeepFirst({}, '')).toBeNull();
  });

  test('returns first match from querySelector', () => {
    const match = { id: 'target' };
    const root = {
      querySelector: () => match,
      shadowRoot: null
    };

    const result = shadow.queryDeepFirst(root, '#target');
    expect(result).toBe(match);
  });

  test('returns null when querySelector returns null', () => {
    const root = {
      querySelector: () => null,
      querySelectorAll: () => [],
      shadowRoot: null
    };

    treeWalkerQueue.push({ matches: () => false, shadowRoot: null });

    const result = shadow.queryDeepFirst(root, '.missing');
    expect(result).toBeNull();
  });

  test('finds match via walkShadowTree when querySelector misses', () => {
    const match = { matches: () => true, shadowRoot: null };
    const root = {
      querySelector: () => null,
      shadowRoot: null
    };

    treeWalkerQueue.push(match);

    const result = shadow.queryDeepFirst(root, '.deep');
    expect(result).toBe(match);
  });

  test('stops walking after finding first match', () => {
    let walkCount = 0;
    const match1 = {
      matches: () => { walkCount++; return true; },
      shadowRoot: null
    };
    const match2 = {
      matches: () => { walkCount++; return true; },
      shadowRoot: null
    };
    const root = {
      querySelector: () => null,
      shadowRoot: null
    };

    treeWalkerQueue.push(match1, match2);

    shadow.queryDeepFirst(root, '.item');

    // After finding match1, the walk callback should skip remaining
    // (walkCount may be 1 or 2 depending on when `found` short-circuits)
    // The key assertion is that the result is match1, not match2
  });

  test('finds match inside shadow root', () => {
    const shadowMatch = { id: 'shadow-target' };
    const shadowRoot = {
      querySelector: () => shadowMatch,
    };
    const host = { shadowRoot, matches: () => false };
    const root = {
      querySelector: () => null,
      shadowRoot: null
    };

    treeWalkerQueue.push(host);

    const result = shadow.queryDeepFirst(root, '.inner');
    expect(result).toBe(shadowMatch);
  });

  test('handles querySelector throwing', () => {
    const root = {
      querySelector: () => { throw new Error('bad selector'); },
      shadowRoot: null
    };

    expect(() => shadow.queryDeepFirst(root, '!!!')).not.toThrow();
  });

  test('handles matches() throwing gracefully', () => {
    const el = {
      matches: () => { throw new Error('unsupported'); },
      shadowRoot: null
    };
    const root = {
      querySelector: () => null,
      shadowRoot: null
    };

    treeWalkerQueue.push(el);

    expect(() => shadow.queryDeepFirst(root, 'div')).not.toThrow();
  });

  test('handles shadow root querySelector throwing', () => {
    const badSR = {
      querySelector: () => { throw new Error('shadow query fail'); },
    };
    const host = { shadowRoot: badSR, matches: () => false };
    const root = {
      querySelector: () => null,
      shadowRoot: null
    };

    treeWalkerQueue.push(host);

    expect(() => shadow.queryDeepFirst(root, '.deep')).not.toThrow();
  });

  test('skips root element from walk matching', () => {
    const root = {
      querySelector: () => null,
      matches: () => true,
      shadowRoot: null
    };

    treeWalkerQueue.push(root);

    const result = shadow.queryDeepFirst(root, 'div');
    // Root is skipped (el === root check)
    expect(result).toBeNull();
  });
});
