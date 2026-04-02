// test_cdp_correct_format.js - 用正确格式测试 session/new 和 upsertSession
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};

function send(method, params, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { delete pending[id]; reject(new Error(`Timeout: ${method}`)); }, timeout);
    pending[id] = { resolve };

    function msgHandler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending[msg.id]) {
        clearTimeout(pending[msg.id].timeout);
        const { resolve: res } = pending[msg.id];
        delete pending[msg.id];
        res(msg);
      }
    }

    if (!ws._handler) { ws._handler = msgHandler; ws.on('message', msgHandler); }

    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.on('open', async () => {
  console.log('Connected\n');
  await send('Runtime.enable');
  await send('Log.enable');

  // 安装无重复拦截器（避免 double-invoke 问题）
  await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode';
      if (window.__intercepted) return 'already intercepted';
      window.__intercepted = true;
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
      return 'intercepted';
    })()`
  });
  console.log('Interceptor installed\n');

  // 等待 extension 完全启动
  await new Promise(r => setTimeout(r, 2000));

  // 测试 session/new with 正确格式
  console.log('=== Testing session/new ===');
  const r1 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('session/new', {
          cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
          mcpServers: []
        });
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`
  });
  console.log('session/new result:', r1.result?.result?.value);

  await new Promise(r => setTimeout(r, 3000));

  // 测试 upsertSession with 正确格式
  console.log('\n=== Testing codebuddy:upsertSession ===');
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const r = await window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {
          conversationId: '2f0b4625bf274d9b8a37eb9fa84a2caf',
          cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
          userId: 'bf0fae44-d3a8-4878-965d-74bcf9fa84a2caf',
          customTitle: 'Test',
          status: 'active'
        });
        return JSON.stringify(r);
      } catch(e) { return 'ERROR: ' + e.message; }
    })()`
  });
  console.log('upsertSession result:', r2.result?.result?.value);

  // 打印 IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.error || '');
    console.log(`  ${i} [${e.dir}] ${e.channel || ''}: ${d.substring(0, 200)}`);
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));