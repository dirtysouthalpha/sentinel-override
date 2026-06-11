// tests/knowledge-graph-init.test.js
// Covers background/knowledge-graph.js lines 31-46:
//   init() deserialization path when storage contains existing nodes and edges.
//
// Must be a SEPARATE test file: the module-level initKnowledgeGraph() fires once
// at import time, so storage must be pre-populated BEFORE the import.

import { jest } from '@jest/globals';

const storageMock = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const r = {};
        for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) {
          r[k] = storageMock[k];
        }
        return r;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
      remove: jest.fn(async (key) => { delete storageMock[key]; }),
    },
  },
};

// Pre-populate storage BEFORE importing the module so the module-level
// initKnowledgeGraph() call reconstructs the graph from this data.
storageMock['sentinel_knowledge_graph'] = {
  nodes: {
    n1: { id: 'n1', type: 'action', label: 'Click submit', properties: { step: 1 }, source: 'agent', createdAt: 1000, updatedAt: 1000 },
    n2: { id: 'n2', type: 'observation', label: 'Page loaded', properties: {}, source: 'agent', createdAt: 2000, updatedAt: 2000 },
  },
  edges: {
    'n1-n2-causes': { id: 'n1-n2-causes', source: 'n1', target: 'n2', relation: 'causes', weight: 1, properties: {}, createdAt: 3000 },
  },
};

const {
  initKnowledgeGraph,
  getKnowledgeNode,
  getKnowledgeNeighbors,
} = await import('../background/knowledge-graph.js');

// Ensure the module-level async init completes before tests run
await initKnowledgeGraph();

describe('init() deserialization from storage', () => {
  test('reconstructs nodes map from stored data', () => {
    const n1 = getKnowledgeNode('n1');
    expect(n1).not.toBeNull();
    expect(n1.type).toBe('action');
    expect(n1.label).toBe('Click submit');
    expect(n1.properties.step).toBe(1);
  });

  test('reconstructs second node correctly', () => {
    const n2 = getKnowledgeNode('n2');
    expect(n2).not.toBeNull();
    expect(n2.type).toBe('observation');
    expect(n2.label).toBe('Page loaded');
  });

  test('rebuilds adjacency list from stored edges', () => {
    // getKnowledgeNeighbors returns Map<neighborId, relation>
    const neighbors = getKnowledgeNeighbors('n1');
    expect(neighbors.has('n2')).toBe(true);
    expect(neighbors.get('n2')).toBe('causes');
  });

  test('does not add non-existent edge source to adjacency list', () => {
    // n2 has no outgoing edges, so its neighbor map should be empty
    const n2Neighbors = getKnowledgeNeighbors('n2');
    expect(n2Neighbors.size).toBe(0);
  });
});
