// tests/report-fabrication.test.js
//
// The MSP ticket templates produce text a technician pastes into a PSA ticket
// or sends to a paying client. Two classes of fabrication were shipping in it,
// neither of them a model hallucination — both were deterministic, in our own
// string templates, on every single run:
//
//   1. INVENTED IDENTITY. getTechnicianInfo() fell back to hardcoded
//      placeholders ("John Smith", "IT Support Technician", "Acme IT",
//      "555-000-0000", "support@example.com") whenever chrome.storage
//      technicianInfo was unset — the state of every fresh install. Worse, the
//      settings UI only persists non-empty fields and getTechnicianInfo merged
//      `{...defaults, ...stored}`, so a technician who filled in only their
//      name still shipped the fake phone and the fake support address into the
//      body of a client-facing email.
//
//   2. INVENTED STATUS. Templates asserted outcomes the agent cannot know:
//      "Ticket closed pending client confirmation", "has been resolved",
//      "Everything is now working as expected", "Vendor case opened at <time>".
//      The agent performs read-only investigation. It does not remediate,
//      close tickets, open vendor cases, or contact anyone.
//
// These tests assert the product no longer states anything it cannot support,
// and that the grounding auditor catches such claims when they arrive from the
// model's own summary text instead of from a template.

import { jest } from '@jest/globals';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const out = {};
        const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of list) if (storageData[k] !== undefined) out[k] = storageData[k];
        return out;
      }),
      set: jest.fn(async (o) => { Object.assign(storageData, o); }),
    },
  },
};

const {
  getTechnicianInfo,
  formatTicketFinalNotes,
  formatTicketKickoff,
  formatWaitingOnClient,
  formatWaitingOnVendor,
  formatItGlueKb,
  formatClientEmail,
  formatTicketOutput,
} = await import('../background/agent-ticket-format.js');

const {
  buildEvidenceCorpus,
  findUngroundedClaims,
  annotateUngroundedClaims,
  auditReport,
  isKnownPlaceholder,
  CLAIM_KIND,
} = await import('../background/report-grounding.js');

beforeEach(() => { storageData = {}; });

// Every fabricated value that used to ship.
const BANNED = [
  'John Smith',
  'Acme IT',
  '555-000-0000',
  'support@example.com',
];

const ALL_FORMATTERS = [
  ['FINAL_NOTES', formatTicketFinalNotes],
  ['TICKET_KICKOFF', formatTicketKickoff],
  ['WAITING_ON_CLIENT', formatWaitingOnClient],
  ['WAITING_ON_VENDOR', formatWaitingOnVendor],
  ['IT_GLUE_KB', formatItGlueKb],
  ['CLIENT_EMAIL', formatClientEmail],
];

// ═══════════════════════════════════════════════════════════════════════════
describe('getTechnicianInfo invents nothing', () => {
  test('an unconfigured install yields null fields, not a fake identity', async () => {
    const info = await getTechnicianInfo();
    expect(info.name).toBeNull();
    expect(info.title).toBeNull();
    expect(info.company).toBeNull();
    expect(info.phone).toBeNull();
    expect(info.email).toBeNull();
    expect(info.configured).toBe(false);
    expect(info.missingFields).toEqual(['name', 'title', 'company', 'phone', 'email']);
  });

  test('a PARTIALLY configured install does not backfill the rest', async () => {
    // The exact shipped bug: settings saves only non-empty fields, and the old
    // `{...defaults, ...stored}` merge handed Jane Doe a fake phone and a fake
    // support@example.com to put in front of her client.
    storageData.technicianInfo = { name: 'Jane Doe', phone: '555-1234' };
    const info = await getTechnicianInfo();
    expect(info.name).toBe('Jane Doe');
    expect(info.phone).toBe('555-1234');
    expect(info.title).toBeNull();
    expect(info.company).toBeNull();
    expect(info.email).toBeNull();
    expect(info.configured).toBe(false);
    expect(info.missingFields).toEqual(['title', 'company', 'email']);
  });

  test('a fully configured install is returned as-is', async () => {
    storageData.technicianInfo = {
      name: 'Ada Byron', title: 'Senior Engineer', company: 'Northwind MSP',
      phone: '+1 617 555 0142', email: 'ada@northwind.example',
    };
    const info = await getTechnicianInfo();
    expect(info.configured).toBe(true);
    expect(info.missingFields).toEqual([]);
    expect(info.name).toBe('Ada Byron');
  });

  test('whitespace-only fields count as unset', async () => {
    storageData.technicianInfo = { name: '   ', email: '\t' };
    const info = await getTechnicianInfo();
    expect(info.name).toBeNull();
    expect(info.email).toBeNull();
  });

  test('a non-object stored value does not resurrect defaults', async () => {
    storageData.technicianInfo = 'invalid';
    const info = await getTechnicianInfo();
    expect(info.name).toBeNull();
    expect(info.configured).toBe(false);
  });

  test('a storage failure does not resurrect defaults', async () => {
    const orig = chrome.storage.local.get;
    chrome.storage.local.get = jest.fn(async () => { throw new Error('fail'); });
    try {
      const info = await getTechnicianInfo();
      expect(info.name).toBeNull();
      expect(info.configured).toBe(false);
    } finally {
      chrome.storage.local.get = orig; // restore, or every later test sees a dead store
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('no formatter emits a placeholder identity', () => {
  test.each(ALL_FORMATTERS)('%s contains no fabricated persona or contact detail', async (name, fn) => {
    const tech = await getTechnicianInfo(); // unconfigured — the fresh-install case
    const out = fn('Read the ticket page. Priority is P1.', 'Investigate ticket #4488', tech, {
      stepCount: 5, apiCallCount: 6,
    });
    for (const banned of BANNED) {
      expect(out).not.toContain(banned);
    }
  });

  test.each(ALL_FORMATTERS)('%s tells the operator their details are missing', async (name, fn) => {
    const tech = await getTechnicianInfo();
    const out = fn('summary text', 'Investigate ticket #4488', tech, {});
    expect(out.toLowerCase()).toMatch(/not (?:set|configured)|no technician/);
  });

  test.each(ALL_FORMATTERS)('%s renders real configured details verbatim', async (name, fn) => {
    storageData.technicianInfo = {
      name: 'Ada Byron', title: 'Senior Engineer', company: 'Northwind MSP',
      phone: '+1 617 555 0142', email: 'ada@northwind.example',
    };
    const tech = await getTechnicianInfo();
    const out = fn('summary text', 'Investigate ticket #4488', tech, {});
    expect(out).toContain('Ada Byron');
    for (const banned of BANNED) expect(out).not.toContain(banned);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('no formatter asserts an outcome the agent cannot verify', () => {
  const tech = {
    name: 'Ada Byron', title: 'Senior Engineer', company: 'Northwind MSP',
    phone: '+1 617 555 0142', email: 'ada@northwind.example',
  };

  test('FINAL_NOTES no longer closes the ticket on the client\'s behalf', () => {
    const out = formatTicketFinalNotes('Investigation complete.', 'ticket #4488', tech, {});
    expect(out).not.toMatch(/Ticket closed pending client confirmation/i);
    expect(out).toMatch(/Technician review required before closing/i);
    expect(out).toMatch(/read-only investigation/i);
  });

  test('FINAL_NOTES does not claim a contact attempt that never happened', () => {
    const out = formatTicketFinalNotes('Investigation complete.', 'ticket #4488', tech, {});
    expect(out).toMatch(/No client or vendor contact was attempted/i);
  });

  test('CLIENT_EMAIL does not tell the client it is resolved', () => {
    const out = formatClientEmail('We read the ticket page.', 'ticket #4488', tech, {});
    expect(out).not.toMatch(/has been resolved/i);
    expect(out).not.toMatch(/Everything is now working as expected/i);
    expect(out).not.toMatch(/^\*\*Subject:\*\* Resolved:/m);
  });

  test('CLIENT_EMAIL is marked a draft and leaves status to the technician', () => {
    const out = formatClientEmail('We read the ticket page.', 'ticket #4488', tech, {});
    expect(out).toMatch(/DRAFT/);
    expect(out).toMatch(/\[STATUS — complete this line before sending/);
    expect(out).toMatch(/cannot confirm whether the issue is resolved/i);
  });

  test('WAITING_ON_VENDOR does not claim a vendor case was opened', () => {
    const out = formatWaitingOnVendor('Diagnostics captured.', 'ticket #4488', tech, {});
    expect(out).not.toMatch(/Vendor case opened at/i);
    expect(out).toMatch(/No vendor case was opened by the agent/i);
  });

  test('WAITING_ON_CLIENT does not claim outbound contact', () => {
    const out = formatWaitingOnClient('Investigation done.', 'ticket #4488', tech, {});
    expect(out).toMatch(/No outbound contact was made by the agent/i);
  });

  test('TICKET_KICKOFF labels its boilerplate ladder as generic', () => {
    // A summary with no sentences to derive a path from falls back to the
    // canned three-step ladder; unlabelled it reads as agent analysis.
    const out = formatTicketKickoff('', 'ticket #4488 kickoff', tech, {});
    expect(out).toMatch(/generic checklist/i);
  });

  test('a real page status IS allowed through — this is not blanket censorship', () => {
    const out = formatTicketFinalNotes(
      'The ticket page shows Status: Resolved for TKT-4488.', 'ticket #4488', tech, {});
    expect(out).toContain('Status: Resolved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('grounding auditor', () => {
  const corpusInput = {
    goal: 'Investigate ticket #4488',
    agentMemory: { ticket_details: 'TKT-4488 P1 Exchange mail flow stopped. Assigned to: UNASSIGNED.' },
    history: [{ action: { type: 'read_page' }, result: 'SLA: BREACHED 11 minutes ago' }],
    technicianInfo: { name: 'Ada Byron', phone: '+1 617 555 0142', email: 'ada@northwind.example' },
  };

  test('the corpus includes memory, history results, goal and configured identity', () => {
    const c = buildEvidenceCorpus(corpusInput);
    expect(c).toContain('tkt-4488');
    expect(c).toContain('sla: breached');
    expect(c).toContain('ada@northwind.example');
    expect(c).toContain('investigate ticket #4488');
  });

  test('a grounded report passes clean', () => {
    const report = 'TKT-4488 is P1, currently UNASSIGNED. SLA: BREACHED 11 minutes ago. '
      + 'Contact Ada Byron at ada@northwind.example.';
    const { ok, claims } = findUngroundedClaims(report, buildEvidenceCorpus(corpusInput));
    expect(claims).toEqual([]);
    expect(ok).toBe(true);
  });

  test('an invented email address is flagged', () => {
    const report = 'Please contact helpdesk@totally-made-up.example for details.';
    const { ok, claims } = findUngroundedClaims(report, buildEvidenceCorpus(corpusInput));
    expect(ok).toBe(false);
    expect(claims.some(c => c.kind === CLAIM_KIND.EMAIL && c.value.includes('totally-made-up'))).toBe(true);
  });

  test('an invented phone number is flagged', () => {
    const report = 'Call the client back on +1 415 999 8888.';
    const { claims } = findUngroundedClaims(report, buildEvidenceCorpus(corpusInput));
    expect(claims.some(c => c.kind === CLAIM_KIND.PHONE)).toBe(true);
  });

  test('the configured phone number is NOT flagged, in any formatting', () => {
    for (const rendering of ['+1 617 555 0142', '(617) 555-0142', '6175550142']) {
      const { claims } = findUngroundedClaims(`Reach me on ${rendering}.`, buildEvidenceCorpus(corpusInput));
      expect(claims.filter(c => c.kind === CLAIM_KIND.PHONE)).toEqual([]);
    }
  });

  test('unsupported outcome assertions are flagged', () => {
    for (const claim of [
      'The issue has been resolved.',
      'Ticket closed and archived.',
      'Everything is now working as expected.',
      'Vendor case opened with the manufacturer.',
      'No further action required.',
    ]) {
      const { claims } = findUngroundedClaims(claim, buildEvidenceCorpus(corpusInput));
      expect(claims.some(c => c.kind === CLAIM_KIND.STATUS)).toBe(true);
    }
  });

  test('an outcome the PAGE actually stated is not flagged', () => {
    const grounded = buildEvidenceCorpus({
      ...corpusInput,
      history: [{ action: { type: 'read_page' }, result: 'Status: Resolved — closed by vendor' }],
    });
    const { claims } = findUngroundedClaims('The issue has been resolved.', grounded);
    expect(claims.filter(c => c.kind === CLAIM_KIND.STATUS)).toEqual([]);
  });

  test('the retired placeholder identities are flagged even if a page echoes them', () => {
    const echoed = buildEvidenceCorpus({ goal: 'x', agentMemory: { p: 'John Smith support@example.com' } });
    const { claims } = findUngroundedClaims('Regards, John Smith — support@example.com', echoed);
    expect(claims.some(c => c.kind === CLAIM_KIND.PLACEHOLDER)).toBe(true);
  });

  test('isKnownPlaceholder recognises the retired defaults in any formatting', () => {
    expect(isKnownPlaceholder('John Smith')).toBe(true);
    expect(isKnownPlaceholder('support@example.com')).toBe(true);
    expect(isKnownPlaceholder('(555) 000-0000')).toBe(true);
    expect(isKnownPlaceholder('Ada Byron')).toBe(false);
    expect(isKnownPlaceholder('')).toBe(false);
  });

  test('annotation is loud, listed, and capped', () => {
    const claims = Array.from({ length: 20 }, (_, i) => ({
      kind: 'email', value: `x${i}@nope.example`, reason: 'r',
    }));
    const out = annotateUngroundedClaims('BODY', claims);
    expect(out).toContain('BODY');
    expect(out).toMatch(/UNVERIFIED DETAILS/);
    expect(out).toContain('x0@nope.example');
    expect(out).toMatch(/and 8 more/);
  });

  test('annotation is a no-op when there is nothing to report', () => {
    expect(annotateUngroundedClaims('BODY', [])).toBe('BODY');
    expect(annotateUngroundedClaims('BODY', null)).toBe('BODY');
  });

  test('auditReport returns the report untouched when clean', () => {
    const r = 'TKT-4488 is UNASSIGNED.';
    const res = auditReport(r, corpusInput);
    expect(res.ok).toBe(true);
    expect(res.report).toBe(r);
  });

  test('auditReport annotates when not clean', () => {
    const res = auditReport('Contact nobody@invented.example. The issue has been resolved.', corpusInput);
    expect(res.ok).toBe(false);
    expect(res.report).toMatch(/UNVERIFIED DETAILS/);
    expect(res.claims.length).toBeGreaterThanOrEqual(2);
  });

  test('handles empty/garbage input without throwing', () => {
    expect(() => findUngroundedClaims('', '')).not.toThrow();
    expect(() => findUngroundedClaims(null, null)).not.toThrow();
    expect(() => buildEvidenceCorpus(null)).not.toThrow();
    expect(() => buildEvidenceCorpus({ agentMemory: { a: { deep: [1, 2] } } })).not.toThrow();
  });

  test('does not flag step counts, timestamps or byte sizes as phone numbers', () => {
    const report = 'Completed 5 steps and 6 AI calls at 2026-08-23 20:47 UTC; extracted 128000 chars.';
    const { claims } = findUngroundedClaims(report, buildEvidenceCorpus(corpusInput));
    expect(claims.filter(c => c.kind === CLAIM_KIND.PHONE)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('end-to-end: the exact output that triggered this work', () => {
  // Reproduces the live-run finish summary from the 2026-08-23 session:
  // a correct extraction wrapped in an invented persona and an invented status.
  test('the fresh-install FINAL_NOTES block is free of all four fabrications', async () => {
    const tech = await getTechnicianInfo();
    const modelSummary = 'TKT-4488 — Exchange mail flow stopped. Priority P1. '
      + 'Assigned to: UNASSIGNED. SLA: BREACHED 11 minutes ago.';
    const out = formatTicketOutput('FINAL_NOTES', modelSummary, 'Investigate ticket #4488', tech, {
      stepCount: 5, apiCallCount: 6,
    });

    expect(out).not.toContain('John Smith');
    expect(out).not.toContain('IT Support Technician, Acme IT');
    expect(out).not.toContain('555-000-0000');
    expect(out).not.toContain('support@example.com');
    expect(out).not.toMatch(/Ticket closed pending client confirmation/i);

    // The real, extracted data survives untouched.
    expect(out).toContain('TKT-4488');
    expect(out).toContain('UNASSIGNED');
    expect(out).toContain('BREACHED');
  });

  test('a model-authored resolution claim is caught by the audit even after formatting', async () => {
    const tech = await getTechnicianInfo();
    const modelSummary = 'TKT-4488 has been resolved and the mail flow is healthy again.';
    const formatted = formatTicketOutput('FINAL_NOTES', modelSummary, 'Investigate ticket #4488', tech, {});
    const res = auditReport(formatted, {
      goal: 'Investigate ticket #4488',
      agentMemory: { t: 'TKT-4488 P1 Exchange mail flow stopped' },
      history: [],
      technicianInfo: tech,
    });
    expect(res.ok).toBe(false);
    expect(res.claims.some(c => c.kind === CLAIM_KIND.STATUS)).toBe(true);
    expect(res.report).toMatch(/UNVERIFIED DETAILS/);
  });
});
