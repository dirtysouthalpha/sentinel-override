const fs = require('fs');
const path = require('path');

function findLongFunctions(filePath, minLines = 50) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const functions = [];

  let inFunction = false;
  let funcStart = 0;
  let braceCount = 0;
  let funcName = 'anonymous';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect function start
    if (/^(async\s+)?function\s+\w+|^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*=>|^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*\{/.test(trimmed) && !trimmed.includes('//')) {
      const nameMatch = trimmed.match(/(?:function|=>\s*|=>)\s*(\w+)/);
      funcName = nameMatch ? nameMatch[1] : 'anonymous';
      funcStart = i + 1;
      inFunction = true;
      braceCount = 0;
    }

    if (inFunction) {
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }

      if (braceCount === 0 && line.includes('}')) {
        const funcLines = i - funcStart + 1;
        if (funcLines >= minLines) {
          functions.push({
            name: funcName,
            start: funcStart,
            end: i + 1,
            lines: funcLines
          });
        }
        inFunction = false;
      }
    }
  }

  return functions;
}

const dirs = ['background', 'content', 'popup-modules'];
const allLongFunctions = [];

for (const dir of dirs) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const longFuncs = findLongFunctions(filePath, 50);
    for (const func of longFuncs) {
      allLongFunctions.push({ file: path.join(dir, file), ...func });
    }
  }
}

allLongFunctions.sort((a, b) => b.lines - a.lines);

console.log('Functions >= 50 lines:');
console.log('');
allLongFunctions.slice(0, 20).forEach(f => {
  console.log(`${f.lines} lines | ${f.file}:${f.start} | ${f.name}`);
});
