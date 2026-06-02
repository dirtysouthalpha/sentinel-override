// tests/popup-onboarding.test.js
// Unit tests for popup-modules/onboarding.js — first-run onboarding flow: step navigation, markDone, auto-show.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox(overrides = {}) {
  const steps = [];
  const modal = {
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
  };

  const stepElements = [];
  for (let i = 1; i <= 4; i++) {
    stepElements.push({
      dataset: { step: String(i) },
      style: { display: '' },
    });
  }

  const elements = {
    'onboarding-modal': modal,
    'onboardingStepIndicator': { textContent: '' },
    'onboardingNextBtn': {
      textContent: '',
      style: { display: '' },
      _clickListeners: [],
      addEventListener(event, cb) { if (event === 'click') this._clickListeners.push(cb); },
    },
    'onboardingPrevBtn': {
      textContent: '',
      style: { display: '' },
      _clickListeners: [],
      addEventListener(event, cb) { if (event === 'click') this._clickListeners.push(cb); },
    },
    'onboardingSkipBtn': {
      _clickListeners: [],
      addEventListener(event, cb) { if (event === 'click') this._clickListeners.push(cb); },
    },
  };

  let storageData = { sentinelOnboardingDone: false };

  const sandbox = {
    window: {},
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelectorAll(selector) {
        if (selector === '.onboarding-step') return stepElements;
        return [];
      },
    },
    chrome: {
      storage: {
        local: {
          async get(defaults) { return { ...defaults, ...storageData }; },
          async set(data) { Object.assign(storageData, data); },
        },
      },
    },
    setTimeout: (cb, ms) => cb(),
    console,
    parseInt: (s, radix) => {
      if (radix === undefined) {
        throw new Error('parseInt called without radix - unsafe (line 74 in popup-onboarding.test.js)');
      }
      return Number.parseInt(s, radix);
    },
    Promise,
    Object,
    Error,
    Symbol,
    Set,
    Map,
    ...overrides,
  };

  sandbox._elements = elements;
  sandbox._modal = modal;
  sandbox._stepElements = stepElements;
  sandbox._storageData = storageData;

  return sandbox;
}

function loadOnboarding(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/onboarding.js'), 'utf8');
  new vm.Script(source, { filename: 'onboarding.js' }).runInContext(sandbox);
}

describe('onboarding flow', () => {
  test('IIFE executes without error', () => {
    const sandbox = createSandbox();
    expect(() => loadOnboarding(sandbox)).not.toThrow();
  });

  test('wires click listeners to next, prev, skip buttons', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    expect(sandbox._elements['onboardingNextBtn']._clickListeners.length).toBeGreaterThan(0);
    expect(sandbox._elements['onboardingPrevBtn']._clickListeners.length).toBeGreaterThan(0);
    expect(sandbox._elements['onboardingSkipBtn']._clickListeners.length).toBeGreaterThan(0);
  });

  test('clicking next advances step indicator', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0]();

    const indicator = sandbox._elements['onboardingStepIndicator'];
    expect(indicator.textContent).toBe('Step 2 of 4');
  });

  test('clicking next from step 4 calls markDone and hides modal', async () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];

    // Advance to step 4
    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // 1→2
    nextBtn._clickListeners[0](); // 2→3
    nextBtn._clickListeners[0](); // 3→4
    nextBtn._clickListeners[0](); // 4→markDone (async)

    // Flush microtasks
    await new Promise(r => setTimeout(r, 0));

    expect(sandbox._modal.classList.contains('show')).toBe(false);
    expect(sandbox._storageData.sentinelOnboardingDone).toBe(true);
  });

  test('clicking prev from step 1 is a no-op', async () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);
    await new Promise(r => setTimeout(r, 0));

    const indicator = sandbox._elements['onboardingStepIndicator'];
    expect(indicator.textContent).toBe('Step 1 of 4');

    const prevBtn = sandbox._elements['onboardingPrevBtn'];
    expect(prevBtn._clickListeners.length).toBeGreaterThan(0);
    prevBtn._clickListeners[0]();

    expect(indicator.textContent).toBe('Step 1 of 4');
  });

  test('clicking prev from step 2 goes back to step 1', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    const prevBtn = sandbox._elements['onboardingPrevBtn'];

    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // 1→2
    expect(prevBtn._clickListeners.length).toBeGreaterThan(0);
    prevBtn._clickListeners[0](); // 2→1

    const indicator = sandbox._elements['onboardingStepIndicator'];
    expect(indicator.textContent).toBe('Step 1 of 4');
  });

  test('skip button calls markDone and hides modal', async () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const skipBtn = sandbox._elements['onboardingSkipBtn'];
    expect(skipBtn._clickListeners.length).toBeGreaterThan(0);
    skipBtn._clickListeners[0]();

    // Flush async
    await new Promise(r => setTimeout(r, 0));

    expect(sandbox._storageData.sentinelOnboardingDone).toBe(true);
    expect(sandbox._modal.classList.contains('show')).toBe(false);
  });

  test('auto-show triggers on first run (no sentinelOnboardingDone flag)', async () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);
    await new Promise(r => setTimeout(r, 0));

    const indicator = sandbox._elements['onboardingStepIndicator'];
    expect(indicator.textContent).toBe('Step 1 of 4');
    expect(sandbox._modal.classList.contains('show')).toBe(true);
  });

  test('auto-show skips when already onboarded', async () => {
    const sandbox = createSandbox();
    sandbox._storageData.sentinelOnboardingDone = true;
    loadOnboarding(sandbox);
    await new Promise(r => setTimeout(r, 0));

    const indicator = sandbox._elements['onboardingStepIndicator'];
    // Should not have been updated (stays empty)
    expect(indicator.textContent).toBe('');
  });

  test('showStep hides non-matching steps', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // Go to step 2

    const steps = sandbox._stepElements;
    expect(steps[0].style.display).toBe('none');
      expect(steps.length).toBeGreaterThan(3);
    expect(steps[1].style.display).toBe('');
    expect(steps[2].style.display).toBe('none');
    expect(steps[3].style.display).toBe('none');
  });

  test('prev button is hidden on step 1', async () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);
    await new Promise(r => setTimeout(r, 0));

    const prevBtn = sandbox._elements['onboardingPrevBtn'];
    expect(prevBtn.style.display).toBe('none');
  });

  test('prev button is visible on step 2+', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    nextBtn._clickListeners[0](); // 1→2

    const prevBtn = sandbox._elements['onboardingPrevBtn'];
    expect(prevBtn.style.display).toBe('');
  });

  test('next button text changes on last step', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // 1→2
    nextBtn._clickListeners[0](); // 2→3
    nextBtn._clickListeners[0](); // 3→4

    expect(nextBtn.textContent).toBe('Get started');
  });

  test('next button text is "Next →" on intermediate steps', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // 1→2
    expect(nextBtn.textContent).toBe('Next →');
  });

  test('handles missing modal gracefully', () => {
    const sandbox = createSandbox();
    // Remove modal from elements
    sandbox._elements['onboarding-modal'] = null;
    sandbox.document.getElementById = (id) => sandbox._elements[id];
    expect(() => loadOnboarding(sandbox)).not.toThrow();
  });

  test('handles missing buttons gracefully', () => {
    const sandbox = createSandbox();
    sandbox._elements['onboardingNextBtn'] = null;
    sandbox._elements['onboardingPrevBtn'] = null;
    sandbox._elements['onboardingSkipBtn'] = null;
    sandbox.document.getElementById = (id) => sandbox._elements[id];
    expect(() => loadOnboarding(sandbox)).not.toThrow();
  });

  test('handles missing step indicator gracefully', () => {
    const sandbox = createSandbox();
    sandbox._elements['onboardingStepIndicator'] = null;
    sandbox.document.getElementById = (id) => sandbox._elements[id];
    loadOnboarding(sandbox);
    // Should not throw, indicator just won't update
  });

  test('full forward-backward navigation cycle', () => {
    const sandbox = createSandbox();
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    const prevBtn = sandbox._elements['onboardingPrevBtn'];
    const indicator = sandbox._elements['onboardingStepIndicator'];

    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // 1→2
    expect(indicator.textContent).toBe('Step 2 of 4');

    nextBtn._clickListeners[0](); // 2→3
    expect(indicator.textContent).toBe('Step 3 of 4');

    expect(prevBtn._clickListeners.length).toBeGreaterThan(0);
    prevBtn._clickListeners[0](); // 3→2
    expect(indicator.textContent).toBe('Step 2 of 4');

    nextBtn._clickListeners[0](); // 2→3
    nextBtn._clickListeners[0](); // 3→4
    expect(indicator.textContent).toBe('Step 4 of 4');
  });

  test('chrome.storage.set failure does not crash', async () => {
    const sandbox = createSandbox();
    sandbox.chrome.storage.local.set = async () => { throw new Error('storage error'); };
    loadOnboarding(sandbox);

    const nextBtn = sandbox._elements['onboardingNextBtn'];
    expect(nextBtn._clickListeners.length).toBeGreaterThan(0);
    nextBtn._clickListeners[0](); // 1→2
    nextBtn._clickListeners[0](); // 2→3
    nextBtn._clickListeners[0](); // 3→4
    // 4→markDone should catch storage error
    expect(() => nextBtn._clickListeners[0]()).not.toThrow();
  });

  test('chrome.storage.get failure does not crash', () => {
    const sandbox = createSandbox();
    sandbox.chrome.storage.local.get = async () => { throw new Error('storage error'); };
    // Should not throw when auto-show checks storage
    expect(() => loadOnboarding(sandbox)).not.toThrow();
  });
});
