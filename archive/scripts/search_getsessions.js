// search_getsessions.js - 搜索 getClawSessions 的参数格式
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
console.log('Reading...');
const content = fs.readFileSync(path, 'utf8');

// 搜索 getClawSessions 的实现
const re = /getClawSessions|GET_CLAW_SESSIONS/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 20) {
  const start = Math.max(0, m.index - 100);
  const end = Math.min(content.length, m.index + 200);
  const ctx = content.substring(start, end).replace(/\n/g, ' ');
  if (!found.includes(ctx)) found.push(ctx);
}
console.log('=== getClawSessions context ===');
found.slice(0, 10).forEach((s, i) => console.log(i, s.substring(0, 400)));

// 搜索 paths[0]
const re2 = /paths\[0\]|paths\.0/g;
const found2 = [];
while ((m = re2.exec(content)) && found2.length < 10) {
  const start = Math.max(0, m.index - 100);
  const end = Math.min(content.length, m.index + 100);
  const ctx = content.substring(start, end).replace(/\n/g, ' ');
  if (!found2.includes(ctx)) found2.push(ctx);
}
console.log('\n=== paths[0] context ===');
found2.slice(0, 5).forEach((s, i) => console.log(i, s.substring(0, 300)));

console.log('\nDone');