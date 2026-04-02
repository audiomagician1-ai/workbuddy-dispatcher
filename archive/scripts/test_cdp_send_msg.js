// test_cdp_send_msg.js - 找到聊天输入框并发送消息
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

  // 找聊天输入框和发送按钮
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 找 contenteditable
      const editable = document.querySelector('[contenteditable="true"]');
      const parent = editable?.parentElement;
      const grandParent = parent?.parentElement;

      const info = {
        editable: editable ? {
          tag: editable.tagName,
          id: editable.id,
          class: editable.className,
          visible: editable.offsetWidth > 0,
          rect: editable.getBoundingClientRect()
        } : null,
        parent: parent ? {
          tag: parent.tagName,
          id: parent.id,
          class: parent.className.substring(0, 60)
        } : null,
        grandParent: grandParent ? {
          tag: grandParent.tagName,
          id: grandParent.id,
          class: grandParent.className.substring(0, 60)
        } : null,
        // 找发送按钮
        buttons: Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent.trim().substring(0, 30),
          class: b.className.substring(0, 60),
          visible: b.offsetWidth > 0
        })).filter(b => b.visible),
        // 找 chat-box
        chatBox: document.querySelector('[class*="chatBox"]')?.className || 'not found',
        chatInputArea: document.querySelector('[class*="chatInput"], [class*="inputArea"], [class*="messageBox"]')?.className || 'not found'
      };
      return JSON.stringify(info);
    })()`
  });
  console.log('Chat UI details:', JSON.stringify(JSON.parse(r1.result?.result?.value || '{}'), null, 2));

  // 尝试输入文字到 contenteditable
  console.log('\nTrying to type in the input...');
  const r2 = await send('Runtime.evaluate', {
    expression: `(function() {
      const editable = document.querySelector('[contenteditable="true"]');
      if (!editable) return 'no editable found';

      // 点击聚焦
      editable.focus();

      // 设置文字
      editable.textContent = '你好，这是测试消息';
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));

      return 'text set: ' + editable.textContent;
    })()`
  });
  console.log('Type result:', r2.result?.result?.value);

  // 等待一下，然后找发送按钮并点击
  await new Promise(r => setTimeout(r, 1000));

  // 找发送按钮
  const r3 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 找所有按钮
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        class: b.className,
        visible: b.offsetWidth > 0,
        disabled: b.disabled
      })).filter(b => b.visible);

      return JSON.stringify(buttons);
    })()`
  });
  console.log('Buttons:', JSON.stringify(JSON.parse(r3.result?.result?.value || '[]'), null, 2));

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));