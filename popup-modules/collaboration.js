// popup-modules/collaboration.js
// Export/import UI: file picker, import preview, conflict resolution, version warnings.
// Depends on: ui-common.js (showToast, sanitizeHtml).
// Communicates with background via chrome.runtime.sendMessage (collab_* actions).

// ========== Export Template ==========

/**
 * Export a single template as a downloadable JSON file.
 * @param {string} templateId
 */
async function exportTemplateFile(templateId) {
  try {
    const response = await sendMessage('collab_export_template', { id: templateId });
    if (!response.ok) throw new Error(response.error || 'Export failed');

    const data = response.data;
    const filename = sanitizeFilename(data.template.name) + '.json';
    downloadJson(data, filename);
    showToast('Template exported', 'success');
  } catch (err) {
    showToast(err.message || 'Export failed', 'error');
  }
}

/**
 * Export all templates as a batch JSON file.
 */
async function exportAllTemplatesFile() {
  try {
    const response = await sendMessage('collab_export_all_templates', {});
    if (!response.ok) throw new Error(response.error || 'Export failed');

    const data = response.data;
    const filename = 'sentinel-templates-' + new Date().toISOString().slice(0, 10) + '.json';
    downloadJson(data, filename);
    showToast(`${data.count} template(s) exported`, 'success');
  } catch (err) {
    showToast(err.message || 'Export failed', 'error');
  }
}

// ========== Import Template ==========

/**
 * Open file picker and handle template import flow.
 */
function openImportDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate import
      const validation = await sendMessage('collab_validate_import', { data: data });
      if (!validation.ok) {
        showToast(validation.error || 'Validation failed', 'error');
        return;
      }

      const result = validation.data;

      // Check for errors
      if (!result.safe) {
        showImportErrors(result);
        return;
      }

      // Check for version warnings
      if (result.warnings && result.warnings.length > 0) {
        showImportPreview(result, result.warnings);
      } else {
        showImportPreview(result, []);
      }
    } catch (err) {
      showToast('Failed to read file: ' + err.message, 'error');
    } finally {
      document.body.removeChild(input);
    }
  });

  input.click();
}

// ========== Export Report ==========

/**
 * Export the current report as a downloadable markdown file.
 * @param {{ summary: string, fullReport: string, goal: string, timestamp: string }} report
 */
async function exportReportFile(report) {
  if (!report || !report.fullReport) {
    showToast('No report to export', 'error');
    return;
  }

  try {
    const response = await sendMessage('collab_export_report', { report });
    if (!response.ok) throw new Error(response.error || 'Export failed');

    const markdown = response.data;
    const filename = 'report-' + new Date().toISOString().slice(0, 10) + '.md';
    downloadText(markdown, filename, 'text/markdown');
    showToast('Report exported', 'success');
  } catch (err) {
    showToast(err.message || 'Export failed', 'error');
  }
}

// ========== Import Preview Modal ==========

function showImportPreview(validationResult, warnings) {
  const templates = validationResult.templates || [];

  // Clear and populate preview
  const list = document.getElementById('import-preview-list');
  list.innerHTML = '';

  templates.forEach(t => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border-color);';

    const paramsText = (t.params && t.params.length > 0)
      ? `${t.params.length} param(s)`
      : 'No params';

    const tagsText = (t.tags && t.tags.length > 0)
      ? t.tags.map(tag => `<span class="template-tag">${escapeHtml(tag)}</span>`).join(' ')
      : '';

    row.innerHTML = `
      <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${escapeHtml(t.name)}</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;white-space:pre-wrap;max-height:40px;overflow:hidden;">${escapeHtml(t.goal)}</div>
      <div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text-tertiary);">
        <span>${paramsText}</span>
        ${tagsText}
      </div>
    `;
    list.appendChild(row);
  });

  // Show version warning if any
  const warningEl = document.getElementById('import-version-warning');
  if (warnings.length > 0) {
    warningEl.style.display = 'block';
    warningEl.innerHTML = warnings.map(w =>
      `<div style="font-size:12px;color:var(--warning-color);padding:4px 0;">⚠ ${escapeHtml(w)}</div>`
    ).join('');
  } else {
    warningEl.style.display = 'none';
  }

  // Store templates for import
  window.__importTemplates = templates;
  window.__importVersion = validationResult.version;

  document.getElementById('import-modal').classList.add('show');
}

function showImportErrors(result) {
  const errors = result.errors || [];
  if (errors.length === 0) return;

  const message = errors.length === 1
    ? errors[0]
    : `${errors.length} errors:\n` + errors.map((e, i) => `${i + 1}. ${e}`).join('\n');

  showToast(message, 'error');
}

// ========== Import Execution ==========

async function executeImport() {
  const templates = window.__importTemplates;
  if (!templates || templates.length === 0) return;

  const conflictMode = document.querySelector('input[name="import-conflict"]:checked')?.value || 'skip';

  try {
    const response = await sendMessage('collab_import_templates', {
      templates,
      conflictMode,
    });

    if (!response.ok) {
      showToast(response.error || 'Import failed', 'error');
      return;
    }

    const result = response.data;
    document.getElementById('import-modal').classList.remove('show');
    window.__importTemplates = null;

    const parts = [];
    if (result.imported > 0) parts.push(`${result.imported} imported`);
    if (result.renamed > 0) parts.push(`${result.renamed} renamed`);
    if (result.overwritten > 0) parts.push(`${result.overwritten} overwritten`);
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`);

    showToast(`Import complete: ${parts.join(', ')}`, 'success');

    // Refresh template list if templates panel is visible
    if (typeof loadTemplates === 'function') loadTemplates();
  } catch (err) {
    showToast(err.message || 'Import failed', 'error');
  }
}

// ========== Download Helpers ==========

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadText(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return (name || 'template')
    .replace(/[^a-z0-9_\-\s]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .substring(0, 80);
}

// ========== Message Helper ==========

function sendMessage(action, data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'No response' });
    });
  });
}

// ========== Event Wiring ==========

document.getElementById('closeImportModalBtn')?.addEventListener('click', () => {
  document.getElementById('import-modal')?.classList.remove('show');
});

document.getElementById('importConfirmBtn')?.addEventListener('click', () => {
  executeImport();
});

// ========== Window Exports ==========
window.exportTemplateFile = exportTemplateFile;
window.exportAllTemplatesFile = exportAllTemplatesFile;
window.openImportDialog = openImportDialog;
window.exportReportFile = exportReportFile;
