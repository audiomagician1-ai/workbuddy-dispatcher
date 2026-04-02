// test_cdp_claw3.js
// 连接 Claw page (038D622...)，用顺序 ws.once 模式
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/038D6223E03EAE3E069A9EEF5E156478';
const ws = new WebSocket(wsUrl);
let msgId = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

ws.on('open', async () => {
  console.log('Connected to Claw page\n');

  const r1 = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  console.log('Title:', r1.result?.result?.value);

  const r2 = await send('Runtime.evaluate', { expression: 'typeof window.vscode', returnByValue: true });
  console.log('window.vscode:', r2.result?.result?.value);

  const r3 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      vscodeKeys: Object.keys(window).filter(k => k.includes('vscode') || k.includes('VSCode')),
      codebuddyKeys: Object.keys(window).filter(k => k.includes('codebuddy') || k.includes('Codebuddy')),
      hasDocument: !!document,
      bodyChildren: document.body ? document.body.children.length : 0
    })`,
    returnByValue: true
  });
  console.log('Keys info:', JSON.stringify(JSON.parse(r3.result?.result?.value || '{}'), null, 2));

  // 截图
  try {
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('claw3.png', Buffer.from(ss.result.data, 'base64'));
    console.log('Screenshot: claw3.png');
  } catch(e) {
    console.log('Screenshot failed:', e.message);
  }

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));