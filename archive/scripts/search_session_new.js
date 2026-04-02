// search_session_prompt.js - 搜索 session/prompt 和 session/new 的参数格式
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';

// 用更长的上下文搜索 session/prompt
const content = fs.readFileSync(path, 'utf8');

// 搜索 sessionPrompt 和 promptSession 相关的调用
const re = /sessionPrompt|session_prompt|promptSession/g;
const found = [];
let m;
while ((m = re.exec(content)) && found.length < 5) {
  const start = Math.max(0, m.index - 150);
  const end = Math.min(content.length, m.index + 150);
  found.push(content.substring(start, end));
}
console.log('=== sessionPrompt context ===');
found.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ').substring(0, 400)));

// 搜索如何创建新 session
const re2 = /createSession|newSession/g;
const found2 = [];
while ((m = re2.exec(content)) && found2.length < 5) {
  const start = Math.max(0, m.index - 100);
  const end = Math.min(content.length, m.index + 100);
  found2.push(content.substring(start, end));
}
console.log('\n=== createSession context ===');
found2.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ').substring(0, 400)));

console.log('\nDone');