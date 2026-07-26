// Sentinel Override v3 — Natural Language Schedule Parser
// Parses natural language input into structured schedule data
// compatible with createSchedule().
// Layer 3 module — no external dependencies, pure functions.

// ========== Constants ==========

const DAYS_OF_WEEK = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const DAY_ABBREVIATIONS = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
};

const TIME_PATTERN = /\b(?:(?:at|@|by)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/gi;
const ORDINAL_PATTERN = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i;
const WEEKDAYS_PATTERN = /\b(?:every\s+)?(?:weekday|weekdays|business\s+days|mon\s*-\s*fri|monday\s*(?:through|to|-)\s*friday)\b/i;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'every', 'each', 'at', 'by', 'on', 'in', 'for', 'to', 'and',
  'or', 'of', 'is', 'are', 'be', 'will', 'shall', 'should', 'must', 'may', 'can',
  'do', 'does', 'did', 'run', 'check', 'monitor', 'verify', 'ensure', 'make', 'sure',
  'that', 'this', 'these', 'those', 'it', 'its', 'from', 'with', 'without',
]);

// ========== Time Parsing ==========

function _normalizeTime(hour, minute, meridiem) {
  let h = parseInt(hour, 10);
  let m = minute ? parseInt(minute, 10) : 0;

  if (meridiem) {
    const mer = meridiem.toLowerCase().replace(/\./g, '');
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
  }

  if (h < 0) h = 0;
  if (h > 23) h = 23;
  if (m < 0) m = 0;
  if (m > 59) m = 59;

  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function _extractTime(text) {
  TIME_PATTERN.lastIndex = 0;
  let match;
  while ((match = TIME_PATTERN.exec(text)) !== null) {
    const hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3] || null;

    if (hour > 24 && !meridiem) continue;
    if (hour > 12 && !meridiem && minute === 0) {
      if (hour <= 23) {
        return { time: _normalizeTime(hour, String(minute), null), rawMatch: match[0] };
      }
      continue;
    }

    return { time: _normalizeTime(match[1], match[2], meridiem), rawMatch: match[0].trim() };
  }
  return null;
}

function _inferDefaultTime(text) {
  const lower = text.toLowerCase();
  if (/\bmorning\b/i.test(lower)) return '08:00';
  if (/\bnoon\b/i.test(lower)) return '12:00';
  if (/\bafternoon\b/i.test(lower)) return '14:00';
  if (/\bevening\b/i.test(lower)) return '18:00';
  if (/\bnight\b/i.test(lower)) return '20:00';
  return '09:00';
}

// ========== Frequency Parsing ==========

function _extractFrequency(text) {
  // Check for weekdays range FIRST (before single day names)
  if (WEEKDAYS_PATTERN.test(text)) {
    return { type: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] };
  }

  // Check for "last day of month" before ordinal/monthly keywords
  if (/\blast\s+day\s+of\s+(?:the\s+)?month\b/i.test(text)) {
    return { type: 'monthly', dayOfMonth: 31, isLastDay: true };
  }

  // Check for specific day name
  const dayMatch = text.match(/\b(?:every\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
  if (dayMatch) {
    const dayName = dayMatch[1].toLowerCase();
    const dayNum = DAYS_OF_WEEK[dayName] ?? DAY_ABBREVIATIONS[dayName];
    if (dayNum !== undefined) {
      return { type: 'weekly_named', dayOfWeek: dayNum };
    }
  }

  const hourlyMatch = text.match(/\bevery\s+(\d+)\s*hours?\b/i);
  if (hourlyMatch) {
    const hours = parseInt(hourlyMatch[1], 10);
    return { type: 'hourly', periodInMinutes: hours * 60 };
  }
  if (/\bhourly\b/i.test(text)) {
    return { type: 'hourly', periodInMinutes: 60 };
  }

  if (/\b(?:every\s+day|daily|each\s+day|every\s+morning|every\s+evening|morning|evening)\b/i.test(text)) {
    return { type: 'daily' };
  }

  if (/\b(?:every\s+week|weekly|each\s+week)\b/i.test(text)) {
    return { type: 'weekly', dayOfWeek: 1 };
  }

  const ordinalMatch = text.match(ORDINAL_PATTERN);
  if (ordinalMatch || /\b(?:every\s+month|monthly|each\s+month)\b/i.test(text)) {
    let dayOfMonth = 1;
    if (ordinalMatch) {
      dayOfMonth = parseInt(ordinalMatch[1], 10);
    }
    return { type: 'monthly', dayOfMonth };
  }

  if (/\b(?:once|one\s+time|just\s+once|single\s+time|today|tomorrow|tonight|now)\b/i.test(text)) {
    return { type: 'once' };
  }

  return { type: 'daily' };
}

// ========== Goal Extraction ==========

function _extractGoal(text, parsed) {
  let goal = text;

  const removals = [
    /\b(?:every\s+day|daily|each\s+day)\b/gi,
    /\b(?:every\s+week|weekly|each\s+week)\b/gi,
    /\b(?:every\s+month|monthly|each\s+month)\b/gi,
    /\b(?:every\s+weekday|weekdays|business\s+days|mon\s*-\s*fri|monday\s*(?:through|to|-)\s*friday)\b/gi,
    /\b(?:every\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/gi,
    /\b(?:once|one\s+time|just\s+once|single\s+time)\b/gi,
    /\b(?:today|tomorrow|tonight|now)\b/gi,
    /\b(?:morning|evening|afternoon|night|noon)\b/gi,
    /\b(?:every\s+\d+\s*hours?)\b/gi,
    /\bhourly\b/gi,
    /\b(?:the\s+)?(?:\d{1,2})(?:st|nd|rd|th)\b/gi,
    /\b(?:first|last)\s+(?:of\s+(?:the\s+)?month|day\s+of\s+(?:the\s+)?month)\b/gi,
    /\b(?:at|@|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\b/gi,
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\b/gi,
  ];

  for (const pattern of removals) {
    goal = goal.replace(pattern, ' ');
  }

  goal = goal.replace(/\s+/g, ' ').trim();
  goal = goal.replace(/^[-,;:]+|[-,;:]+$/g, '').trim();

  if (goal.length > 0) {
    goal = goal.charAt(0).toUpperCase() + goal.slice(1);
  }

  return goal;
}

// ========== Name Generation ==========

function _generateName(goal) {
  if (!goal || !goal.trim()) return 'Scheduled Task';

  const words = goal.split(/\s+/).filter(w => w.length > 0);
  const properNouns = words.filter(w => /^[A-Z][a-z]/.test(w) && !STOPWORDS.has(w.toLowerCase()));
  const keyTerms = words.filter(w => {
    const lower = w.toLowerCase().replace(/[^a-z]/g, '');
    return lower.length > 2 && !STOPWORDS.has(lower);
  });

  if (properNouns.length > 0) {
    const name = properNouns.slice(0, 3).join(' ');
    return _titleCase(name) + ' Task';
  }

  if (keyTerms.length >= 2) {
    return _titleCase(keyTerms.slice(0, 3).join(' '));
  }

  return _titleCase(words.slice(0, 3).join(' '));
}

function _titleCase(str) {
  return str.split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ========== Confidence + Alternatives ==========

function _calculateConfidence(input, parsed) {
  let score = 0;
  const maxScore = 5;

  if (parsed._timeFound) score += 1;
  else score += 0.3;

  if (parsed._frequencyFound) score += 1;
  else score += 0.2;

  if (parsed.goal && parsed.goal.length > 3) score += 1;
  else if (parsed.goal && parsed.goal.length > 0) score += 0.5;

  if (parsed.name && parsed.name.length > 2) score += 1;

  if (input.split(/\s+/).length >= 3) score += 1;

  return Math.min(score / maxScore, 1.0);
}

function _generateAlternatives(input, primary) {
  const alternatives = [];

  if (primary.type === 'recurring' && primary.recurrence && primary.recurrence.interval === 'daily') {
    const alt = (() => { try { return JSON.parse(JSON.stringify(primary)); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
    alt.recurrence.interval = 'weekly';
    alt.recurrence.periodInMinutes = 10080;
    alt.recurrence.dayOfWeek = 1;
    alternatives.push(alt);
  }

  if (primary.type === 'recurring' && primary.recurrence && primary.recurrence.interval === 'weekly' && primary.recurrence.dayOfWeek != null && !primary.recurrence.daysOfWeek) {
    const alt = (() => { try { return JSON.parse(JSON.stringify(primary)); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
    alt.recurrence.daysOfWeek = [1, 2, 3, 4, 5];
    delete alt.recurrence.dayOfWeek;
    alternatives.push(alt);
  }

  if (primary.type === 'once') {
    const alt = (() => { try { return JSON.parse(JSON.stringify(primary)); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
    alt.type = 'recurring';
    alt.recurrence = {
      interval: 'daily',
      periodInMinutes: 1440,
      time: alt._time || '09:00',
      daysOfWeek: null,
    };
    delete alt.runAt;
    alternatives.push(alt);
  }

  if (!primary._timeFound) {
    const altTimes = ['08:00', '12:00', '17:00'];
    for (const t of altTimes) {
      if (t !== (primary._time || '09:00')) {
        const alt = (() => { try { return JSON.parse(JSON.stringify(primary)); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
        if (alt.recurrence) alt.recurrence.time = t;
        alternatives.push(alt);
      }
    }
  }

  return alternatives.slice(0, 3);
}

// ========== Main Export ==========

export function parseNaturalLanguageSchedule(input) {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return {
      schedule: null,
      confidence: 0,
      alternatives: [],
      error: 'Input is required',
    };
  }

  const text = input.trim();

  const timeResult = _extractTime(text);
  const time = timeResult ? timeResult.time : _inferDefaultTime(text);

  const freq = _extractFrequency(text);

  const goal = _extractGoal(text, { time, freq });

  const name = _generateName(goal);

  const baseSchedule = {
    name,
    goal,
    _time: time,
    _timeFound: !!timeResult,
    _frequencyFound: freq.type !== 'daily' || /\b(?:every\s+day|daily|each\s+day|morning|evening)\b/i.test(text),
  };

  let schedule;

  switch (freq.type) {
    case 'once': {
      const now = Date.now();
      let runAt = now + 3600000;
      if (/\btomorrow\b/i.test(text)) {
        const tomorrow = new Date(now + 86400000);
        const parts = time.split(':').map(Number);
        tomorrow.setHours(parts[0], parts[1], 0, 0);
        runAt = tomorrow.getTime();
      } else if (/\btoday\b/i.test(text) || /\btonight\b/i.test(text)) {
        const today = new Date(now);
        const parts = time.split(':').map(Number);
        today.setHours(parts[0], parts[1], 0, 0);
        runAt = today.getTime();
        if (runAt <= now) runAt += 86400000;
      } else if (timeResult) {
        const target = new Date(now);
        const parts = time.split(':').map(Number);
        target.setHours(parts[0], parts[1], 0, 0);
        runAt = target.getTime();
        if (runAt <= now) runAt += 86400000;
      }

      schedule = Object.assign({}, baseSchedule, { type: 'once', runAt });
      break;
    }

    case 'hourly': {
      schedule = Object.assign({}, baseSchedule, {
        type: 'recurring',
        recurrence: {
          interval: 'hourly',
          periodInMinutes: freq.periodInMinutes || 60,
          time,
          daysOfWeek: null,
        },
      });
      break;
    }

    case 'daily': {
      schedule = Object.assign({}, baseSchedule, {
        type: 'recurring',
        recurrence: {
          interval: 'daily',
          periodInMinutes: 1440,
          time,
          daysOfWeek: null,
        },
      });
      break;
    }

    case 'weekly': {
      const recurrence = {
        interval: 'weekly',
        periodInMinutes: 10080,
        time,
      };
      if (freq.daysOfWeek) {
        recurrence.daysOfWeek = freq.daysOfWeek;
      } else if (freq.dayOfWeek != null) {
        recurrence.dayOfWeek = freq.dayOfWeek;
        recurrence.daysOfWeek = [freq.dayOfWeek];
      } else {
        recurrence.daysOfWeek = [1];
      }
      schedule = Object.assign({}, baseSchedule, { type: 'recurring', recurrence });
      break;
    }

    case 'weekly_named': {
      schedule = Object.assign({}, baseSchedule, {
        type: 'recurring',
        recurrence: {
          interval: 'weekly',
          periodInMinutes: 10080,
          time,
          dayOfWeek: freq.dayOfWeek,
          daysOfWeek: [freq.dayOfWeek],
        },
      });
      break;
    }

    case 'monthly': {
      schedule = Object.assign({}, baseSchedule, {
        type: 'recurring',
        recurrence: {
          interval: 'monthly',
          periodInMinutes: 43200,
          time,
          dayOfMonth: freq.dayOfMonth || 1,
          daysOfWeek: null,
        },
      });
      break;
    }

    default: {
      schedule = Object.assign({}, baseSchedule, {
        type: 'recurring',
        recurrence: {
          interval: 'daily',
          periodInMinutes: 1440,
          time,
          daysOfWeek: null,
        },
      });
    }
  }

  const confidence = _calculateConfidence(text, schedule);
  const alternatives = confidence < 0.7 ? _generateAlternatives(text, schedule) : [];

  const cleanSchedule = Object.assign({}, schedule);
  delete cleanSchedule._time;
  delete cleanSchedule._timeFound;
  delete cleanSchedule._frequencyFound;

  const cleanAlternatives = alternatives.map(alt => {
    const clean = Object.assign({}, alt);
    delete clean._time;
    delete clean._timeFound;
    delete clean._frequencyFound;
    return clean;
  });

  return {
    schedule: cleanSchedule,
    confidence,
    alternatives: cleanAlternatives,
    parsed: { time, frequencyType: freq.type, goal, name },
  };
}

export function formatSchedulePreview(schedule) {
  if (!schedule) return '';

  const goal = schedule.goal ? ' — Goal: ' + schedule.goal : '';

  if (schedule.type === 'once') {
    const date = new Date(schedule.runAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return '📅 Once on ' + dateStr + ' at ' + timeStr + goal;
  }

  const r = schedule.recurrence || {};
  const time = r.time || '09:00';

  let freqText = 'Recurring';
  if (r.interval === 'daily') freqText = 'Daily at ' + time;
  else if (r.interval === 'weekly') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (r.daysOfWeek && r.daysOfWeek.length > 1) {
      const names = r.daysOfWeek.map(d => dayNames[d] || '?').join(', ');
      freqText = 'Weekly on ' + names + ' at ' + time;
    } else {
      const dayIdx = r.dayOfWeek != null ? r.dayOfWeek : (r.daysOfWeek ? r.daysOfWeek[0] : 1);
      freqText = 'Weekly on ' + (dayNames[dayIdx] || 'Mon') + ' at ' + time;
    }
  } else if (r.interval === 'monthly') {
    const day = r.dayOfMonth || 1;
    const suffix = day === 31 ? 'last day' : '' + day + _ordinalSuffix(day);
    freqText = 'Monthly on the ' + suffix + ' at ' + time;
  } else if (r.interval === 'hourly') {
    freqText = 'Every ' + (r.periodInMinutes || 60) + ' min';
  }

  return '📅 ' + freqText + goal;
}

function _ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
