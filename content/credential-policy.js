// Sentinel Override — Credential Typing Policy
//
// The question this answers: can the agent type into input[type=password]?
//
// It could, and did, unconditionally. content/index.js detected the sensitive
// field, wrote a telemetry line — "proceeding per IT-tech authorization" — and
// typed anyway. Nobody had actually authorized anything: there was no setting,
// no prompt, and no way to say no. An autonomous agent driven by a remote model
// putting text into a password box, with the justification living only in a
// code comment, is not something an MSP can hand to a client's auditor.
//
// The capability itself is legitimate — filling a credential is real MSP work.
// What was missing is that it be DELIBERATE, LOGGED and CONSENTED. This module
// is the decision function for that, kept pure and window-global (like
// execute-js-sandbox.js) so it can be unit-tested by actually running it rather
// than by re-implementing it in a test file.

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.credPolicy = window.__sentinelUtils.credPolicy || {};

(function () {
  const api = window.__sentinelUtils.credPolicy;

  /** Policy values, stored at chrome.storage.local.credentialTypingPolicy. */
  const POLICY = {
    /** Default. Refuse and hand off to the human. */
    BLOCK: 'block',
    /** Ask the operator each time, showing the field and the page. */
    APPROVE: 'approve',
    /** Type it. Still logged to telemetry and the forensic run log. */
    ALLOW: 'allow',
  };

  /** Decisions the caller must act on. */
  const DECISION = {
    PROCEED: 'proceed',
    BLOCKED: 'blocked',
    NEEDS_APPROVAL: 'needs_approval',
  };

  /**
   * Decide what to do about typing into a field.
   *
   * @param {object} input
   * @param {string|null} input.sensitiveMatch - Keyword matched by the detector, or null.
   * @param {boolean} input.isPasswordInput - Whether the element is input[type=password].
   * @param {string} [input.policy] - Configured policy; unknown values fail safe to BLOCK.
   * @param {boolean} [input.approved] - True once the operator approved THIS request.
   * @returns {{decision: string, reason: string, sensitive: boolean, audit: boolean}}
   */
  function decideCredentialTyping(input) {
    const inp = input || {};
    const sensitive = !!(inp.isPasswordInput || inp.sensitiveMatch);

    if (!sensitive) {
      return { decision: DECISION.PROCEED, reason: 'not a sensitive field', sensitive: false, audit: false };
    }

    // An approval already granted for this exact request wins — that IS consent.
    if (inp.approved === true) {
      return { decision: DECISION.PROCEED, reason: 'operator approved this request', sensitive: true, audit: true };
    }

    // Unknown / missing policy fails safe. A typo in storage must not silently
    // re-enable unattended credential entry.
    const policy = [POLICY.BLOCK, POLICY.APPROVE, POLICY.ALLOW].includes(inp.policy)
      ? inp.policy
      : POLICY.BLOCK;

    if (policy === POLICY.ALLOW) {
      return { decision: DECISION.PROCEED, reason: 'policy=allow (logged)', sensitive: true, audit: true };
    }
    if (policy === POLICY.APPROVE) {
      return { decision: DECISION.NEEDS_APPROVAL, reason: 'policy=approve', sensitive: true, audit: true };
    }
    return { decision: DECISION.BLOCKED, reason: 'policy=block', sensitive: true, audit: true };
  }

  /**
   * The message returned to the agent (and shown to the operator) when typing
   * is refused. Written so the MODEL can act on it: it names the handoff, so a
   * planner reads "ask the human" rather than "retry with a different selector".
   *
   * @param {string} what - Short description of the field.
   * @returns {string}
   */
  function blockedMessage(what) {
    return `BLOCKED: refusing to type into a credential field (${what}). `
      + 'Sentinel Override does not enter passwords or secrets unattended. '
      + 'HUMAN HANDOFF REQUIRED: ask the operator to type it, then continue. '
      + 'Do not retry this action, and do not attempt another selector for the same field. '
      + 'An operator can change this in Settings → Privacy & Data Protection → Credential typing.';
  }

  api.POLICY = POLICY;
  api.DECISION = DECISION;
  api.decideCredentialTyping = decideCredentialTyping;
  api.blockedMessage = blockedMessage;
})();
