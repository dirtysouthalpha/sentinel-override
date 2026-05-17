/**
 * Sentinel Override — Export run report as HTML.
 * Generates a sharable, styled HTML report from the audit log.
 */

export function generateHtmlReport(auditLog, metadata) {
  const {
    goal = 'Unknown',
    startTime,
    endTime,
    totalSteps = 0,
    status = 'completed',
    trustScore = null,
  } = metadata;

  const duration = startTime && endTime
    ? Math.round((new Date(endTime) - new Date(startTime)) / 1000)
    : 0;
  const durationStr = duration > 60
    ? `${Math.floor(duration / 60)}m ${duration % 60}s`
    : `${duration}s`;

  const steps = auditLog.map((entry, i) => {
    const stepClass = entry.actionFailed ? 'step-failed' : 'step-ok';
    const icon = entry.actionFailed ? '❌' : '✅';
    const actionName = entry.action?.type || entry.action || 'unknown';
    const params = entry.action?.params
      ? Object.entries(entry.action.params)
          .map(([k, v]) => `<span class="param"><strong>${k}:</strong> ${truncate(String(v), 60)}</span>`)
          .join(', ')
      : '';
    const screenshot = entry.screenshot
      ? `<div class="screenshot"><img src="${entry.screenshot}" alt="Step ${i + 1}" loading="lazy" /></div>`
      : '';
    const result = entry.result
      ? `<div class="result">${truncate(String(entry.result), 200)}</div>`
      : '';

    return `
      <div class="step ${stepClass}">
        <div class="step-header">
          <span class="step-icon">${icon}</span>
          <span class="step-num">#${i + 1}</span>
          <span class="step-action">${actionName}</span>
          ${params ? `<span class="step-params">${params}</span>` : ''}
          <span class="step-time">${entry.duration ? `${entry.duration}ms` : ''}</span>
        </div>
        ${result}
        ${screenshot}
      </div>`;
  }).join('');

  const trustBadge = trustScore !== null
    ? `<div class="trust-badge trust-${trustScore >= 80 ? 'high' : trustScore >= 50 ? 'mid' : 'low'}">
        Trust: ${trustScore}%
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sentinel Override — Run Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --border: #334155;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --brand: #818cf8;
      --success: #34d399;
      --error: #f87171;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    .header { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }
    .header h1 span { color: var(--brand); }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-top: 1rem; }
    .meta-item { background: var(--surface); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border); }
    .meta-item .label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-item .value { font-size: 1.1rem; font-weight: 600; margin-top: 0.25rem; }
    .goal { background: var(--surface); padding: 1rem; border-radius: 8px; border-left: 3px solid var(--brand); margin-bottom: 2rem; }
    .goal strong { color: var(--brand); }
    .steps { display: flex; flex-direction: column; gap: 0.75rem; }
    .step { background: var(--surface); border-radius: 8px; padding: 0.75rem 1rem; border: 1px solid var(--border); }
    .step-failed { border-color: var(--error); border-left: 3px solid var(--error); }
    .step-ok { border-left: 3px solid var(--success); }
    .step-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .step-icon { font-size: 0.9rem; }
    .step-num { color: var(--muted); font-size: 0.8rem; }
    .step-action { font-weight: 600; color: var(--brand); }
    .step-params { font-size: 0.8rem; color: var(--muted); }
    .step-params .param { margin-right: 0.5rem; }
    .step-time { margin-left: auto; font-size: 0.75rem; color: var(--muted); }
    .result { font-size: 0.85rem; color: var(--muted); margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 4px; max-height: 100px; overflow: hidden; }
    .screenshot { margin-top: 0.5rem; }
    .screenshot img { max-width: 100%; border-radius: 4px; border: 1px solid var(--border); }
    .trust-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.8rem; font-weight: 600; }
    .trust-high { background: rgba(52, 211, 153, 0.15); color: var(--success); }
    .trust-mid { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    .trust-low { background: rgba(248, 113, 113, 0.15); color: var(--error); }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.8rem; color: var(--muted); text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ Sentinel <span>Override</span> — Run Report</h1>
      ${trustBadge}
      <div class="meta">
        <div class="meta-item">
          <div class="label">Steps</div>
          <div class="value">${totalSteps}</div>
        </div>
        <div class="meta-item">
          <div class="label">Duration</div>
          <div class="value">${durationStr}</div>
        </div>
        <div class="meta-item">
          <div class="label">Status</div>
          <div class="value">${status}</div>
        </div>
        <div class="meta-item">
          <div class="label">Date</div>
          <div class="value">${startTime ? new Date(startTime).toLocaleDateString() : 'N/A'}</div>
        </div>
      </div>
    </div>
    <div class="goal">
      <strong>Goal:</strong> ${escapeHtml(goal)}
    </div>
    <div class="steps">
      ${steps}
    </div>
    <div class="footer">
      Generated by Sentinel Override v3.44.0 · ${new Date().toISOString()}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
