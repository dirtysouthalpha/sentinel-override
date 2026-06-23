// background/agent-network.js
// CDP Network Interception Module for Agent Engine.
// Captures API calls, XHR, and fetch requests via Chrome DevTools Protocol.
// Provides formatted network context for LLM observations.
//
// Dependencies: readNetworkRequests from tab-manager.js

import { readNetworkRequests } from './tab-manager.js';

// Keywords that indicate the agent goal involves API/network/debugging work.
// When any of these appear in the goal string, network monitoring is auto-enabled.
const NETWORK_KEYWORDS = [
  'api', 'apis', 'endpoint', 'endpoints',
  'network', 'request', 'requests',
  'debug', 'debugging', 'inspect',
  'xhr', 'fetch', 'ajax',
  'status code', 'error', 'errors',
  'failed', 'failure', 'timeout',
  'webhook', 'graphql', 'rest',
  'response', 'response code',
  'console error', 'network error',
  'http', 'https', 'curl',
  'ping', 'latency', 'latencies',
  'login', 'auth', 'token',
  'cors', 'headers'
];

// Compact format: method + status + url + duration
function _compactEntry(e) {
  const status = e.failed ? 'FAIL' : e.status || '---';
  const dur = e.duration_ms ? `${e.duration_ms}ms` : '';
  const err = e.error ? ` err=${e.error}` : '';
  return `${e.method || 'GET'} ${status} ${dur} ${e.url || ''}${err}`;
}

// Detailed format: includes type and error details
function _detailedEntry(e) {
  const parts = [
    `${e.method || 'GET'} ${e.status || '---'}`,
    e.url || '',
  ];
  if (e.type) parts.push(`[${e.type}]`);
  if (e.duration_ms != null) parts.push(`${e.duration_ms}ms`);
  (e.failed || (e.status >= 400 && e.status < 600)) && parts.push('FAILED');
  if (e.error) parts.push(`error: ${e.error}`);
  return parts.join(' ');
  // Compact alternative: `${e.method || 'GET'} ${e.status || '---'} ${e.type || ''} ${e.url || ''} ${e.duration_ms || 0}ms ${e.failed ? 'FAILED' : ''} ${e.error ? 'err=' + e.error : ''}`.trim();
}

/**
 * Determine if the agent goal warrants network monitoring.
 * Returns true if the goal contains any API/network/debugging keywords.
 *
 * @param {string} goal - The agent's goal string.
 * @returns {boolean}
 */
export function shouldReportNetwork(goal) {
  if (typeof goal !== 'string' || !goal.trim()) return false;
  const lower = goal.toLowerCase();
  return NETWORK_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Format raw CDP network requests into a compact, LLM-readable string.
 * Groups by failed-first, then recent-first.
 *
 * @param {Array<{method:string,url:string,status:number,type:string,duration_ms:number,failed:boolean,error:string}>} requests
 * @param {object} [opts] - Formatting options.
 * @param {number} [opts.maxEntries=15] - Maximum entries to include.
 * @param {boolean} [opts.includeFailedOnly=false] - If true, only show failed/errored requests.
 * @returns {string} Compact multi-line string, or empty string if no requests.
 */
export function formatNetworkForContext(requests, opts = {}) {
  if (!Array.isArray(requests) || requests.length === 0) return '';
  const maxEntries = opts.maxEntries || 15;
  const includeFailedOnly = opts.includeFailedOnly || false;

  let arr = requests;
  if (includeFailedOnly) {
    arr = arr.filter(e => e.failed || (e.status >= 400 && e.status < 600));
  }
  if (arr.length === 0) return '';

  // Sort: failed first, then most-recent first
  arr.sort((a, b) => {
    const aFail = a.failed || (a.status >= 400 && a.status < 600);
    const bFail = b.failed || (b.status >= 400 && b.status < 600);
    if (aFail && !bFail) return -1;
    if (!aFail && bFail) return 1;
    return 0; // preserve input order for same-priority entries
  });

  const lines = arr.slice(0, maxEntries).map(_compactEntry);
  const summary = `[Network Snapshot: ${arr.length} request${arr.length === 1 ? '' : 's'}${includeFailedOnly ? ' (failed only)' : ''}]`;
  return `${summary}\n${lines.join('\n')}`;
}

/**
 * Capture a formatted network snapshot for the current tab.
 * Reads the CDP network buffer and formats it for LLM context.
 *
 * @param {number} tabId - The tab to read network requests from.
 * @param {object} [opts] - Capture options.
 * @param {number} [opts.limit=30] - Max raw requests to read from buffer.
 * @param {number} [opts.maxEntries=15] - Max entries to format in output.
 * @returns {string} Formatted network snapshot string, or empty string if no data.
 */
export function captureNetworkSnapshot(tabId, opts = {}) {
  if (typeof tabId !== 'number') return '';
  const limit = opts.limit || 30;
  const maxEntries = opts.maxEntries || 15;
  const rawRequests = readNetworkRequests(tabId, { limit });
  if (!rawRequests || rawRequests.length === 0) return '';
  return formatNetworkForContext(rawRequests, { maxEntries });
}

/**
 * Convenience: capture network and return ONLY failed/errored requests.
 * Useful for error-driven debugging flows.
 *
 * @param {number} tabId
 * @returns {string} Formatted failed-only snapshot, or empty string.
 */
export function captureFailedRequests(tabId) {
  if (typeof tabId !== 'number') return '';
  const raw = readNetworkRequests(tabId, { limit: 20, filter: 'failed' });
  if (!raw || raw.length === 0) return '';
  return formatNetworkForContext(raw, { maxEntries: 10, includeFailedOnly: true });
}

// Export keyword list for testing
export const _internal = { NETWORK_KEYWORDS, _compactEntry, _detailedEntry };
