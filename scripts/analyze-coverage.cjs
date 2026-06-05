const fs = require('fs');

// Read coverage file
const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));

function countCoverage(obj) {
  const values = Object.values(obj || {});
  const covered = values.filter(v => Array.isArray(v) ? v.some(x => x > 0) : v > 0).length;
  const total = values.length;
  return { covered, total };
}

const files = Object.entries(cov)
  .map(([path, data]) => {
    const stmt = countCoverage(data.s);
    const branch = countCoverage(data.b);
    const func = countCoverage(data.f);
    return {
      file: path.split(/[/\\]/).pop(),
      path: path,
      stmt,
      branch,
      func,
      stmtPct: Math.round(100 * stmt.covered / stmt.total),
      branchPct: Math.round(100 * branch.covered / branch.total),
      funcPct: Math.round(100 * func.covered / func.total)
    };
  })
  .filter(x => x.file.endsWith('.js') && x.stmt.total > 20)
  .sort((a, b) => a.branchPct - b.branchPct);

console.log('Files with lowest branch coverage (>20 statements):');
console.log('');
files.slice(0, 20).forEach(x => {
  console.log(`${String(x.branchPct).padStart(3)}% branch | ${String(x.stmtPct).padStart(3)}% stmt | ${x.file} (${x.branch.covered}/${x.branch.total} branches)`);
});

console.log('');
console.log('--- Popup modules ---');
const popupFiles = files.filter(x => x.path.includes('popup-modules')).sort((a,b) => a.branchPct - b.branchPct);
popupFiles.slice(0, 10).forEach(x => {
  console.log(`${String(x.branchPct).padStart(3)}% branch | ${String(x.stmtPct).padStart(3)}% stmt | ${x.file}`);
});
