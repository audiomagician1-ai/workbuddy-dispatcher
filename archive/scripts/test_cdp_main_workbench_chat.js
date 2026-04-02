// test_cdp_main_workbench_chat.js - 找主 workbench 的聊天视图
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
  console.log('Connected to Main Workbench\n');
  await send('Runtime.enable');
  await send('Log.enable');
  await new Promise(r => setTimeout(r, 2000));

  // 分析主 workbench DOM
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 找 chat-container, coding-copilot 等
      const chatContainer = document.querySelector('[class*="chat-container"], #chat-container');
      const copilot = document.querySelector('[class*="copilot"], [class*="coding-copilot"]');
      const panel = document.querySelector('#workbench\\.parts\\.panel, [part="panel"]');

      return JSON.stringify({
        chatContainer: chatContainer ? {
          class: chatContainer.className.substring(0, 60),
          visible: chatContainer.offsetWidth > 0,
          childCount: chatContainer.children.length
        } : null,
        copilot: copilot ? {
          class: copilot.className.substring(0, 60),
          visible: copilot.offsetWidth > 0
        } : null,
        panel: panel ? {
          class: panel.className.substring(0, 60),
          visible: panel.offsetWidth > 0
        } : null,
        // 找 coding-copilot webview
        webviews: Array.from(document.querySelectorAll('iframe[src*="coding-copilot"], iframe[src*="copilot"]')).map(w => ({
          src: w.src ? w.src.substring(0, 100) : '',
          visible: w.offsetWidth > 0
        })),
        // 找 workbench 的主要 panel
        panels: Array.from(document.querySelectorAll('[role="region"], [part]')).map(p => ({
          part: p.getAttribute('part'),
          class: p.className.substring(0, 40)
        })).slice(0, 10)
      });
    })()`
  });
  console.log('Main workbench DOM:', JSON.stringify(JSON.parse(r1.result?.result?.value || '{}'), null, 2));

  // 截图
  try {
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('main-workbench-chat.png', Buffer.from(ss.result.data, 'base64'));
    console.log('\nScreenshot: main-workbench-chat.png');
  } catch(e) {
    console.log('Screenshot failed:', e.message);
  }

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));