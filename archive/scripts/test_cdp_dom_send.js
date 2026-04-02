// test_cdp_dom_send.js - 通过 CDP 操作 DOM 发送消息到 AI Agent
// 找到 AI 输入框，模拟用户输入
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
  await send('Page.enable');
  await new Promise(r => setTimeout(r, 2000));

  // 分析 DOM，找 AI 输入框
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 找所有可能包含 AI 输入框的元素
      const results = {
        // 找 Monaco 相关
        monaco: !!document.querySelector('.monaco-editor'),
        // 找 Workbench 的 AI 面板
        workbenchAi: !!document.querySelector('[data-panelid="workbench.panel.ai"]'),
        // 找 Claw 相关
        claw: !!document.querySelector('[data-testid="claw"]'),
        claw2: Array.from(document.querySelectorAll('*')).find(el =>
          el.className && el.className.includes && el.className.includes('claw')
        )?.className || 'not found',
        // 找 CodeBuddy overlay
        overlay: !!document.querySelector('[id*="overlay"]'),
        // 找输入相关
        textareas: document.querySelectorAll('textarea').length,
        // 找所有 panel
        panels: Array.from(document.querySelectorAll('[role="panel"], [role="region"]')).map(el => el.id || el.className || el.tagName).slice(0, 10),
        // 找特定字符串
        ai: Array.from(document.querySelectorAll('*')).find(el =>
          el.children.length === 0 && el.textContent &&
          (el.textContent.includes('Claw') || el.textContent.includes('Agent'))
        )?.className || 'not found'
      };
      return JSON.stringify(results);
    })()`
  });
  console.log('DOM analysis:', JSON.stringify(JSON.parse(r1.result?.result?.value || '{}'), null, 2));



  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));