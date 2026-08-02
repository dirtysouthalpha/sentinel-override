#!/usr/bin/env node
/**
 * Report uncovered statements and branches for a source file from an istanbul
 * coverage run.
 *
 * Usage: node scripts/find-uncovered.cjs [relative/path/to/file.js]
 *        (defaults to background/agent-engine.js)
 *
 * Run `npm run test:coverage` first to produce coverage/coverage-final.json.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = path.join('background', 'agent-engine.js');

function fail(message) {
  console.error(`find-uncovered: ${message}`);
  process.exit(1);
}

// Coverage keys are absolute paths written by whichever machine ran the tests, so they
// can differ from a locally resolved path in separator style and drive-letter case.
// Compare normalised forms, and fall back to a path-segment suffix match.
function normalise(p) {
  const n = path.normalize(p).split(path.sep).join('/');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function findCoverageEntry(coverage, absoluteTarget, relativeTarget) {
  const wanted = normalise(absoluteTarget);
  const wantedSuffix = normalise(relativeTarget);

  for (const [key, value] of Object.entries(coverage)) {
    if (normalise(key) === wanted) return value;
  }
  // Coverage produced elsewhere (CI, a container) won't share our absolute prefix.
  const suffixMatches = Object.entries(coverage)
    .filter(([key]) => normalise(key).endsWith(`/${wantedSuffix}`));
  if (suffixMatches.length === 1) return suffixMatches[0][1];
  if (suffixMatches.length > 1) {
    fail(`${relativeTarget} matches ${suffixMatches.length} coverage entries; pass a more specific path`);
  }
  return null;
}

const targetArg = process.argv[2] || DEFAULT_TARGET;
const absoluteTarget = path.resolve(REPO_ROOT, targetArg);
const relativeTarget = path.relative(REPO_ROOT, absoluteTarget);

const coveragePath = path.join(REPO_ROOT, 'coverage', 'coverage-final.json');
if (!fs.existsSync(coveragePath)) {
  fail(`no coverage at ${coveragePath} — run "npm run test:coverage" first`);
}
if (!fs.existsSync(absoluteTarget)) {
  fail(`no such source file: ${absoluteTarget}`);
}

let coverage;
try {
  coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
} catch (err) {
  fail(`could not parse ${coveragePath}: ${err.message}`);
}

const data = findCoverageEntry(coverage, absoluteTarget, relativeTarget);
if (!data) {
  fail(`${relativeTarget} has no entry in coverage-final.json — was it exercised by the test run?`);
}

const sourceLines = fs.readFileSync(absoluteTarget, 'utf8').split('\n');
const lineText = line => (sourceLines[line - 1] || '').trim();

const uncoveredStmts = Object.entries(data.s)
  .filter(([, count]) => count === 0)
  .map(([id]) => data.statementMap[id].start)
  .sort((a, b) => a.line - b.line);

console.log(`Uncovered statements in ${relativeTarget}:`);
console.log('');
uncoveredStmts.forEach(({ line }) => console.log(`Line ${line}: ${lineText(line)}`));

console.log('');
console.log('Uncovered branches:');
Object.entries(data.b).forEach(([id, counts]) => {
  const { line } = data.branchMap[id].loc.start;
  if (counts.every(c => c === 0)) {
    console.log(`Line ${line}: ${lineText(line).substring(0, 80)}`);
  } else if (counts.some(c => c === 0)) {
    console.log(`Line ${line}: PARTIAL (${counts.filter(c => c > 0).length}/${counts.length} taken)`);
  }
});
