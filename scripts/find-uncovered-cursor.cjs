const fs = require('fs');

const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const path = 'C:\\Users\\Administrator\\Projects\\sentinel-override\\content\\cursor.js';
const data = cov[path];

const sourceLines = fs.readFileSync('content/cursor.js', 'utf8').split('\n');

console.log('Uncovered branches in cursor.js:');
console.log('');
Object.entries(data.b).forEach(([id, counts]) => {
  if (counts.every(c => c === 0)) {
    const info = data.branchMap[id];
    const line = info.loc.start.line;
    console.log(`Line ${line}: ${sourceLines[line - 1].trim().substring(0, 100)}`);
  } else if (counts.some(c => c === 0)) {
    const info = data.branchMap[id];
    const line = info.loc.start.line;
    console.log(`Line ${line}: PARTIAL (${counts.filter(c => c > 0).length}/${counts.length} taken): ${sourceLines[line - 1].trim().substring(0, 80)}`);
  }
});
