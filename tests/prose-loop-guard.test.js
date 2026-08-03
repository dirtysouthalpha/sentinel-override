// tests/prose-loop-guard.test.js
// The no-action prose loop guard: proseLoopVerdict() from agent-loop-helpers.js.
// Covers the LongCat-2.0 announce-loop observed live 2026-08-03: the model
// replied with the same "Agent Zero is running on NUKE... Let me update the
// domain config:" prose (no action JSON) every step until stopped.

import { proseLoopVerdict, PROSE_LOOP_ABORT_REPEATS } from '../background/agent-loop-helpers.js';

const parseNote = (prose) => ({ type: 'note', text: `Parse error (will retry) — captured model output: ${prose}` });
const ANNOUNCE = 'Agent Zero is running on NUKE. Let me update the domain config:';

describe('proseLoopVerdict', () => {
  test('real action resets the streak', () => {
    const r = proseLoopVerdict('some prior prose', 1, { type: 'click', selector: '#a' });
    expect(r).toEqual({ prose: '', repeats: 0, verdict: 'ok' });
  });

  test('null command resets the streak', () => {
    const r = proseLoopVerdict('some prior prose', 1, null);
    expect(r).toEqual({ prose: '', repeats: 0, verdict: 'ok' });
  });

  test('first parse-error capture starts a streak', () => {
    const r = proseLoopVerdict('', 0, parseNote(ANNOUNCE));
    expect(r.verdict).toBe('first');
    expect(r.repeats).toBe(0);
    expect(r.prose).toContain('agent zero is running on nuke');
  });

  test('second identical capture nudges', () => {
    const first = proseLoopVerdict('', 0, parseNote(ANNOUNCE));
    const second = proseLoopVerdict(first.prose, first.repeats, parseNote(ANNOUNCE));
    expect(second.verdict).toBe('nudge');
    expect(second.repeats).toBe(1);
  });

  test('third identical capture aborts', () => {
    const first = proseLoopVerdict('', 0, parseNote(ANNOUNCE));
    const second = proseLoopVerdict(first.prose, first.repeats, parseNote(ANNOUNCE));
    const third = proseLoopVerdict(second.prose, second.repeats, parseNote(ANNOUNCE));
    expect(third.verdict).toBe('abort');
    expect(third.repeats).toBe(PROSE_LOOP_ABORT_REPEATS);
  });

  test('different prose restarts the streak instead of advancing it', () => {
    const first = proseLoopVerdict('', 0, parseNote(ANNOUNCE));
    const changed = proseLoopVerdict(first.prose, first.repeats, parseNote('The web UI is responding. Checking ports now.'));
    expect(changed.verdict).toBe('first');
    expect(changed.repeats).toBe(0);
  });

  test('whitespace and case differences still count as identical', () => {
    const first = proseLoopVerdict('', 0, parseNote(ANNOUNCE));
    const second = proseLoopVerdict(first.prose, first.repeats, parseNote(`  agent zero IS running\n on NUKE.   Let me update the domain config:`));
    expect(second.verdict).toBe('nudge');
  });

  test('unrelated note (e.g. API failure) neither resets nor advances the streak', () => {
    const first = proseLoopVerdict('', 0, parseNote(ANNOUNCE));
    const apiFail = proseLoopVerdict(first.prose, first.repeats, { type: 'note', text: 'API call failed: 429' });
    expect(apiFail.verdict).toBe('ok');
    expect(apiFail.prose).toBe(first.prose);
    expect(apiFail.repeats).toBe(first.repeats);
    // The identical announcement after the transient failure still nudges.
    const resumed = proseLoopVerdict(apiFail.prose, apiFail.repeats, parseNote(ANNOUNCE));
    expect(resumed.verdict).toBe('nudge');
  });
});
