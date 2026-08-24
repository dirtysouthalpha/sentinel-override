// Sentinel Override — execute_js Risk Disclosure
//
// The runtime sandbox in content/execute-js-sandbox.js blocks bare-name access
// to privileged APIs. It is NOT a security boundary and never was: the code runs
// in the page's own MAIN world, so anything the page can do, code that escapes
// the wrapper can also do. Reflective routes out of it are trivial and
// well-known — `({}).constructor.constructor('return this')()` reconstructs
// Function and hands back the real global object, past every proxy trap.
//
// Freezing the intrinsics reachable from the wrapper would be an arms race in a
// context where the attacker (a mistaken or prompt-injected model) and the
// victim (the page) share a realm. The honest and more useful move is to make
// the operator's approval an INFORMED one: say plainly what approving does, and
// point at the specific constructs in the code that would leave the sandbox.
//
// This module is the detector behind that disclosure.

/**
 * Patterns that reach outside the sandbox, or that make code unreviewable.
 * Each carries the plain-English consequence, because "matched CONSTRUCTOR_RE"
 * helps nobody at 2am.
 */
const RISK_PATTERNS = [
  {
    id: 'reflective-function',
    re: /\.\s*constructor\s*(\[\s*['"]constructor['"]\s*\]|\.\s*constructor)/,
    label: 'Rebuilds the Function constructor via .constructor.constructor — this escapes the sandbox entirely.',
  },
  {
    id: 'function-ctor',
    re: /\b(?:new\s+)?Function\s*\(/,
    label: 'Constructs code from a string (Function) — runs with full page access.',
  },
  { id: 'eval', re: /\beval\s*\(/, label: 'Uses eval() — runs arbitrary code with full page access.' },
  { id: 'dynamic-import', re: /\bimport\s*\(/, label: 'Dynamically imports a module — can pull in and run remote code.' },
  { id: 'global-reach', re: /\b(?:globalThis|self|top|parent|frames|window)\s*\[/, label: 'Reaches the real global object by computed property — bypasses the name-based guards.' },
  { id: 'proto-walk', re: /\b__proto__\b|\bObject\s*\.\s*getPrototypeOf\s*\(/, label: 'Walks the prototype chain — a route to intrinsics the sandbox does not wrap.' },
  { id: 'network', re: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b/, label: 'Makes a network request — can send page data off-box.' },
  { id: 'storage', re: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\s*\.\s*cookie\b/, label: 'Reads or writes browser storage / cookies — can exfiltrate or forge a session.' },
  { id: 'obfuscation', re: /\batob\s*\(|\bString\s*\.\s*fromCharCode\s*\(|\\x[0-9a-f]{2}/i, label: 'Contains encoded or obfuscated text — what it does is not visible from reading it.' },
];

/**
 * Assess a block of execute_js code for constructs that defeat the sandbox.
 *
 * @param {string} code
 * @returns {{risks: Array<{id: string, label: string}>, escapesSandbox: boolean}}
 */
export function assessExecuteJsRisk(code) {
  const src = typeof code === 'string' ? code : '';
  const risks = [];
  for (const { id, re, label } of RISK_PATTERNS) {
    if (re.test(src)) risks.push({ id, label });
  }
  const ESCAPE_IDS = new Set(['reflective-function', 'function-ctor', 'eval', 'dynamic-import', 'global-reach', 'proto-walk']);
  return { risks, escapesSandbox: risks.some(r => ESCAPE_IDS.has(r.id)) };
}

/**
 * The disclosure text shown on the approval card.
 *
 * Two different truths depending on the answer:
 *  - Approving SKIPS the sandbox outright (that is what approvalGranted means
 *    in content/index.js), so approved code always has full page privileges.
 *  - Declining leaves the sandbox on, which stops an honest mistake but not a
 *    deliberate escape.
 *
 * @param {string} code
 * @returns {{headline: string, detail: string, risks: Array, escapesSandbox: boolean}}
 */
export function buildExecuteJsDisclosure(code) {
  const { risks, escapesSandbox } = assessExecuteJsRisk(code);

  const headline = escapesSandbox
    ? '⚠️ This code can leave the sandbox. Approving gives it full access to this page.'
    : 'Approving runs this with full access to the page — the sandbox is skipped for approved code.';

  const detail = [
    'What approval means:',
    '• Approve → the runtime sandbox is SKIPPED. The code runs with the same privileges as the page itself: cookies, storage, network, session.',
    '• Decline → the code is refused.',
    '',
    'About the sandbox (when code is not explicitly approved):',
    'It blocks bare access to fetch, storage, cookies, chrome and the window self-references. It is a guard-rail against a model making a mistake, NOT a security boundary — the code shares a JavaScript realm with the page, and reflective tricks such as ({}).constructor.constructor can reach the real globals regardless.',
    '',
    'Only approve code you have read and would run yourself in this tab.',
  ].join('\n');

  return { headline, detail, risks, escapesSandbox };
}
