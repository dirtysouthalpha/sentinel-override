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
const ENV_M365_RE = /m365|microsoft|entra|exchange|defender|purview/i;
const ENV_FIREWALL_RE = /sonicwall|fortigate|firewall/i;
const ENV_EDR_RE = /sentinelone|crowdstrike|defender for endpoint/i;
const ENV_RMM_RE = /connectwise|ninjaone|kaseya|datto/i;
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

async function getTechnicianInfo() {
  const defaults = {
    name: 'John Smith',
    title: 'IT Support Technician',
    company: 'Acme IT',
    phone: '555-000-0000',
    email: 'support@example.com'
  };
  try {
    const stored = await chrome.storage.local.get(['technicianInfo']);
    if (stored && stored.technicianInfo && typeof stored.technicianInfo === 'object' && stored.technicianInfo !== null) {
      return { ...defaults, ...stored.technicianInfo };
    }
  } catch (_e) { /* storage read non-fatal */ }
  return defaults;
}

function extractTicketNumber(goal) {
  if (!goal) return '';
  const m = goal.match(TICKET_NUMBER_RE1)
         || goal.match(TICKET_NUMBER_RE2);
  return m ? m[1] : '';
}

// ── FINAL_NOTES format ───────────────────────────────────────────────────
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

  const nextStep = partial
    ? 'Manual review required — see investigation findings below. Recommend follow-up within 1 business day.'
    : 'None required. Ticket closed pending client confirmation.';

  const ownership = `${tech.name} (${tech.title}, ${tech.company}) — ${partial ? 'investigation in progress' : 'investigation completed and findings documented'}.`;

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
    `- Automated investigation via Sentinel Override agent at ${stamp} (${stepCount} steps, ${apiCallCount} AI calls).`,
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
    '---',
    '',
    `_${tech.name} · ${tech.title} · ${tech.company}_`,
    `_Phone: ${tech.phone} · Email: ${tech.email}_`
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
    : ['1. Low-risk check (verify configuration, run diagnostics).', '2. Next step (apply targeted fix or escalate).', '3. Escalation/fix (vendor case, change request, or remediation)'];

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
    `_${tech.name} · ${tech.title} · ${tech.company}_`,
    `_Phone: ${tech.phone} · Email: ${tech.email}_`
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
    `- Automated investigation completed at ${stamp}. Awaiting client confirmation or additional details.`,
    '',
    '**Next Step and Time:**',
    `- Follow up by ${followUp} (or sooner if client responds).`,
    '',
    '**Ownership Statement:**',
    `- ${tech.name} (${tech.title}, ${tech.company}) — will re-engage once client responds.`,
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_ ${tech.name} · Phone: ${tech.phone} · Email: ${tech.email}_`
  ];
  return lines.join('\n');
}

function formatWaitingOnVendor(summary, goal, tech, options) {
  const _opts = options || {};
  const ticketNum = extractTicketNumber(goal);
  const stamp = _ticketStamp();
  const firstSentence = getFirstSentence(summary || '').slice(0, 240) || 'Diagnostics completed; vendor case opened.';
  const followUp = `${new Date(Date.now() + ONE_DAY_MS).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Waiting on Vendor')}`,
    '',
    '**Action Taken:**',
    `- ${firstSentence}`,
    '',
    '**Contact Attempt Details:**',
    `- Vendor case opened at ${stamp}. Awaiting vendor response / ETA.`,
    '',
    '**Next Step and Time:**',
    `- Follow up by ${followUp} (or on vendor response).`,
    '',
    '**Ownership Statement:**',
    `- ${tech.name} (${tech.title}, ${tech.company}) — will follow up with vendor and update ticket.`,
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_ ${tech.name} · Phone: ${tech.phone} · Email: ${tech.email}_`
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
    `_Documented by ${tech.name} · ${tech.company}_`
  ];
  return out.join('\n');
}

function formatClientEmail(summary, goal, tech, options) {
  const _opts = options || {};
  const ticketNum = extractTicketNumber(goal);
  const ticketRef = ticketNum ? `Ticket #${ticketNum}` : 'your recent ticket';
  const ticketRefShort = ticketNum ? `Ticket #${ticketNum}` : 'your ticket';
  const briefIssue = getFirstLine(goal || '').replace(TICKET_PREFIX_RE, '').slice(0, 80) || 'your reported issue';
  const oneLine = getFirstSentence(summary || 'The issue has been investigated and addressed.').slice(0, 240);

  const subject = `Resolved: ${ticketRefShort} \u2013 ${briefIssue}`;

  const body = [
    'Hello [Client Name],',
    '',
    `The issue reported in ${ticketRef} has been resolved. ${oneLine}`,
    '',
    `Everything is now working as expected. If you need further assistance, contact us at ${tech.phone} or ${tech.email}.`,
    '',
    'Best regards,',
    tech.name,
    tech.title,
    tech.company,
    `Phone: ${tech.phone} | Email: ${tech.email}`
  ];

  const block = [
    '## Client Email',
    '',
    `**Subject:** ${subject}`,
    '',
    '**Body:**',
    '',
    body.join('\n'),
    '',
    '---',
    '',
    '_Replace `[Client Name]` before sending. Investigation findings (for your reference, not in email body):_',
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
