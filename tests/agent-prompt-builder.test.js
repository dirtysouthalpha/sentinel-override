// tests/agent-prompt-builder.test.js
// Covers background/agent-prompt-builder.js — the prompt renderer extracted from
// llm-client.js. It takes no imports and has no side effects, so it can be called
// directly with a params object; these assert the branches that used to be
// reachable only by driving a full callLLM run.

import { buildAgentPrompt } from '../background/agent-prompt-builder.js';

// Minimum viable params. Individual tests override only what they exercise.
function params(overrides = {}) {
  return {
    quickModeCtx: '', runbookCtx: '', platformCtx: '',
    goal: 'check the mailbox', currentUrl: 'https://example.com', stepCount: 1,
    pageContent: 'page text', trimmedElements: [], totalElementCount: 0,
    historyWindowSize: 10, isRunbook: false, sanitizedHistory: [],
    lastAction: null, lastResult: null,
    planCtx: '', strategyCtx: '', finishCtx: '', verificationCtx: '',
    patternCtx: '', memoryCtx: '', clientKnowledgeCtx: '', brainKnowledgeCtx: '',
    tabCtxSection: '', loopCtx: '',
    agentState: {}, base64Image: null,
    provider: { supportsToolUse: true },
    ...overrides,
  };
}

describe('buildAgentPrompt', () => {
  it('returns a string containing the goal and current URL', () => {
    const out = buildAgentPrompt(params({ goal: 'reset a password', currentUrl: 'https://portal.test/x' }));
    expect(typeof out).toBe('string');
    expect(out).toContain('reset a password');
    expect(out).toContain('https://portal.test/x');
  });

  it('is pure — identical params produce an identical prompt', () => {
    expect(buildAgentPrompt(params())).toBe(buildAgentPrompt(params()));
  });

  it('does not mutate the params object it is given', () => {
    const p = params();
    const before = JSON.stringify(p);
    buildAgentPrompt(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  describe('injected context strings', () => {
    it('splices multiPortalCtx and multiArticleCtx into the prompt', () => {
      const out = buildAgentPrompt(params({
        multiPortalCtx: '<<PORTAL-DIRECTIVE>>',
        multiArticleCtx: '<<ARTICLE-DIRECTIVE>>',
      }));
      expect(out).toContain('<<PORTAL-DIRECTIVE>>');
      expect(out).toContain('<<ARTICLE-DIRECTIVE>>');
    });

    it('omits them entirely when not supplied (they default to empty)', () => {
      const out = buildAgentPrompt(params());
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('MULTI-PORTAL INVESTIGATION');
    });

    it('renders every optional context slot that is provided', () => {
      const out = buildAgentPrompt(params({
        planCtx: '<<PLAN>>', strategyCtx: '<<STRATEGY>>', finishCtx: '<<FINISH>>',
        verificationCtx: '<<VERIFY>>', patternCtx: '<<PATTERN>>', memoryCtx: '<<MEMORY>>',
        clientKnowledgeCtx: '<<CLIENT>>', brainKnowledgeCtx: '<<BRAIN>>',
        tabCtxSection: '<<TABS>>', loopCtx: '<<LOOP>>',
        quickModeCtx: '<<QUICK>>', runbookCtx: '<<RUNBOOK>>', platformCtx: '<<PLATFORM>>',
      }));
      for (const marker of ['<<PLAN>>', '<<STRATEGY>>', '<<FINISH>>', '<<VERIFY>>', '<<PATTERN>>',
        '<<MEMORY>>', '<<CLIENT>>', '<<BRAIN>>', '<<TABS>>', '<<LOOP>>', '<<QUICK>>',
        '<<RUNBOOK>>', '<<PLATFORM>>']) {
        expect(out).toContain(marker);
      }
    });
  });

  describe('vision branch', () => {
    const withImage = extra => params({ base64Image: 'ZmFrZQ==', ...extra });

    it('permits coordinate clicking when the model can see the screenshot', () => {
      const out = buildAgentPrompt(withImage({ visionCapable: true }));
      expect(out).toContain('click_at');
      expect(out).not.toContain('you cannot determine pixel coordinates');
    });

    it('forbids coordinate clicking when it cannot', () => {
      const out = buildAgentPrompt(withImage({ visionCapable: false }));
      expect(out).toContain('Do NOT use click_at');
    });

    it('defaults to not vision-capable when the flag is absent', () => {
      const out = buildAgentPrompt(withImage());
      expect(out).toContain('Do NOT use click_at');
    });

    it('omits the screenshot section when there is no image', () => {
      const out = buildAgentPrompt(params({ base64Image: null, visionCapable: true }));
      expect(out).not.toContain('Do NOT use click_at');
    });
  });

  describe('provider tool-use branch', () => {
    it('appends the JSON-only instruction when the provider lacks tool use', () => {
      const out = buildAgentPrompt(params({ provider: { supportsToolUse: false } }));
      expect(out).toContain('Return ONLY a single JSON object');
    });

    it('omits it when the provider supports tool use', () => {
      const out = buildAgentPrompt(params({ provider: { supportsToolUse: true } }));
      expect(out).not.toContain('Return ONLY a single JSON object');
    });
  });

  describe('agentState-driven sections', () => {
    it('includes the zoom annotation when present', () => {
      const out = buildAgentPrompt(params({ agentState: { zoomAnnotation: '<<ZOOM>>' } }));
      expect(out).toContain('<<ZOOM>>');
    });

    it('warns about CDP fallback when that mode is active', () => {
      const out = buildAgentPrompt(params({ agentState: { cdpFallbackActive: true } }));
      expect(out).toContain('CDP FALLBACK MODE');
    });

    it('tolerates an empty agentState without emitting undefined', () => {
      const out = buildAgentPrompt(params({ agentState: {} }));
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('CDP FALLBACK MODE');
    });
  });
});
