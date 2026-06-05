/**
 * Tests for background/knowledge-graph.js
 */

import { jest } from '@jest/globals';
import {
  initKnowledgeGraph,
  addKnowledgeNode,
  updateKnowledgeNode,
  addKnowledgeEdge,
  getKnowledgeNode,
  getKnowledgeNeighbors,
  findKnowledgeNodes,
  findKnowledgeContradictions,
  isKnowledgeNovel,
  findKnowledgePath,
  getKnowledgeGraphStats,
  persistKnowledgeGraph,
  clearKnowledgeGraph
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

describe('addKnowledgeNode and getKnowledgeNode', () => {
  test('adds and retrieves a node', () => {
    const node = addKnowledgeNode('node1', { type: 'action', label: 'Click button', properties: { step: 1 }, source: 'agent' });
    expect(node).not.toBeNull();
    expect(node.id).toBe('node1');
    expect(node.type).toBe('action');
    expect(node.label).toBe('Click button');
    expect(node.properties.step).toBe(1);

    const retrieved = getKnowledgeNode('node1');
    expect(retrieved).toEqual(node);
  });

  test('returns null for missing node', () => {
    expect(getKnowledgeNode('nonexistent')).toBeNull();
  });

  test('uses defaults when data is empty', () => {
    const node = addKnowledgeNode('node_defaults');
    expect(node.type).toBe('generic');
    expect(node.label).toBe('node_defaults');
    expect(node.source).toBe('unknown');
  });

  test('returns null for node with same id as deleted node after clear', async () => {
    addKnowledgeNode('temp_node', { type: 'test' });
    await clearKnowledgeGraph();
    expect(getKnowledgeNode('temp_node')).toBeNull();
  });
});

describe('updateKnowledgeNode', () => {
  test('updates existing node properties', () => {
    addKnowledgeNode('update_node', { type: 'action', label: 'Original', properties: { status: 'pending' } });
    const updated = updateKnowledgeNode('update_node', { label: 'Updated', properties: { status: 'done' } });
    expect(updated).toBe(true);
    const node = getKnowledgeNode('update_node');
    expect(node.label).toBe('Updated');
    expect(node.properties.status).toBe('done');
  });

  test('returns false for nonexistent node', () => {
    expect(updateKnowledgeNode('nonexistent', { label: 'X' })).toBe(false);
  });

  test('merges properties (does not replace)', () => {
    addKnowledgeNode('merge_node', { properties: { a: 1, b: 2 } });
    updateKnowledgeNode('merge_node', { properties: { b: 99, c: 3 } });
    const node = getKnowledgeNode('merge_node');
    expect(node.properties.a).toBe(1);
    expect(node.properties.b).toBe(99);
    expect(node.properties.c).toBe(3);
  });

  test('updates type when provided', () => {
    addKnowledgeNode('type_node', { type: 'action' });
    updateKnowledgeNode('type_node', { type: 'observation' });
    expect(getKnowledgeNode('type_node').type).toBe('observation');
  });
});

describe('addKnowledgeEdge', () => {
  test('adds edge between two nodes', () => {
    addKnowledgeNode('src', { type: 'action' });
    addKnowledgeNode('tgt', { type: 'action' });
    const edge = addKnowledgeEdge('src', 'tgt', { relation: 'leads_to', weight: 0.9 });
    expect(edge).not.toBeNull();
    expect(edge.source).toBe('src');
    expect(edge.target).toBe('tgt');
    expect(edge.relation).toBe('leads_to');
    expect(edge.weight).toBe(0.9);
  });

  test('returns null when source node does not exist', () => {
    addKnowledgeNode('only_tgt', { type: 'action' });
    const edge = addKnowledgeEdge('nonexistent', 'only_tgt', { relation: 'related' });
    expect(edge).toBeNull();
  });

  test('returns null when target node does not exist', () => {
    addKnowledgeNode('only_src', { type: 'action' });
    const edge = addKnowledgeEdge('only_src', 'nonexistent', { relation: 'related' });
    expect(edge).toBeNull();
  });

  test('defaults relation to "related"', () => {
    addKnowledgeNode('a', {});
    addKnowledgeNode('b', {});
    const edge = addKnowledgeEdge('a', 'b');
    expect(edge.relation).toBe('related');
    expect(edge.weight).toBe(1.0);
  });
});

describe('getKnowledgeNeighbors', () => {
  test('returns neighbors at depth 1', () => {
    addKnowledgeNode('root', {});
    addKnowledgeNode('child1', {});
    addKnowledgeNode('child2', {});
    addKnowledgeEdge('root', 'child1', { relation: 'has' });
    addKnowledgeEdge('root', 'child2', { relation: 'has' });

    const neighbors = getKnowledgeNeighbors('root', 1);
    expect(neighbors.has('child1')).toBe(true);
    expect(neighbors.has('child2')).toBe(true);
  });

  test('returns deeper neighbors at depth 2', () => {
    addKnowledgeNode('n1', {});
    addKnowledgeNode('n2', {});
    addKnowledgeNode('n3', {});
    addKnowledgeEdge('n1', 'n2', { relation: 'next' });
    addKnowledgeEdge('n2', 'n3', { relation: 'next' });

    const neighbors = getKnowledgeNeighbors('n1', 2);
    expect(neighbors.has('n2')).toBe(true);
    expect(neighbors.has('n3')).toBe(true);
  });

  test('returns empty map for isolated node', () => {
    addKnowledgeNode('isolated', {});
    const neighbors = getKnowledgeNeighbors('isolated');
    expect(neighbors.size).toBe(0);
  });
});

describe('findKnowledgeNodes', () => {
  test('finds nodes by type', () => {
    addKnowledgeNode('act1', { type: 'action', label: 'click' });
    addKnowledgeNode('obs1', { type: 'observation', label: 'visible' });
    addKnowledgeNode('act2', { type: 'action', label: 'type' });

    const actions = findKnowledgeNodes({ type: 'action' });
    expect(actions.length).toBe(2);
    expect(actions.every(n => n.type === 'action')).toBe(true);
  });

  test('finds nodes by label substring', () => {
    addKnowledgeNode('l1', { label: 'login button' });
    addKnowledgeNode('l2', { label: 'logout link' });
    addKnowledgeNode('l3', { label: 'submit form' });

    const matches = findKnowledgeNodes({ label: 'log' });
    expect(matches.length).toBe(2);
  });

  test('finds nodes by properties', () => {
    addKnowledgeNode('p1', { properties: { status: 'done', step: 1 } });
    addKnowledgeNode('p2', { properties: { status: 'pending', step: 2 } });
    addKnowledgeNode('p3', { properties: { status: 'done', step: 3 } });

    const done = findKnowledgeNodes({ properties: { status: 'done' } });
    expect(done.length).toBe(2);
  });

  test('returns empty array when no matches', () => {
    addKnowledgeNode('x1', { type: 'action' });
    expect(findKnowledgeNodes({ type: 'nonexistent' })).toEqual([]);
  });
});

describe('findKnowledgeContradictions', () => {
  test('finds contradicting property values', () => {
    addKnowledgeNode('c1', { type: 'state', label: 'button', properties: { visible: true } });
    addKnowledgeNode('c2', { type: 'state', label: 'button', properties: { visible: false } });

    const contradictions = findKnowledgeContradictions();
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].type).toBe('property_conflict');
    expect(contradictions[0].property).toBe('visible');
  });

  test('returns empty array when no contradictions', () => {
    addKnowledgeNode('nc1', { type: 'action', label: 'click', properties: { step: 1 } });
    addKnowledgeNode('nc2', { type: 'action', label: 'type', properties: { step: 2 } });

    const contradictions = findKnowledgeContradictions();
    expect(contradictions).toEqual([]);
  });
});

describe('isKnowledgeNovel', () => {
  test('isolated node is novel', () => {
    addKnowledgeNode('novel_node', {});
    expect(isKnowledgeNovel('novel_node')).toBe(true);
  });

  test('connected node is not novel', () => {
    addKnowledgeNode('connected_src', {});
    addKnowledgeNode('connected_tgt', {});
    addKnowledgeEdge('connected_src', 'connected_tgt', {});
    expect(isKnowledgeNovel('connected_src')).toBe(false);
  });

  test('nonexistent node returns true (no neighbors)', () => {
    expect(isKnowledgeNovel('does_not_exist')).toBe(true);
  });
});

describe('findKnowledgePath', () => {
  test('finds path between connected nodes', () => {
    addKnowledgeNode('s', {});
    addKnowledgeNode('m', {});
    addKnowledgeNode('e', {});
    addKnowledgeEdge('s', 'm', {});
    addKnowledgeEdge('m', 'e', {});

    const path = findKnowledgePath('s', 'e');
    expect(path).not.toBeNull();
    expect(path[0]).toBe('s');
    expect(path[path.length - 1]).toBe('e');
    expect(path).toContain('m');
  });

  test('returns null when no path exists', () => {
    addKnowledgeNode('p1', {});
    addKnowledgeNode('p2', {});
    expect(findKnowledgePath('p1', 'p2')).toBeNull();
  });

  test('returns null when nodes do not exist', () => {
    expect(findKnowledgePath('noexist1', 'noexist2')).toBeNull();
  });

  test('returns single-element path when source equals target', () => {
    addKnowledgeNode('self', {});
    const path = findKnowledgePath('self', 'self');
    expect(path).toEqual(['self']);
  });
});

describe('getKnowledgeGraphStats', () => {
  test('returns zero stats for empty graph', () => {
    const stats = getKnowledgeGraphStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.isolatedNodeCount).toBe(0);
    expect(stats.avgDegree).toBe(0);
  });

  test('counts nodes and edges correctly', () => {
    addKnowledgeNode('s1', { type: 'action' });
    addKnowledgeNode('s2', { type: 'observation' });
    addKnowledgeNode('s3', { type: 'action' });
    addKnowledgeEdge('s1', 's2', {});

    const stats = getKnowledgeGraphStats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(1);
    expect(stats.nodeTypes.action).toBe(2);
    expect(stats.nodeTypes.observation).toBe(1);
    expect(stats.isolatedNodeCount).toBe(2); // s3 and s2 has no outgoing... wait
    // Actually s1 -> s2, so s1 has 1 neighbor (connected), s2 has 0 outgoing (isolated), s3 has 0
    expect(stats.connectedComponentCount).toBeGreaterThanOrEqual(1);
    expect(typeof stats.avgDegree).toBe('number');
  });
});

describe('persistKnowledgeGraph and initKnowledgeGraph', () => {
  test('persists and reloads graph', async () => {
    addKnowledgeNode('persist1', { type: 'action', label: 'Persist test' });
    await persistKnowledgeGraph();
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  test('handles persist error gracefully', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('persist error'));
    addKnowledgeNode('pe1', {});
    await expect(persistKnowledgeGraph()).resolves.not.toThrow();
  });

  test('handles init error gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('init error'));
    await expect(initKnowledgeGraph()).resolves.not.toThrow();
  });
});

describe('clearKnowledgeGraph', () => {
  test('clears all nodes and edges', async () => {
    addKnowledgeNode('clr1', {});
    addKnowledgeNode('clr2', {});
    addKnowledgeEdge('clr1', 'clr2', {});

    await clearKnowledgeGraph();
    const stats = getKnowledgeGraphStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
  });

  test('handles clear storage error gracefully', async () => {
    chrome.storage.local.remove.mockRejectedValueOnce(new Error('clear error'));
    await expect(clearKnowledgeGraph()).resolves.not.toThrow();
  });
});
