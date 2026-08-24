// Sentinel Override — Ticket Formatters
// Extracted from agent-engine.js for modularity.
// MSP output templates: FINAL_NOTES, TICKET_KICKOFF, WAITING_ON_CLIENT,
// WAITING_ON_VENDOR, IT_GLUE_KB, CLIENT_EMAIL.

import { ONE_DAY_MS } from './constants.js';

// ── Regex constants (local copies, originally in agent-engine.js) ──────────
const TICKET_GOAL_RE = /\b(ticket|incident|alert|investigat|threat\s+hunt|malware|sentinelone|connectwise|kaseya)\b|#\d{3,}/i;
const TICKET_NUMBER_RE1 = /(?:ticket|incident|alert)[#\s:]*(\d{3,8})/i;
const TICKET_NUMBER_RE2 = /#(\d{3,8})/;
const NEWLINE_SPLIT_RE = /\n+/;
const WHITESPACE_NORMALIZE_RE = /\s+/g;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const TICKET_PREFIX_RE = /^(ticket|incident)\s*#?\d*[:\-\s]+/i;
const STEP_PREFIX_RE = /^(\d+[.)]|-|\*)\s+/;
const ENV_M365_RE = /m365|microsoft|entra|exchange|defender|purview|power\s*automate|power\s*apps/i;
const ENV_FIREWALL_RE = /sonicwall|fortigate|firewall/i;
const ENV_EDR_RE = /sentinelone|crowdstrike|defender for endpoint/i;
const ENV_RMM_RE = /connectwise|ninjaone|kaseya|datto/i;
const ENV_EMAIL_SEC_RE = /proofpoint|mimecast|barracuda|quarantine|smart\s*search/i;
const TICKET_VENDOR_RE = /waiting on (the )?vendor|vendor (case|ticket)|vendor support/;
const TICKET_CLIENT_RE = /waiting on (the )?client|awaiting client|client to respond|client (callback|reply)/;
const TICKET_ITGLUE_RE = /(create|document|write).*(kb|knowledge base|it glue)/;
const TICKET_EMAIL_RE = /draft (an?|the) email|send (an?|the) email|email the client/;
const TICKET_KICKOFF_RE = /kickoff|new ticket|just opened|investigate this ticket/;
const PLAN_PARTIAL_RE = /step limit|extraction.*fail|not yet|incomplete|manually search/i;
const TRIED_ACTION_RE = /^(tried|attempted|ran|tested|restart|reboot|reinstall|reset|verified|confirmed|checked|cleared|escalated)/i;

// ── Helper functions ──────────────────────────────────────────────────────
const getFirstLine = (str) => {
  if (!str) return '';
  const idx = str.indexOf('\n');
  return idx === -1 ? str : str.slice(0, idx);
};

const getFirstSentence = (str) => {
  if (!str) return '';
  const idx = str.indexOf('. ');
  return idx === -1 ? str : str.slice(0, idx + 1);
};

// ── Ticket detection & info ──────────────────────────────────────────────
function isTicketInvestigationGoal(goal) {
  if (!goal || typeof goal !== 'string') return false;
  return TICKET_GOAL_RE.test(goal);
}

const TECH_FIELDS = ['name', 'title', 'company', 'phone', 'email'];

const TECH_LABEL = {
  name: 'Technician name',
  title: 'Title',
  company: 'Company',
  phone: 'Phone',
  email: 'Email',
};

/**
 * Read the operator's configured technician identity.
 *
 * This used to fall back to hardcoded placeholders — "John Smith",
 * "IT Support Technician", "Acme IT", "555-000-0000", "support@example.com" —
 * whenever `technicianInfo` was unset, which is the state of every fresh
 * install. Those values were then rendered into the Ownership Statement and
 * into the body of a client-facing email, so the product deterministically
 * signed MSP tickets with a fake person and a fake support address.
 *
 * The merge made it worse than an all-or-nothing default: the settings UI only
 * persists non-empty fields, so a technician who filled in just their name
 * still shipped `555-000-0000` and `support@example.com` to a paying client.
 *
 * Now: unset fields are null. Every formatter renders a visible
 * "not set — configure in Settings" marker instead of inventing a plausible
 * value. `configured` / `missingFields` let callers warn earlier.
 *
 * @returns {Promise<{name: string|null, title: string|null, company: string|null,
 *   phone: string|null, email: string|null, configured: boolean, missingFields: string[]}>}
 */
async function getTechnicianInfo() {
  const info = { name: null, title: null, company: null, phone: null, email: null };
  try {
    const stored = await chrome.storage.local.get(['technicianInfo']);
    const t = stored && stored.technicianInfo;
    if (t && typeof t === 'object') {
      for (const k of TECH_FIELDS) {
        const v = typeof t[k] === 'string' ? t[k].trim() : '';
        if (v) info[k] = v;
      }
    }
  } catch (_e) { /* storage read non-fatal */ }
  info.missingFields = TECH_FIELDS.filter(k => !info[k]);
  info.configured = info.missingFields.length === 0;
  return info;
}

/**
 * Render one technician field, or a visible marker when it is not configured.
 * Never substitutes a plausible-looking value.
 *
 * @param {object} tech
 * @param {string} key - One of TECH_FIELDS.
 * @returns {string}
 */
function techField(tech, key) {
  const v = tech && tech[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return `[${TECH_LABEL[key] || key} not set — configure in Settings → Ticket Mode]`;
}

/** True when the operator has configured at least a name. */
function hasTechIdentity(tech) {
  return !!(tech && typeof tech.name === 'string' && tech.name.trim());
}

/**
 * The signature block. With no configured identity it says so plainly rather
 * than printing five placeholder markers.
 *
 * @param {object} tech
 * @returns {string[]} lines
 */
function techSignature(tech) {
  if (!hasTechIdentity(tech)) {
    return [
      '_Prepared by Sentinel Override (automated investigation)._',
      '_⚠️ No technician details configured — set your name, title, company, phone and email in Settings → Ticket Mode before sending this to a client._',
    ];
  }
  return [
    `_${techField(tech, 'name')} · ${techField(tech, 'title')} · ${techField(tech, 'company')}_`,
    `_Phone: ${techField(tech, 'phone')} · Email: ${techField(tech, 'email')}_`,
  ];
}

/**
 * Ownership line. Attributing work to a named person requires that the operator
 * actually named themselves.
 *
 * @param {object} tech
 * @param {string} trailing - What that person did / will do.
 * @returns {string}
 */
function ownershipLine(tech, trailing) {
  if (!hasTechIdentity(tech)) {
    return `Automated investigation by Sentinel Override — ${trailing}. `
      + 'No technician identity is configured; add yours in Settings before this goes to a client.';
  }
  return `${techField(tech, 'name')} (${techField(tech, 'title')}, ${techField(tech, 'company')}) — ${trailing}.`;
}

// The agent performs read-only investigation. It does not remediate, close
// tickets, open vendor cases, or contact anyone — so no template may assert
// that it did. This is the one line every "what happens next" field uses.
const NO_REMEDIATION_NOTE =
  'This run was read-only investigation by an automated agent: nothing was changed, '
  + 'no ticket was closed and no one was contacted.';

function extractTicketNumber(goal) {
  if (!goal) return '';
  const m = goal.match(TICKET_NUMBER_RE1)
         || goal.match(TICKET_NUMBER_RE2);
  return m ? m[1] : '';
}

// ── FINAL_NOTES format ───────────────────────────────────────────────────
import { formatFindingsForReport } from './investigation-checklist.js';

function formatTicketFinalNotes(summary, goal, tech, options) {
  const ticketNum = extractTicketNumber(goal);
  const opts = options || {};
  const stepCount = opts.stepCount || 0;
  const apiCallCount = opts.apiCallCount || 0;
  const now = new Date();
  const stamp = `${now.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const partial = PLAN_PARTIAL_RE.test(summary || '');

  const summaryStr = typeof summary === 'string' ? summary : '';
  let actionTaken = summaryStr.split(SENTENCE_SPLIT_RE).slice(0, 2).join(' ').trim();
  if (!actionTaken) actionTaken = 'Investigation completed via Sentinel Override agent.';
  if (actionTaken.length > 240) actionTaken = `${actionTaken.slice(0, 237)}...`;

  // "None required. Ticket closed pending client confirmation." used to be
  // asserted here whenever a regex failed to spot partial-run wording. The
  // agent cannot know whether a ticket may be closed — that is a technician's
  // judgement about a client commitment — and stating it in a PSA note is a
  // false record.
  const nextStep = partial
    ? `Manual review required — see investigation findings below. Recommend follow-up within 1 business day. ${NO_REMEDIATION_NOTE}`
    : `Technician review required before closing. ${NO_REMEDIATION_NOTE}`;

  const ownership = ownershipLine(
    tech,
    partial ? 'investigation in progress' : 'investigation completed and findings documented'
  );

  let header = '';
  if (ticketNum) header = `**Ticket #${ticketNum}** — `;
  header += partial ? 'Investigation Notes (partial)' : 'Final Notes';

  const block = [
    `## ${header}`,
    '',
    '**Action Taken:**',
    `- ${actionTaken}`,
    '',
    '**Contact Attempt Details:**',
    `- No client or vendor contact was attempted. Automated investigation via Sentinel Override at ${stamp} (${stepCount} steps, ${apiCallCount} AI calls).`,
    '',
    '**Next Step and Time:**',
    `- ${nextStep}`,
    '',
    '**Ownership Statement:**',
    `- ${ownership}`,
    '',
    '---',
    '',
    '### Full investigation findings',
    '',
    summary || '(no summary)',
    '',
    (() => {
      try {
        // (audit) Only render a checklist that reflects real progress. The engine
        // does not track investigation-checklist state during a run, so the old
        // `|| parseInvestigationChecklist(goal)` fallback produced a fresh
        // all-pending checklist and appended "0% sections complete" to every
        // finished ticket — falsely reporting no progress. Show it only when a
        // caller supplies an actual (progressed) checklist.
        const checklist = options && options.investigationChecklist;
        if (checklist && checklist.isInvestigation && checklist.sections.length > 0) {
          return formatFindingsForReport(checklist) + '\n---';
        }
      } catch (_e) { /* non-fatal */ }
      return '';
    })(),
    '',
    '---',
    '',
    ...techSignature(tech)
  ].join('\n');

  return block;
}

// ── Ticket Mode Formatters (3.14.0) ──────────────────────────────────────
function _ticketHeader(ticketNum, label) {
  return ticketNum ? `**Ticket #${ticketNum}** — ${label}` : label;
}

function _ticketStamp() {
  return `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function _splitTriedSection(summary) {
  if (!summary || typeof summary !== 'string') return ['Pending technician input.'];
  const lines = summary.split(NEWLINE_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  const triedRe = TRIED_ACTION_RE;
  const matches = lines.filter(l => triedRe.test(l)).slice(0, 6);
  return matches.length ? matches : [(lines.length ? lines[0] : '').slice(0, 200)];
}

function formatTicketKickoff(summary, goal, tech, options) {
  const _opts = options || {};
  const ticketNum = extractTicketNumber(goal);
  const tried = _splitTriedSection(summary).map(s => `- ${s}`).join('\n');
  const sentences = (summary || '').split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  const tail = sentences.slice(-3);
  const pathLines = tail.length
    ? tail.map((s, i) => `${i + 1}. ${s.replace(WHITESPACE_NORMALIZE_RE, ' ').slice(0, 240)}`)
    // Labelled, because this is a boilerplate ladder that has nothing to do
    // with THIS ticket. Presenting it unmarked as "the fastest safe resolution
    // path" reads as an agent recommendation derived from the investigation.
    : ['_(generic checklist — this run produced no ticket-specific steps; replace before use)_',
       '1. Low-risk check (verify configuration, run diagnostics).',
       '2. Next step (apply targeted fix or escalate).',
       '3. Escalation/fix (vendor case, change request, or remediation)'];

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Ticket Kickoff')}`,
    '',
    '**MAIN ISSUE:**',
    `- ${getFirstLine(goal || '').slice(0, 280)}`,
    '',
    '**WHAT HAS BEEN TRIED:**',
    tried,
    '',
    '**FASTEST SAFE RESOLUTION PATH:**',
    pathLines.join('\n'),
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    ...techSignature(tech)
  ];
  return lines.join('\n');
}

function formatWaitingOnClient(summary, goal, tech, options) {
  const _opts = options || {};
  const ticketNum = extractTicketNumber(goal);
  const stamp = _ticketStamp();
  const firstSentence = getFirstSentence(summary || '').slice(0, 240) || 'Investigation in progress; awaiting client response.';
  const followUp = `${new Date(Date.now() + ONE_DAY_MS).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Waiting on Client')}`,
    '',
    '**Action Taken:**',
    `- ${firstSentence}`,
    '',
    '**Contact Attempt Details:**',
    `- No outbound contact was made by the agent. Automated investigation completed at ${stamp}; awaiting client confirmation or additional details.`,
    '',
    '**Next Step and Time:**',
    `- Follow up by ${followUp} (or sooner if client responds).`,
    '',
    '**Ownership Statement:**',
    `- ${ownershipLine(tech, 'will re-engage once client responds')}`,
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    ...techSignature(tech)
  ];
  return lines.join('\n');
}

function formatWaitingOnVendor(summary, goal, tech, options) {
  const _opts = options || {};
  const ticketNum = extractTicketNumber(goal);
  const stamp = _ticketStamp();
  const firstSentence = getFirstSentence(summary || '').slice(0, 240) || 'Diagnostics completed.';
  const followUp = `${new Date(Date.now() + ONE_DAY_MS).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Waiting on Vendor')}`,
    '',
    '**Action Taken:**',
    `- ${firstSentence}`,
    '',
    '**Contact Attempt Details:**',
    `- No vendor case was opened by the agent. Diagnostics captured at ${stamp} — open the vendor case and record its reference here.`,
    '',
    '**Next Step and Time:**',
    `- Follow up by ${followUp} (or on vendor response).`,
    '',
    '**Ownership Statement:**',
    `- ${ownershipLine(tech, 'will follow up with vendor and update ticket')}`,
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    ...techSignature(tech)
  ];
  return lines.join('\n');
}

function formatItGlueKb(summary, goal, tech, options) {
  const _opts = options || {};
  const goalShort = getFirstLine(goal || '').slice(0, 100);
  const ticketNum = extractTicketNumber(goal);
  const title = ticketNum ? `${goalShort} (Ref: Ticket #${ticketNum})` : goalShort;

  const lines = (summary || '').split(NEWLINE_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  const stepCandidates = lines.filter(l => /^(\d+[.)]|-|\*)\s+/.test(l)).slice(0, 8);
  const steps = stepCandidates.length
    ? stepCandidates.map((s, i) => `${i + 1}. ${s.replace(STEP_PREFIX_RE, '')}`)
    : (lines.slice(0, 5).map((s, i) => `${i + 1}. ${s}`));

  const envBits = [];
  if (ENV_M365_RE.test(goal || '')) envBits.push('Microsoft 365 / Entra ID');
  if (ENV_FIREWALL_RE.test(goal || '')) envBits.push('Firewall (vendor-specific)');
  if (ENV_EDR_RE.test(goal || '')) envBits.push('EDR platform');
  if (ENV_RMM_RE.test(goal || '')) envBits.push('RMM/PSA platform');
  if (ENV_EMAIL_SEC_RE.test(goal || '')) envBits.push('Email security (Proofpoint/Mimecast/Barracuda)');
  if (!envBits.length) envBits.push('General — see investigation findings for specifics');

  const out = [
    '## IT Glue Knowledge Base Entry',
    '',
    '**Title:**',
    `- ${(title || 'Untitled')}`,
    '',
    '**Issue:**',
    `- ${getFirstSentence(summary || '').slice(0, 240)}`,
    '',
    '**Environment:**',
    `- ${envBits.join('; ')}`,
    '',
    '**Resolution Steps:**',
    steps.length ? steps.join('\n') : '1. (steps not auto-derivable — fill in manually)',
    '',
    '**Verification:**',
    '- Confirm the configured state is present and the original symptom no longer reproduces.',
    '',
    '**Screenshots:**',
    '- (attach the agent\'s screenshots from the investigation report)',
    '',
    '---',
    '',
    '### Source — Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    hasTechIdentity(tech)
      ? `_Documented by ${techField(tech, 'name')} · ${techField(tech, 'company')}_`
      : '_Documented by Sentinel Override (automated) — no technician identity configured._'
  ];
  return out.join('\n');
}

function formatClientEmail(summary, goal, tech, options) {
  const _opts = options || {};
  const ticketNum = extractTicketNumber(goal);
  const ticketRef = ticketNum ? `Ticket #${ticketNum}` : 'your recent ticket';
  const ticketRefShort = ticketNum ? `Ticket #${ticketNum}` : 'your ticket';
  const briefIssue = getFirstLine(goal || '').replace(TICKET_PREFIX_RE, '').slice(0, 80) || 'your reported issue';
  const oneLine = getFirstSentence(summary || 'We have investigated the issue.').slice(0, 240);

  // This template is the highest-risk output in the product: it is drafted to
  // be sent verbatim to a paying client. It used to open with "has been
  // resolved" and close with "Everything is now working as expected" \u2014 two
  // unconditional factual claims about an outcome the agent never verified and
  // could not have produced, since it only reads pages. The subject line said
  // "Resolved:" for the same reason. All three are now honest, and the one
  // sentence that must state status is an explicit blank for the technician.
  const subject = `Update: ${ticketRefShort} \u2013 ${briefIssue}`;

  const body = [
    'Hello [Client Name],',
    '',
    `Here is an update on ${ticketRef}. ${oneLine}`,
    '',
    '[STATUS \u2014 complete this line before sending. The automated investigation cannot confirm whether the issue is resolved.]',
    '',
    `If you need further assistance, contact us at ${techField(tech, 'phone')} or ${techField(tech, 'email')}.`,
    '',
    'Best regards,',
    techField(tech, 'name'),
    techField(tech, 'title'),
    techField(tech, 'company'),
    `Phone: ${techField(tech, 'phone')} | Email: ${techField(tech, 'email')}`
  ];

  const block = [
    '## Client Email (DRAFT \u2014 do not send unedited)',
    '',
    `**Subject:** ${subject}`,
    '',
    '**Body:**',
    '',
    body.join('\n'),
    '',
    '---',
    '',
    '_Before sending: replace `[Client Name]`, complete the `[STATUS \u2026]` line, and check every bracketed field above._',
    ...(hasTechIdentity(tech)
      ? []
      : ['_\u26a0\ufe0f No technician details are configured \u2014 this draft has no valid sender identity or contact details. Set them in Settings \u2192 Ticket Mode._']),
    '',
    '_Investigation findings (for your reference, not in the email body):_',
    '',
    summary || '(no summary)'
  ];
  return block.join('\n');
}

// ── Dispatcher ───────────────────────────────────────────────────────────
function _autoPickFormat(summary, goal) {
  const text = `${goal} ${summary}`.toLowerCase();
  if (TICKET_VENDOR_RE.test(text)) return 'WAITING_ON_VENDOR';
  if (TICKET_CLIENT_RE.test(text)) return 'WAITING_ON_CLIENT';
  if (TICKET_ITGLUE_RE.test(text)) return 'IT_GLUE_KB';
  if (TICKET_EMAIL_RE.test(text)) return 'CLIENT_EMAIL';
  if (TICKET_KICKOFF_RE.test(text)) return 'TICKET_KICKOFF';
  return 'FINAL_NOTES';
}

function formatTicketOutput(format, summary, goal, tech, options) {
  const fmt = (format || 'auto').toString().toUpperCase();
  const resolved = (fmt === 'AUTO') ? _autoPickFormat(summary, goal) : fmt;
  switch (resolved) {
    case 'TICKET_KICKOFF':     return formatTicketKickoff(summary, goal, tech, options);
    case 'WAITING_ON_CLIENT':  return formatWaitingOnClient(summary, goal, tech, options);
    case 'WAITING_ON_VENDOR':  return formatWaitingOnVendor(summary, goal, tech, options);
    case 'IT_GLUE_KB':         return formatItGlueKb(summary, goal, tech, options);
    case 'CLIENT_EMAIL':       return formatClientEmail(summary, goal, tech, options);
    case 'FINAL_NOTES':
    default:                   return formatTicketFinalNotes(summary, goal, tech, options);
  }
}

export {
  isTicketInvestigationGoal,
  getTechnicianInfo,
  extractTicketNumber,
  formatTicketFinalNotes,
  formatTicketKickoff,
  formatWaitingOnClient,
  formatWaitingOnVendor,
  formatItGlueKb,
  formatClientEmail,
  formatTicketOutput,
  _autoPickFormat,
  getFirstLine,
  getFirstSentence,
};
