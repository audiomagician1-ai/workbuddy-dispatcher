// test_cdp_claw_session.js - 获取完整 Claw session 并探索 MessagePort channel
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

  // 拦截 IPC
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
      // 拦截 onDidReceiveMessage
      const origOn = window.vscode.ipcRenderer.onDidReceiveMessage;
      window.vscode.ipcRenderer.onDidReceiveMessage = function(handler) {
        window.__wbIPC.push({ dir: 'listen', msg: 'onDidReceiveMessage registered' });
        return origOn ? origOn.call(window.vscode.ipcRenderer, handler) : undefined;
      };
      return 'ok';
    })()`,
    returnByValue: true
  });
  console.log('Interceptor installed\n');

  // 获取 Claw sessions
  console.log('Getting Claw sessions...');
  const r1 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions', {})`,
    returnByValue: true
  });
  const sessions = JSON.parse(r1.result?.result?.value || '{}');
  console.log('Claw Sessions:', JSON.stringify(sessions, null, 2).substring(0, 1000));

  // 获取完整 IPC log
  await new Promise(r => setTimeout(r, 2000));

  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`,
    returnByValue: true
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log:');
  log.forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.msg || e.error).substring(0, 150);
    console.log(`  ${i} [${e.dir}] ${e.channel || e.msg}: ${d}`);
  });

  ws.close();
  console.log('\nDone');
});