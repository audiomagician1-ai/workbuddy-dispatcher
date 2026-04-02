// test_cdp_send_v2.js - 动态查找 target + 发送消息
const WebSocket = require('ws');
const http = require('http');

async function main() {
  // 1. 获取所有 targets
  const targets = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  // 2. 找有 contenteditable 的 target
  let targetWsUrl = null;
  let targetId = null;
  
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
          if (msg.id === 1) {
            const val = msg.result?.result?.value;
            ws.close();
            resolve(val === 'yes');
          }
        });
        ws.on('error', () => { ws.close(); resolve(false); });
        setTimeout(() => { ws.close(); resolve(false); }, 5000);
      });
      
      if (found) {
        console.log(`Found input in: ${t.title}`);
        targetWsUrl = t.webSocketDebuggerUrl;
        targetId = t.id;
        break;
      }
    } catch(e) {}
  }

  if (!targetWsUrl) {
    console.error('No target with editable input found!');
    process.exit(1);
  }

  // 3. 连接并发送消息
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

    // 截图看看当前状态
    try {
      const ss = await cdpSend('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync('agent_page_state.png', Buffer.from(ss.result.data, 'base64'));
      console.log('Screenshot: agent_page_state.png');
    } catch(e) { console.log('Screenshot failed:', e.message); }

    // 获取输入框详情
    const info = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('[contenteditable="true"]');
        if (!el) return JSON.stringify({ found: false });
        const rect = el.getBoundingClientRect();
        return JSON.stringify({
          found: true,
          text: el.textContent,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          visible: rect.width > 0,
          class: el.className,
          placeholder: el.getAttribute('data-placeholder') || '',
          parentClass: el.parentElement?.className?.substring(0, 60) || ''
        });
      })()`
    });
    console.log('Input info:', info.result?.result?.value);

    const inputInfo = JSON.parse(info.result?.result?.value);
    if (!inputInfo.found || !inputInfo.visible) {
      console.log('Input not visible. Trying to find it...');
      ws.close();
      return;
    }

    const cx = inputInfo.rect.x + inputInfo.rect.w / 2;
    const cy = inputInfo.rect.y + inputInfo.rect.h / 2;

    // 点击聚焦
    console.log('Clicking input...');
    await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 300));

    // 逐字符输入
    const msg = 'ping';
    console.log(`Typing: "${msg}"`);
    for (const char of msg) {
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'keyDown', key: char, text: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'char', key: char, text: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'keyUp', key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await new Promise(r => setTimeout(r, 50));
    }

    await new Promise(r => setTimeout(r, 500));

    // 验证
    const check = await cdpSend('Runtime.evaluate', {
      expression: `document.querySelector('[contenteditable="true"]')?.textContent`
    });
    console.log(`Input now: "${check.result?.result?.value}"`);

    // 按 Enter 发送
    console.log('Pressing Enter...');
    await cdpSend('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', text: '\r', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await cdpSend('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await new Promise(r => setTimeout(r, 1000));

    // 检查发送结果
    const after = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('[contenteditable="true"]');
        const userMsgs = document.querySelectorAll('[class*="userMessage"], [class*="user-message"]');
        return JSON.stringify({
          inputEmpty: el ? (el.textContent === '' || el.textContent === '输入消息...') : false,
          userMsgCount: userMsgs.length,
          lastUserMsg: userMsgs.length > 0 ? userMsgs[userMsgs.length-1].textContent.substring(0, 50) : 'none'
        });
      })()`
    });
    console.log('After send:', after.result?.result?.value);

    // 截图
    try {
      const ss = await cdpSend('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync('after_send.png', Buffer.from(ss.result.data, 'base64'));
      console.log('Screenshot: after_send.png');
    } catch(e) {}

    // 等待回复
    console.log('\nWaiting for reply (15s)...');
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const reply = await cdpSend('Runtime.evaluate', {
        expression: `(function() {
          const msgs = document.querySelectorAll('[class*="assistant"], [class*="ai-message"]');
          const last = msgs[msgs.length - 1];
          return last ? last.textContent.substring(0, 100) : null;
        })()`
      });
      if (reply.result?.result?.value) {
        console.log(`Reply after ${i+1}s: "${reply.result.result.value}"`);
        console.log('\n✅ SUCCESS!');
        ws.close();
        return;
      }
      process.stdout.write('.');
    }
    console.log('\nNo reply detected (may need different selector)');

    ws.close();
  });

  ws.on('error', (e) => console.error('WS Error:', e.message));
}

main().catch(e => console.error(e));
