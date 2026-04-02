/**
 * WorkBuddy CDP - 向 Claw 页面发送 IPC 消息
 * 测试 IPC 通道
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const CDP_PORT = 9222;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function wsSend(ws, id, method, params) {
  ws.send(JSON.stringify({ id, method, params }));
}

async function wsRecv(ws) {
  return new Promise(r => ws.once('message', d => r(JSON.parse(d))));
}

async function main() {
  const raw = await get(`http://localhost:${CDP_PORT}/json`);
  const targets = JSON.parse(raw);

  // 找 Claw page
  const clawPage = targets.find(t => t.title === 'Claw - WorkBuddy');
  if (!clawPage) { console.log('Claw page not found'); return; }

  console.log('[*] 连接 Claw page...');
  const ws = new WebSocket(clawPage.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;

  // 1. 获取 DOM 信息
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      inputs: Array.from(document.querySelectorAll('input, textarea, [contenteditable]'))
        .map(e => ({ tag: e.tagName, id: e.id, cls: e.className.toString().slice(0,50) }))
        .slice(0, 10),
      buttons: Array.from(document.querySelectorAll('button'))
        .map(b => ({ text: b.textContent.trim().slice(0,30), cls: b.className.toString().slice(0,40) }))
        .slice(0, 10)
    })`,
    returnByValue: true
  });

  let resp = await wsRecv(ws);
  console.log('\n[*] DOM 结构:\n', JSON.stringify(resp, null, 2));

  // 2. 测试 IPC 通道 - 尝试调用 vscode.ipcRenderer.invoke
  // 先看有哪些已知 channel 可以调用
  const testChannels = [
    'vscode:fetchWindowConfig',
    'vscode:webview.send',
    'vscode:webview.postMessage',
    'codebuddy:chat.send',
    'codebuddy:session.create',
    'codebuddy:agent.send',
    'claw:send',
    'claw:chat.send'
  ];

  console.log('\n[*] 测试 IPC 通道...\n');
  for (const channel of testChannels) {
    wsSend(ws, id++, 'Runtime.evaluate', {
      expression: `window.vscode.ipcRenderer.invoke('${channel}', {test: true}).then(r => 'OK: ' + JSON.stringify(r)).catch(e => 'ERR: ' + e.message)`,
      returnByValue: true
    });

    resp = await wsRecv(ws);
    const val = resp.result?.result?.value || '';
    console.log(`  ${channel}: ${val}`);
  }

  ws.close();
}

main().catch(e => console.error('Error:', e.message));
