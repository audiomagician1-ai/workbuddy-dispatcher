// search_codebuddy3.js - 搜索 codebuddy: 开头的所有通道及上下文
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';

console.log('Reading...');
const content = fs.readFileSync(path, 'utf8');
console.log('Done reading, searching...\n');

// 搜索 codebuddy: 通道注册上下文
const re = /CODEBUDDY_[A-Z_]+:"codebuddy:/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 50) {
  const start = Math.max(0, m.index - 30);
  const end = Math.min(content.length, m.index + 80);
  const ctx = content.substring(start, end);
  if (!found.includes(ctx)) found.push(ctx);
}
console.log('=== codebuddy: channel constants ===');
found.slice(0, 20).forEach((s, i) => console.log(i, s.replace(/\n/g, ' ')));

// 搜索 "session/new" 调用处（实际 sendRequest）
const re2 = /sendRequest\(dV\.session_new|session\/new",/g;
const found2 = [];
let m2;
while ((m2 = re2.exec(content)) && found2.length < 5) {
  const start = Math.max(0, m2.index - 100);
  const end = Math.min(content.length, m2.index + 100);
  const ctx = content.substring(start, end);
  if (!found2.includes(ctx)) found2.push(ctx);
}
console.log('\n=== session/new actual calls ===');
found2.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ').substring(0, 400)));

console.log('\nDone');