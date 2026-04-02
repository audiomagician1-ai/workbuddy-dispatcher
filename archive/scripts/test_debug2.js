// test_debug2.js - 打印完整响应
const WebSocket = require('ws');
const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';

const ws = new WebSocket(wsUrl);
let step = 0;
let currentResolve;

ws.on('open', () => { console.log('Connected'); nextStep(); });

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('MSG received, id:', msg.id, 'method:', msg.method, 'has result:', !!msg.result, 'has error:', !!msg.error);
  if (currentResolve) { const r = currentResolve; currentResolve = null; r(msg); }
});

function ask(method, params) {
  return new Promise((resolve) => {
    currentResolve = resolve;
    const id = ++step;
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (currentResolve === resolve) { currentResolve = null; resolve({ error: 'timeout' }); }
    }, 8000);
  });
}

async function nextStep() {
  try {
    console.log('\n--- Evaluating 1+1 ---');
    const r = await ask('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    console.log('Full response:', JSON.stringify(r, null, 2).substring(0, 500));
  } catch(e) {
    console.error('Error:', e.message);
  }
  ws.close();
}

nextStep().catch(e => { console.error(e.message); ws.close(); });