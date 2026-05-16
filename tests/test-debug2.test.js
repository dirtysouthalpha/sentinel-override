import { jest } from '@jest/globals';

let _agentRunning = false;

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  get agentRunning() { console.log('[MOCK] agentRunning called:', _agentRunning); return _agentRunning; },
  startAgent: jest.fn(async () => {}),
}));

const agentEngine = await import('../background/agent-engine.js');

test('getter before clearAllMocks', () => {
  console.log('Before clearAllMocks, agentRunning:', agentEngine.agentRunning);
  expect(agentEngine.agentRunning).toBe(false);
});

test('getter after setting true and clearAllMocks', () => {
  _agentRunning = true;
  jest.clearAllMocks();
  console.log('After clearAllMocks, agentRunning:', agentEngine.agentRunning);
  expect(agentEngine.agentRunning).toBe(true);
  _agentRunning = false;
});
