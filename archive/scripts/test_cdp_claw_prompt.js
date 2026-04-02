// test_cdp_claw_prompt.js - 正确获取 session 数据并尝试发送 prompt
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

  // 安装拦截器
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

  // 获取 Claw sessions（正确 await）
  console.log('Getting Claw sessions...');
  const r1 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions', {});
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`,
    returnByValue: true
  });
  const clawData = JSON.parse(r1.result?.result?.value || '{}');
  console.log('\n=== Claw Sessions ===');
  console.log(JSON.stringify(clawData, null, 2).substring(0, 2000));

  // 尝试 upsertSession（创建新会话）
  console.log('\n\nCreating new session via upsertSession...');
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {
          type: 'agent',
          config: { cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw' }
        });
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`,
    returnByValue: true
  });
  console.log('upsertSession result:', r2.result?.result?.value);

  await new Promise(r => setTimeout(r, 3000));

  // 查询 IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`,
    returnByValue: true
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\n=== IPC log ===');
  log.forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.error).substring(0, 150);
    console.log(`  ${i} [${e.dir}] ${e.channel}: ${d}`);
  });

  ws.close();
  console.log('\nDone');
});