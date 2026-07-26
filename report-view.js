// report-view.js — extracted from the former inline <script> in report-view.html.
// MV3 extension pages enforce CSP `script-src 'self'`, which forbids inline
// scripts. While the script lived inline, the report tab was blocked from
// executing and stayed stuck on "Loading report…". Keeping it in this external
// file (same extension origin) satisfies the CSP.

// Theme: respect the user's theme-preference from the popup if available;
// default to dark for a comfortable reading experience.
(function initTheme() {
  try {
    chrome.storage.local.get(['theme-preference'], (r) => {
      if (r && r['theme-preference'] === 'light') {
        document.documentElement.classList.add('light-mode');
      }
    });
  } catch (e) {
    // localStorage fallback
    try {
      if (localStorage.getItem('theme-preference') === 'light') {
        document.documentElement.classList.add('light-mode');
      }
    } catch (ee) {}
  }
})();

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// (audit) The report body is built from LLM/page-derived text (untrusted) and
// rendered via marked into innerHTML. The extension CSP blocks inline script,
// but injected elements that auto-load external resources (e.g. <img src>) can
// still exfiltrate data under a permissive img-src, and injected markup can spoof
// the report. Strip code-executing / resource-loading elements and dangerous
// attributes before insertion.
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

let __currentReport = null;

(async function loadReport() {
  try {
    const stored = await chrome.storage.local.get(['_pendingViewReport', '_pendingPrintReport', 'last_agent_report']);
    // Prefer the view-specific key, fall back to print key, fall back to last_agent_report
    const data = (stored && stored._pendingViewReport) ||
                 (stored && stored._pendingPrintReport) ||
                 (stored && stored.last_agent_report);
    if (!data || !data.fullReport) {
      document.getElementById('reportBody').innerHTML =
        '<div class="loading" style="color:var(--warn-text);">No report available. Run an agent task first, then click "View Full Report".</div>';
      return;
    }
    __currentReport = data;
    const goalEl = document.getElementById('reportGoal');
    const tsEl = document.getElementById('reportTimestamp');
    const banner = document.getElementById('goalBanner');
    if (data.goal) {
      goalEl.textContent = data.goal;
      banner.style.display = 'block';
    }
    if (data.timestamp) tsEl.textContent = new Date(data.timestamp).toLocaleString();

    const html = window.marked && window.marked.parse
      ? window.marked.parse(data.fullReport)
      : escapeHtml(data.fullReport).replace(/\n/g, '<br>');

    // Decorate [src:key] / [unverified] markers as inline chips for
    // audit trail visibility.
    const decorated = html
      .replace(/\[src:([a-z0-9_-]+)\]/gi, '<span class="src-chip" title="Source: $1">$1</span>')
      .replace(/\[unverified\]/gi, '<span class="src-unverified">unverified</span>');

    document.getElementById('reportBody').innerHTML = sanitizeReportHtml(decorated);
    document.title = 'Sentinel Override — ' + (data.goal ? data.goal.substring(0, 60) : 'Investigation Report');
  } catch (e) {
    document.getElementById('reportBody').innerHTML =
      '<div class="loading" style="color:var(--warn-text);">Error loading report: ' +
      escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
  }
})();

// Button wiring
document.getElementById('copyMdBtn').addEventListener('click', async () => {
  if (!__currentReport || !__currentReport.fullReport) return;
  try {
    await navigator.clipboard.writeText(__currentReport.fullReport);
    const btn = document.getElementById('copyMdBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (e) {
    alert('Copy failed: ' + (e && e.message ? e.message : e));
  }
});

document.getElementById('downloadMdBtn').addEventListener('click', () => {
  if (!__currentReport || !__currentReport.fullReport) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `sentinel-report-${timestamp}.md`;
  const blob = new Blob([__currentReport.fullReport], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

document.getElementById('downloadJsonBtn').addEventListener('click', () => {
  if (!__currentReport || !__currentReport.structuredData) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `sentinel-report-${timestamp}.json`;
  const json = JSON.stringify(__currentReport.structuredData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

document.getElementById('printBtn').addEventListener('click', () => {
  window.print();
});

document.getElementById('themeBtn').addEventListener('click', () => {
  document.documentElement.classList.toggle('light-mode');
  try {
    const isLight = document.documentElement.classList.contains('light-mode');
    chrome.storage.local.set({ 'theme-preference': isLight ? 'light' : 'dark' });
  } catch (e) {}
});
