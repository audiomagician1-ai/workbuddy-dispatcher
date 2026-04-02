// search_codebuddy2.js - 搜索所有 IPC 通道
const fs = require('fs');

const path = 'A:\\WorkBuddy\\resources\\app\\out\\codebuddy\\main.js';
const content = fs.readFileSync(path, 'utf8');

// 搜索所有 codebuddy: 开头的字符串
const cbChannels = [];
const re1 = /codebuddy:[a-zA-Z/]+/g;
let m;
while ((m = re1.exec(content)) && cbChannels.length < 30) {
  if (!cbChannels.includes(m[0])) cbChannels.push(m[0]);
}
console.log('=== codebuddy: channels ===');
cbChannels.forEach(c => console.log(' ', c));

// 搜索 session/ 开头的字符串
const sessChannels = [];
const re2 = /"session\/[^"]+"/g;
while ((m = re2.exec(content)) && sessChannels.length < 20) {
  if (!sessChannels.includes(m[0])) sessChannels.push(m[0]);
}
console.log('\n=== session/ channels ===');
sessChannels.forEach(c => console.log(' ', c));

// 搜索 agent/ 开头的字符串
const agentChannels = [];
const re3 = /"agent\/[^"]+"/g;
while ((m = re3.exec(content)) && agentChannels.length < 20) {
  if (!agentChannels.includes(m[0])) agentChannels.push(m[0]);
}
console.log('\n=== agent/ channels ===');
agentChannels.forEach(c => console.log(' ', c));

// 搜索 chat/ 开头的字符串
const chatChannels = [];
const re4 = /"chat\/[^"]+"/g;
while ((m = re4.exec(content)) && chatChannels.length < 20) {
  if (!chatChannels.includes(m[0])) chatChannels.push(m[0]);
}
console.log('\n=== chat/ channels ===');
chatChannels.forEach(c => console.log(' ', c));

console.log('\nDone');