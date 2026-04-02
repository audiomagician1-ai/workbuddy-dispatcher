/**
 * WorkBuddy CDP - 监听主 Workbench 的 IPC 消息
 * 触发一些操作，看 Workbench 和 overlay 之间怎么通信
 */
const WebSocket = require('ws');

const CDP_PORT = 9222;

async function getTargets() {
  const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
  return resp.json();
}

function wsSend(ws, id, method, params) {
  ws.send(JSON.stringify({ id, method, params }));
}

function wsRecvAll(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => resolve(messages), timeout);
    ws.on('message', data => {
      messages.push(JSON.parse(data));
      clearTimeout(timer);
      resolve(messages);
    });
    ws.on('error', reject);
  });
}

async function main() {
  const targets = await getTargets();
  const mainTarget = targets.find(t => t.title.includes('MEMORY.md'));

  if (!mainTarget) { console.log('Main workbench not found'); return; }

  console.log('[*] 连接主 Workbench 并启用日志...\n');
  const ws = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let msgId = 1;

  // 启用 Page.lifecycleEvent
  wsSend(ws, msgId++, 'Page.setLifecycleEventsEnabled', { enabled: true });
  // 启用 Log
  wsSend(ws, msgId++, 'Log.enable', {});
  // 启用 Network
  wsSend(ws, msgId++, 'Network.enable', {});

  // 等待一下让事件来
  await new Promise(r => setTimeout(r, 1000));

  // 现在尝试执行 JS 来触发 overlay 通信
  // 先检查 overlay 的 postMessage API
  wsSend(ws, msgId++, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      // 找所有 iframe
      iframeCount: frames.length,
      parentOrigin: window.parent === window ? 'top' : 'nested',
      // 检查是否有面向 overlay 的消息监听
      hasPostMessage: typeof window.postMessage !== 'undefined',
      // 尝试列出所有 window 对象的 key（过滤）
      keys: Object.keys(window).filter(k => k.includes('Listener') || k.includes('Handler') || k.includes('Callback'))
    })`,
    returnByValue: true
  });

  const resp = await wsRecvAll(ws, 3000);
  console.log('Window info:', JSON.stringify(resp[resp.length - 1], null, 2));

  // 监听接下来 5 秒的所有事件
  console.log('\n[*] 监听中（5秒）...');
  wsSend(ws, msgId++, 'Runtime.evaluate', {
    expression: `(() => {
      // 注入一个消息监听器，监听所有 postMessage
      const originalPostMessage = window.postMessage;
      window.postMessage = function(msg, target, transfer) {
        console.log('[CDP-INJECTED postMessage]', msg, target);
        return originalPostMessage.apply(this, arguments);
      };
      return 'postMessage hooked';
    })()`,
    returnByValue: true
  });

  const events = await wsRecvAll(ws, 5000);
  console.log(`\n[*] 收到 ${events.length} 条消息`);
  for (const e of events.slice(-5)) {
    console.log('  ', JSON.stringify(e).slice(0, 200));
  }

  ws.close();
}

main().catch(e => console.error('Error:', e.message));
