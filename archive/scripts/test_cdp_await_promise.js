// test_cdp_await_promise.js - 等 Promise resolve，看 extension 返回什么
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};

function send(method, params, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { delete pending[id]; reject(new Error(`Timeout: ${method}`)); }, timeout);
    pending[id] = { resolve };
    function msgHandler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending[msg.id]) { clearTimeout(pending[msg.id].timeout); const { resolve: r } = pending[msg.id]; delete pending[msg.id]; r(msg); }
    }
    if (!ws._handler) { ws._handler = msgHandler; ws.on('message', msgHandler); }
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.on('open', async () => {
  console.log('Connected\n');
  await send('Runtime.enable');
  await send('Log.enable');
  await new Promise(r => setTimeout(r, 3000)); // 等待 extension 完全启动

  const cwd = 'c:/Users/Gu YongSheng/WorkBuddy/Claw';

  // 调用 getSessions，等待 Promise resolve
  console.log('Calling codebuddy:getSessions...');
  const r1 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:getSessions', {limit:100,offset:0,userId:'test'});
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`
  });
  console.log('getSessions result:', r1.result?.result?.value);

  await new Promise(r => setTimeout(r, 2000));

  // 调用 getClawSessions
  console.log('\nCalling codebuddy:getClawSessions...');
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions', {limit:100,offset:0,userId:'test'});
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`
  });
  console.log('getClawSessions result:', r2.result?.result?.value);

  await new Promise(r => setTimeout(r, 2000));

  // 调用 upsertSession
  console.log('\nCalling codebuddy:upsertSession...');
  const r3 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {conversationId:'',cwd:'${cwd}',userId:'test',customTitle:'CDP Test',status:'active'});
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`
  });
  console.log('upsertSession result:', r3.result?.result?.value);

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));