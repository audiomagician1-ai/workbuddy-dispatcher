// search_handler_sig.js - 搜索 getSessions/getClawSessions handler 的签名
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
console.log('Reading...');
const content = fs.readFileSync(path, 'utf8');
console.log('Searching...');

// 搜索 getSessions handler 的注册
const re = /getSessions[^{]{0,100}/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 5) {
  const start = Math.max(0, m.index - 20);
  const end = Math.min(content.length, m.index + m[0].length + 100);
  const ctx = content.substring(start, end).replace(/\n/g, ' ');
  if (!found.includes(ctx)) found.push(ctx);
}
console.log('=== getSessions context ===');
found.forEach((s, i) => console.log(i, s.substring(0, 300)));

// 搜索 paths
const re2 = /paths\[0\]/g;
const found2 = [];
while ((m = re2.exec(content)) && found2.length < 5) {
  const start = Math.max(0, m.index - 200);
  const end = Math.min(content.length, m.index + 200);
  const ctx = content.substring(start, end).replace(/\n/g, ' ');
  if (!found2.includes(ctx)) found2.push(ctx);
}
console.log('\n=== paths[0] context ===');
found2.forEach((s, i) => console.log(i, s.substring(0, 300)));
console.log('\nDone');