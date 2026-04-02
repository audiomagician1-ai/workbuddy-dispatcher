// test_cdp_string_arg.js - 测试 getClawSessions 是否只接受 string cwd
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

  await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode?.ipcRenderer || window.__intercepted) return 'skip';
      window.__intercepted = true;
      const oldInvoke = window.vscode.ipcRenderer.invoke.bind(window.vscode.ipcRenderer);
      window.__wbIPC = [];
      window.vscode.ipcRenderer.invoke = function(ch, data) {
        window.__wbIPC.push({ dir: 'out', channel: ch, data });
        const p = oldInvoke(ch, data);
        p.then(r => window.__wbIPC.push({ dir: 'in', channel: ch, result: r }))
         .catch(e => window.__wbIPC.push({ dir: 'err', channel: ch, error: e.message }));
        return p;
      };
      return 'ok';
    })()`
  });

  await new Promise(r => setTimeout(r, 2000));

  const cwd = 'c:/Users/Gu YongSheng/WorkBuddy/Claw';
  const cwdEscaped = cwd.replace(/'/g, "\\'");

  // 测试 getClawSessions(cwd_string)
  console.log('=== Test 1: getClawSessions as string ===');
  await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions', '${cwdEscaped}')`
  });

  await new Promise(r => setTimeout(r, 3000));

  // 测试 getSessions({cwd, userId...})
  console.log('=== Test 2: getSessions with userId ===');
  const userId = 'bf0fae44-d3a8-4878-965d-74bcf9fa84a2caf';
  await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:getSessions', {limit: 10000, offset: 0, userId: '${userId}'})`
  });

  await new Promise(r => setTimeout(r, 3000));

  // IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.error || '');
    console.log(`  ${i} [${e.dir}] ${e.channel}: ${d.substring(0, 200)}`);
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));