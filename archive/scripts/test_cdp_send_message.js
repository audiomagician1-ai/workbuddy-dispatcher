// test_cdp_send_message.js - 通过 CDP 模拟键盘输入发送消息到 Agent Manager
const WebSocket = require('ws');

const TARGET_ID = 'E073C461311BC253D8EFC077103C3EC4';
const wsUrl = `ws://localhost:9222/devtools/page/${TARGET_ID}`;
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};

function send(method, params, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => { delete pending[id]; reject(new Error('timeout')); }, timeout);
    pending[id] = { resolve, timer };
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// CDP key event helpers
function keyDown(key, text = '') {
  return {
    type: 'keyDown',
    key,
    text,
    code: key === 'Enter' ? 'Enter' : `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: key === 'Enter' ? 13 : key.charCodeAt(0),
    nativeVirtualKeyCode: key === 'Enter' ? 13 : key.charCodeAt(0)
  };
}
function keyUp(key) {
  return {
    type: 'keyUp',
    key,
    code: key === 'Enter' ? 'Enter' : `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: key === 'Enter' ? 13 : key.charCodeAt(0),
    nativeVirtualKeyCode: key === 'Enter' ? 13 : key.charCodeAt(0)
  };
}
function charEvent(text) {
  return {
    type: 'char',
    key: text,
    text,
    code: `Key${text.toUpperCase()}`,
    windowsVirtualKeyCode: text.charCodeAt(0),
    nativeVirtualKeyCode: text.charCodeAt(0)
  };
}

async function typeText(text) {
  for (const char of text) {
    if (char === '\n') {
      await send('Input.dispatchKeyEvent', keyDown('Enter', '\n'));
      await send('Input.dispatchKeyEvent', keyUp('Enter'));
    } else {
      await send('Input.dispatchKeyEvent', keyDown(char, char));
      await send('Input.dispatchKeyEvent', charEvent(char));
      await send('Input.dispatchKeyEvent', keyUp(char));
    }
    // Small delay between keystrokes for React to process
    await new Promise(r => setTimeout(r, 30));
  }
}

const TEST_MESSAGE = 'hello, this is a test message from CDP';

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending[msg.id]) {
    clearTimeout(pending[msg.id].timer);
    pending[msg.id].resolve(msg);
    delete pending[msg.id];
  }
});

ws.on('open', async () => {
  console.log('Connected to Agent Manager\n');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Input.setInterceptDrags', { enabled: true });

  // 1. 点击输入框聚焦
  console.log('1. Focusing input...');
  const editableRect = await send('Runtime.evaluate', {
    expression: `(function() {
      const el = document.querySelector('[contenteditable="true"]');
      if (!el) return null;
      el.focus();
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`
  });
  const coords = JSON.parse(editableRect.result?.result?.value || 'null');
  if (!coords) { console.error('No input found!'); ws.close(); return; }

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 200));

  // 2. 输入文字（逐字符模拟键盘）
  console.log(`2. Typing: "${TEST_MESSAGE}"`);
  await typeText(TEST_MESSAGE);
  await new Promise(r => setTimeout(r, 500));

  // 3. 验证输入框内容
  const checkInput = await send('Runtime.evaluate', {
    expression: `(function() {
      const el = document.querySelector('[contenteditable="true"]');
      return el ? el.textContent : 'NOT FOUND';
    })()`
  });
  console.log(`   Input content: "${checkInput.result?.result?.value}"`);

  // 4. 按 Enter 发送
  console.log('3. Pressing Enter to send...');
  await send('Input.dispatchKeyEvent', keyDown('Enter', '\r'));
  await send('Input.dispatchKeyEvent', keyUp('Enter'));
  await new Promise(r => setTimeout(r, 1000));

  // 5. 检查消息是否发出（输入框应清空）
  const afterSend = await send('Runtime.evaluate', {
    expression: `(function() {
      const el = document.querySelector('[contenteditable="true"]');
      const text = el ? el.textContent : 'NOT FOUND';
      
      // 检查是否出现了新的用户消息气泡
      const messages = Array.from(document.querySelectorAll('[class*="userMessage"], [class*="message-content"], [class*="chatMessage"]'));
      const lastMsg = messages.length > 0 ? messages[messages.length - 1].textContent.substring(0, 60) : 'no messages';
      
      return JSON.stringify({ inputText: text, msgCount: messages.length, lastMsg });
    })()`
  });
  console.log(`   After Enter: ${afterSend.result?.result?.value}`);

  // 6. 等待 Agent 回复（30秒）
  console.log('\n4. Waiting for agent reply (30s)...');
  
  // 设置 MutationObserver 监听 DOM 变化
  await send('Runtime.evaluate', {
    expression: `(function() {
      window.__msgCount = 0;
      window.__agentReply = null;
      
      const observer = new MutationObserver(() => {
        // 查找 assistant 消息
        const assistantMsgs = document.querySelectorAll('[class*="assistant"], [class*="agent"], [class*="ai-message"]');
        if (assistantMsgs.length > window.__msgCount) {
          window.__msgCount = assistantMsgs.length;
          const last = assistantMsgs[assistantMsgs.length - 1];
          window.__agentReply = last.textContent.substring(0, 200);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      
      return 'observer set';
    })()`
  });

  // 轮询检查回复
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const check = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ reply: window.__agentReply, count: window.__msgCount })`
    });
    const info = JSON.parse(check.result?.result?.value || '{}');
    if (info.reply && info.reply.length > 0) {
      console.log(`   Agent replied after ${i + 1}s:`);
      console.log(`   "${info.reply}"`);
      console.log('\n✅ SUCCESS! End-to-end message send works!');
      ws.close();
      return;
    }
    process.stdout.write('.');
  }
  console.log('\n   No reply received in 30s');
  console.log('   (Message may have been sent but reply not detected via DOM)');

  // 最后截图看看状态
  try {
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('after_send.png', Buffer.from(ss.result.data, 'base64'));
    console.log('   Screenshot saved: after_send.png');
  } catch(e) {}

  ws.close();
});

ws.on('error', (e) => console.error('WS Error:', e.message));
