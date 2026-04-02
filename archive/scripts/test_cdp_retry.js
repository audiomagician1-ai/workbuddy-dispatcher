// test_cdp_retry.js - extension 已完全启动后重试 IPC
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

ws.on('open', async () => {
  console.log('Connected\n');
  await send('Runtime.enable');
  await send('Log.enable');

  // 安装 IPC 拦截器
  await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode';
      const oldInvoke = window.vscode.ipcRenderer.invoke.bind(window.vscode.ipcRenderer);
      window.__wbIPC = [];
      window.vscode.ipcRenderer.invoke = function(ch, data) {
        window.__wbIPC.push({ dir: 'out', channel: ch, data });
        return oldInvoke(ch, data).then(r => {
          window.__wbIPC.push({ dir: 'in', channel: ch, result: r });
          return r;
        }).catch(e => {
          window.__wbIPC.push({ dir: 'err', channel: ch, error: e.message });
          throw e;
        });
      };
      return 'ok';
    })()`,
    returnByValue: true
  });

  // 等待 extension 完全启动（确保 "IPC handlers registered" 已打印）
  console.log('Waiting 5s for extension to fully start...\n');
  await new Promise(r => setTimeout(r, 5000));

  // 测试 upsertSession with conversationId from existing Claw session
  console.log('=== Testing codebuddy:upsertSession ===');
  const r1 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {
          conversationId: '2f0b4625bf274d9b8a37eb9fa84a2caf',
          cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
          userId: 'bf0fae44-d3a8-4878-965d-74bcf9fa84a2caf',
          title: 'Test Session',
          status: 'active'
        });
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`,
    returnByValue: true
  });
  console.log('upsertSession:', r1.result?.result?.value);

  await new Promise(r => setTimeout(r, 3000));

  // 测试 session/prompt
  console.log('\n=== Testing session/prompt ===');
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        // 先看 session/new 格式
        const r = await window.vscode.ipcRenderer.invoke('session/new', {
          cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
          prompt: '你好'
        });
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`,
    returnByValue: true
  });
  console.log('session/new:', r2.result?.result?.value);

  // 打印 IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`,
    returnByValue: true
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.slice(-20).forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.error).substring(0, 200);
    console.log(`  ${i} [${e.dir}] ${e.channel}: ${d}`);
  });

  ws.close();
  console.log('\nDone');
});