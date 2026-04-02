// test_minimal.js - 极简版，逐步测试
const WebSocket = require('ws');
const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';

const ws = new WebSocket(wsUrl);
let step = 0;
let currentResolve;
let currentReject;

ws.on('open', () => {
  console.log('Connected');
  nextStep();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (currentResolve) {
    const resolver = currentResolve;
    currentResolve = null;
    resolver(msg);
  }
});

function ask(method, params) {
  return new Promise((resolve, reject) => {
    currentResolve = resolve;
    currentReject = reject;
    const id = ++step;
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (currentResolve === resolve) {
        currentResolve = null;
        reject(new Error('Timeout'));
      }
    }, 8000);
  });
}

async function nextStep() {
  try {
    // Step 1: Runtime.enable
    console.log('Step 1: Runtime.enable');
    await ask('Runtime.enable');
    console.log('OK\n');

    // Step 2: evaluate 1+1
    console.log('Step 2: Evaluate 1+1');
    const r2 = await ask('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    console.log('Result:', JSON.stringify(r2.result));
    console.log('OK\n');

    // Step 3: check window.vscode
    console.log('Step 3: Check window.vscode');
    const r3 = await ask('Runtime.evaluate', { expression: 'typeof window.vscode', returnByValue: true });
    console.log('Result:', JSON.stringify(r3.result));
    console.log('OK\n');

    // Step 4: invoke codebuddy:session.create
    console.log('Step 4: codebuddy:session.create');
    const r4 = await ask('Runtime.evaluate', {
      expression: '(async () => { const r = await window.vscode.ipcRenderer.invoke("codebuddy:session.create", {type:"agent",config:{}}); return JSON.stringify(r); })()',
      returnByValue: true
    });
    console.log('Result:', JSON.stringify(r4.result));
    console.log('OK\n');

    console.log('ALL DONE');
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  ws.close();
}