// test_cdp_claw_inject.js
// 注入脚本到 Claw page，拦截 vscode IPC 并记录结果
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/038D6223E03EAE3E069A9EEF5E156478';
const ws = new WebSocket(wsUrl);
let msgId = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (!msg.id && msg.method) {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params?.args || []).map(a => a.value || '').join('');
      if (text.includes('[INJECT]') || text.includes('[CodeBuddy]') || text.includes('[Claw]')) {
        console.log('  [Console]', text.substring(0, 200));
      }
    }
  }
});

ws.on('open', async () => {
  console.log('Connected to Claw page\n');

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  console.log('Domains enabled\n');

  // 注入拦截脚本
  console.log('Injecting IPC interceptor...');
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode.ipcRenderer';

      const oldInvoke = window.vscode.ipcRenderer.invoke.bind(window.vscode.ipcRenderer);
      window.__clawIPC = [];
      window.vscode.ipcRenderer.invoke = function(channel, data) {
        window.__clawIPC.push({ dir: 'out', channel, data: JSON.parse(JSON.stringify(data)) });
        const result = oldInvoke(channel, data);
        result.then(r => {
          window.__clawIPC.push({ dir: 'in', channel, result: JSON.parse(JSON.stringify(r)) });
        }).catch(e => {
          window.__clawIPC.push({ dir: 'err', channel, error: e.message });
        });
        return result;
      };

      // 监听 onDidReceiveMessage
      if (window.vscode.ipcRenderer.onDidReceiveMessage) {
        window.vscode.ipcRenderer.onDidReceiveMessage(msg => {
          window.__clawIPC.push({ dir: 'recv', msg });
        });
      }

      return 'interceptor installed';
    })()`,
    returnByValue: true
  });
  console.log('Injection:', JSON.stringify(r1.result?.result));

  await new Promise(r => setTimeout(r, 2000));

  // 触发 session.create
  console.log('\nTriggering codebuddy:session.create...');
  const r2 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:session.create', {type:'agent',config:{}})`,
    returnByValue: true
  });
  console.log('Result:', JSON.stringify(r2.result?.result));

  await new Promise(r => setTimeout(r, 2000));

  // 触发 agent.send
  console.log('\nTriggering codebuddy:agent.send...');
  const r3 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:agent.send', {sessionId:'claw-test-1',message:'你好'})`,
    returnByValue: true
  });
  console.log('Result:', JSON.stringify(r3.result?.result));

  await new Promise(r => setTimeout(r, 2000));

  // 查询收集的 IPC
  const r4 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__clawIPC || [])`,
    returnByValue: true
  });
  const ipcLog = JSON.parse(r4.result?.result?.value || '[]');
  console.log('\nIPC log (', ipcLog.length, 'entries):');
  ipcLog.forEach((e, i) => {
    console.log(i, e.dir, e.channel, JSON.stringify(e.data || e.result || e.msg || e.error || {}).substring(0, 100));
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));