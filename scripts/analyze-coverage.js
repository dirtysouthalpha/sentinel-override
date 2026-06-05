import fs from 'fs';

// Read coverage summary - has the aggregate stats we need
const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));

const files = Object.entries(summary)
  .filter(([f]) => f.endsWith('.js'))
  .map(([f, d]) => ({
    file: f.split(/[/\\]/).pop(),
    path: f,
    lines: d.lines,
    branches: d.branches,
    statements: d.statements,
    functions: d.functions,
  }))
  .filter(x => x.lines.total > 20)
  .sort((a, b) => a.branches.pct - b.branches.pct);

console.log('Files with lowest branch coverage (>20 lines):');
files.slice(0, 20).forEach(x => {
  console.log(`${x.branches.pct}% branches | ${x.lines.pct}% lines | ${x.file} (${x.lines.covered}/${x.lines.total} lines)`);
});
