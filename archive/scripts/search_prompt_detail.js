// search_prompt_detail.js - 搜索 session/prompt 的参数格式（发送端）
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
console.log('Reading...');
const content = fs.readFileSync(path, 'utf8');
console.log('Searching for session_prompt arguments...');

// 搜索 sessionPrompt( 或 .sessionPrompt( 来看调用参数
const re = /sessionPrompt\([^;]{0,300}/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 5) {
  const ctx = m[0].replace(/\n/g, ' ').substring(0, 300);
  if (!found.includes(ctx)) found.push(ctx);
}
console.log('\n=== sessionPrompt() calls ===');
found.forEach((s, i) => console.log(i, s));

// 搜索 newSession 调用
const re2 = /newSession\([^;]{0,200}/g;
const found2 = [];
let m2;
while ((m2 = re2.exec(content)) && found2.length < 5) {
  const ctx = m2[0].replace(/\n/g, ' ').substring(0, 200);
  if (!found2.includes(ctx)) found2.push(ctx);
}
console.log('\n=== newSession() calls ===');
found2.forEach((s, i) => console.log(i, s));

// 搜索 upsertSession 的实现
const re3 = /upsertSession[a-zA-Z(][^;]{0,500}/g;
const found3 = [];
let m3;
while ((m3 = re3.exec(content)) && found3.length < 3) {
  const ctx = m3[0].replace(/\n/g, ' ').substring(0, 400);
  if (!found3.includes(ctx)) found3.push(ctx);
}
console.log('\n=== upsertSession implementation ===');
found3.forEach((s, i) => console.log(i, s.substring(0, 400)));

console.log('\nDone');