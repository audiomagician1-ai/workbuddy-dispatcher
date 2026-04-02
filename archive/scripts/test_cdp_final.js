// test_cdp_final.js - 基于 test_ws_api.js 的成功模式，打印完整响应
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('Connected');
  runTests();
});

ws.on('message', (data) => {
  console.log('RAW MSG:', data.toString().substring(0, 300));
});

function send(method, params) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 100000);
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function runTests() {
  // Step 1: basic evaluate
  const r1 = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
  console.log('\n=== Evaluate 1+1 ===');
  console.log(JSON.stringify(r1, null, 2));

  // Step 2: window.vscode
  const r2 = await send('Runtime.evaluate', { expression: 'typeof window.vscode', returnByValue: true });
  console.log('\n=== window.vscode ===');
  console.log(JSON.stringify(r2, null, 2));

  // Step 3: IPC invoke
  const r3 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:session.create', {type:'agent',config:{}});
        return {ok: true, r: JSON.stringify(r)};
      } catch(e) {
        return {ok: false, error: e.message};
      }
    })()`,
    returnByValue: true
  });
  console.log('\n=== codebuddy:session.create ===');
  console.log(JSON.stringify(r3, null, 2));

  // Step 4: try to get session list
  const r4 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:chat.sessionList', {});
        return {ok: true, r: JSON.stringify(r)};
      } catch(e) {
        return {ok: false, error: e.message};
      }
    })()`,
    returnByValue: true
  });
  console.log('\n=== codebuddy:chat.sessionList ===');
  console.log(JSON.stringify(r4, null, 2));

  ws.close();
  console.log('\nDone');
}

ws.on('error', (e) => console.error('WS Error:', e.message));