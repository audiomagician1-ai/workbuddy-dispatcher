// test_cdp_wb_inject.js
// 注入脚本到主 workbench，拦截 codebuddy IPC
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

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (!msg.id && msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params?.args || []).map(a => a.value || '').join('');
    if (text.includes('[INJECT') || text.includes('IPC') || text.includes('channel')) {
      console.log('  [Console]', text.substring(0, 200));
    }
  }
});

ws.on('open', async () => {
  console.log('Connected to Workbench\n');

  await send('Runtime.enable');
  await send('Log.enable');
  console.log('Domains enabled\n');

  // 注入拦截脚本
  console.log('Injecting IPC interceptor on Workbench...');
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode.ipcRenderer';

      const oldInvoke = window.vscode.ipcRenderer.invoke.bind(window.vscode.ipcRenderer);
      window.__wbIPC = [];
      window.vscode.ipcRenderer.invoke = function(channel, data) {
        window.__wbIPC.push({ dir: 'out', channel, data: JSON.parse(JSON.stringify(data)) });
        const result = oldInvoke(channel, data);
        result.then(r => {
          window.__wbIPC.push({ dir: 'in', channel, result: JSON.parse(JSON.stringify(r)) });
        }).catch(e => {
          window.__wbIPC.push({ dir: 'err', channel, error: e.message });
        });
        return result;
      };

      if (window.vscode.ipcRenderer.onDidReceiveMessage) {
        const origHandler = window.vscode.ipcRenderer.onDidReceiveMessage.bind(window.vscode.ipcRenderer);
        window.vscode.ipcRenderer.onDidReceiveMessage = function(handler) {
          window.__wbIPC.push({ dir: 'listen', handler: 'onDidReceiveMessage registered' });
          return origHandler(handler);
        };
      }

      return 'workbench interceptor installed';
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
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:agent.send', {sessionId:'wb-test-1',message:'你好'})`,
    returnByValue: true
  });
  console.log('Result:', JSON.stringify(r3.result?.result));

  await new Promise(r => setTimeout(r, 5000));

  // 查询 IPC log
  const r4 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`,
    returnByValue: true
  });
  const log = JSON.parse(r4.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.forEach((e, i) => {
    const detail = e.data || e.result || e.error;
    console.log(i, e.dir, e.channel, JSON.stringify(detail).substring(0, 150));
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));