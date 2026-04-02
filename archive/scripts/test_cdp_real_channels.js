// test_cdp_real_channels.js - 使用正确的 IPC 通道
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (!msg.id && msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params?.args || []).map(a => a.value || '').join('');
    if (text.includes('[INJECT') || text.includes('IPC') || text.includes('channel') || text.includes('result') || text.includes('Result')) {
      console.log('  [Console]', text.substring(0, 200));
    }
  }
});

ws.on('open', async () => {
  console.log('Connected to Workbench\n');

  await send('Runtime.enable');
  await send('Log.enable');
  console.log('Domains enabled\n');

  // 注入拦截器
  console.log('Installing IPC interceptor...');
  await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode';
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
      return 'ok';
    })()`,
    returnByValue: true
  });
  console.log('Interceptor installed\n');

  // 测试正确的通道
  const channels = [
    'codebuddy:getSessions',
    'codebuddy:getClawSessions',
    'codebuddy:getRecentlyOpened',
    'codebuddy:check'
  ];

  for (const ch of channels) {
    try {
      const r = await send('Runtime.evaluate', {
        expression: `window.vscode.ipcRenderer.invoke('${ch}', {})`,
        returnByValue: true
      });
      const val = r.result?.result;
      console.log(`${ch}:`, JSON.stringify(val?.value || val).substring(0, 100));
    } catch(e) {
      console.log(`${ch}: ERROR - ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // 监听 5 秒收集事件
  console.log('\nListening 5s for sessionUpserted events...');
  await new Promise(r => setTimeout(r, 5000));

  // 查询 IPC log
  const rLog = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__wbIPC || [])`,
    returnByValue: true
  });
  const log = JSON.parse(rLog.result?.result?.value || '[]');
  console.log('\nIPC log (', log.length, 'entries):');
  log.forEach((e, i) => {
    const detail = e.data || e.result || e.error;
    console.log(`  ${i} [${e.dir}] ${e.channel}:`, JSON.stringify(detail).substring(0, 150));
  });

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));