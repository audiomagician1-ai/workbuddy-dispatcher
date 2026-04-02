// test_cdp_workflow.js - 完整流程：创建 session，发送 prompt
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

  // 安装拦截器（不重复）
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

  // Step 1: upsertSession 创建/更新会话
  console.log('Step 1: upsertSession...');
  const r1 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', {
      conversationId: '', cwd: 'c:/Users/Gu YongSheng/WorkBuddy/Claw',
      userId: 'test-user', customTitle: 'CDP Test', status: 'active'
    })`
  });
  console.log('upsertSession CDP response type:', r1.result?.result?.subtype);

  await new Promise(r => setTimeout(r, 3000));

  // Step 2: 通过 CodeBuddy overlay webview 发送 prompt
  // 连接 overlay webview 并发送消息
  console.log('\nStep 2: 尝试通过 overlay 发送 prompt...');

  // 获取 overlay webview 的 CDP URL
  const targets = await send('Target.getTargets', {});
  const overlayTarget = targets.result?.result?.filter(t =>
    t.title?.includes('CodeBuddy') || t.url?.includes('CodeBuddy.overlay')
  );
  console.log('Overlay targets:', JSON.stringify(overlayTarget?.map(t => ({id: t.id, title: t.title}))));

  // 直接在 overlay 里注入脚本
  // 但 overlay 是 sandboxed，window.vscode 不存在
  // 所以改用 postMessage 模拟 UI 操作

  // Step 3: 通过 getSessions 确认 session 列表
  console.log('\nStep 3: getClawSessions...');
  const r3 = await send('Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions', {})`
  });
  const sessions = r3.result?.result?.value;
  console.log('Claw sessions:', sessions);

  // 打印 IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.slice(-20).forEach((e, i) => {
    const d = JSON.stringify(e.data || e.result || e.error || '');
    console.log(`  ${i} [${e.dir}] ${e.channel}: ${d.substring(0, 150)}`);
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));