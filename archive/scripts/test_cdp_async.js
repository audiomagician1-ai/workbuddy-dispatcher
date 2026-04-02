// test_cdp_async.js - 正确处理 Promise，正确解析 extension 响应
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

  // 安装拦截器
  await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode?.ipcRenderer || window.__intercepted) return 'skipped';
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

  await new Promise(r => setTimeout(r, 2000));

  // 测试 upsertSession - 不 await，直接返回原始结果
  console.log('=== Testing codebuddy:upsertSession ===');
  const r1 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {
      conversationId: '2f0b4625bf274d9b8a37eb9fa84a2caf',
      cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
      userId: 'bf0fae44-d3a8-4878-965d-74bcf9fa84a2caf',
      customTitle: 'Test',
      status: 'active'
    })`,
    returnByValue: false  // 不 await，看原始 Promise
  });
  console.log('raw result:', JSON.stringify(r1.result?.result));

  // 等待 extension 处理
  await new Promise(r => setTimeout(r, 5000));

  // 查询 IPC log（包含 extension 的实际响应）
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