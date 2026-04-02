/**
 * WorkBuddy CDP - DOM 操作测试
 * 通过 CDP 操作 WorkBuddy 的 UI，模拟用户输入
 */
const WebSocket = require('ws');
const https = require('https');
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

async function wsRecv(ws) {
  return new Promise(r => ws.once('message', d => r(JSON.parse(d))));
}

async function main() {
  // 获取 targets
  const raw = await get(`http://localhost:${CDP_PORT}/json`);
  const targets = JSON.parse(raw);

  // 找 CodeBuddy overlay webview（输入框）
  const overlayTarget = targets.find(t =>
    t.url.includes('CodeBuddy.overlay') && t.type === 'iframe'
  );

  // 找主 workbench
  const mainTarget = targets.find(t =>
    t.title.includes('MEMORY.md') && t.type === 'page'
  );

  console.log('[*] 连接主 Workbench (DOM 操作)...\n');
  const ws = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;

  // 1. 截图看整体 UI
  wsSend(ws, id++, 'Page.captureScreenshot', { format: 'png' });
  let resp = await wsRecv(ws);
  if (resp.result && resp.result.data) {
    require('fs').writeFileSync('A:/GitHub/agent-infra/workbuddy-screenshot.png', Buffer.from(resp.result.data, 'base64'));
    console.log('[+] 截图已保存: workbuddy-screenshot.png');
  }

  // 2. 获取主 workbench 的 DOM 结构
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      bodyChildren: document.body.children.length,
      bodyTags: Array.from(document.body.children).map(c => c.tagName + (c.id ? '#'+c.id : '') + (c.className ? '.'+c.className.toString().slice(0,30) : ''))
    })`,
    returnByValue: true
  });
  resp = await wsRecv(ws);
  console.log('\n[*] DOM 结构:');
  console.log(JSON.stringify(resp, null, 2));

  // 3. 尝试在主 workbench 里找 sidebar / panel
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      sidebars: document.querySelectorAll('[class*="sidebar"]').length,
      panels: document.querySelectorAll('[class*="panel"]').length,
      // 找 activity bar
      activityBar: document.querySelectorAll('[class*="activity"]').length,
      // 找 vscode 的工作区容器
      workbench: !!document.querySelector('[class*="workbench"]'),
      // 找所有可能的内容区域
      areas: Array.from(document.querySelectorAll('[role="main"], main, [class*="content"], [class*="editor"]')).slice(0,5).map(a => a.className.toString().slice(0,50))
    })`,
    returnByValue: true
  });
  resp = await wsRecv(ws);
  console.log('\n[*] UI 区域:');
  console.log(JSON.stringify(resp, null, 2));

  ws.close();
}

main().catch(e => console.error('Error:', e.message));
