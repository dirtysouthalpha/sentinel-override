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
});
