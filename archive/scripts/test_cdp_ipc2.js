/**
 * WorkBuddy CDP - 测试 codebuddy IPC 通道的具体行为
 */
const WebSocket = require('ws');
const http = require('http');

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
  const clawPage = targets.find(t => t.title === 'Claw - WorkBuddy');
  if (!clawPage) { console.log('Claw page not found'); return; }

  console.log('[*] 连接 Claw page...\n');
  const ws = new WebSocket(clawPage.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1;

  // 测试 codebuddy:session.create
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:session.create', {
  type: 'agent',
  agentId: 'claw'
}).then(r => JSON.stringify({ok: true, result: r})).catch(e => JSON.stringify({ok: false, error: e.message}))`,
    returnByValue: true
  });
  let resp = await wsRecv(ws);
  console.log('[*] codebuddy:session.create:\n  ', JSON.stringify(resp.result?.result?.value));

  // 测试 codebuddy:agent.send
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:agent.send', {
  agentId: 'claw',
  message: 'hello'
}).then(r => JSON.stringify({ok: true, result: r})).catch(e => JSON.stringify({ok: false, error: e.message}))`,
    returnByValue: true
  });
  resp = await wsRecv(ws);
  console.log('\n[*] codebuddy:agent.send:\n  ', JSON.stringify(resp.result?.result?.value));

  // 测试 codebuddy:chat.send
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:chat.send', {
  message: 'hello'
}).then(r => JSON.stringify({ok: true, result: r})).catch(e => JSON.stringify({ok: false, error: e.message}))`,
    returnByValue: true
  });
  resp = await wsRecv(ws);
  console.log('\n[*] codebuddy:chat.send:\n  ', JSON.stringify(resp.result?.result?.value));

  // 测试 vscode:webview.postMessage
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('vscode:webview.postMessage', {
  viewId: 'claw',
  message: { type: 'test', data: 'hello' }
}).then(r => JSON.stringify({ok: true, result: r})).catch(e => JSON.stringify({ok: false, error: e.message}))`,
    returnByValue: true
  });
  resp = await wsRecv(ws);
  console.log('\n[*] vscode:webview.postMessage:\n  ', JSON.stringify(resp.result?.result?.value));

  ws.close();
}

main().catch(e => console.error('Error:', e.message));
