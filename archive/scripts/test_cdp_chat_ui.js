// test_cdp_chat_ui.js - 找聊天输入框
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

  // 找聊天输入框
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 找聊天输入框
      const chatInputs = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"], [aria-label*="chat"], [aria-label*="message"], [placeholder*="发"], [placeholder*="输入"], [placeholder*="请"], textarea'));
      const chatInputInfo = chatInputs.map(el => ({
        tag: el.tagName, id: el.id, class: el.className.substring(0, 60),
        placeholder: el.placeholder || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
        visible: el.offsetWidth > 0
      }));

      // 找主要聊天区域
      const chatArea = document.querySelector('#codebuddy-chat-container, [class*="chat-container"], [class*="conversation"]');

      // 找所有 div 的 class
      const divs = Array.from(document.querySelectorAll('DIV[class]')).slice(0, 30).map(d => d.id || d.className.substring(0, 40));

      // 找 cb-chat
      const cbChat = Array.from(document.querySelectorAll('*')).filter(el =>
        el.className && typeof el.className === 'string' && el.className.includes('cb-chat')
      ).slice(0, 5).map(el => el.tagName + '#' + el.id + '.' + el.className.substring(0, 60));

      // 找 message 相关
      const messages = Array.from(document.querySelectorAll('[class*="message"], [class*="chat"]')).slice(0, 10).map(el => el.tagName + '#' + el.id + '.' + el.className.substring(0, 40));

      return JSON.stringify({ chatInputs: chatInputInfo, cbChat, messages, divs: divs.slice(0, 15) });
    })()`
  });
  console.log('Chat UI:', JSON.stringify(JSON.parse(r1.result?.result?.value || '{}'), null, 2));

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));