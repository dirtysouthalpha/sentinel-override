// popup-modules/scheduler-ui.js
// Schedule management UI: list, create, enable/disable, delete, run history.
// Communicates with background via chrome.runtime.sendMessage (schedule_* actions).

// ========== Module-level State ==========
let refreshIntervalId = null;
let templatesCache = [];

// ========== Countdown / Relative Time Helpers ==========
// formatCountdown, relativeTime, formatDuration are in window.Helpers (popup-modules/helpers.js)

// ========== Panel Toggle ==========
function showSchedulesPanel() {
  document.getElementById('schedules-panel').style.display = 'flex';
  document.getElementById('chat-container').style.display = 'none';
  document.getElementById('input-area').style.display = 'none';
  document.getElementById('templates-panel').style.display = 'none';
  document.getElementById('templatesBtn')?.classList.remove('active');
  document.getElementById('schedulerBtn')?.classList.add('active');

  // Load templates for the create form dropdown
  loadTemplatesCache();

  // Load and render schedules
  loadAndRenderSchedules();

  // Clear notification badge
  chrome.runtime.sendMessage({ action: 'schedule_clear_badge' });

  // Start refresh interval for countdown timers
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  refreshIntervalId = setInterval(() => {
    loadAndRenderSchedules();
  }, 30000);
}

function hideSchedulesPanel() {
  document.getElementById('schedules-panel').style.display = 'none';
  document.getElementById('chat-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('schedulerBtn')?.classList.remove('active');
  document.getElementById('templates-panel').style.display = 'none';
  document.getElementById('templatesBtn')?.classList.remove('active');

  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

// ========== Templates Cache ==========
function loadTemplatesCache() {
  chrome.runtime.sendMessage({ action: 'template_list' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.ok && Array.isArray(response.data)) {
      templatesCache = response.data;
    }
  });
}

// ========== Schedule List ==========
async function loadAndRenderSchedules() {
  const container = document.getElementById('schedule-list');
  if (!container) return;

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'schedule_list' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });

    const schedules = (response && response.ok && Array.isArray(response.data))
      ? response.data
      : [];

    if (schedules.length === 0) {
      container.innerHTML = '<div class="schedule-empty">No schedules yet. Click + New Schedule to create one.</div>';
      return;
    }

    container.innerHTML = '';
    schedules.forEach(schedule => {
      const card = document.createElement('div');
      card.className = 'schedule-card' + (schedule.enabled ? '' : ' disabled');
      card.innerHTML = renderScheduleCard(schedule);
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="schedule-empty" style="color:var(--error-color);">Error loading schedules: ${escapeHtml((err && err.message) || String(err))}</div>`;
  }
}

function renderScheduleCard(schedule) {
  const goalPreview = schedule.goal
    ? escapeHtml(schedule.goal.length > 80 ? schedule.goal.substring(0, 80) + '...' : schedule.goal)
    : (schedule.templateId ? '<em>Template task</em>' : '<em>No goal</em>');

  // Recurrence display
  let recurrenceText = '';
  if (schedule.type === 'once') {
    recurrenceText = 'Once';
  } else if (schedule.recurrence) {
    const r = schedule.recurrence;
    if (r.interval === 'daily') {
      recurrenceText = `Daily at ${r.time || '09:00'}`;
    } else if (r.interval === 'weekly' && r.daysOfWeek && r.daysOfWeek.length > 0) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = r.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ');
      recurrenceText = `Weekly on ${days} at ${r.time || '09:00'}`;
    } else if (r.interval === 'custom') {
      recurrenceText = `Every ${r.periodInMinutes || 60} minutes`;
    } else {
      recurrenceText = 'Recurring';
    }
  }

  // Next run countdown
  const nextRunText = schedule.enabled
    ? formatCountdown(schedule.nextRunAt)
    : (schedule.nextRunAt ? 'Disabled' : 'Not scheduled');

  // Last run status badge
  let statusBadge = '';
  if (schedule.lastRunStatus) {
    const statusClass = schedule.lastRunStatus;
    const statusLabel = schedule.lastRunStatus.charAt(0).toUpperCase() + schedule.lastRunStatus.slice(1);
    statusBadge = `<span class="schedule-status-badge ${statusClass}">${statusLabel}</span>`;
  }

  // Toggle checkbox
  const toggleChecked = schedule.enabled ? 'checked' : '';

  return `
    <div class="schedule-card-header">
      <div class="schedule-card-name">${escapeHtml(schedule.name)}</div>
      <label class="toggle-switch" style="flex-shrink:0;">
        <input type="checkbox" data-action="toggle" data-id="${schedule.id}" ${toggleChecked}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="schedule-card-goal">${goalPreview}</div>
    <div class="schedule-card-meta">
      <span>${recurrenceText}</span>
      <span>${nextRunText}</span>
      ${schedule.lastRunAt ? `<span>Last run: ${relativeTime(schedule.lastRunAt)}</span>` : ''}
      ${statusBadge}
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">
      <button class="small-btn" data-action="history" data-id="${schedule.id}" data-name="${escapeHtml(schedule.name)}">History</button>
      <button class="small-btn" data-action="delete" data-id="${schedule.id}" data-name="${escapeHtml(schedule.name)}" style="color:var(--error-color);">Delete</button>
    </div>
  `;
}

// ========== Event Delegation for Schedule List ==========
document.getElementById('schedules-panel').addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;

  if (action === 'toggle') {
    // Checkbox change is handled separately below
    return;
  }
  if (action === 'history') {
    showRunHistory(id, target.dataset.name);
  } else if (action === 'delete') {
    handleDeleteSchedule(id, target.dataset.name);
  }
});

// Handle toggle checkbox changes (change event)
document.getElementById('schedules-panel').addEventListener('change', (e) => {
  const target = e.target.closest('[data-action="toggle"]');
  if (!target) return;

  const id = target.dataset.id;
  const enabled = target.checked;
  handleToggleSchedule(id, enabled);
});

// ========== Create Schedule Modal ==========
function openCreateScheduleModal() {
  document.getElementById('schedule-modal-title').textContent = 'New Schedule';
  document.getElementById('sch-name').value = '';
  document.getElementById('sch-source-type').value = 'template';
  document.getElementById('sch-goal').value = '';
  document.getElementById('sch-type').value = 'once';
  document.getElementById('sch-run-at').value = '';
  document.getElementById('sch-interval').value = 'daily';
  document.getElementById('sch-time').value = '09:00';
  document.getElementById('sch-period').value = '60';
  document.getElementById('sch-template-params').innerHTML = '';

  // Reset day checkboxes
  document.querySelectorAll('.sch-day-check').forEach(cb => { cb.checked = false; });

  // Reset field visibility
  document.getElementById('sch-template-field').style.display = '';
  document.getElementById('sch-goal-field').style.display = 'none';
  document.getElementById('sch-once-fields').style.display = '';
  document.getElementById('sch-recurring-fields').style.display = 'none';
  document.getElementById('sch-weekly-days').style.display = 'none';
  document.getElementById('sch-custom-interval').style.display = 'none';

  // Set min datetime to now
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const minDatetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  document.getElementById('sch-run-at').min = minDatetime;

  // Populate template dropdown
  populateTemplateDropdown();

  // Show modal
  document.getElementById('schedule-modal').classList.add('show');
}

function openCreateScheduleModalForTemplate(templateId, templateName) {
  openCreateScheduleModal();

  // Pre-select the template
  const dropdown = document.getElementById('sch-template-id');
  dropdown.value = templateId;

  // Pre-fill name
  if (templateName) {
    document.getElementById('sch-name').value = templateName + ' Schedule';
  }

  // Trigger change to load template params
  dropdown.dispatchEvent(new Event('change'));
}

function populateTemplateDropdown() {
  const dropdown = document.getElementById('sch-template-id');
  if (!dropdown) return;
  dropdown.innerHTML = '<option value="">-- Select a template --</option>';

  chrome.runtime.sendMessage({ action: 'template_list' }, (response) => {
    if (chrome.runtime.lastError) {
      dropdown.innerHTML = '<option value="">Error loading templates</option>';
      return;
    }

    const templates = (response && response.ok && Array.isArray(response.data))
      ? response.data
      : [];

    templatesCache = templates;

    templates.forEach(t => {
      const option = document.createElement('option');
      option.value = t.id;
      option.textContent = t.name;
      dropdown.appendChild(option);
    });

    if (templates.length === 0) {
      dropdown.innerHTML = '<option value="">No templates available</option>';
    }
  });
}

// ========== Form Field Toggling ==========

// Source type: template vs goal
document.getElementById('sch-source-type')?.addEventListener('change', (e) => {
  const isTemplate = e.target.value === 'template';
  const tf = document.getElementById('sch-template-field');
  const gf = document.getElementById('sch-goal-field');
  if (tf) tf.style.display = isTemplate ? '' : 'none';
  if (gf) gf.style.display = isTemplate ? 'none' : '';
});

// Schedule type: once vs recurring
document.getElementById('sch-type')?.addEventListener('change', (e) => {
  const isOnce = e.target.value === 'once';
  const onceFields = document.getElementById('sch-once-fields');
  const recFields = document.getElementById('sch-recurring-fields');
  if (onceFields) onceFields.style.display = isOnce ? '' : 'none';
  if (recFields) recFields.style.display = isOnce ? 'none' : '';

  if (!isOnce) {
    const weeklyDays = document.getElementById('sch-weekly-days');
    const customInterval = document.getElementById('sch-custom-interval');
    const intervalEl = document.getElementById('sch-interval');
    if (weeklyDays) weeklyDays.style.display = 'none';
    if (customInterval) customInterval.style.display = 'none';
    if (intervalEl) intervalEl.value = 'daily';
  }
});

// Interval: daily vs weekly vs custom
document.getElementById('sch-interval')?.addEventListener('change', (e) => {
  const interval = e.target.value;
  const weeklyDays = document.getElementById('sch-weekly-days');
  const customInterval = document.getElementById('sch-custom-interval');
  if (weeklyDays) weeklyDays.style.display = interval === 'weekly' ? '' : 'none';
  if (customInterval) customInterval.style.display = interval === 'custom' ? '' : 'none';
});

// Template selection: load params
document.getElementById('sch-template-id')?.addEventListener('change', (e) => {
  const templateId = e.target.value;
  const container = document.getElementById('sch-template-params');
  if (!container) return;

  if (!templateId) {
    container.innerHTML = '';
    return;
  }

  // Find template from cache or fetch
  const cached = templatesCache.find(t => t.id === templateId);
  if (cached && cached.params && cached.params.length > 0) {
    renderTemplateParams(cached.params);
  } else {
    container.innerHTML = '';
  }
});

function renderTemplateParams(params) {
  const container = document.getElementById('sch-template-params');
  if (!container) return;
  container.innerHTML = '';

  params.forEach(param => {
    const row = document.createElement('div');
    row.className = 'template-param-row';
    row.style.marginTop = '8px';
    row.innerHTML = `
      <label>${escapeHtml(param.label || param.key)}</label>
      <input type="text" data-sch-param="${param.key}" placeholder="${escapeHtml(param.defaultValue || 'Enter value...')}" value="${escapeHtml(param.defaultValue || '')}">
    `;
    container.appendChild(row);
  });
}

// ========== Save Schedule ==========
async function handleSaveSchedule() {
  const name = document.getElementById('sch-name').value.trim();
  if (!name) {
    showToast('Schedule name is required', 'error');
    return;
  }

  const sourceType = document.getElementById('sch-source-type').value;
  const schType = document.getElementById('sch-type').value;

  // Build schedule data
  const scheduleData = { name, type: schType };

  if (sourceType === 'template') {
    const templateId = document.getElementById('sch-template-id').value;
    if (!templateId) {
      showToast('Please select a template', 'error');
      return;
    }
    scheduleData.templateId = templateId;

    // Collect params
    const params = {};
    document.querySelectorAll('#sch-template-params input[data-sch-param]').forEach(input => {
      params[input.dataset.schParam] = input.value;
    });
    scheduleData.params = Object.keys(params).length > 0 ? params : null;
  } else {
    const goal = document.getElementById('sch-goal').value.trim();
    if (!goal) {
      showToast('Goal is required', 'error');
      return;
    }
    scheduleData.goal = goal;
  }

  // Time configuration
  if (schType === 'once') {
    const runAtValue = document.getElementById('sch-run-at').value;
    if (!runAtValue) {
      showToast('Please select a date and time', 'error');
      return;
    }
    scheduleData.runAt = new Date(runAtValue).getTime();
    if (scheduleData.runAt <= Date.now()) {
      showToast('Date and time must be in the future', 'error');
      return;
    }
  } else {
    // Recurring
    const interval = document.getElementById('sch-interval').value;
    const time = document.getElementById('sch-time').value || '09:00';

    const recurrence = { interval, time };

    if (interval === 'weekly') {
      const days = [];
      document.querySelectorAll('.sch-day-check:checked').forEach(cb => {
        days.push(parseInt(cb.value, 10));
      });
      if (days.length === 0) {
        showToast('Please select at least one day of the week', 'error');
        return;
      }
      recurrence.daysOfWeek = days;
    }

    if (interval === 'custom') {
      const period = parseInt(document.getElementById('sch-period').value, 10);
      if (!period || period < 30) {
        showToast('Custom interval must be at least 30 minutes', 'error');
        return;
      }
      recurrence.periodInMinutes = period;
    }

    scheduleData.recurrence = recurrence;
  }

  // Send create request
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'schedule_create', schedule: scheduleData }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });

    if (!response || !response.ok) {
      showToast((response && response.error) || 'Failed to create schedule', 'error');
      return;
    }

    // Close modal and refresh
    document.getElementById('schedule-modal').classList.remove('show');
    loadAndRenderSchedules();
    showToast('Schedule created', 'success');
  } catch (err) {
    showToast('Error creating schedule: ' + ((err && err.message) || String(err)), 'error');
  }
}

// ========== Toggle Schedule ==========
async function handleToggleSchedule(scheduleId, enabled) {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'schedule_toggle', id: scheduleId, enabled }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });

    if (!response || !response.ok) {
      showToast((response && response.error) || 'Failed to toggle schedule', 'error');
      return;
    }

    loadAndRenderSchedules();
    showToast(enabled ? 'Schedule enabled' : 'Schedule disabled', 'success');
  } catch (err) {
    showToast('Error toggling schedule: ' + ((err && err.message) || String(err)), 'error');
  }
}

// ========== Delete Schedule ==========
async function handleDeleteSchedule(scheduleId, name) {
  if (!confirm(`Delete schedule "${name}"? This cannot be undone.`)) {
    return;
  }

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'schedule_delete', id: scheduleId }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });

    if (!response || !response.ok) {
      showToast((response && response.error) || 'Failed to delete schedule', 'error');
      return;
    }

    loadAndRenderSchedules();
    showToast('Schedule deleted', 'success');
  } catch (err) {
    showToast('Error deleting schedule: ' + ((err && err.message) || String(err)), 'error');
  }
}

// ========== Run History ==========
async function showRunHistory(scheduleId, scheduleName) {
  const container = document.getElementById('schedule-history-list');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Loading history...</div>';

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'schedule_results', id: scheduleId }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });

    const results = (response && response.ok && Array.isArray(response.data))
      ? response.data
      : [];

    if (results.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">No run history yet.</div>';
    } else {
      container.innerHTML = '';
      results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'schedule-result-item';

        const statusClass = result.status || 'pending';
        const statusLabel = (result.status || 'pending').charAt(0).toUpperCase() + (result.status || 'pending').slice(1);
        const duration = formatDuration(result.startedAt, result.completedAt);
        const timestamp = result.completedAt
          ? new Date(result.completedAt).toLocaleString()
          : 'In progress...';

        let reportBtn = '';
        if (result.report) {
          reportBtn = `<button class="small-btn" data-action="view-report" data-report="${encodeURIComponent(result.report)}" style="margin-top:4px;">View Report</button>`;
        }

        let errorMsg = '';
        if (result.error) {
          errorMsg = `<div style="font-size:11px;color:var(--error-color);margin-top:2px;">${escapeHtml(result.error)}</div>`;
        }

        item.innerHTML = `
          <div>
            <span class="schedule-status-badge ${statusClass}">${statusLabel}</span>
            <div class="schedule-result-time" style="margin-top:4px;">${timestamp}</div>
            ${duration ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Duration: ${duration}</div>` : ''}
            ${errorMsg}
            ${reportBtn}
          </div>
        `;
        container.appendChild(item);
      });

      // Wire view-report buttons inside history modal
      container.querySelectorAll('[data-action="view-report"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const report = decodeURIComponent(btn.dataset.report || '');
          if (report && window.openReportModal) {
            window.openReportModal(report);
          }
        });
      });
    }

    // Show modal
    document.getElementById('schedule-history-modal').classList.add('show');

    // Set title with schedule name
    const _h2 = document.getElementById('schedule-history-modal').querySelector('h2');
    if (_h2) _h2.textContent = `Run History: ${scheduleName}`;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--error-color);">Error: ${escapeHtml((err && err.message) || String(err))}</div>`;
    document.getElementById('schedule-history-modal').classList.add('show');
  }
}

// ========== Global Exports ==========
window.showSchedulesPanel = showSchedulesPanel;
window.hideSchedulesPanel = hideSchedulesPanel;
window.openCreateScheduleModal = openCreateScheduleModal;
window.openCreateScheduleModalForTemplate = openCreateScheduleModalForTemplate;
window._handleSaveSchedule = handleSaveSchedule;
