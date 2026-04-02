// test_cdp_find_chat.js - 重启后动态找到聊天输入框所在的 target
const WebSocket = require('ws');
const http = require('http');

// 1. 获取所有 targets
http.get('http://localhost:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const targets = JSON.parse(data);
    const pages = targets.filter(t => t.type === 'page' || t.type === 'iframe');
    console.log(`Found ${pages.length} pages/iframes, scanning for chat input...\n`);

    // 2. 逐个探测
    let idx = 0;
    function probeNext() {
      if (idx >= pages.length) {
        console.log('\nDone scanning. No chat input found in any target.');
        process.exit(0);
      }
      const target = pages[idx];
      const wsUrl = target.webSocketDebuggerUrl;
      console.log(`[${idx}] ${target.title.substring(0, 50)} (${target.type})`);
      
      const ws = new WebSocket(wsUrl);
      let msgId = 0;
      const pending = {};

      function send(method, params, timeout = 8000) {
        return new Promise((resolve, reject) => {
          const id = ++msgId;
          const timer = setTimeout(() => { delete pending[id]; reject(new Error('timeout')); }, timeout);
          pending[id] = { resolve, timer };
          ws.send(JSON.stringify({ id, method, params }));
        });
      }

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pending[msg.id]) {
          clearTimeout(pending[msg.id].timer);
          pending[msg.id].resolve(msg);
          delete pending[msg.id];
        }
      });

      ws.on('open', async () => {
        try {
          await send('Runtime.enable');
          
          // 检查是否有 contenteditable 输入框
          const r = await send('Runtime.evaluate', {
            expression: `(function() {
              const editables = document.querySelectorAll('[contenteditable="true"]');
              const textareas = document.querySelectorAll('textarea');
              const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
              const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t);
              
              return JSON.stringify({
                editables: editables.length,
                textareas: textareas.length,
                textInputs: inputs.length,
                editableClasses: Array.from(editables).map(e => e.className.substring(0, 50)).slice(0, 3),
                buttonLabels: buttons.slice(0, 5),
                bodyChildCount: document.body.children.length,
                hasChatContainer: !!document.querySelector('[class*="chat"]'),
                hasInputArea: !!document.querySelector('[class*="input"], [class*="message"]'),
                hasEditable: !!document.querySelector('[class*="editable"]'),
                title: document.title
              });
            })()`
          });

          const info = JSON.parse(r.result?.result?.value || '{}');
          
          // 如果有 contenteditable 且有 chat 相关元素，标记为候选
          if (info.editables > 0 && (info.hasChatContainer || info.hasEditable || info.hasInputArea)) {
            console.log(`  >>> CANDIDATE! editables=${info.editables}, buttons=[${info.buttonLabels.join(',')}], classes=${JSON.stringify(info.editableClasses)}`);
            console.log(`  >>> Target ID: ${target.id}`);
            console.log(`  >>> WS URL: ${wsUrl}`);
          } else if (info.editables > 0) {
            console.log(`  editables=${info.editables} (no chat context)`);
          } else {
            console.log(`  no input found`);
          }
        } catch(e) {
          console.log(`  error: ${e.message}`);
        }
        ws.close();
        idx++;
        setTimeout(probeNext, 300);
      });

      ws.on('error', (e) => {
        console.log(`  ws error: ${e.message}`);
        idx++;
        setTimeout(probeNext, 300);
      });
    }

    probeNext();
  });
}).on('error', (e) => {
  console.error('Failed to connect:', e.message);
});
