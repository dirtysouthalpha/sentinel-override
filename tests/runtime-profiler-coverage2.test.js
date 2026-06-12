/**
 * runtime-profiler-coverage2.test.js
 * Covers getProfilingStatus duration false branch (line 228):
 *   profilerState.startTime is null in a fresh module → duration = 0
 *
 * Uses dynamic import so this module gets its own VM context, ensuring
 * profilerState.startTime starts as null (never set by prior tests).
 */

import { jest } from '@jest/globals';

const { getProfilingStatus } = await import('../background/runtime-profiler.js');

describe('getProfilingStatus — duration false branch (line 228)', () => {
  test('returns duration=0 when startTime is null (fresh module, profiling never started)', () => {
    const status = getProfilingStatus();
    expect(status.duration).toBe(0);
    expect(status.enabled).toBe(false);
  });
});
