// search_upsert.js - 搜索 upsertSession 的调用参数格式
const fs = require('fs');

const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
const content = fs.readFileSync(path, 'utf8');

// 搜索 upsertSession 调用
const re1 = /upsertSession[^;]{0,200}/g;
let m;
const found = [];
while ((m = re1.exec(content)) && found.length < 10) {
  const ctx = m[0];
  if (!found.includes(ctx)) found.push(ctx);
}
console.log('=== upsertSession context ===');
found.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ').substring(0, 300)));

// 搜索 session/new 调用
const re2 = /session\/new[^;]{0,200}/g;
const found2 = [];
while ((m = re2.exec(content)) && found2.length < 10) {
  const ctx = m[0];
  if (!found2.includes(ctx)) found2.push(ctx);
}
console.log('\n=== session/new context ===');
found2.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ').substring(0, 300)));

// 搜索 session/prompt 调用
const re3 = /session\/prompt[^;]{0,200}/g;
const found3 = [];
while ((m = re3.exec(content)) && found3.length < 10) {
  const ctx = m[0];
  if (!found3.includes(ctx)) found3.push(ctx);
}
console.log('\n=== session/prompt context ===');
found3.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ').substring(0, 300)));

console.log('\nDone');