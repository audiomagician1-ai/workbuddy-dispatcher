/**
 * WorkBuddy CDP 注入 - 直接用 ws 连接 + 执行 JS
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

function wsRecv(ws) {
  return new Promise(resolve => {
    ws.once('message', data => resolve(JSON.parse(data)));
  });
}

async function main() {
  const targets = await getTargets();

  // 找 CodeBuddy overlay webview（AI 输入框）
  const overlayTarget = targets.find(t =>
    t.url.includes('CodeBuddy.overlay') && t.type === 'iframe'
  );

  // 找 coding-copilot webview（主 AI 面板）
  const copilotTarget = targets.find(t =>
    t.url.includes('Tencent-Cloud.coding-copilot') && t.type === 'iframe'
  );

  // 找主 workbench 页面
  const mainTarget = targets.find(t => t.title.includes('MEMORY.md'));

  const toTest = [
    { t: overlayTarget, name: 'CodeBuddy Overlay' },
    { t: copilotTarget, name: 'Coding Copilot' },
    { t: mainTarget, name: 'Main Workbench' },
  ];

  let msgId = 1;

  for (const { t, name } of toTest) {
    if (!t) { console.log(`\n[*] ${name}: 未找到`); continue; }

    console.log(`\n[*] 连接 ${name}...`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);

    await new Promise(r => ws.on('open', r));

    // 执行 JS: 检查 window 上的 API
    wsSend(ws, msgId++, 'Runtime.evaluate', {
      expression: `JSON.stringify({
        hasVscode: typeof window.vscode !== 'undefined',
        hasCodebuddy: typeof window.codebuddy !== 'undefined',
        vscodeKeys: window.vscode ? Object.keys(window.vscode) : [],
        codebuddyKeys: window.codebuddy ? Object.keys(window.codebuddy) : [],
        location: window.location.href.slice(0, 60)
      })`,
      returnByValue: true
    });

    const resp = await wsRecv(ws);
    console.log(`    结果:`, JSON.stringify(resp, null, 2));

    // 如果有 vscode，检查 ipcRenderer
    wsSend(ws, msgId++, 'Runtime.evaluate', {
      expression: `window.vscode && window.vscode.ipcRenderer ? JSON.stringify({
        hasSend: typeof window.vscode.ipcRenderer.send === 'function',
        hasInvoke: typeof window.vscode.ipcRenderer.invoke === 'function',
        hasOn: typeof window.vscode.ipcRenderer.on === 'function'
      }) : 'no ipcRenderer'`,
      returnByValue: true
    });

    const resp2 = await wsRecv(ws);
    console.log(`    ipcRenderer:`, JSON.stringify(resp2, null, 2));

    ws.close();
  }
}

main().catch(e => console.error('Error:', e.message));
