// search_upsert_detail.js - 搜索 upsertSession 的调用和参数
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
console.log('Reading...');
const content = fs.readFileSync(path, 'utf8');
console.log('Searching...');

// 搜索 upsertSession 调用（不是定义）
// 定义在 CODEBUDDY_UPSERT_SESSION，但调用是 upsertSession(
const re = /upsertSession\([^)]{0,300}/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 10) {
  const ctx = m[0].replace(/\n/g, ' ').substring(0, 300);
  if (!found.includes(ctx) && !ctx.includes('CODEBUDDY_')) found.push(ctx);
}
console.log('\n=== upsertSession() calls ===');
found.slice(0, 8).forEach((s, i) => console.log(i, s));

// 搜索 renameSession 和 moveSession
const re2 = /renameSession|moveSession/g;
const found2 = [];
while ((m = re2.exec(content)) && found2.length < 5) {
  const start = Math.max(0, m.index - 50);
  const end = Math.min(content.length, m.index + 150);
  found2.push(content.substring(start, end).replace(/\n/g, ' '));
}
console.log('\n=== renameSession context ===');
found2.forEach((s, i) => console.log(i, s.substring(0, 300)));

console.log('\nDone');