// test_cdp_send_v3.js - 修复字符重复 + 精确发送 + 精确检测回复
const WebSocket = require('ws');
const http = require('http');

async function main() {
  // 1. 获取 targets 并找到 agent manager
  const targets = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  let targetWsUrl = null;
  for (const t of targets.filter(t => t.type === 'page')) {
    try {
      const found = await new Promise((resolve, reject) => {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        let mid = 0;
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.evaluate', params: {
            expression: `document.querySelector('[contenteditable="true"]') ? 'yes' : 'no'`
          }}));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === 1) { ws.close(); resolve(msg.result?.result?.value === 'yes'); }
        });
        ws.on('error', () => { ws.close(); resolve(false); });
        setTimeout(() => { ws.close(); resolve(false); }, 5000);
      });
      if (found) { targetWsUrl = t.webSocketDebuggerUrl; console.log(`Target: ${t.title}`); break; }
    } catch(e) {}
  }
  if (!targetWsUrl) { console.error('No input found'); process.exit(1); }

  // 2. 连接
  const ws = new WebSocket(targetWsUrl);
  let msgId = 0;
  const pending = {};
  function cdpSend(method, params, timeout = 15000) {
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
    console.log('Connected\n');
    await cdpSend('Runtime.enable');
    await cdpSend('Log.enable');

    // 3. 先创建新会话（点击"新建任务"按钮）
    console.log('Creating new task...');
    const newTaskResult = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '新建任务');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not found';
      })()`
    });
    console.log('New task:', newTaskResult.result?.result?.value);
    await new Promise(r => setTimeout(r, 2000));

    // 4. 获取输入框
    const inputInfo = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('[contenteditable="true"]');
        if (!el) return JSON.stringify({ found: false });
        el.focus();
        const rect = el.getBoundingClientRect();
        return JSON.stringify({ found: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
      })()`
    });
    const info = JSON.parse(inputInfo.result?.result?.value);
    if (!info.found) { console.log('No input after new task'); ws.close(); return; }

    const cx = info.rect.x + info.rect.w / 2;
    const cy = info.rect.y + info.rect.h / 2;

    // 5. 点击聚焦
    await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 300));

    // 6. 逐字符输入（只用 keyDown + keyUp，不用 char 事件，避免重复）
    const message = 'hello';
    console.log(`Typing: "${message}"`);
    for (const char of message) {
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'keyDown', key: char, text: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await new Promise(r => setTimeout(r, 30));
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'keyUp', key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => setTimeout(r, 300));

    // 7. 验证输入
    const check = await cdpSend('Runtime.evaluate', {
      expression: `document.querySelector('[contenteditable="true"]')?.textContent`
    });
    console.log(`Input: "${check.result?.result?.value}"`);

    // 8. 记录当前消息数量
    const beforeCount = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        // 查找所有消息容器
        const containers = document.querySelectorAll('[class*="chatMessage"], [class*="message-item"]');
        return containers.length;
      })()`
    });
    console.log(`Messages before send: ${beforeCount.result?.result?.value}`);

    // 9. 按 Enter 发送（Slate: Enter without Shift = submit）
    console.log('Sending with Enter...');
    await cdpSend('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await new Promise(r => setTimeout(r, 50));
    await cdpSend('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await new Promise(r => setTimeout(r, 1500));

    // 10. 检查发送结果
    const afterSend = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('[contenteditable="true"]');
        const inputText = el ? el.textContent.trim() : 'NOT FOUND';
        
        // 检查各种可能的消息选择器
        const selectors = [
          '[class*="userMessage"]',
          '[class*="user-message"]', 
          '[class*="chatMessage"]',
          '[class*="message-item"]',
          '[class*="messageContent"]'
        ];
        const counts = {};
        selectors.forEach(s => { counts[s] = document.querySelectorAll(s).length; });
        
        return JSON.stringify({ inputText, messageCounts: counts });
      })()`
    });
    console.log('After send:', afterSend.result?.result?.value);

    // 11. 截图
    try {
      const ss = await cdpSend('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync('after_send_v3.png', Buffer.from(ss.result.data, 'base64'));
      console.log('Screenshot: after_send_v3.png');
    } catch(e) {}

    // 12. 等待 Agent 回复
    console.log('\nWaiting for reply (30s)...');
    const before = JSON.parse(afterSend.result?.result?.value).messageCounts;
    
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      
      const state = await cdpSend('Runtime.evaluate', {
        expression: `(function() {
          // 检查是否有新增的 assistant 消息
          const assistantSelectors = [
            '[class*="assistant"]',
            '[class*="ai-message"]',
            '[class*="bot-message"]'
          ];
          let allText = '';
          assistantSelectors.forEach(s => {
            const els = document.querySelectorAll(s);
            if (els.length > 0) {
              allText += els[els.length - 1].textContent.substring(0, 150);
            }
          });
          
          // 检查输入框是否恢复为空/placeholder 状态
          const el = document.querySelector('[contenteditable="true"]');
          const inputState = el ? el.textContent.trim() : '';
          
          return JSON.stringify({ lastAssistantText: allText, inputState });
        })()`
      });
      
      const s = JSON.parse(state.result?.result?.value);
      process.stdout.write('.');
      
      if (s.lastAssistantText && s.lastAssistantText.length > 5) {
        console.log(`\nAgent replied after ${i+1}s: "${s.lastAssistantText.substring(0, 100)}"`);
        console.log(`Input state: "${s.inputState}"`);
        
        // 最终截图
        try {
          const ss = await cdpSend('Page.captureScreenshot', { format: 'png' });
          require('fs').writeFileSync('agent_reply.png', Buffer.from(ss.result.data, 'base64'));
          console.log('Screenshot: agent_reply.png');
        } catch(e) {}
        
        console.log('\n✅ END-TO-END SUCCESS!');
        ws.close();
        return;
      }
    }
    console.log('\nTimeout - no new assistant reply detected');

    ws.close();
  });

  ws.on('error', (e) => console.error('WS Error:', e.message));
}

main().catch(console.error);
