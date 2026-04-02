// test_cdp_claw_intercept.js
// 连接 Claw page，直接注入脚本监听 session/prompt 调用
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/038D6223E03EAE3E069A9EEF5E156478';
const ws = new WebSocket(wsUrl);
let msgId = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

ws.on('open', async () => {
  console.log('Connected to Claw page\n');
  await send('Runtime.enable');
  await send('Log.enable');

  // 注入深度拦截器 - 监听所有 vscode API 调用
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode) return 'no vscode';

      // 深度监听 ipcRenderer
      const ipc = window.vscode.ipcRenderer;
      if (!ipc) return 'no ipcRenderer';

      // 保存原始方法
      const origInvoke = ipc.invoke.bind(ipc);
      const origSend = ipc.send ? ipc.send.bind(ipc) : null;
      const origPostMessage = window.postMessage.bind(window);

      // 拦截 invoke
      window.__clawInvokeLog = [];
      ipc.invoke = function(channel, data) {
        window.__clawInvokeLog.push({ type: 'invoke', channel, data: JSON.parse(JSON.stringify(data)) });
        return origInvoke(channel, data).then(r => {
          window.__clawInvokeLog.push({ type: 'invoke_result', channel, result: JSON.parse(JSON.stringify(r)) });
          return r;
        }).catch(e => {
          window.__clawInvokeLog.push({ type: 'invoke_error', channel, error: e.message });
          throw e;
        });
      };

      // 监听消息
      ipc.onDidReceiveMessage = function(handler) {
        window.__clawInvokeLog.push({ type: 'listen_didReceiveMessage', handler: 'registered' });
      };

      return 'deep interceptor installed on Claw page';
    })()`,
    returnByValue: true
  });
  console.log('Injection:', JSON.stringify(r1.result?.result));

  // 等待
  await new Promise(r => setTimeout(r, 3000));

  // 查询调用日志
  const r2 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__clawInvokeLog || [])`,
    returnByValue: true
  });
  const log = JSON.parse(r2.result?.result?.value || '[]');
  console.log('\nClaw page IPC log (', log.length, 'entries):');
  log.forEach((e, i) => {
    console.log(i, e.type, e.channel || '', JSON.stringify(e.data || e.result || e.error || e.handler || '').substring(0, 200));
  });

  // 也检查 window 上的其他 API
  const r3 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hasVscode: typeof window.vscode,
      vscodeKeys: Object.keys(window.vscode || {}),
      hasPostMessage: typeof window.postMessage,
      bodyChildTags: Array.from(document.body.children).map(c => c.tagName)
    })`,
    returnByValue: true
  });
  console.log('\nClaw page APIs:', JSON.stringify(JSON.parse(r3.result?.result?.value || '{}'), null, 2));

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));