import { describe, test, expect, beforeEach } from '@jest/globals';
import { canStartRun, registerRun, completeRun, queueRun, getQueueStatus, cancelPendingRun, resetQueue } from '../background/run-queue.js';

describe('run-queue', () => {
  beforeEach(() => {
    resetQueue();
  });

  test('canStartRun returns true for new tab', () => {
    expect(canStartRun(1)).toEqual({ canStart: true });
  });

  test('canStartRun rejects duplicate tab', () => {
    registerRun(1, 'test', Promise.resolve());
    expect(canStartRun(1)).toEqual({ canStart: false, reason: 'Tab already has an active run' });
  });

  test('registerRun and completeRun lifecycle', () => {
    registerRun(1, 'test goal', Promise.resolve());
    const status = getQueueStatus();
    expect(status.activeCount).toBe(1);
    expect(status.activeRuns[0].goal).toBe('test goal');

    const result = completeRun(1, { summary: 'done' });
    expect(result.status).toBe('completed');
    expect(result.goal).toBe('test goal');

    const afterComplete = getQueueStatus();
    expect(afterComplete.activeCount).toBe(0);
    expect(afterComplete.completedCount).toBe(1);
  });

  test('completeRun with error marks as failed', () => {
    registerRun(2, 'failing goal', Promise.resolve());
    const result = completeRun(2, { error: true, summary: 'something broke' });
    expect(result.status).toBe('failed');
  });

  test('queueRun queues a pending run', async () => {
    const promise = queueRun('queued goal', 3);
    const status = getQueueStatus();
    expect(status.pendingCount).toBe(1);
    cancelPendingRun('queued goal');
    await expect(promise).rejects.toThrow('Run cancelled');
  });

  test('cancelPendingRun returns false for non-existent goal', () => {
    expect(cancelPendingRun('nonexistent')).toBe(false);
  });

  test('getQueueStatus returns correct structure', () => {
    const status = getQueueStatus();
    expect(status).toHaveProperty('activeCount');
    expect(status).toHaveProperty('pendingCount');
    expect(status).toHaveProperty('maxConcurrent');
    expect(status).toHaveProperty('activeRuns');
    expect(status).toHaveProperty('completedCount');
    expect(status).toHaveProperty('recentCompleted');
    expect(status.maxConcurrent).toBe(5);
  });

  test('canStartRun rejects when MAX_CONCURRENT_RUNS reached', () => {
    for (let i = 0; i < 5; i++) {
      registerRun(i + 10, `goal ${i}`, Promise.resolve());
    }
    const result = canStartRun(99);
    expect(result.canStart).toBe(false);
    expect(result.reason).toMatch(/Max concurrent/);
  });

  test('completeRun returns undefined for unknown tabId', () => {
    expect(completeRun(999, { summary: 'oops' })).toBeUndefined();
  });

  test('completeRun trims completed list when over _maxCompleted', () => {
    // Fill to _maxCompleted (50) by completing 50 runs, then add one more
    for (let i = 0; i < 50; i++) {
      registerRun(i, `goal ${i}`, Promise.resolve());
      completeRun(i, { summary: 'done' });
    }
    registerRun(99, 'one more', Promise.resolve());
    completeRun(99, { summary: 'trim me' });
    const status = getQueueStatus();
    expect(status.completedCount).toBe(50);
  });

  test('_processNextPending resolves queued run when slot opens', async () => {
    // Fill to max concurrent
    for (let i = 0; i < 5; i++) {
      registerRun(i + 10, `goal ${i}`, Promise.resolve());
    }
    // Queue a pending run
    const pending = queueRun('pending goal', 20);
    expect(getQueueStatus().pendingCount).toBe(1);

    // Complete one active run — should trigger _processNextPending
    completeRun(10, { summary: 'done' });
    const resolved = await pending;
    expect(resolved).toEqual({ canStart: true, tabId: 20 });
    expect(getQueueStatus().pendingCount).toBe(0);
  });

  test('resetQueue rejects all pending runs with Queue reset error', async () => {
    const p1 = queueRun('goal-a', 1);
    const p2 = queueRun('goal-b', 2);
    resetQueue();
    await expect(p1).rejects.toThrow('Queue reset');
    await expect(p2).rejects.toThrow('Queue reset');
  });

  test('completeRun result.summary defaults to empty string', () => {
    registerRun(1, 'goal', Promise.resolve());
    const result = completeRun(1, {});
    expect(result.result).toBe('');
  });

  test('getQueueStatus truncates long goal in activeRuns', () => {
    const longGoal = 'X'.repeat(200);
    registerRun(1, longGoal, Promise.resolve());
    const status = getQueueStatus();
    expect(status.activeRuns[0].goal.length).toBe(100);
  });

  test('getQueueStatus handles null goal in active run', () => {
    registerRun(1, null, Promise.resolve());
    const status = getQueueStatus();
    expect(status.activeRuns[0].goal).toBe('');
  });
});
