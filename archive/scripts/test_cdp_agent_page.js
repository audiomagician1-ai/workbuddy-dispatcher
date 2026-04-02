// test_cdp_agent_page.js - 连接 Agent Manager page
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/579A94E3EF0094DBE6C6B980953F17DE';
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
  console.log('Connected to Agent Manager\n');
  await send('Runtime.enable');
  await send('Log.enable');
  await new Promise(r => setTimeout(r, 2000));

  // 基本信息
  const r1 = await send('Runtime.evaluate', {
    expression: `'title: ' + document.title + ', bodyChildren: ' + document.body.children.length`
  });
  console.log('Page info:', r1.result?.result?.value);

  // 分析 DOM
  const r2 = await send('Runtime.evaluate', {
    expression: `(function() {
      const body = document.body;
      const info = {
        bodyChildren: Array.from(body.children).map(c => c.tagName + '#' + c.id + '.' + c.className.substring(0, 40)),
        // 找 input
        inputs: Array.from(document.querySelectorAll('input, textarea')).map(i => ({
          tag: i.tagName, id: i.id, class: i.className.substring(0, 50), placeholder: i.placeholder || i.getAttribute('placeholder')
        })),
        // 找 button
        buttons: Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent.trim().substring(0, 30), class: b.className.substring(0, 50)
        })),
        // 找 vscode API
        hasVscode: typeof window.vscode !== 'undefined',
        vscodeKeys: Object.keys(window.vscode || {})
      };
      return JSON.stringify(info);
    })()`
  });
  console.log('Agent Manager DOM:', JSON.stringify(JSON.parse(r2.result?.result?.value || '{}'), null, 2));

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));