import { checkCircuitBreaker } from '../background/agent-circuit-breaker.js';

describe('agent-circuit-breaker', () => {
  test('returns safe for short history', () => {
    const result = checkCircuitBreaker([], 1, 60);
    expect(result.tripped).toBe(false);
  });

  test('returns safe for single action', () => {
    const history = [
      { step: 1, action: { type: 'navigate' }, result: 'OK' }
    ];
    const result = checkCircuitBreaker(history, 1, 60);
    expect(result.tripped).toBe(false);
  });
});
