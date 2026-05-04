// popup-modules/templates.js
// Template library UI: list, search, filter, create, edit, run, delete.
// Depends on: ui-common.js (showToast, sanitizeHtml).
// Communicates with background via chrome.runtime.sendMessage (template_* actions).

// ========== Shared State ==========
const getState = () => window.__popupState;

// ========== Module-level State ==========
let editingTemplateId = null;
let runningTemplateId = null;

// ========== Relative Time Helper ==========
function relativeTime(timestamp) {
  if (!timestamp) return 'Never run';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ========== Panel Toggle ==========
function showTemplatesPanel() {
  document.getElementById('templates-panel').style.display = 'flex';
  document.getElementById('chat-container').style.display = 'none';
  document.getElementById('templatesBtn').classList.add('active');
  loadTemplates();
}

function hideTemplatesPanel() {
  document.getElementById('templates-panel').style.display = 'none';
  document.getElementById('chat-container').style.display = 'flex';
  document.getElementById('templatesBtn').classList.remove('active');
}

// ========== Template List ==========
function loadTemplates() {
  const searchTerm = document.getElementById('templateSearchInput').value.toLowerCase().trim();
  const tagFilter = document.getElementById('templateTagFilter').value.toLowerCase().trim();

  chrome.runtime.sendMessage({ action: 'template_list' }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error loading templates', 'error');
      return;
    }

    const templates = response && Array.isArray(response.templates) ? response.templates : [];
    const filtered = filterTemplates(templates, searchTerm, tagFilter);
    renderTemplateList(filtered);
  });
}

function filterTemplates(templates, searchTerm, tagFilter) {
  let result = templates;

  if (searchTerm) {
    result = result.filter(t =>
      t.name && t.name.toLowerCase().includes(searchTerm)
    );
  }

  if (tagFilter) {
    result = result.filter(t =>
      t.tags && Array.isArray(t.tags) && t.tags.some(tag =>
        tag.toLowerCase().includes(tagFilter)
      )
    );
  }

  return result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function renderTemplateList(templates) {
  const container = document.getElementById('template-list');

  if (!templates || templates.length === 0) {
    container.innerHTML = '<div class="template-empty">No templates yet. Create one from a completed task or build one from scratch.</div>';
    return;
  }

  container.innerHTML = '';
  templates.forEach(template => {
    const card = document.createElement('div');
    card.className = 'template-card';

    const tagsHtml = (template.tags && template.tags.length > 0)
      ? `<div class="template-card-tags">${template.tags.map(t => `<span class="template-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    card.innerHTML = `
      <div class="template-card-header">
        <div class="template-card-name">${escapeHtml(template.name)}</div>
        <div class="template-card-actions">
          <button class="small-btn" data-action="run" data-id="${template.id}" style="background:var(--accent-primary);color:white;border-color:var(--accent-primary);">Run</button>
          <button class="small-btn" data-action="edit" data-id="${template.id}">Edit</button>
          <button class="small-btn" data-action="delete" data-id="${template.id}" data-name="${escapeHtml(template.name)}" style="color:var(--error-color);">Delete</button>
        </div>
      </div>
      <div class="template-card-goal">${escapeHtml(template.goal)}</div>
      ${tagsHtml}
      <div class="template-card-meta">
        <span>Last used: ${relativeTime(template.lastUsedAt)}</span>
        <span>Runs: ${template.runCount || 0}</span>
        <span>${template.params && template.params.length > 0 ? template.params.length + ' param' + (template.params.length > 1 ? 's' : '') : 'No params'}</span>
      </div>
    `;

    // Wire card action buttons
    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'run') openRunModal(id);
        else if (action === 'edit') openEditTemplateModal(id);
        else if (action === 'delete') deleteTemplate(id, btn.dataset.name);
      });
    });

    container.appendChild(card);
  });
}

// ========== HTML Escape Helper ==========
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ========== Search and Filter ==========
document.getElementById('templateSearchInput').addEventListener('input', () => {
  loadTemplates();
});

document.getElementById('templateTagFilter').addEventListener('input', () => {
  loadTemplates();
});

// ========== Create Template ==========
function openCreateTemplateModal(goalText) {
  editingTemplateId = null;
  document.getElementById('template-modal-title').textContent = 'New Template';
  document.getElementById('tmpl-name').value = '';
  document.getElementById('tmpl-goal').value = goalText || '';
  document.getElementById('tmpl-tags').value = '';
  document.getElementById('tmpl-params-container').innerHTML = '';
  document.getElementById('template-modal').classList.add('show');
  updateParamEditor();
}

function saveNewTemplate() {
  const name = document.getElementById('tmpl-name').value.trim();
  const goal = document.getElementById('tmpl-goal').value.trim();
  const tagsStr = document.getElementById('tmpl-tags').value.trim();

  if (!name) {
    showToast('Template name is required', 'error');
    return;
  }
  if (!goal) {
    showToast('Template goal is required', 'error');
    return;
  }

  const tags = parseTags(tagsStr);

  chrome.runtime.sendMessage({
    action: 'template_save',
    template: { name, goal, tags }
  }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error saving template', 'error');
      return;
    }
    if (response && response.error) {
      showToast(response.error, 'error');
      return;
    }
    document.getElementById('template-modal').classList.remove('show');
    loadTemplates();
    showToast('Template saved', 'success');
  });
}

function parseTags(tagString) {
  if (!tagString) return [];
  return tagString.split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

// ========== Edit Template ==========
function openEditTemplateModal(templateId) {
  chrome.runtime.sendMessage({ action: 'template_get', id: templateId }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error loading template', 'error');
      return;
    }
    if (!response || !response.template) {
      showToast('Template not found', 'error');
      return;
    }

    const template = response.template;
    editingTemplateId = templateId;
    document.getElementById('template-modal-title').textContent = 'Edit Template';
    document.getElementById('tmpl-name').value = template.name || '';
    document.getElementById('tmpl-goal').value = template.goal || '';
    document.getElementById('tmpl-tags').value = (template.tags || []).join(', ');
    document.getElementById('template-modal').classList.add('show');
    updateParamEditor(template.params);
  });
}

function saveEditedTemplate() {
  const name = document.getElementById('tmpl-name').value.trim();
  const goal = document.getElementById('tmpl-goal').value.trim();
  const tagsStr = document.getElementById('tmpl-tags').value.trim();

  if (!name) {
    showToast('Template name is required', 'error');
    return;
  }
  if (!goal) {
    showToast('Template goal is required', 'error');
    return;
  }

  const tags = parseTags(tagsStr);

  chrome.runtime.sendMessage({
    action: 'template_update',
    id: editingTemplateId,
    updates: { name, goal, tags }
  }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error updating template', 'error');
      return;
    }
    if (response && response.error) {
      showToast(response.error, 'error');
      return;
    }
    editingTemplateId = null;
    document.getElementById('template-modal').classList.remove('show');
    loadTemplates();
    showToast('Template updated', 'success');
  });
}

// ========== Parameter Editor (create/edit modal) ==========
function updateParamEditor(existingParams) {
  const goalText = document.getElementById('tmpl-goal').value;
  const container = document.getElementById('tmpl-params-container');
  const regex = /:{2}(\w+):{2}/g;

  const seen = new Set();
  const keys = [];
  let match;
  while ((match = regex.exec(goalText)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      keys.push(match[1]);
    }
  }

  if (keys.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);">No parameters detected. Use ::key:: in the goal to add placeholders.</div>';
    return;
  }

  container.innerHTML = '';
  keys.forEach(key => {
    const label = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    // Look up default from existing params (when editing)
    const existing = (existingParams || []).find(p => p.key === key);
    const defaultValue = existing ? (existing.defaultValue || '') : '';

    const row = document.createElement('div');
    row.className = 'template-param-row';
    row.innerHTML = `
      <label>${escapeHtml(label)}</label>
      <input type="text" data-param-key="${key}" placeholder="Default value (optional)" value="${escapeHtml(defaultValue)}">
    `;
    container.appendChild(row);
  });
}

// Wire goal input to auto-detect params
document.getElementById('tmpl-goal').addEventListener('input', () => {
  updateParamEditor();
});

// ========== Run Template ==========
function openRunModal(templateId) {
  chrome.runtime.sendMessage({ action: 'template_get', id: templateId }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error loading template', 'error');
      return;
    }
    if (!response || !response.template) {
      showToast('Template not found', 'error');
      return;
    }

    const template = response.template;
    runningTemplateId = templateId;
    document.getElementById('template-run-title').textContent = 'Run: ' + template.name;
    document.getElementById('template-run-goal-preview').textContent = template.goal;

    const container = document.getElementById('tmpl-run-params-container');
    container.innerHTML = '';

    const params = template.params || [];
    if (params.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);">No parameters required. Click Run to execute.</div>';
    } else {
      params.forEach(param => {
        const row = document.createElement('div');
        row.className = 'template-param-row';
        row.innerHTML = `
          <label>${escapeHtml(param.label || param.key)}</label>
          <input type="text" data-run-param="${param.key}" placeholder="${escapeHtml(param.defaultValue || 'Enter value...')}" value="${escapeHtml(param.defaultValue || '')}">
        `;
        container.appendChild(row);
      });
    }

    document.getElementById('template-run-modal').classList.add('show');
  });
}

function executeTemplate() {
  if (!runningTemplateId) return;

  // Collect param values from inputs
  const params = {};
  const inputs = document.querySelectorAll('#tmpl-run-params-container input[data-run-param]');
  inputs.forEach(input => {
    params[input.dataset.runParam] = input.value;
  });

  chrome.runtime.sendMessage({
    action: 'template_run',
    templateId: runningTemplateId,
    params
  }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error running template', 'error');
      return;
    }
    if (response && response.error) {
      showToast(response.error, 'error');
      return;
    }
    runningTemplateId = null;
    document.getElementById('template-run-modal').classList.remove('show');
    hideTemplatesPanel();
    showToast('Template running...', 'success');
  });
}

// ========== Delete Template ==========
function deleteTemplate(templateId, templateName) {
  if (!confirm('Delete template "' + templateName + '"? This cannot be undone.')) {
    return;
  }

  chrome.runtime.sendMessage({
    action: 'template_delete',
    id: templateId
  }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message || 'Error deleting template', 'error');
      return;
    }
    if (response && response.error) {
      showToast(response.error, 'error');
      return;
    }
    loadTemplates();
    showToast('Template deleted', 'success');
  });
}

// ========== Event Wiring ==========
document.getElementById('createTemplateBtn').addEventListener('click', () => {
  openCreateTemplateModal();
});

document.getElementById('saveTemplateBtn').addEventListener('click', () => {
  if (editingTemplateId) {
    saveEditedTemplate();
  } else {
    saveNewTemplate();
  }
});

document.getElementById('closeTemplateModalBtn').addEventListener('click', () => {
  document.getElementById('template-modal').classList.remove('show');
  editingTemplateId = null;
});

document.getElementById('runTemplateBtn').addEventListener('click', () => {
  executeTemplate();
});

document.getElementById('closeRunModalBtn').addEventListener('click', () => {
  document.getElementById('template-run-modal').classList.remove('show');
  runningTemplateId = null;
});
