/**
 * WorkBuddy CDP - 直接连接 Claw 专用 page
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

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
  const raw = await get(`http://localhost:${CDP_PORT}/json`);
  const targets = JSON.parse(raw);

  // 找所有 page 类型的 target
  const pages = targets.filter(t => t.type === 'page');
  console.log('[*] 所有 page 类型目标:');
  for (const p of pages) {
    console.log(`  - ${p.title}`);
    console.log(`    URL: ${p.url}`);
  }

  // 找 Claw 专用 page
  const clawPage = targets.find(t => t.title === 'Claw - WorkBuddy');
  const agentMgr = targets.find(t => t.url.includes('agentManager'));

  console.log('\n[*] 尝试连接 Claw page...');
  if (clawPage) {
    const ws = new WebSocket(clawPage.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));

    let id = 1;

    // 截图
    wsSend(ws, id++, 'Page.captureScreenshot', { format: 'png' });
    let resp = await wsRecv(ws);
    if (resp.result && resp.result.data) {
      fs.writeFileSync('A:/GitHub/agent-infra/claw-page.png', Buffer.from(resp.result.data, 'base64'));
      console.log('[+] Claw page 截图已保存');
    }

    // 检查 API
    wsSend(ws, id++, 'Runtime.evaluate', {
      expression: `JSON.stringify({
        hasVscode: typeof window.vscode !== 'undefined',
        vscodeKeys: window.vscode ? Object.keys(window.vscode) : [],
        title: document.title,
        bodyChildren: document.body.children.length
      })`,
      returnByValue: true
    });
    resp = await wsRecv(ws);
    console.log('\n[*] Claw page info:\n', JSON.stringify(resp, null, 2));

    ws.close();
  } else {
    console.log('[!] 未找到 Claw page');
  }

  console.log('\n[*] 尝试连接 agentManager...');
  if (agentMgr) {
    const ws = new WebSocket(agentMgr.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));

    let id = 1;
    wsSend(ws, id++, 'Page.captureScreenshot', { format: 'png' });
    let resp = await wsRecv(ws);
    if (resp.result && resp.result.data) {
      fs.writeFileSync('A:/GitHub/agent-infra/agent-manager.png', Buffer.from(resp.result.data, 'base64'));
      console.log('[+] Agent Manager 截图已保存');
    }

    wsSend(ws, id++, 'Runtime.evaluate', {
      expression: `JSON.stringify({
        hasVscode: typeof window.vscode !== 'undefined',
        vscodeKeys: window.vscode ? Object.keys(window.vscode) : [],
        title: document.title,
        inputs: Array.from(document.querySelectorAll('input, textarea')).map(e => e.tagName + '#' + e.id + '.' + e.className.toString().slice(0,40)).slice(0, 10)
      })`,
      returnByValue: true
    });
    resp = await wsRecv(ws);
    console.log('\n[*] Agent Manager info:\n', JSON.stringify(resp, null, 2));

    ws.close();
  } else {
    console.log('[!] 未找到 agentManager page');
  }
}

main().catch(e => console.error('Error:', e.message));
