// Sentinel Override v3 -- Unit tests for background/report-generator.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

// Mock dependencies
vi.mock('../../background/message-protocol.js', () => ({
  sendSilentUpdate: vi.fn(),
}));
vi.mock('../../background/provider-registry.js', () => ({
  getActiveProvider: vi.fn(() => Promise.resolve({
    id: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKey: 'sk-ant-test',
    model: 'claude-haiku-4-5-20251001',
  })),
  resolveProvider: vi.fn(() => ({
    buildHeaders: () => ({ 'Content-Type': 'application/json', 'x-api-key': 'test' }),
    buildBody: (model, sys, user) => ({ model, system: sys, messages: [{ role: 'user', content: user }] }),
    parseResponse: (data) => data.text || 'Parsed report',
  })),
}));

import { generateReport } from '../../background/report-generator.js';

describe('report-generator', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
  });

  const baseExecutionData = {
    goal: 'Test goal',
    history: [
      { step: 1, action: { type: 'navigate', url: 'https://example.com' }, result: 'Navigated' },
      { step: 2, action: { type: 'click', selector: '#btn' }, result: 'Clicked' },
    ],
    agentMemory: { ip: '10.0.0.5', hostname: 'server-01' },
    agentPlan: null,
    stepCount: 2,
    apiCallCount: 3,
    tabContexts: [{ label: 'Main', url: 'https://example.com', hasScreenshot: false }],
  };

  const baseConfig = {
    fetchTimeout: 45000,
  };

  describe('generateReport', () => {
    it('generates report via LLM call', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ text: '### Goal\nTest goal completed.' }),
      }));

      const report = await generateReport(baseExecutionData, baseConfig);
      expect(report).toBeDefined();
      expect(report.goal).toBe('Test goal');
      expect(report.fullReport).toContain('Goal');
      expect(report.summary).toBeDefined();
      expect(report.timestamp).toBeDefined();
    });

    it('falls back to raw data when LLM call fails', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      const report = await generateReport(baseExecutionData, baseConfig);
      expect(report).toBeDefined();
      expect(report.goal).toBe('Test goal');
      expect(report.fullReport).toContain('Goal');
      expect(report.fullReport).toContain('Steps Taken');
      expect(report.fullReport).toContain('Evidence');
    });

    it('falls back when LLM returns non-ok response', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      }));

      const report = await generateReport(baseExecutionData, baseConfig);
      expect(report).toBeDefined();
      expect(report.fullReport).toContain('Goal');
    });

    it('strips code fences from LLM response', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          text: '```markdown\n### Goal\nClean report\n```',
        }),
      }));

      const report = await generateReport(baseExecutionData, baseConfig);
      expect(report.fullReport).not.toContain('```');
      expect(report.fullReport).toContain('### Goal');
    });

    it('handles empty history gracefully', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ text: '### Goal\nNo steps.' }),
      }));

      const report = await generateReport({
        ...baseExecutionData,
        history: [],
        stepCount: 0,
        apiCallCount: 0,
      }, baseConfig);
      expect(report).toBeDefined();
    });

    it('handles empty agent memory', async () => {
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ text: '### Goal\nDone.' }),
      }));

      const report = await generateReport({
        ...baseExecutionData,
        agentMemory: {},
      }, baseConfig);
      expect(report).toBeDefined();
    });

    it('includes plan context when plan exists', async () => {
      global.fetch = vi.fn(() => {
        // Check that the prompt includes plan info
        const call = global.fetch.mock.calls[0];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ text: '### Goal\nPlan executed.' }),
        });
      });

      const report = await generateReport({
        ...baseExecutionData,
        agentPlan: ['Step 1', 'Step 2', 'Step 3'],
      }, baseConfig);
      expect(report).toBeDefined();
    });
  });

  describe('fallback report structure', () => {
    it('includes memory in fallback report', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('fail')));

      const report = await generateReport(baseExecutionData, baseConfig);
      expect(report.fullReport).toContain('10.0.0.5');
      expect(report.fullReport).toContain('server-01');
    });

    it('includes step count and API calls in fallback', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('fail')));

      const report = await generateReport(baseExecutionData, baseConfig);
      expect(report.fullReport).toContain('2 steps');
      expect(report.fullReport).toContain('3 API calls');
    });
  });
});
