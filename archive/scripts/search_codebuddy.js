// search_codebuddy.js - 在 codebuddy/main.js 里搜索 IPC 通道
const fs = require('fs');
const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';

console.log('Reading codebuddy/main.js...');
const content = fs.readFileSync(path, 'utf8');
console.log(`File size: ${content.length} chars`);

// 搜索 onDidReceiveMessage 相关
const pattern1 = /onDidReceiveMessage/g;
const matches1 = [];
let m;
while ((m = pattern1.exec(content)) && matches1.length < 5) {
  const start = Math.max(0, m.index - 80);
  const end = Math.min(content.length, m.index + 80);
  matches1.push(content.substring(start, end));
}
console.log('\n=== onDidReceiveMessage ===');
matches1.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ')));

// 搜索可能的 channel 名称
const channelPatterns = [
  /codebuddy[.:][a-zA-Z.]+/g,
  /"chat[./][a-zA-Z]+"/g,
  /"session[./][a-zA-Z]+"/g,
  /"agent[./][a-zA-Z]+"/g,
];

console.log('\n=== Channel patterns ===');
channelPatterns.forEach((pat, pi) => {
  const found = [];
  let m2;
  while ((m2 = pat.exec(content)) && found.length < 3) {
    found.push(m2[0]);
  }
  if (found.length > 0) console.log('Pattern', pi, ':', found);
});

// 搜索 getUri
const pattern2 = /getUri|asWebviewUri|postMessage/g;
const matches2 = [];
while ((m = pattern2.exec(content)) && matches2.length < 3) {
  const start = Math.max(0, m.index - 60);
  const end = Math.min(content.length, m.index + 60);
  matches2.push(content.substring(start, end));
}
console.log('\n=== getUri/postMessage ===');
matches2.forEach((s, i) => console.log(i, s.replace(/\n/g, ' ')));

console.log('\nDone');