// background/investigation-checklist.js
// Investigation Checklist Tracker — v1.0.0
//
// Parses structured investigation prompts (common in MSP workflows) into
// trackable sections. Each numbered item becomes a trackable section with
// status (pending → in_progress → done) and findings storage.
//
// Example prompt this is designed to parse:
//   "You are investigating why X cannot do Y.
//    1. Portal A - Check setting 1
//    2. Portal B - Check setting 2
//    3. Users - Find user Z
//    WHAT TO DOCUMENT: setting 1, setting 2, restrictions"

const NUMBERED_SECTION_RE = /(?:^|\n)\s*(\d+)\.\s+([A-Z][^\n]+(?:\n(?!\s*\d+\.)[^\n]+)*)/g;
const DOCUMENT_SECTION_RE = /(?:WHAT TO (?:DOCUMENT|CHECK)|DELIVERABLES?|OUTPUT)[:\s]*\n?([\s\S]*?)(?:\n\n|$)/i;
const TASK_ITEM_RE = /(?:^|\n)\s*[-•]\s+([^\n]+)/g;

/**
 * Parse an investigation goal into a structured checklist.
 * @param {string} goal - The raw goal text from the user.
 * @returns {{sections: Array, documentItems: Array, isInvestigation: boolean, totalTasks: number}}
 */
export function parseInvestigationChecklist(goal) {
  const sections = [];
  let match;

  // Extract numbered sections (1. Title, 2. Title, etc.)
  NUMBERED_SECTION_RE.lastIndex = 0;
  while ((match = NUMBERED_SECTION_RE.exec(goal)) !== null) {
    const sectionNum = parseInt(match[1]);
    const sectionText = match[2].trim();
    const title = sectionText.split('\n')[0].trim();

    // Extract sub-tasks (bullet points under each section)
    const subTasks = [];
    let taskMatch;
    TASK_ITEM_RE.lastIndex = 0;
    while ((taskMatch = TASK_ITEM_RE.exec(sectionText)) !== null) {
      subTasks.push(taskMatch[1].trim());
    }

    sections.push({
      id: sectionNum,
      title,
      subTasks,
      status: 'pending', // pending, in_progress, done, skipped
      findings: null,
    });
  }

  // Extract "WHAT TO DOCUMENT" section
  const docMatch = DOCUMENT_SECTION_RE.exec(goal);
  const documentItems = [];
  if (docMatch) {
    let itemMatch;
    TASK_ITEM_RE.lastIndex = 0;
    while ((itemMatch = TASK_ITEM_RE.exec(docMatch[1])) !== null) {
      documentItems.push(itemMatch[1].trim());
    }
    // If no bullet items found, try splitting by comma
    if (documentItems.length === 0 && docMatch[1].trim()) {
      const commaItems = docMatch[1].trim().split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
      documentItems.push(...commaItems);
    }
  }

  return {
    sections,
    documentItems,
    isInvestigation: sections.length >= 2,
    totalTasks: sections.reduce((sum, s) => sum + 1 + s.subTasks.length, 0),
  };
}

/**
 * Quick check if a goal looks like an investigation prompt.
 * @param {string} goal - The raw goal text.
 * @returns {boolean}
 */
export function isInvestigationGoal(goal) {
  const checklist = parseInvestigationChecklist(goal);
  return checklist.isInvestigation;
}

/**
 * Format checklist as a tracking directive for the LLM prompt.
 * @param {object} checklist - Parsed checklist from parseInvestigationChecklist.
 * @returns {string} Formatted directive text to append to goal.
 */
export function formatChecklistForPrompt(checklist) {
  let prompt = '\n## \u{1F4CB} INVESTIGATION CHECKLIST \u2014 Track Progress\n';
  prompt += 'Complete each section in order. After completing a section, summarize your findings before moving on.\n\n';

  for (const section of checklist.sections) {
    prompt += `${section.id}. ${section.title}\n`;
    for (const task of section.subTasks) {
      prompt += `   - ${task}\n`;
    }
    prompt += '\n';
  }

  if (checklist.documentItems.length > 0) {
    prompt += '## \u{1F4DD} REQUIRED DOCUMENTATION \u2014 Include all of these in your final report:\n';
    for (const item of checklist.documentItems) {
      prompt += `   - ${item}\n`;
    }
  }

  return prompt;
}

/**
 * Update the status of a checklist section.
 * @param {object} checklist - Parsed checklist object (mutated in place).
 * @param {number} sectionId - The section number to update.
 * @param {string} status - New status: 'pending', 'in_progress', 'done', 'skipped'.
 * @param {string|null} findings - Optional findings text for this section.
 * @returns {object} The updated checklist.
 */
export function updateChecklistStatus(checklist, sectionId, status, findings) {
  const section = checklist.sections.find(s => s.id === sectionId);
  if (section) {
    section.status = status;
    if (findings !== undefined && findings !== null) section.findings = findings;
  }
  return checklist;
}

/**
 * Calculate completion progress for a checklist.
 * @param {object} checklist - Parsed checklist object.
 * @returns {{done: number, total: number, percentage: number}}
 */
export function getChecklistProgress(checklist) {
  const done = checklist.sections.filter(s => s.status === 'done').length;
  const total = checklist.sections.length;
  return { done, total, percentage: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/**
 * Format findings for final report, mapping to document items.
 * @param {object} checklist - Parsed checklist with findings populated.
 * @returns {string} Formatted report section.
 */
export function formatFindingsForReport(checklist) {
  let report = '\n## Investigation Findings Report\n\n';

  for (const section of checklist.sections) {
    const statusIcon = section.status === 'done' ? '\u2705' :
                       section.status === 'in_progress' ? '\u{1F7E0}' :
                       section.status === 'skipped' ? '\u{23ED}\uFE0F' : '\u23F3';
    report += `### ${statusIcon} ${section.id}. ${section.title}\n\n`;
    if (section.findings) {
      report += `${section.findings}\n\n`;
    } else if (section.status === 'done') {
      report += '(completed - no findings recorded)\n\n';
    } else {
      report += `(status: ${section.status})\n\n`;
    }
  }

  if (checklist.documentItems.length > 0) {
    report += '## Required Documentation Items\n\n';
    for (const item of checklist.documentItems) {
      report += `- ${item}\n`;
    }
  }

  const progress = getChecklistProgress(checklist);
  report += `\n**Progress: ${progress.done}/${progress.total} sections complete (${progress.percentage}%)**\n`;

  return report;
}
