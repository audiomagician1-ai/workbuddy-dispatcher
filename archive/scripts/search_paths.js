// search_paths.js - 搜索 paths[0] error 的来源
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
console.log('Reading...');
const content = fs.readFileSync(path, 'utf8');

// 搜索 "paths[0]" argument must be
const re = /paths\[0\]\[^;]{0,200}/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 3) {
  const start = Math.max(0, m.index - 50);
  const end = Math.min(content.length, m.index + 150);
  const ctx = content.substring(start, end).replace(/\n/g, ' ');
  if (!found.includes(ctx)) found.push(ctx);
}
console.log('=== paths[0] context ===');
found.forEach((s, i) => console.log(i, s.substring(0, 300)));

console.log('\nDone');