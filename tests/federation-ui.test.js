/**
 * Federation UI Tests
 *
 * Tests the federation-ui.js popup module using fresh vm sandbox per test.
 * Covers: renderPeerList, renderJobList, toggle, distribute, show/hide panel.
 *
 * @version 1.0.0
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import vm from 'vm';

// ── Shared DOM mock infrastructure ──
const _elementsById = new Map();

function makeEl(tag) {
  const cls = new Set();
  const children = [];
  return {
    tagName: (tag || 'div').toUpperCase(),
    id: '',
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    checked: false,
    style: {},
    _attrs: {},
    classList: {
      add(...cs) { cs.forEach(c => cls.add(c)); },
      remove(...cs) { cs.forEach(c => cls.delete(c)); },
      contains(c) { return cls.has(c); },
      toggle(c) { if (cls.has(c)) cls.delete(c); else cls.add(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(child) { children.push(child); return child; },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      return child;
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    _children: children,
    _classList: cls,
  };
}

function resetDOM() {
  _elementsById.clear();
  const ids = [
    'federation-panel', 'fed-toggle-btn', 'fed-peer-list', 'fed-job-list',
    'fed-goal-input', 'fed-distribute-btn', 'fed-show-panel',
  ];
  for (const id of ids) {
    _elementsById.set(id, makeEl('div'));
  }
}

// ── Module loader: creates a FRESH vm context each call ──
const _moduleCode = fs.readFileSync('popup-modules/federation-ui.js', 'utf-8');

let _sandbox;
let _mocks;

function loadModule() {
  resetDOM();

  _mocks = {
    setInterval: jest.fn(() => 12345),
    clearInterval: jest.fn(),
    sendMessage: jest.fn((msg, cb) => {
      if (cb) {
        process.nextTick(() => cb({ enabled: false, peers: [], jobs: [], peerCount: 0, activeJobs: 0 }));
      }
    }),
  };

  const documentMock = {
    getElementById(id) { return _elementsById.get(id) ?? null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener: jest.fn(),
    readyState: 'loading',
  };

  const chromeMock = {
    runtime: {
      sendMessage: _mocks.sendMessage,
      lastError: null,
    },
  };

  _sandbox = {
    document: documentMock,
    chrome: chromeMock,
    window: {},
    setInterval: _mocks.setInterval,
    clearInterval: _mocks.clearInterval,
    console,
    Date,
    Math,
    Set,
    Map,
    Object,
    Array,
    JSON,
    String,
    Number,
    Boolean,
    nextTick: process.nextTick.bind(process),
  };

  vm.createContext(_sandbox);
  new vm.Script(_moduleCode).runInContext(_sandbox);

  return {
    showFederationPanel: _sandbox.showFederationPanel,
    hideFederationPanel: _sandbox.hideFederationPanel,
    refreshFederationStatus: _sandbox.refreshFederationStatus,
    renderPeerList: _sandbox.renderPeerList,
    renderJobList: _sandbox.renderJobList,
    handleDistributeGoal: _sandbox.handleDistributeGoal,
    handleFederationToggle: _sandbox.handleFederationToggle,
    updateFederationToggle: _sandbox.updateFederationToggle,
    initFederationUI: _sandbox.initFederationUI,
    window: _sandbox.window,
    chrome: chromeMock,
    mocks: _mocks,
    elements: _elementsById,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// renderPeerList
// ═══════════════════════════════════════════════════════════
describe('renderPeerList', () => {
  test('renders empty message when no peers', () => {
    const m = loadModule();
    m.renderPeerList([]);
    const container = m.elements.get('fed-peer-list');
    expect(container.innerHTML).toContain('No peers');
  });

  test('renders peer items for each peer', () => {
    const m = loadModule();
    m.renderPeerList([
      { id: 'local-agent-0', name: 'Local Agent 1', trust: 100, status: 'running' },
      { id: 'local-agent-1', name: 'Local Agent 2', trust: 95, status: 'idle' },
    ]);
    const container = m.elements.get('fed-peer-list');
    expect(container._children.length).toBe(2);
  });

  test('peer item shows name, trust, and status', () => {
    const m = loadModule();
    m.renderPeerList([{ id: 'p1', name: 'Test Peer', trust: 85, status: 'running' }]);
    const container = m.elements.get('fed-peer-list');
    const item = container._children[0];
    expect(item._children.length).toBe(3);
    expect(item._children[0].textContent).toBe('Test Peer');
    expect(item._children[1].textContent).toContain('85');
    expect(item._children[2].textContent).toBe('running');
  });

  test('uses peer.id when name is not provided', () => {
    const m = loadModule();
    m.renderPeerList([{ id: 'remote-1', trust: 50, status: 'active' }]);
    const container = m.elements.get('fed-peer-list');
    expect(container._children[0]._children[0].textContent).toBe('remote-1');
  });

  test('handles undefined trust value', () => {
    const m = loadModule();
    m.renderPeerList([{ id: 'p1', name: 'No Trust Peer', status: 'idle' }]);
    const container = m.elements.get('fed-peer-list');
    expect(container._children[0]._children[1].textContent).toContain('N/A');
  });
});

// ═══════════════════════════════════════════════════════════
// renderJobList
// ═══════════════════════════════════════════════════════════
describe('renderJobList', () => {
  test('renders empty message when no jobs', () => {
    const m = loadModule();
    m.renderJobList([]);
    const container = m.elements.get('fed-job-list');
    expect(container.innerHTML).toContain('No active jobs');
  });

  test('renders job items', () => {
    const m = loadModule();
    m.renderJobList([
      { id: 'j1', goal: 'List users', status: 'running', subGoalCount: 3 },
      { id: 'j2', goal: 'Extract data', status: 'distributing', subGoalCount: 2 },
    ]);
    const container = m.elements.get('fed-job-list');
    expect(container._children.length).toBe(2);
  });

  test('job item shows goal and status', () => {
    const m = loadModule();
    m.renderJobList([{ id: 'j1', goal: 'Test Goal', status: 'running', subGoalCount: 5 }]);
    const container = m.elements.get('fed-job-list');
    const item = container._children[0];
    expect(item._children[0].textContent).toBe('Test Goal');
    expect(item._children[1].textContent).toContain('running');
    expect(item._children[1].textContent).toContain('5');
  });

  test('handles missing subGoalCount', () => {
    const m = loadModule();
    m.renderJobList([{ id: 'j1', goal: 'No subgoals', status: 'pending' }]);
    const container = m.elements.get('fed-job-list');
    expect(container._children[0]._children[1].textContent).toContain('pending');
  });
});

// ═══════════════════════════════════════════════════════════
// showFederationPanel / hideFederationPanel
// ═══════════════════════════════════════════════════════════
describe('showFederationPanel', () => {
  test('sets panel display to flex', () => {
    const m = loadModule();
    const panel = m.elements.get('federation-panel');
    panel.style.display = 'none';
    m.showFederationPanel();
    expect(panel.style.display).toBe('flex');
  });

  test('starts auto-refresh interval', () => {
    const m = loadModule();
    m.showFederationPanel();
    expect(m.mocks.setInterval).toHaveBeenCalled();
  });
});

describe('hideFederationPanel', () => {
  test('hides panel and clears interval', () => {
    const m = loadModule();
    m.showFederationPanel();
    m.hideFederationPanel();
    const panel = m.elements.get('federation-panel');
    expect(panel.style.display).toBe('none');
    expect(m.mocks.clearInterval).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// updateFederationToggle
// ═══════════════════════════════════════════════════════════
describe('updateFederationToggle', () => {
  test('shows Disable when enabled', () => {
    const m = loadModule();
    m.updateFederationToggle(true);
    const btn = m.elements.get('fed-toggle-btn');
    expect(btn.textContent).toBe('Disable');
    expect(btn._classList.has('active')).toBe(true);
  });

  test('shows Enable when disabled', () => {
    const m = loadModule();
    m.updateFederationToggle(false);
    const btn = m.elements.get('fed-toggle-btn');
    expect(btn.textContent).toBe('Enable');
    expect(btn._classList.has('active')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// handleDistributeGoal
// ═══════════════════════════════════════════════════════════
describe('handleDistributeGoal', () => {
  test('sends federation_distribute message with goal', () => {
    const m = loadModule();
    const input = m.elements.get('fed-goal-input');
    input.value = 'List all users';
    m.handleDistributeGoal();
    expect(m.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'federation_distribute', goal: 'List all users' }),
      expect.any(Function)
    );
  });

  test('does nothing when input is empty', () => {
    const m = loadModule();
    const input = m.elements.get('fed-goal-input');
    input.value = '   ';
    m.handleDistributeGoal();
    expect(m.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('disables distribute button during request', () => {
    const m = loadModule();
    const input = m.elements.get('fed-goal-input');
    input.value = 'Test goal';
    const btn = m.elements.get('fed-distribute-btn');
    m.handleDistributeGoal();
    expect(btn.disabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// handleFederationToggle
// ═══════════════════════════════════════════════════════════
describe('handleFederationToggle', () => {
  test('sends federation_enable when not active', () => {
    const m = loadModule();
    const btn = m.elements.get('fed-toggle-btn');
    btn._classList.delete('active');
    m.handleFederationToggle();
    expect(m.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'federation_enable' }),
      expect.any(Function)
    );
  });

  test('sends federation_disable when active', () => {
    const m = loadModule();
    const btn = m.elements.get('fed-toggle-btn');
    btn._classList.add('active');
    m.handleFederationToggle();
    expect(m.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'federation_disable' }),
      expect.any(Function)
    );
  });
});

// ═══════════════════════════════════════════════════════════
// initFederationUI
// ═══════════════════════════════════════════════════════════
describe('initFederationUI', () => {
  test('attaches click listeners to buttons', () => {
    const m = loadModule();
    m.initFederationUI();
    const toggleBtn = m.elements.get('fed-toggle-btn');
    const distributeBtn = m.elements.get('fed-distribute-btn');
    expect(toggleBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    expect(distributeBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  test('attaches keydown listener to goal input', () => {
    const m = loadModule();
    m.initFederationUI();
    const input = m.elements.get('fed-goal-input');
    expect(input.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

// ═══════════════════════════════════════════════════════════
// window.FederationUI exports
// ═══════════════════════════════════════════════════════════
describe('window.FederationUI exports', () => {
  test('exposes all required functions', () => {
    const m = loadModule();
    expect(m.window.FederationUI).toBeDefined();
    expect(typeof m.window.FederationUI.show).toBe('function');
    expect(typeof m.window.FederationUI.hide).toBe('function');
    expect(typeof m.window.FederationUI.refresh).toBe('function');
    expect(typeof m.window.FederationUI.renderPeers).toBe('function');
    expect(typeof m.window.FederationUI.renderJobs).toBe('function');
  });
});
