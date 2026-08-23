// lib/report-sanitize.js — the ONE copy of the report HTML sanitizer.
//
// report-view.js and report-print.js each carried their own hand-copied
// sanitizeReportHtml. Two copies of a security function is how one of them
// quietly rots: a tag added to one strip list and not the other is an XSS that
// only fires in whichever page you didn't test. Same playbook as
// web/lib/dash-escape.js — a single classic script both pages load, plus a
// globalThis handle so the jest suite can import it and beat on it.
//
// Load order matters: this file must appear in a <script src> BEFORE the page
// script that calls sanitizeReportHtml.
//
// (audit) The report body is built from untrusted LLM/page-derived text and
// rendered via marked into innerHTML. The extension CSP blocks inline script,
// but injected elements that auto-load external resources (e.g. <img src>) can
// still exfiltrate data under a permissive img-src, and injected markup can
// spoof the report. Strip code-executing / resource-loading elements and
// dangerous attributes before insertion.
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

// In a browser classic script the function declaration above is already a
// global. The explicit handle is for Node/jest, where this file is imported as
// a module and top-level declarations stay module-scoped.
globalThis.ReportSanitize = { sanitizeReportHtml };
