// test_cdp_wait.js - 加长等待时间，看 extension 是否有响应
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

  // 单独测试 session/new，等待响应
  console.log('Testing session/new...');
  const r1 = await send('Runtime.evaluate', {
    expression: `(async () => {
      const r = await window.vscode.ipcRenderer.invoke('session/new', {cwd:'c:/Users/Gu YongSheng/WorkBuddy/Claw', mcpServers:[]});
      return 'got: ' + JSON.stringify(r);
    })()`
  }, 15000);
  console.log('session/new CDP response:', JSON.stringify(r1.result?.result));

  // 等待更久
  console.log('\nWaiting 10s for extension response...');
  await new Promise(r => setTimeout(r, 10000));

  // 查询 IPC log
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