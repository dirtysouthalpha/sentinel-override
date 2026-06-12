/**
 * Branch coverage for background/knowledge-graph.js — targets paths
 * not exercised by knowledge-graph.test.js.
 */

import { jest } from '@jest/globals';
import {
  clearKnowledgeGraph,
  addKnowledgeNode,
  addKnowledgeEdge,
  updateKnowledgeNode,
  getKnowledgeNode,
  getKnowledgeNeighbors,
  findKnowledgeContradictions,
  findKnowledgePath,
  getKnowledgeGraphStats,
} from '../background/knowledge-graph.js';

const storageMock = {};
globalThis.chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
      get: jest.fn(async (keys) => {
        const r = {};
        for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) r[k] = storageMock[k];
        return r;
      }),
      remove: jest.fn(async (key) => { delete storageMock[key]; })
    }
  }
};

beforeEach(async () => {
  jest.clearAllMocks();
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
  await clearKnowledgeGraph();
});

// ── updateKnowledgeNode default arg (line 97 branch[0]) ──────────────────────

describe('updateKnowledgeNode — no updates arg → default {} used (line 97)', () => {
  test('calling without second argument applies default {} and returns true', () => {
    addKnowledgeNode('nA', { type: 'generic', label: 'Node A' });
    // updateNode(id, updates = {}) — omitting updates triggers the default-arg branch
    const result = updateKnowledgeNode('nA');
    expect(result).toBe(true);
    expect(getKnowledgeNode('nA').label).toBe('Node A'); // unchanged
  });

  test('returns false for non-existent node (default arg path still exercised)', () => {
    const result = updateKnowledgeNode('noSuchNode');
    expect(result).toBe(false);
  });
});

// ── getKnowledgeNeighbors default arg (line 170 branch[0]) ───────────────────

describe('getKnowledgeNeighbors — no maxDepth arg → default 1 used (line 170)', () => {
  test('calling without maxDepth uses 1 and returns direct neighbors', () => {
    addKnowledgeNode('nA', { type: 'generic', label: 'A' });
    addKnowledgeNode('nB', { type: 'generic', label: 'B' });
    addKnowledgeNode('nC', { type: 'generic', label: 'C' });
    addKnowledgeEdge('nA', 'nB', { relation: 'child' });
    addKnowledgeEdge('nB', 'nC', { relation: 'child' });
    // maxDepth = 1 default — only immediate neighbors
    const neighbors = getKnowledgeNeighbors('nA');
    expect(neighbors.has('nB')).toBe(true);
    expect(neighbors.has('nC')).toBe(false); // depth 2 — excluded at default maxDepth=1
  });
});

// ── getKnowledgeNeighbors: already-visited neighbor skipped (line 189 false) ──

describe('getKnowledgeNeighbors — BFS encounters already-visited node (line 189)', () => {
  test('bidirectional edge: processing B encounters A already in visited → !visited.has(A) = false', () => {
    addKnowledgeNode('nA', { type: 'generic', label: 'A' });
    addKnowledgeNode('nB', { type: 'generic', label: 'B' });
    addKnowledgeNode('nC', { type: 'generic', label: 'C' });
    addKnowledgeEdge('nA', 'nB', { relation: 'fwd' });
    addKnowledgeEdge('nB', 'nA', { relation: 'bwd' }); // back-edge creates the revisit scenario
    addKnowledgeEdge('nB', 'nC', { relation: 'fwd' });
    // With maxDepth=2: A(d=0) queues B(d=1); B(d=1) processes neighbors {A, C}.
    // A is already in visited → !visited.has('nA') = false → branch 32[1] covered.
    const neighbors = getKnowledgeNeighbors('nA', 2);
    expect(neighbors.has('nB')).toBe(true);
    expect(neighbors.has('nC')).toBe(true);
    expect(neighbors.has('nA')).toBe(false); // source not returned as its own neighbor
  });
});

// ── findKnowledgeContradictions: same value → condition false (line 263) ─────

describe('findKnowledgeContradictions — same property value → no contradiction (line 263)', () => {
  test('two nodes with identical type, label, and property value produce no conflict', () => {
    addKnowledgeNode('nX', { type: 'config', label: 'timeout', properties: { value: 30 } });
    addKnowledgeNode('nY', { type: 'config', label: 'timeout', properties: { value: 30 } });
    // otherValue !== value → 30 !== 30 = false → whole if condition false → no push
    const contradictions = findKnowledgeContradictions();
    expect(contradictions.filter(c => c.property === 'value')).toHaveLength(0);
  });

  test('second node lacks the property → otherValue undefined → first part of && is false', () => {
    addKnowledgeNode('nX', { type: 'flag', label: 'feature', properties: { enabled: true } });
    addKnowledgeNode('nY', { type: 'flag', label: 'feature', properties: {} });
    // otherValue = undefined → otherValue !== undefined is false → short-circuit, no push
    const contradictions = findKnowledgeContradictions();
    expect(contradictions.filter(c => c.property === 'enabled')).toHaveLength(0);
  });
});

// ── findKnowledgePath: already-visited neighbor in BFS (line 318 false) ──────

describe('findKnowledgePath — BFS revisit (line 318 !visited.has false)', () => {
  test('back-edge causes neighbor already in visited; unreachable target returns null', () => {
    addKnowledgeNode('nA', { type: 'generic', label: 'A' });
    addKnowledgeNode('nB', { type: 'generic', label: 'B' });
    addKnowledgeNode('nC', { type: 'generic', label: 'C' }); // isolated — no path from A
    addKnowledgeEdge('nA', 'nB', { relation: 'next' });
    addKnowledgeEdge('nB', 'nA', { relation: 'prev' }); // back-edge
    // BFS from A: visited={A}, process [A] → push [A,B], visited.add(B)
    // Process [A,B]: neighbors of B = {A}. !visited.has(A) = false → branch 50[1] covered.
    // Queue exhausted before finding C → return null.
    const path = findKnowledgePath('nA', 'nC');
    expect(path).toBeNull();
  });

  test('direct path still found when there is also a back-edge', () => {
    addKnowledgeNode('nA', { type: 'generic', label: 'A' });
    addKnowledgeNode('nB', { type: 'generic', label: 'B' });
    addKnowledgeEdge('nA', 'nB', { relation: 'next' });
    addKnowledgeEdge('nB', 'nA', { relation: 'prev' });
    const path = findKnowledgePath('nA', 'nB');
    expect(path).toEqual(['nA', 'nB']);
  });
});

// ── getKnowledgeGraphStats: DFS revisit in _dfsVisit (line 378 false) ────────

describe('getKnowledgeGraphStats — DFS encounters already-visited node (line 378)', () => {
  test('bidirectional edge: _dfsVisit(B) tries to revisit A → !visited.has(A) = false', () => {
    addKnowledgeNode('nA', { type: 'generic', label: 'A' });
    addKnowledgeNode('nB', { type: 'generic', label: 'B' });
    addKnowledgeEdge('nA', 'nB', { relation: 'fwd' });
    addKnowledgeEdge('nB', 'nA', { relation: 'bwd' }); // cycle
    // _countConnectedComponents() → _dfsVisit('nA', visited):
    //   add A, process neighbors {B} → _dfsVisit('nB', visited):
    //     add B, process neighbors {A} → !visited.has('nA') = false → branch 55[1] covered
    const stats = getKnowledgeGraphStats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(2);
    expect(stats.connectedComponentCount).toBe(1);
    expect(stats.isolatedNodeCount).toBe(0);
  });

  test('isolated node has no neighbors → adjacencyList entry is empty Set (size=0)', () => {
    addKnowledgeNode('solo', { type: 'generic', label: 'solo' });
    const stats = getKnowledgeGraphStats();
    expect(stats.isolatedNodeCount).toBe(1);
    expect(stats.connectedComponentCount).toBe(1);
  });
});
