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

    // Render markdown -> HTML
    const html = window.marked && window.marked.parse
      ? window.marked.parse(data.fullReport)
      : data.fullReport.replace(/</g, '&lt;');

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
    document.getElementById('reportBody').innerHTML = '<div class="loading" style="color:#b00;">Error loading report: ' + (e && e.message ? e.message : e) + '</div>';
  }
})();

// (audit) The report body is built from untrusted LLM/page-derived text and
// rendered via marked into innerHTML. Strip code-executing / resource-loading
// elements and dangerous attributes before insertion (see report-view.js).
function sanitizeReportHtml(dirty) {
  if (!dirty) return '';
  const doc = new DOMParser().parseFromString(String(dirty), 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,link,base,meta,svg,math,img,source,video,audio,track,input,button,textarea,style').forEach((el) => el.remove());
  const URL_ATTR = /^(href|src|srcset|action|formaction|xlink:href|background|poster)$/i;
  const BAD_PROTO = /^\s*(javascript|data|vbscript)\s*:/i;
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'style') { el.removeAttribute(attr.name); continue; }
      if (URL_ATTR.test(name) && BAD_PROTO.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}
