// report-print.js — extracted from the former inline <script> in
// report-print.html. MV3 extension pages enforce CSP `script-src 'self'`, which
// forbids inline scripts; while inline, this print view was blocked from
// executing and never rendered/printed the report. Keeping it external (same
// extension origin) satisfies the CSP.
(async function () {
  try {
    const stored = await chrome.storage.local.get(['_pendingPrintReport']);
    const data = stored && stored._pendingPrintReport;
    if (!data || !data.fullReport) {
      document.getElementById('reportBody').innerHTML = '<div class="loading" style="color:#b00;">No report available to print. Generate a report first, then click Export PDF.</div>';
      return;
    }
    const goalEl = document.getElementById('reportGoal');
    const tsEl = document.getElementById('reportTimestamp');
    if (goalEl) goalEl.textContent = data.goal || '';
    if (tsEl) tsEl.textContent = data.timestamp ? new Date(data.timestamp).toLocaleString() : '';

    // Render markdown -> HTML. The fallback matches report-view.js: the full
    // escapeHtml from lib/report-sanitize.js, not the old <-only replace.
    const html = window.marked && window.marked.parse
      ? window.marked.parse(data.fullReport)
      : escapeHtml(data.fullReport).replace(/\n/g, '<br>');

    // Decorate [src:key] / [unverified] markers as small inline chips
    // for paper-friendly auditability.
    const decorated = html
      .replace(/\[src:([a-z0-9_-]+)\]/gi, '<span class="src-chip">$1</span>')
      .replace(/\[unverified\]/gi, '<span class="src-unverified">unverified</span>');

    document.getElementById('reportBody').innerHTML = sanitizeReportHtml(decorated);

    // Trigger the print dialog after a brief render delay so styles
    // apply and the user sees the page first.
    setTimeout(() => { window.print(); }, 350);
  } catch (e) {
    // Built through the DOM: report-view.js escapes this message, but this
    // path concatenated it raw into innerHTML — an exception message can carry
    // fragments of the attacker-influenced report it choked on.
    const body = document.getElementById('reportBody');
    body.textContent = '';
    const div = document.createElement('div');
    div.className = 'loading';
    div.style.color = '#b00';
    div.textContent = 'Error loading report: ' + (e && e.message ? e.message : String(e));
    body.appendChild(div);
  }
})();

// sanitizeReportHtml lives in lib/report-sanitize.js (loaded by
// report-print.html before this file). One copy for both report pages —
// duplicated security functions drift.
