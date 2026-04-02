/**
 * test_cdp_ws_workbench.js - 连接主 workbench 测试 vscode API
 */
const WebSocket = require('ws');

const WB_WS_URL = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';

let ws;
let msgId = 0;
const pending = {};

function send(method, params = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { delete pending[id]; reject(new Error(`Timeout: ${method}`)); }, timeout);
    pending[id] = { resolve };
    ws.send(JSON.stringify({ id, method, params }));
  }).finally(() => clearTimeout(t));
}

async function main() {
  ws = new WebSocket(WB_WS_URL);
  ws.on('error', e => console.error('WS error:', e.message));
  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) { pending[msg.id].resolve(msg); delete pending[msg.id]; }
  });

  await new Promise(r => ws.on('open', r));
  console.log('✅ Connected to Workbench');

  // 基础 evaluate
  const r1 = await send('Runtime.evaluate', { expression: `'title: ' + document.title`, returnByValue: true }, 5000);
  console.log('📄 Page title:', r1.result.result.value);

  // 查找 vscode
  const r2 = await send('Runtime.evaluate', { expression: `typeof window.vscode`, returnByValue: true }, 5000);
  console.log('📊 window.vscode:', r2.result.result.value);

  // 看看全局有哪些键
  const r3 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(Object.keys(window).filter(k => /[A-Z]/.test(k) && k.length < 20).slice(0, 30))`,
    returnByValue: true
  }, 5000);
  console.log('📊 Global keys:', r3.result.result.value);

  // 测试 IPC
  const r4 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:session.create', { type: 'agent' });
        return 'create ok: ' + JSON.stringify(r);
      } catch(e) { return 'create error: ' + e.message; }
    })()`,
    returnByValue: true
  }, 5000);
  console.log('📡 codebuddy:session.create:', r4.result.result.value);

  ws.close();
  console.log('\n✅ 测试完成');
}

main().catch(e => { console.error('Fatal:', e.message); if (ws) ws.close(); });