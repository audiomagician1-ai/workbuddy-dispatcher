/**
 * test_cdp_ws_workbench_v2.js - 用 ws.once 避免消息乱序
 */
const WebSocket = require('ws');

const WB_WS_URL = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';

let ws;
let msgId = 0;

function send(method, params = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => reject(new Error(`Timeout: ${method}`)), timeout);
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', data => {
      clearTimeout(t);
      resolve(JSON.parse(data));
    });
  });
}

async function main() {
  ws = new WebSocket(WB_WS_URL);
  ws.on('error', e => console.error('WS error:', e.message));
  await new Promise(r => ws.on('open', r));
  console.log('✅ Connected to Workbench\n');

  // 测试 1：基本 evaluate
  const r1 = await send('Runtime.evaluate', { expression: `'title: ' + document.title`, returnByValue: true });
  console.log('📄 Page title:', r1.result?.result?.value || r1.result);

  // 测试 2: window.vscode 类型
  const r2 = await send('Runtime.evaluate', { expression: `typeof window.vscode`, returnByValue: true });
  console.log('📊 window.vscode:', r2.result?.result?.value);

  // 测试 3: IPC invoke
  const r3 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:session.create', { type: 'agent', config: {} });
        return 'ok: ' + JSON.stringify(r);
      } catch(e) { return 'error: ' + e.message; }
    })()`,
    returnByValue: true
  });
  console.log('📡 IPC result:', r3.result?.result?.value);

  // 测试 4: 列出会话
  const r4 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:chat.sessionList', {});
        return 'ok: ' + JSON.stringify(r);
      } catch(e) { return 'error: ' + e.message; }
    })()`,
    returnByValue: true
  });
  console.log('📡 sessionList:', r4.result?.result?.value);

  ws.close();
  console.log('\n✅ Done');
}

main().catch(e => { console.error('Fatal:', e.message); if (ws) ws.close(); });