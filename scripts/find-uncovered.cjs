const fs = require('fs');

// Read coverage and source files
const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const agentEnginePath = 'C:\\Users\\Administrator\\Projects\\sentinel-override\\background\\agent-engine.js';
const data = cov[agentEnginePath];

// Read source file
const sourceLines = fs.readFileSync('background/agent-engine.js', 'utf8').split('\n');

// Find uncovered statements
const uncoveredStmts = Object.entries(data.s)
  .filter(([id, count]) => count === 0)
  .map(([id]) => {
    const info = data.statementMap[id];
    return { line: info.start.line, col: info.start.column };
  })
  .sort((a, b) => a.line - b.line);

console.log('Uncovered statements in agent-engine.js:');
console.log('');
uncoveredStmts.forEach(({ line, col }) => {
  console.log(`Line ${line}: ${sourceLines[line - 1].trim()}`);
});

// Find uncovered branches
console.log('');
console.log('Uncovered branches:');
Object.entries(data.b).forEach(([id, counts]) => {
  if (counts.every(c => c === 0)) {
    const info = data.branchMap[id];
    console.log(`Line ${info.loc.start.line}: ${sourceLines[info.loc.start.line - 1].trim().substring(0, 80)}`);
  } else if (counts.some(c => c === 0)) {
    const info = data.branchMap[id];
    console.log(`Line ${info.loc.start.line}: PARTIAL (${counts.filter(c => c > 0).length}/${counts.length} taken)`);
  }
});
