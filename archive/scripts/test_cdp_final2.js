// test_cdp_final2.js - ID-based CDP routing，避免 ws.once 乱序
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};  // id -> {resolve, timeout}

function send(method, params, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => {
      delete pending[id];
      reject(new Error(`Timeout: ${method}`));
    }, timeout);

    pending[id] = { resolve, reject, method };

    // 同时监听所有消息，路由到正确的 pending 请求
    function messageHandler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending[msg.id]) {
        clearTimeout(pending[msg.id].timeout);
        const { resolve: res } = pending[msg.id];
        delete pending[msg.id];
        res(msg);
      }
    }

    // 只在第一次调用时添加全局监听器
    if (!ws._msgHandler) {
      ws._msgHandler = messageHandler;
      ws.on('message', messageHandler);
    }

    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.on('open', async () => {
  console.log('Connected\n');
  await send('Runtime.enable');
  await send('Log.enable');

  // 安装 IPC 拦截器
  console.log('Installing IPC interceptor...');
  const r0 = await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode';
      const oldInvoke = window.vscode.ipcRenderer.invoke.bind(window.vscode.ipcRenderer);
      window.__wbIPC = [];
      window.vscode.ipcRenderer.invoke = function(ch, data) {
        window.__wbIPC.push({ dir: 'out', channel: ch, data: JSON.parse(JSON.stringify(data)) });
        return oldInvoke(ch, data).then(r => {
          window.__wbIPC.push({ dir: 'in', channel: ch, result: JSON.parse(JSON.stringify(r)) });
          return r;
        }).catch(e => {
          window.__wbIPC.push({ dir: 'err', channel: ch, error: e.message });
          throw e;
        });
      };
      return 'ok';
    })()`
  });
  console.log('Interceptor:', JSON.stringify(r0.result?.result));

  // 等待 extension 启动
  console.log('\nWaiting 3s for extension...\n');
  await new Promise(r => setTimeout(r, 3000));

  // 测试 upsertSession
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
    })()`
  });
  console.log('upsertSession result:', r1.result?.result?.value);

  await new Promise(r => setTimeout(r, 3000));

  // 测试 session/new
  console.log('\n=== Testing session/new ===');
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('session/new', {
          cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
          prompt: '你好'
        });
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`
  });
  console.log('session/new result:', r2.result?.result?.value);

  // 打印 IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.slice(-15).forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.error || '');
    console.log(`  ${i} [${e.dir}] ${e.channel || ''}: ${d.substring(0, 200)}`);
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));