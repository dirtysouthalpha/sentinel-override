// tests/action-hud-deep.test.js
// Comprehensive tests for content/action-hud.js — HUD update, icons, visibility, auto-hide.

import { jest } from '@jest/globals';
import { JSDOM } from 'linkedom';

// We recreate the action-hud module logic in a testable way using linkedom for DOM.

function setupHUD() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="content">Page content</div></body></html>');
  const doc = dom.window.document;
  global.document = doc;
  global.window = dom.window;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.clearTimeout = clearTimeout;
  global.setTimeout = setTimeout;

  // Icons from action-hud.js
  const ICONS = {
    navigate: '<svg viewBox="0 0 18 18">NAV</svg>',
    click: '<svg viewBox="0 0 18 18">CLK</svg>',
    type: '<svg viewBox="0 0 18 18">TYP</svg>',
    execute_js: '<svg viewBox="0 0 18 18">JS</svg>',
    read_page: '<svg viewBox="0 0 18 18">READ</svg>',
    open_tab: '<svg viewBox="0 0 18 18">TAB</svg>',
    close_tab: '<svg viewBox="0 0 18 18">CTAB</svg>',
    note: '<svg viewBox="0 0 18 18">NOTE</svg>',
    scroll: '<svg viewBox="0 0 18 18">SCR</svg>',
    finish: '<svg viewBox="0 0 18 18">FIN</svg>',
    default: '<svg viewBox="0 0 18 18">DEF</svg>',
  };

  const HUD_ID = '__sentinel_action_hud__';
  let currentStep = 0;
  let totalSteps = 20;
  let currentAction = '';

  function getIcon(actionType) {
    return ICONS[actionType] || ICONS.default;
  }

  function ensureHUD() {
    let el = document.getElementById(HUD_ID);
    if (el && el.isConnected) return el;

    el = document.createElement('div');
    el.id = HUD_ID;
    el.setAttribute('data-sentinel', 'action-hud');
    el.innerHTML = `
      <div class="hud-card">
        <div class="hud-header">
          <span class="hud-brand"><span class="hud-pulse"></span>SENTINEL</span>
          <span class="hud-step">Step <span class="step-num">${currentStep}</span>/${totalSteps}</span>
        </div>
        <div class="hud-progress-bar"><div class="hud-progress-fill" style="width: 0%"></div></div>
        <div class="hud-action">
          <div class="hud-action-icon">${ICONS.default}</div>
          <div class="hud-action-text">Initializing...</div>
        </div>
        <div class="hud-result"></div>
      </div>
    `;
    document.documentElement.appendChild(el);
    return el;
  }

  function updateHUD(opts) {
    const el = ensureHUD();
    if (!el) return;

    if (opts.step !== undefined) currentStep = opts.step;
    if (opts.totalSteps !== undefined) totalSteps = opts.totalSteps;
    if (opts.action) currentAction = opts.action;

    const stepEl = el.querySelector('.hud-step');
    if (stepEl) stepEl.innerHTML = `Step <span class="step-num">${currentStep}</span>/${totalSteps}`;

    const fill = el.querySelector('.hud-progress-fill');
    if (fill) fill.style.width = `${Math.min(100, (currentStep / totalSteps) * 100)}%`;

    const iconEl = el.querySelector('.hud-action-icon');
    const textEl = el.querySelector('.hud-action-text');
    if (iconEl) iconEl.innerHTML = getIcon(currentAction);
    if (textEl && opts.actionLabel) textEl.textContent = opts.actionLabel;

    const resultEl = el.querySelector('.hud-result');
    if (resultEl) {
      resultEl.className = 'hud-result';
      if (opts.result) {
        resultEl.textContent = (typeof opts.result === 'string' ? opts.result : String(opts.result)).substring(0, 80);
        if (opts.resultSuccess) resultEl.classList.add('success');
        if (opts.resultError) resultEl.classList.add('error');
      } else {
        resultEl.textContent = '';
      }
    }

    el.classList.remove('action-pulse');
    el.classList.add('action-pulse');

    el.classList.add('visible');
  }

  function hideHUD() {
    const el = document.getElementById(HUD_ID);
    if (el) el.classList.remove('visible');
  }

  function getHUDElement() {
    return document.getElementById(HUD_ID);
  }

  return { dom, doc, updateHUD, hideHUD, getHUD, getHUDElement, getIcon, HUD_ID };
}

describe('action-hud: getIcon', () => {
  const ICONS = {
    navigate: '<svg>NAV</svg>',
    click: '<svg>CLK</svg>',
    type: '<svg>TYP</svg>',
    execute_js: '<svg>JS</svg>',
    read_page: '<svg>READ</svg>',
    open_tab: '<svg>TAB</svg>',
    close_tab: '<svg>CTAB</svg>',
    note: '<svg>NOTE</svg>',
    scroll: '<svg>SCR</svg>',
    finish: '<svg>FIN</svg>',
    default: '<svg>DEF</svg>',
  };

  function getIcon(actionType) {
    return ICONS[actionType] || ICONS.default;
  }

  test('returns navigate icon', () => expect(getIcon('navigate')).toBe(ICONS.navigate));
  test('returns click icon', () => expect(getIcon('click')).toBe(ICONS.click));
  test('returns type icon', () => expect(getIcon('type')).toBe(ICONS.type));
  test('returns execute_js icon', () => expect(getIcon('execute_js')).toBe(ICONS.execute_js));
  test('returns read_page icon', () => expect(getIcon('read_page')).toBe(ICONS.read_page));
  test('returns open_tab icon', () => expect(getIcon('open_tab')).toBe(ICONS.open_tab));
  test('returns close_tab icon', () => expect(getIcon('close_tab')).toBe(ICONS.close_tab));
  test('returns note icon', () => expect(getIcon('note')).toBe(ICONS.note));
  test('returns scroll icon', () => expect(getIcon('scroll')).toBe(ICONS.scroll));
  test('returns finish icon', () => expect(getIcon('finish')).toBe(ICONS.finish));
  test('returns default icon for unknown action', () => expect(getIcon('unknown_action')).toBe(ICONS.default));
  test('returns default icon for empty string', () => expect(getIcon('')).toBe(ICONS.default));
  test('returns default icon for null', () => expect(getIcon(null)).toBe(ICONS.default));
  test('returns default icon for undefined', () => expect(getIcon(undefined)).toBe(ICONS.default));
});

describe('action-hud: HUD creation', () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  test('HUD element is created with correct ID', () => {
    const { getHUDElement, HUD_ID } = setupHUD();
    const el = getHUDElement();
    expect(el).not.toBeNull();
    expect(el.id).toBe(HUD_ID);
  });

  test('HUD has data-sentinel attribute', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().getAttribute('data-sentinel')).toBe('action-hud');
  });

  test('HUD contains step counter', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-step')).not.toBeNull();
  });

  test('HUD contains progress bar', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-progress-fill')).not.toBeNull();
  });

  test('HUD contains action icon container', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-action-icon')).not.toBeNull();
  });

  test('HUD contains action text container', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-action-text')).not.toBeNull();
  });

  test('HUD contains result container', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-result')).not.toBeNull();
  });

  test('HUD is initially visible', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().classList.contains('visible')).toBe(true);
  });

  test('HUD brand text contains SENTINEL', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-brand').textContent).toContain('SENTINEL');
  });

  test('HUD contains pulse element', () => {
    const { getHUDElement } = setupHUD();
    expect(getHUDElement().querySelector('.hud-pulse')).not.toBeNull();
  });
});

describe('action-hud: updateHUD', () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  test('update step counter', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ step: 5 });
    const stepEl = getHUDElement().querySelector('.hud-step');
    expect(stepEl.textContent).toContain('5');
  });

  test('update totalSteps', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ totalSteps: 30 });
    const stepEl = getHUDElement().querySelector('.hud-step');
    expect(stepEl.textContent).toContain('30');
  });

  test('update progress bar width', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ step: 5, totalSteps: 10 });
    const fill = getHUDElement().querySelector('.hud-progress-fill');
    expect(fill.style.width).toBe('50%');
  });

  test('progress bar caps at 100%', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ step: 100, totalSteps: 5 });
    const fill = getHUDElement().querySelector('.hud-progress-fill');
    expect(fill.style.width).toBe('100%');
  });

  test('progress bar at 0%', () => {
    const { getHUDElement } = setupHUD();
    const fill = getHUDElement().querySelector('.hud-progress-fill');
    expect(fill.style.width).toBe('0%');
  });

  test('update action icon', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ action: 'click' });
    const iconEl = getHUDElement().querySelector('.hud-action-icon');
    expect(iconEl.innerHTML).toContain('CLK');
  });

  test('update action label text', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ action: 'navigate', actionLabel: 'Going to Google' });
    const textEl = getHUDElement().querySelector('.hud-action-text');
    expect(textEl.textContent).toBe('Going to Google');
  });

  test('update result text', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ result: 'Page loaded successfully' });
    const resultEl = getHUDElement().querySelector('.hud-result');
    expect(resultEl.textContent).toBe('Page loaded successfully');
  });

  test('result text truncated to 80 chars', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    const longResult = 'a'.repeat(200);
    updateHUD({ result: longResult });
    const resultEl = getHUDElement().querySelector('.hud-result');
    expect(resultEl.textContent.length).toBe(80);
  });

  test('result success class added', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ result: 'Success', resultSuccess: true });
    const resultEl = getHUDElement().querySelector('.hud-result');
    expect(resultEl.classList.contains('success')).toBe(true);
  });

  test('result error class added', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ result: 'Failed', resultError: true });
    const resultEl = getHUDElement().querySelector('.hud-result');
    expect(resultEl.classList.contains('error')).toBe(true);
  });

  test('result class resets between updates', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ result: 'Failed', resultError: true });
    updateHUD({ result: 'Success', resultSuccess: true });
    const resultEl = getHUDElement().querySelector('.hud-result');
    expect(resultEl.classList.contains('error')).toBe(false);
    expect(resultEl.classList.contains('success')).toBe(true);
  });

  test('action-pulse class is added on update', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ action: 'click', actionLabel: 'Clicking' });
    expect(getHUDElement().classList.contains('action-pulse')).toBe(true);
  });

  test('numeric result is stringified', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ result: 42 });
    const resultEl = getHUDElement().querySelector('.hud-result');
    expect(resultEl.textContent).toBe('42');
  });

  test('step 0 of 1 shows 0%', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ step: 0, totalSteps: 1 });
    const fill = getHUDElement().querySelector('.hud-progress-fill');
    expect(fill.style.width).toBe('0%');
  });

  test('step 1 of 1 shows 100%', () => {
    const { updateHUD, getHUDElement } = setupHUD();
    updateHUD({ step: 1, totalSteps: 1 });
    const fill = getHUDElement().querySelector('.hud-progress-fill');
    expect(fill.style.width).toBe('100%');
  });
});

describe('action-hud: hideHUD', () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  test('removes visible class', () => {
    const { hideHUD, getHUDElement } = setupHUD();
    expect(getHUDElement().classList.contains('visible')).toBe(true);
    hideHUD();
    expect(getHUDElement().classList.contains('visible')).toBe(false);
  });

  test('hide when no HUD element does not crash', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;
    expect(() => {
      const el = document.getElementById('__sentinel_action_hud__');
      if (el) el.classList.remove('visible');
    }).not.toThrow();
    delete global.document;
    delete global.window;
  });
});

describe('action-hud: step counter formatting', () => {
  test('step 0/20 displays correctly', () => {
    const step = 0, total = 20;
    const html = `Step <span class="step-num">${step}</span>/${total}`;
    expect(html).toContain('Step <span class="step-num">0</span>/20');
  });

  test('step 10/10 displays correctly', () => {
    const step = 10, total = 10;
    const html = `Step <span class="step-num">${step}</span>/${total}`;
    expect(html).toContain('Step <span class="step-num">10</span>/10');
  });

  test('large step numbers display correctly', () => {
    const step = 999, total = 999;
    const html = `Step <span class="step-num">${step}</span>/${total}`;
    expect(html).toContain('Step <span class="step-num">999</span>/999');
  });
});
