#!/usr/bin/env node
/**
 * send_message.js - 通过 CDP 发送消息到 WorkBuddy Agent Manager
 * 用法: node send_message.js "你的消息" [--new]
 * 
 * Options:
 *   --new    创建新任务后再发送
 */
const WebSocket = require('ws');
const http = require('http');

const CDP_PORT = 9222;

// --- Helpers ---

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function findTargetWithInput() {
  const targets = await getTargets();
  for (const t of targets.filter(t => t.type === 'page')) {
    try {
      const found = await new Promise((resolve) => {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        let mid = 0;
        const timer = setTimeout(() => { ws.close(); resolve(null); }, 5000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.evaluate', params: {
            expression: `document.querySelector('[contenteditable="true"]') ? 'yes' : 'no'`
          }}));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === 1) { clearTimeout(timer); ws.close(); resolve(msg.result?.result?.value === 'yes' ? t : null); }
        });
        ws.on('error', () => { clearTimeout(timer); ws.close(); resolve(null); });
      });
      if (found) return found;
    } catch(e) {}
  }
  return null;
}

class CDPAgent {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = {};
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.pending[msg.id]) {
          clearTimeout(this.pending[msg.id].timer);
          this.pending[msg.id].resolve(msg);
          delete this.pending[msg.id];
        }
      });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }

  send(method, params, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => { delete this.pending[id]; reject(new Error(`timeout: ${method}`)); }, timeout);
      this.pending[id] = { resolve, timer };
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result?.result?.value;
  }

  async typeText(text) {
    for (const char of text) {
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: char, text: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await new Promise(r => setTimeout(r, 20));
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await new Promise(r => setTimeout(r, 20));
    }
  }

  async pressEnter() {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await new Promise(r => setTimeout(r, 50));
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const newTask = args.includes('--new');
  const message = args.filter(a => !a.startsWith('--')).join(' ');

  if (!message) {
    console.log('Usage: node send_message.js "message" [--new]');
    console.log('');
    console.log('Options:');
    console.log('  --new    Create new task before sending');
    process.exit(1);
  }

  console.log('🔍 Finding Agent Manager target...');
  const target = await findTargetWithInput();
  if (!target) {
    console.error('❌ No target with input found. Is WorkBuddy running with --remote-debugging-port=9222?');
    process.exit(1);
  }
  console.log(`   Found: ${target.title.substring(0, 60)}`);

  const agent = new CDPAgent(target.webSocketDebuggerUrl);
  await agent.connect();
  console.log('📡 Connected');
  await agent.send('Runtime.enable');

  // 创建新任务
  if (newTask) {
    console.log('📝 Creating new task...');
    await agent.evaluate(`(function() {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '新建任务');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // 点击输入框
  await agent.evaluate(`document.querySelector('[contenteditable="true"]')?.focus()`);
  await new Promise(r => setTimeout(r, 200));

  // 输入
  console.log(`⌨️  Typing: "${message}"`);
  await agent.typeText(message);
  await new Promise(r => setTimeout(r, 200));

  // 验证
  const inputText = await agent.evaluate(`document.querySelector('[contenteditable="true"]')?.textContent`);
  console.log(`   Input: "${inputText}"`);

  // 发送
  console.log('📤 Sending with Enter...');
  await agent.pressEnter();
  await new Promise(r => setTimeout(r, 1000));

  // 验证发送
  const afterSend = await agent.evaluate(`document.querySelector('[contenteditable="true"]')?.textContent`);
  console.log(`   After send: "${afterSend}"`);

  if (afterSend === '' || afterSend === '输入消息...' || afterSend?.includes('输入消息')) {
    console.log('✅ Message sent successfully!');
  } else {
    console.log('⚠️  Input not cleared - message may not have been sent');
  }

  agent.disconnect();
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
