/**
 * WorkBuddy CDP - 监听 IPC 事件，看看 codebuddy:* 通道的响应格式
 */
const WebSocket = require('ws');
const http = require('http');

const CDP_PORT = 9222;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function wsSend(ws, id, method, params) {
  ws.send(JSON.stringify({ id, method, params }));
}

async function wsRecvAll(ws, timeout = 3000) {
  return new Promise(r => {
    const msgs = [];
    const timer = setTimeout(() => r(msgs), timeout);
    ws.on('message', d => {
      msgs.push(JSON.parse(d));
      // 如果收到 result，清空计时器
      if (msgs[msgs.length - 1]?.id) clearTimeout(timer);
    });
  });
}

async function main() {
  const raw = await get(`http://localhost:${CDP_PORT}/json`);
  const targets = JSON.parse(raw);
  const clawPage = targets.find(t => t.title === 'Claw - WorkBuddy');
  if (!clawPage) { console.log('Claw page not found'); return; }

  console.log('[*] 连接 Claw page...\n');
  const ws = new WebSocket(clawPage.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1;

  // 1. 尝试注册一个 IPC 监听器，看看有没有事件来
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `(() => {
  const events = [];
  // 监听一些可能的 event channel
  const channels = ['codebuddy:result', 'codebuddy:response', 'agent:result', 'chat:result', 'session:result'];
  channels.forEach(ch => {
    try {
      window.vscode.ipcRenderer.on(ch, (data) => {
        events.push({ channel: ch, data: JSON.stringify(data) });
        console.log('[EVENT]', ch, data);
      });
    } catch(e) {}
  });

  // 也监听一般的 postMessage 看看有没有消息来
  window.addEventListener('message', (e) => {
    events.push({ type: 'postMessage', data: JSON.stringify(e.data) });
    console.log('[POSTMESSAGE]', e.data);
  });

  return '监听器已注册, channels: ' + channels.join(', ');
})()`,
    returnByValue: true
  });

  let resp = await wsRecvAll(ws, 3000);
  console.log('[*] 监听器注册结果:');
  for (const r of resp) {
    console.log(JSON.stringify(r, null, 2));
  }

  // 2. 发一个消息，然后等事件
  console.log('\n[*] 发送 chat.send 并监听响应...');
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `window.vscode.ipcRenderer.invoke('codebuddy:chat.send', { message: '你好，测试消息' }).then(r => 'sent: ' + JSON.stringify(r)).catch(e => 'error: ' + e.message)`,
    returnByValue: true
  });

  // 等 5 秒看有没有事件来
  resp = await wsRecvAll(ws, 5000);
  console.log(`\n[*] 收到 ${resp.length} 条消息:`);
  for (const r of resp) {
    console.log(JSON.stringify(r, null, 2).slice(0, 300));
  }

  ws.close();
}

main().catch(e => console.error('Error:', e.message));
