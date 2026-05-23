const fs = require('fs');
const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));

const files = Object.entries(cov)
  .map(([f, d]) => ({
    file: f.split('/').pop(),
    path: f,
    stmt: d.s,
    stmtPct: Math.round(100 * d.s.p / (d.s.t || 1)),
    branch: d.b,
    branchPct: Math.round(100 * d.b.p / (d.b.t || 1))
  }))
  .filter(x => x.file.endsWith('.js') && x.stmt.t > 20)
  .sort((a, b) => a.branchPct - b.branchPct);

console.log('Files with lowest branch coverage (>20 statements):');
files.slice(0, 20).forEach(x => {
  console.log(`${x.branchPct}% branches | ${x.stmtPct}% stmts | ${x.file} (${x.stmt.c}/${x.stmt.t} stmts)`);
});
