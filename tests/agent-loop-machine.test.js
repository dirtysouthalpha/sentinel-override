// tests/agent-loop-machine.test.js
// Unit tests for background/agent-loop-machine.js — the explicit runAgentLoop
// state machine (#45) and the pure phase logic lifted out of the loop body.
//
// The extracted functions are byte-for-byte the logic that used to run inline,
// so these tests double as the first direct coverage that logic has ever had:
// before the extraction it was reachable only through a full multi-step
// integration run of runAgentLoop.

import {
  LOOP_PHASE,
  PHASE_SEQUENCE,
  LOOP_EXIT,
  isPhase,
  isExitReason,
  isLegalTransition,
  createLoopMachine,
  computeStepBudget,
  partitionElements,
  PRIORITY_ELEMENT_TYPES,
  buildLoopDirective,
  escalateCircuitBreaker,
  buildPromptHistory,
  buildBadIndexHint,
  mapVisionAction,
  cleanFinishMemory,
} from '../background/agent-loop-machine.js';

// ═══════════════════════════════════════════════════════════════════════════
// Phase / exit vocabulary
// ═══════════════════════════════════════════════════════════════════════════
describe('phase and exit vocabulary', () => {
  test('LOOP_PHASE and LOOP_EXIT are frozen', () => {
    expect(Object.isFrozen(LOOP_PHASE)).toBe(true);
    expect(Object.isFrozen(LOOP_EXIT)).toBe(true);
    expect(Object.isFrozen(PHASE_SEQUENCE)).toBe(true);
  });

  test('PHASE_SEQUENCE covers every phase except FINALIZE', () => {
    const all = Object.values(LOOP_PHASE);
    expect(PHASE_SEQUENCE).not.toContain(LOOP_PHASE.FINALIZE);
    expect(PHASE_SEQUENCE.length).toBe(all.length - 1);
    for (const p of PHASE_SEQUENCE) expect(all).toContain(p);
  });

  test('phase values are unique', () => {
    const vals = Object.values(LOOP_PHASE);
    expect(new Set(vals).size).toBe(vals.length);
  });

  test('exit reason values are unique', () => {
    const vals = Object.values(LOOP_EXIT);
    expect(new Set(vals).size).toBe(vals.length);
  });

  test('isPhase / isExitReason reject unknown values', () => {
    expect(isPhase(LOOP_PHASE.THINK)).toBe(true);
    expect(isPhase('daydream')).toBe(false);
    expect(isPhase(undefined)).toBe(false);
    expect(isExitReason(LOOP_EXIT.FINISH)).toBe(true);
    expect(isExitReason('gave_up')).toBe(false);
  });

  test('every documented terminal of runAgentLoop has a name', () => {
    // Enumerated from the 26 `break` statements in the loop body plus the
    // normal loop-condition exit. If a new terminal is added to the loop and
    // not named here, this test is the reminder.
    for (const r of [
      'loop_condition', 'stopped', 'no_llm_calls', 'step_limit', 'no_active_tab',
      'tab_closed', 'restricted_page_no_url', 'restricted_page_nav_failed',
      'hard_stop', 'circuit_breaker_force_finish', 'vision_payload_serialization',
      'prose_loop', 'finish', 'click_at_data_in_memory', 'click_at_block_limit',
      'js_blocked', 'duplicate_js', 'auto_finish_data_ready', 'stuck_click_loop',
      'alt_loop', 'tab_recovery_failed',
    ]) {
      expect(isExitReason(r)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Transitions
// ═══════════════════════════════════════════════════════════════════════════
describe('isLegalTransition', () => {
  test('a run starts at PREFLIGHT and nowhere else', () => {
    expect(isLegalTransition(null, LOOP_PHASE.PREFLIGHT)).toBe(true);
    expect(isLegalTransition(null, LOOP_PHASE.THINK)).toBe(false);
    expect(isLegalTransition(undefined, LOOP_PHASE.OBSERVE)).toBe(false);
  });

  test('phases move forward through PHASE_SEQUENCE', () => {
    for (let i = 0; i < PHASE_SEQUENCE.length - 1; i++) {
      expect(isLegalTransition(PHASE_SEQUENCE[i], PHASE_SEQUENCE[i + 1])).toBe(true);
    }
  });

  test('forward skips are legal — most steps never reach ACT', () => {
    expect(isLegalTransition(LOOP_PHASE.DISPATCH, LOOP_PHASE.CHECKPOINT)).toBe(true);
    expect(isLegalTransition(LOOP_PHASE.PREFLIGHT, LOOP_PHASE.THINK)).toBe(true);
  });

  test('backward transitions are illegal except the `continue` restart', () => {
    expect(isLegalTransition(LOOP_PHASE.THINK, LOOP_PHASE.OBSERVE)).toBe(false);
    expect(isLegalTransition(LOOP_PHASE.ACT, LOOP_PHASE.DIRECTIVES)).toBe(false);
    // `continue` sends the loop back to the top of the step from anywhere.
    expect(isLegalTransition(LOOP_PHASE.ACT, LOOP_PHASE.PREFLIGHT)).toBe(true);
    expect(isLegalTransition(LOOP_PHASE.VERIFY, LOOP_PHASE.PREFLIGHT)).toBe(true);
  });

  test('a phase cannot transition to itself', () => {
    for (const p of PHASE_SEQUENCE) {
      if (p === LOOP_PHASE.PREFLIGHT) continue;  // re-entered by `continue`
      expect(isLegalTransition(p, p)).toBe(false);
    }
  });

  test('FINALIZE is reachable from anywhere and is terminal', () => {
    for (const p of PHASE_SEQUENCE) {
      expect(isLegalTransition(p, LOOP_PHASE.FINALIZE)).toBe(true);
    }
    expect(isLegalTransition(LOOP_PHASE.FINALIZE, LOOP_PHASE.PREFLIGHT)).toBe(false);
    expect(isLegalTransition(LOOP_PHASE.FINALIZE, LOOP_PHASE.FINALIZE)).toBe(true);
  });

  test('unknown phases are rejected on both sides', () => {
    expect(isLegalTransition('nonsense', LOOP_PHASE.THINK)).toBe(false);
    expect(isLegalTransition(LOOP_PHASE.THINK, 'nonsense')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The machine
// ═══════════════════════════════════════════════════════════════════════════
describe('createLoopMachine', () => {
  test('starts empty', () => {
    const m = createLoopMachine();
    expect(m.phase).toBeNull();
    expect(m.step).toBe(0);
    expect(m.exitReason).toBeNull();
    expect(m.illegalTransitions).toBe(0);
  });

  test('beginStep enters PREFLIGHT and records the step number', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    expect(m.phase).toBe(LOOP_PHASE.PREFLIGHT);
    expect(m.step).toBe(1);
    expect(m.lastStepPhases()).toEqual([LOOP_PHASE.PREFLIGHT]);
  });

  test('records the phase trace of a full step', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    for (const p of PHASE_SEQUENCE.slice(1)) m.enter(p);
    expect(m.lastStepPhases()).toEqual(PHASE_SEQUENCE.slice());
  });

  test('a short step (note short-circuits at DISPATCH) traces only what it ran', () => {
    const m = createLoopMachine();
    m.beginStep(3);
    m.enter(LOOP_PHASE.ACQUIRE_TAB);
    m.enter(LOOP_PHASE.OBSERVE);
    m.enter(LOOP_PHASE.THINK);
    m.enter(LOOP_PHASE.DISPATCH);
    expect(m.lastStepPhases()).toEqual([
      LOOP_PHASE.PREFLIGHT, LOOP_PHASE.ACQUIRE_TAB, LOOP_PHASE.OBSERVE,
      LOOP_PHASE.THINK, LOOP_PHASE.DISPATCH,
    ]);
    expect(m.illegalTransitions).toBe(0);
  });

  test('non-strict mode counts illegal transitions but never throws', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.enter(LOOP_PHASE.THINK);
    expect(() => m.enter(LOOP_PHASE.OBSERVE)).not.toThrow();
    expect(m.illegalTransitions).toBe(1);
    expect(m.phase).toBe(LOOP_PHASE.OBSERVE);   // still advances — bookkeeping only
  });

  test('strict mode throws on an illegal transition', () => {
    const m = createLoopMachine({ strict: true });
    m.beginStep(1);
    m.enter(LOOP_PHASE.THINK);
    expect(() => m.enter(LOOP_PHASE.OBSERVE)).toThrow(/illegal transition/);
  });

  test('the first terminal wins — later exits do not overwrite it', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.exit(LOOP_EXIT.PROSE_LOOP, 'three identical replies');
    m.exit(LOOP_EXIT.FINISH);
    expect(m.exitReason).toBe(LOOP_EXIT.PROSE_LOOP);
    expect(m.exitDetail).toBe('three identical replies');
  });

  test('an unknown exit reason is counted, not recorded', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.exit('ran_out_of_ideas');
    expect(m.exitReason).toBeNull();
    expect(m.illegalTransitions).toBe(1);
  });

  test('strict mode throws on an unknown exit reason', () => {
    const m = createLoopMachine({ strict: true });
    m.beginStep(1);
    expect(() => m.exit('ran_out_of_ideas')).toThrow(/unknown exit reason/);
  });

  test('finalize defaults to LOOP_CONDITION when nothing broke out', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.enter(LOOP_PHASE.CHECKPOINT);
    expect(m.finalize()).toBe(LOOP_EXIT.LOOP_CONDITION);
    expect(m.phase).toBe(LOOP_PHASE.FINALIZE);
  });

  test('finalize preserves an explicit terminal', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.exit(LOOP_EXIT.STEP_LIMIT);
    expect(m.finalize()).toBe(LOOP_EXIT.STEP_LIMIT);
  });

  test('beginStep without an argument advances the counter', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.beginStep();
    expect(m.step).toBe(2);
  });

  test('the trace ring-caps so a long run cannot grow without bound', () => {
    const m = createLoopMachine({ maxTrace: 3 });
    for (let i = 1; i <= 10; i++) m.beginStep(i);
    const snap = m.snapshot();
    expect(snap.trace).toHaveLength(3);
    expect(snap.trace.map(t => t.step)).toEqual([8, 9, 10]);
  });

  test('snapshot is a copy — mutating it cannot corrupt the machine', () => {
    const m = createLoopMachine();
    m.beginStep(1);
    m.enter(LOOP_PHASE.OBSERVE);
    const snap = m.snapshot();
    snap.trace[0].phases.push('tampered');
    expect(m.lastStepPhases()).toEqual([LOOP_PHASE.PREFLIGHT, LOOP_PHASE.OBSERVE]);
  });

  test('reset returns the machine to its initial state', () => {
    const m = createLoopMachine();
    m.beginStep(4);
    m.exit(LOOP_EXIT.FINISH);
    m.reset();
    expect(m.phase).toBeNull();
    expect(m.step).toBe(0);
    expect(m.exitReason).toBeNull();
    expect(m.snapshot().trace).toEqual([]);
  });

  test('a whole run traces every step and ends on its terminal', () => {
    const m = createLoopMachine({ strict: true });
    for (let step = 1; step <= 3; step++) {
      m.beginStep(step);
      m.enter(LOOP_PHASE.ACQUIRE_TAB);
      m.enter(LOOP_PHASE.OBSERVE);
      m.enter(LOOP_PHASE.DIRECTIVES);
      m.enter(LOOP_PHASE.THINK);
      m.enter(LOOP_PHASE.PREPROCESS);
      m.enter(LOOP_PHASE.DISPATCH);
    }
    m.exit(LOOP_EXIT.FINISH, 'model called finish');
    m.finalize();
    const snap = m.snapshot();
    expect(snap.trace).toHaveLength(3);
    expect(snap.exitReason).toBe(LOOP_EXIT.FINISH);
    expect(snap.phase).toBe(LOOP_PHASE.FINALIZE);
    expect(snap.illegalTransitions).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeStepBudget
// ═══════════════════════════════════════════════════════════════════════════
describe('computeStepBudget', () => {
  const RE = /\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|m365|admin\.microsoft|portal\.azure|sentinelone|virustotal)\b/gi;

  test('single-portal goal uses the plain baseline', () => {
    const r = computeStepBudget('check entra sign-ins', 100, 0, RE);
    expect(r.dynamicBaseline).toBe(100);
    expect(r.multiPortal).toBe(false);
  });

  test('two or more portals add the +50 head start', () => {
    const r = computeStepBudget('check entra and purview logs', 100, 0, RE);
    expect(r.dynamicBaseline).toBe(150);
    expect(r.multiPortal).toBe(true);
  });

  test('the hard ceiling of 60 clamps everything', () => {
    expect(computeStepBudget('x', 100, 0, RE).dynamicMaxSteps).toBe(60);
    expect(computeStepBudget('entra purview', 100, 20, RE).dynamicMaxSteps).toBe(60);
    expect(computeStepBudget('x', 1000, 100, RE).dynamicMaxSteps).toBe(60);
  });

  test('a low baseline is extended by productive steps, still clamped at 60', () => {
    expect(computeStepBudget('x', 10, 0, RE).dynamicMaxSteps).toBe(10);
    expect(computeStepBudget('x', 10, 1, RE).dynamicMaxSteps).toBe(35);
    expect(computeStepBudget('x', 10, 2, RE).dynamicMaxSteps).toBe(60);
    expect(computeStepBudget('x', 10, 3, RE).dynamicMaxSteps).toBe(60);
  });

  test('a non-string goal falls back to the baseline without throwing', () => {
    expect(computeStepBudget(null, 100, 0, RE).dynamicBaseline).toBe(100);
    expect(computeStepBudget(undefined, 40, 0, RE).dynamicMaxSteps).toBe(40);
    expect(computeStepBudget({}, 40, 0, RE).dynamicBaseline).toBe(40);
  });

  test('a missing regex is tolerated', () => {
    expect(computeStepBudget('entra purview', 100, 0, null).dynamicBaseline).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// partitionElements
// ═══════════════════════════════════════════════════════════════════════════
describe('partitionElements', () => {
  test('interactive selectors are hoisted ahead of the rest', () => {
    const out = partitionElements([
      { selector: 'div.wrapper', text: 'a' },
      { selector: '#submit-button', text: 'b' },
      { selector: 'span', text: 'c' },
      { selector: 'input[name=q]', text: 'd' },
    ], 80);
    expect(out.map(e => e.selector)).toEqual([
      '#submit-button', 'input[name=q]', 'div.wrapper', 'span',
    ]);
  });

  test('the list is capped at maxElements', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ selector: `div${i}`, text: 't' }));
    expect(partitionElements(many, 80)).toHaveLength(80);
  });

  test('long labels are truncated to 77 chars plus an ellipsis', () => {
    const [el] = partitionElements([{ selector: 'div', text: 'x'.repeat(200) }], 80);
    expect(el.text).toHaveLength(80);
    expect(el.text.endsWith('...')).toBe(true);
  });

  test('short labels are left alone', () => {
    const [el] = partitionElements([{ selector: 'div', text: 'short' }], 80);
    expect(el.text).toBe('short');
  });

  test('the source array and its elements are not mutated', () => {
    const src = [{ selector: 'div', text: 'y'.repeat(200) }];
    const snapshot = JSON.parse(JSON.stringify(src));
    partitionElements(src, 80);
    expect(src).toEqual(snapshot);
  });

  test('non-array and empty inputs return an empty list', () => {
    expect(partitionElements(null, 80)).toEqual([]);
    expect(partitionElements(undefined, 80)).toEqual([]);
    expect(partitionElements([], 80)).toEqual([]);
  });

  test('elements with no selector are treated as non-priority', () => {
    const out = partitionElements([{ text: 'a' }, { selector: 'button', text: 'b' }], 80);
    expect(out[0].selector).toBe('button');
  });

  test('PRIORITY_ELEMENT_TYPES is the documented set', () => {
    expect([...PRIORITY_ELEMENT_TYPES].sort()).toEqual(['button', 'input', 'select', 'textarea']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildLoopDirective
// ═══════════════════════════════════════════════════════════════════════════
describe('buildLoopDirective', () => {
  const NON_PRODUCTIVE_READ = new Set(['read_page', 'scroll', 'execute_js']);
  const DATA_ACTIONS = new Set(['extract', 'extract_list', 'note']);
  const TAB_ACTIONS = new Set(['open_tab', 'switch_tab', 'close_tab']);
  const noLoop = () => ({ isLoop: false });

  function ctx(over = {}) {
    return {
      history: [],
      agentMemory: {},
      stepCount: 1,
      pageIsEmpty: false,
      elementsEmpty: false,
      detectActionTypeLoop: noLoop,
      nonProductiveReadActions: NON_PRODUCTIVE_READ,
      dataActions: DATA_ACTIONS,
      tabActions: TAB_ACTIONS,
      ...over,
    };
  }
  const entry = (type, result = 'ok') => ({ action: { type }, result });

  test('a healthy early run gets no directive', () => {
    expect(buildLoopDirective(ctx())).toBe('');
  });

  test('two consecutive read_page trips the read_page guard', () => {
    const d = buildLoopDirective(ctx({ history: [entry('read_page'), entry('read_page')] }));
    expect(d).toContain('READ_PAGE LOOP DETECTED');
  });

  test('one read_page does not trip it', () => {
    expect(buildLoopDirective(ctx({ history: [entry('click'), entry('read_page')] }))).toBe('');
  });

  test('the action-type loop detector wins over later checks', () => {
    const d = buildLoopDirective(ctx({
      history: [entry('navigate'), entry('navigate'), entry('navigate')],
      detectActionTypeLoop: () => ({ isLoop: true, type: 'navigate', count: 3 }),
    }));
    expect(d).toContain('ACTION-TYPE LOOP');
    expect(d).toContain('3 of last 4 actions were "navigate"');
  });

  test('read_page guard takes precedence over the action-type loop', () => {
    const d = buildLoopDirective(ctx({
      history: [entry('read_page'), entry('read_page')],
      detectActionTypeLoop: () => ({ isLoop: true, type: 'read_page', count: 4 }),
    }));
    expect(d).toContain('READ_PAGE LOOP DETECTED');
    expect(d).not.toContain('ACTION-TYPE LOOP');
  });

  test('three consecutive non-productive reads trip the loop directive', () => {
    const d = buildLoopDirective(ctx({
      history: [entry('click'), entry('scroll'), entry('scroll'), entry('scroll')],
    }));
    expect(d).toContain('LOOP DETECTED');
    expect(d).toContain('3 non-productive steps in a row');
  });

  test('with memory present the loop directive demands a finish instead', () => {
    const d = buildLoopDirective(ctx({
      history: [entry('click'), entry('scroll'), entry('scroll'), entry('scroll')],
      agentMemory: { a: 1, b: 2 },
    }));
    expect(d).toContain('You have 2 items in memory');
    expect(d).toContain('finish');
  });

  test('four execute_js in eight steps with no extraction is a JS loop', () => {
    const history = [
      entry('execute_js'), entry('click'), entry('execute_js'), entry('click'),
      entry('execute_js'), entry('click'), entry('execute_js'), entry('click'),
    ];
    const d = buildLoopDirective(ctx({ history }));
    expect(d).toContain('4 execute_js calls in last 8 steps with no data saved');
  });

  test('an extract in the window clears the JS loop', () => {
    const history = [
      entry('execute_js'), entry('extract'), entry('execute_js'), entry('click'),
      entry('execute_js'), entry('click'), entry('execute_js'), entry('click'),
    ];
    expect(buildLoopDirective(ctx({ history }))).toBe('');
  });

  test('two empty-page results plus an empty page trip the empty-page directive', () => {
    const history = [entry('read_page', 'page was empty'), entry('click', 'no content here')];
    const d = buildLoopDirective(ctx({ history, pageIsEmpty: true }));
    expect(d).toContain('EMPTY PAGE');
  });

  test('elementsEmpty alone is enough to trip it', () => {
    const history = [entry('read_page', 'page was empty'), entry('click', 'no content here')];
    expect(buildLoopDirective(ctx({ history, elementsEmpty: true }))).toContain('EMPTY PAGE');
  });

  test('one empty result is not enough', () => {
    const history = [entry('read_page', 'page was empty'), entry('click', 'fine')];
    expect(buildLoopDirective(ctx({ history, pageIsEmpty: true }))).toBe('');
  });

  test('step 15 with nothing to show warns about the step limit', () => {
    const d = buildLoopDirective(ctx({ stepCount: 15 }));
    expect(d).toContain('STEP LIMIT');
    expect(d).toContain('step 15');
  });

  test('step 15 is not warned while the agent is opening tabs', () => {
    expect(buildLoopDirective(ctx({ stepCount: 15, history: [entry('open_tab')] }))).toBe('');
  });

  test('step 15 is not warned while memory is being filled', () => {
    expect(buildLoopDirective(ctx({ stepCount: 15, agentMemory: { k: 'v' } }))).toBe('');
  });

  test('step 20 warns even when progress is being made, and names the item count', () => {
    const d = buildLoopDirective(ctx({ stepCount: 20, agentMemory: { k: 'v' } }));
    expect(d).toContain('You have 1 extracted items');
  });

  test('step 20 with no memory asks for a finish with what is known', () => {
    const d = buildLoopDirective(ctx({ stepCount: 20, history: [entry('open_tab')] }));
    expect(d).toContain('If you have not found useful data');
  });

  test('entries with no action field are skipped without crashing', () => {
    const history = [{ result: 'x' }, entry('click')];
    expect(() => buildLoopDirective(ctx({ history }))).not.toThrow();
  });

  // Pinned pre-existing behaviour, faithfully carried over from the inline
  // version: the tab-action scan dereferences history[i].action unguarded, so a
  // literal null entry throws. historyPush() only ever appends objects, so this
  // is unreachable in practice — but the extraction must not quietly "fix" it,
  // because a guard here would change which steps produce a STEP LIMIT
  // directive on any future path that does admit holes.
  test('a null history entry throws in the tab-action scan (as it did inline)', () => {
    expect(() => buildLoopDirective(ctx({ history: [null, entry('click')] })))
      .toThrow(TypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// escalateCircuitBreaker
// ═══════════════════════════════════════════════════════════════════════════
describe('escalateCircuitBreaker', () => {
  const base = () => ({ shouldHardStop: false, reason: '', severity: 'none', directive: '' });

  test('a clean history changes nothing', () => {
    const r = escalateCircuitBreaker(base(), [{ result: 'ok' }]);
    expect(r.shouldHardStop).toBe(false);
    expect(r.severity).toBe('none');
  });

  test('five API errors in the last six steps force a hard stop', () => {
    const history = Array.from({ length: 6 }, () => ({ result: 'API Error: 500' }));
    const r = escalateCircuitBreaker(base(), history);
    expect(r.shouldHardStop).toBe(true);
    expect(r.severity).toBe('critical');
    expect(r.reason).toContain('model/provider incompatibility');
  });

  test('four API errors are not enough', () => {
    const history = [
      { result: 'ok' }, { result: 'ok' },
      ...Array.from({ length: 4 }, () => ({ result: 'non-ok response' })),
    ];
    expect(escalateCircuitBreaker(base(), history).shouldHardStop).toBe(false);
  });

  test('a vision-unsupported error in the last result forces a hard stop', () => {
    const r = escalateCircuitBreaker(base(), [{ result: 'No endpoints found that support image input' }]);
    expect(r.shouldHardStop).toBe(true);
    expect(r.reason).toContain('Model does not support vision');
  });

  test('the shorter "support image input" phrasing also trips it', () => {
    const r = escalateCircuitBreaker(base(), [{ result: 'this model does not support image input' }]);
    expect(r.shouldHardStop).toBe(true);
  });

  test('the vision check only looks at the most recent entry', () => {
    const history = [{ result: 'support image input' }, { result: 'fine now' }];
    expect(escalateCircuitBreaker(base(), history).shouldHardStop).toBe(false);
  });

  test('an already-hard-stopped verdict keeps its original reason', () => {
    const cb = { shouldHardStop: true, reason: 'ABSOLUTE STEP CEILING', severity: 'critical', directive: '' };
    const history = Array.from({ length: 6 }, () => ({ result: 'API Error' }));
    expect(escalateCircuitBreaker(cb, history).reason).toBe('ABSOLUTE STEP CEILING');
  });

  test('the vision override wins even over an existing hard stop reason', () => {
    const cb = { shouldHardStop: true, reason: 'something else', severity: 'warning', directive: '' };
    const r = escalateCircuitBreaker(cb, [{ result: 'support image input' }]);
    expect(r.reason).toContain('Model does not support vision');
    expect(r.severity).toBe('critical');
  });

  test('an empty history is safe', () => {
    expect(escalateCircuitBreaker(base(), []).shouldHardStop).toBe(false);
  });

  test('non-string results are ignored', () => {
    const history = Array.from({ length: 6 }, () => ({ result: { code: 500 } }));
    expect(escalateCircuitBreaker(base(), history).shouldHardStop).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildPromptHistory
// ═══════════════════════════════════════════════════════════════════════════
describe('buildPromptHistory', () => {
  test('only the last `historyWindow` entries are kept', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ step: i, action: { type: 'note' }, result: 'r' }));
    const out = buildPromptHistory(history, 15);
    expect(out).toHaveLength(15);
    expect(out[0].step).toBe(15);
    expect(out[14].step).toBe(29);
  });

  test('a short history is returned whole', () => {
    const history = [{ step: 1, action: { type: 'note' }, result: 'r' }];
    expect(buildPromptHistory(history, 15)).toHaveLength(1);
  });

  test('screenshots are stripped from the entry and its action', () => {
    const out = buildPromptHistory([{
      step: 1, base64Image: 'BIG', screenshot: 'BIG',
      action: { type: 'click', base64Image: 'BIG', screenshot: 'BIG' },
      result: 'ok',
    }], 15);
    expect(out[0].base64Image).toBeUndefined();
    expect(out[0].screenshot).toBeUndefined();
    expect(out[0].action.base64Image).toBeUndefined();
    expect(out[0].action.screenshot).toBeUndefined();
  });

  test('action.text over 200 chars is capped with an ellipsis', () => {
    const out = buildPromptHistory([{ action: { type: 'type', text: 'a'.repeat(500) }, result: '' }], 15);
    expect(out[0].action.text).toHaveLength(201);
    expect(out[0].action.text.endsWith('…')).toBe(true);
  });

  test('action.code over 300 chars is capped with an ellipsis', () => {
    const out = buildPromptHistory([{ action: { type: 'execute_js', code: 'b'.repeat(900) }, result: '' }], 15);
    expect(out[0].action.code).toHaveLength(301);
  });

  test('text and code under the caps are untouched', () => {
    const out = buildPromptHistory([{ action: { type: 'type', text: 'short', code: 'tiny' }, result: '' }], 15);
    expect(out[0].action.text).toBe('short');
    expect(out[0].action.code).toBe('tiny');
  });

  test('a long result is truncated with a count of the omitted chars', () => {
    const out = buildPromptHistory([{ action: { type: 'note' }, result: 'z'.repeat(1000) }], 15);
    expect(out[0].result).toContain('[truncated; 200 more chars in memory]');
    expect(out[0].result.startsWith('z'.repeat(800))).toBe(true);
  });

  test('the source history is never mutated', () => {
    const history = [{
      step: 1, base64Image: 'BIG',
      action: { type: 'type', text: 'a'.repeat(500) },
      result: 'z'.repeat(1000),
    }];
    const snapshot = JSON.parse(JSON.stringify(history));
    buildPromptHistory(history, 15);
    expect(history).toEqual(snapshot);
  });

  test('non-object entries pass straight through', () => {
    const out = buildPromptHistory([null, 'raw string', { action: { type: 'note' }, result: 'r' }], 15);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe('raw string');
  });

  test('entries with a null action are left alone', () => {
    const out = buildPromptHistory([{ step: 1, action: null, result: 'r' }], 15);
    expect(out[0].action).toBeNull();
  });

  test('role/content entries (user notes) survive intact', () => {
    const out = buildPromptHistory([{ role: 'user', content: 'technician note' }], 15);
    expect(out[0]).toEqual({ role: 'user', content: 'technician note' });
  });

  test('an empty history yields an empty prompt history', () => {
    expect(buildPromptHistory([], 15)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mapVisionAction / buildBadIndexHint
// ═══════════════════════════════════════════════════════════════════════════
describe('buildBadIndexHint', () => {
  test('with no visible elements it asks the model to re-observe', () => {
    expect(buildBadIndexHint(null, 5)).toContain('No numbered elements are currently visible');
    expect(buildBadIndexHint(new Map(), 5)).toContain('scroll or re-observe');
  });

  test('it reports the real valid range', () => {
    const map = new Map([[3, {}], [1, {}], [7, {}]]);
    const hint = buildBadIndexHint(map, 99);
    expect(hint).toContain('[99] is not on this page.');
    expect(hint).toContain('1–7');
    expect(hint).toContain('(3 elements)');
  });

  test('a missing index says so instead of naming a number', () => {
    expect(buildBadIndexHint(new Map([[1, {}]]), NaN)).toContain('No index was given.');
  });

  test('non-positive and non-integer keys are excluded from the range', () => {
    const map = new Map([[0, {}], [-2, {}], [4, {}], ['x', {}]]);
    expect(buildBadIndexHint(map, 9)).toContain('4–4');
  });
});

describe('mapVisionAction', () => {
  const map = new Map([[1, { tag: 'BUTTON' }], [2, { tag: 'INPUT' }]]);

  test('returns null when there is no action', () => {
    expect(mapVisionAction(null, map)).toBeNull();
    expect(mapVisionAction({}, map)).toBeNull();
  });

  test('click with a valid index becomes an indexed click_at', () => {
    const cmd = mapVisionAction({ action: { type: 'click', index: 1 } }, map);
    expect(cmd).toEqual({ type: 'click_at', _visionIndex: 1, _visionAction: true });
  });

  test('a numeric-string index is accepted', () => {
    expect(mapVisionAction({ action: { type: 'click', index: ' 2 ' } }, map)._visionIndex).toBe(2);
  });

  test('click with a hallucinated index auto-extracts instead of clicking', () => {
    const cmd = mapVisionAction({ action: { type: 'click', index: 99 } }, map);
    expect(cmd.type).toBe('execute_js');
    expect(cmd.key).toBe('page_content');
    expect(cmd.approvalGranted).toBe(true);
  });

  test('click_at is normalised to click before dispatch', () => {
    expect(mapVisionAction({ action: { type: 'click_at', index: 1 } }, map).type).toBe('click_at');
    // ...and the same normalisation applies when the index is bad:
    expect(mapVisionAction({ action: { type: 'click_at', index: 42 } }, map).type).toBe('execute_js');
  });

  test('input with a valid index becomes a type command', () => {
    const cmd = mapVisionAction({ action: { type: 'input', index: 2, text: 'hello' } }, map);
    expect(cmd).toEqual({ type: 'type', text: 'hello', _visionIndex: 2, _visionAction: true });
  });

  test('input with a bad index becomes a corrective note carrying the valid range', () => {
    const cmd = mapVisionAction({ action: { type: 'input', index: 42, text: 'hi' } }, map);
    expect(cmd.type).toBe('note');
    expect(cmd.text).toContain('1–2');
    expect(cmd.text).toContain('needs a valid [index]');
  });

  test('scroll defaults to down', () => {
    expect(mapVisionAction({ action: { type: 'scroll' } }, map).direction).toBe('down');
    expect(mapVisionAction({ action: { type: 'scroll', direction: 'up' } }, map).direction).toBe('up');
  });

  test('navigate carries the url through', () => {
    expect(mapVisionAction({ action: { type: 'navigate', url: 'https://x.test' } }, map))
      .toEqual({ type: 'navigate', url: 'https://x.test', _visionAction: true });
  });

  test('go_back becomes navigate_back', () => {
    expect(mapVisionAction({ action: { type: 'go_back' } }, map).type).toBe('navigate_back');
  });

  test('extract falls back to a body-text harvest when no code is given', () => {
    const cmd = mapVisionAction({ action: { type: 'extract' } }, map);
    expect(cmd.code).toContain('document.body.innerText');
    expect(cmd.key).toBe('page_content');
  });

  test('execute_js without a key gets a timestamped one', () => {
    const cmd = mapVisionAction({ action: { type: 'execute_js', code: 'return 1' } }, map, { now: () => 12345 });
    expect(cmd.key).toBe('js_result_12345');
  });

  test('done becomes finish, preferring the action text then the memory field', () => {
    expect(mapVisionAction({ action: { type: 'done', text: 'all good' } }, map).summary).toBe('all good');
    expect(mapVisionAction({ action: { type: 'done' }, memory: 'from memory' }, map).summary).toBe('from memory');
    expect(mapVisionAction({ action: { type: 'done' } }, map).summary).toBe('Task complete');
  });

  test('an unknown action type becomes a diagnostic note', () => {
    const cmd = mapVisionAction({ action: { type: 'teleport' } }, map);
    expect(cmd.type).toBe('note');
    expect(cmd.text).toContain('unknown action teleport');
  });

  test('index 0 is never treated as valid', () => {
    expect(mapVisionAction({ action: { type: 'click', index: 0 } }, map).type).toBe('execute_js');
  });

  test('a null element map degrades to the no-index paths', () => {
    expect(mapVisionAction({ action: { type: 'click', index: 1 } }, null).type).toBe('execute_js');
  });

  test('every mapped command is tagged as a vision action', () => {
    for (const type of ['click', 'input', 'scroll', 'navigate', 'go_back', 'extract', 'execute_js', 'done', 'zzz']) {
      expect(mapVisionAction({ action: { type, index: 1 } }, map)._visionAction).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cleanFinishMemory
// ═══════════════════════════════════════════════════════════════════════════
describe('cleanFinishMemory', () => {
  const clean = (mem) => cleanFinishMemory(mem, Object.keys(mem));

  test('keeps usable values', () => {
    expect(clean({ a: 'a real extracted value', b: [1, 2, 3] })).toEqual({ a: 'a real extracted value', b: [1, 2, 3] });
  });

  test('drops empty, "Done" and too-short values', () => {
    expect(clean({ a: '', b: 'Done', c: 'abcd' })).toEqual({});
  });

  test('drops execution-failure strings', () => {
    expect(clean({
      a: 'Execution error: boom',
      b: 'Code execution timed out',
      c: 'JS Error: ReferenceError',
      d: 'Element not found: #x',
    })).toEqual({});
  });

  test('a value that merely mentions an error is kept', () => {
    expect(clean({ a: 'the log contains JS Error: foo' })).toEqual({ a: 'the log contains JS Error: foo' });
  });

  test('non-string values are stringified for the checks', () => {
    expect(clean({ a: { x: 1 }, b: null, c: 5 })).toEqual({ a: { x: 1 } });
  });

  test('only the supplied keys are considered', () => {
    expect(cleanFinishMemory({ a: 'keep this value', b: 'ignore this one' }, ['a'])).toEqual({ a: 'keep this value' });
  });

  test('an empty memory yields an empty object', () => {
    expect(cleanFinishMemory({}, [])).toEqual({});
  });
});
