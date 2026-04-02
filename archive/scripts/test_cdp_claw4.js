// test_cdp_claw4.js
// Claw page：监听所有 CDP 事件 + 触发 IPC，看实际通信流
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/038D6223E03EAE3E069A9EEF5E156478';
const ws = new WebSocket(wsUrl);
let msgId = 0;
const rawEvents = [];

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  // 如果是事件（无 id），记录下来
  if (!msg.id && msg.method) {
    rawEvents.push(msg.method);
    if (msg.method.includes('Overlay') || msg.method.includes('inspector') || msg.method.includes('exception') || msg.method.includes('console')) {
      console.log('EVENT:', msg.method, JSON.stringify(msg.params || {}).substring(0, 150));
    }
  }
});

ws.on('open', async () => {
  console.log('Connected to Claw page\n');

  // 启用所有可能的域
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');
  console.log('Domains enabled, listening 3s...');

  // 监听一些事件
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n=== 触发 codebuddy:session.create ===');
  const r1 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:session.create', {type:'agent',config:{}})`,
    returnByValue: true
  });
  console.log('Result:', JSON.stringify(r1.result?.result));

  await new Promise(r => setTimeout(r, 3000));

  console.log('\n=== 触发 codebuddy:agent.send ===');
  const r2 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:agent.send', {sessionId:'test-999',message:'你好'})`,
    returnByValue: true
  });
  console.log('Result:', JSON.stringify(r2.result?.result));

  // 监听更久
  console.log('\nListening 8s for events...');
  await new Promise(r => setTimeout(r, 8000));

  console.log('\n=== 所有事件 ===');
  console.log(rawEvents.filter(e => !e.includes('function') && !e.includes('garbage')).join('\n'));
  console.log('\nDone');

  ws.close();
});

ws.on('error', (e) => console.error('WS Error:', e.message));