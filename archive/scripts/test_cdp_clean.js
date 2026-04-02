// test_cdp_clean.js - 无 interceptor，直接调用，看 extension 是否响应
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};

function send(method, params, timeout = 15000) {
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

  // 直接调用 upsertSession
  console.log('Calling codebuddy:upsertSession...');
  const r1 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {conversationId:'',cwd:'${cwd}',userId:'test',customTitle:'Clean Test',status:'active'})`
  });
  console.log('upsertSession CDP response:', JSON.stringify(r1.result?.result));

  await new Promise(r => setTimeout(r, 2000));

  // 直接调用 getSessions
  console.log('\nCalling codebuddy:getSessions...');
  const r2 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:getSessions', {limit:100,offset:0,userId:'test'})`
  });
  console.log('getSessions CDP response:', JSON.stringify(r2.result?.result));

  await new Promise(r => setTimeout(r, 2000));

  // 直接调用 session/new
  console.log('\nCalling session/new...');
  const r3 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('session/new', {cwd:'${cwd}',mcpServers:[]})`
  });
  console.log('session/new CDP response:', JSON.stringify(r3.result?.result));

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));