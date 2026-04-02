// test_cdp_overlay.js
// 连接 CodeBuddy overlay webview，测试它的 API
const WebSocket = require('ws');

// CodeBuddy overlay iframe
const overlayWsUrl = 'ws://localhost:9222/devtools/page/A0118BE4966B9B32B8DA24043B2CA03C';

let msgId = 0;
function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

const ws = new WebSocket(overlayWsUrl);

ws.on('open', async () => {
  console.log('Connected to CodeBuddy overlay\n');

  // 基本信息
  const r1 = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  console.log('Title:', r1.result?.result?.value);

  // 全局 API
  const r2 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(Object.keys(window).filter(k => /[A-Z]/.test(k) && k.length < 25))`,
    returnByValue: true
  });
  console.log('Global keys:', r2.result?.result?.value);

  // 找输入框
  const r3 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      textareas: document.querySelectorAll('textarea').length,
      editable: document.querySelectorAll('[contenteditable="true"]').length,
      allInputs: document.querySelectorAll('input').length,
      bodyChildren: document.body ? document.body.children.length : 'no body',
      classes: Array.from(document.querySelectorAll('*')).slice(0,20).map(e => e.tagName + '.' + e.className.substring(0,30))
    })`,
    returnByValue: true
  });
  console.log('DOM:', JSON.stringify(JSON.parse(r3.result?.result?.value || '{}'), null, 2));

  // window.vscode
  const r4 = await send('Runtime.evaluate', { expression: 'typeof window.vscode', returnByValue: true });
  console.log('\nwindow.vscode:', r4.result?.result?.value);

  // window.codebuddy
  const r5 = await send('Runtime.evaluate', { expression: 'typeof window.codebuddy', returnByValue: true });
  console.log('window.codebuddy:', r5.result?.result?.value);

  // 截图
  try {
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('overlay.png', Buffer.from(ss.result.data, 'base64'));
    console.log('Screenshot: overlay.png');
  } catch(e) {
    console.log('Screenshot failed:', e.message);
  }

  ws.close();
  console.log('Done');
});

ws.on('error', (e) => console.error('WS Error:', e.message));