/**
 * WorkBuddy CDP - 深入 Claw AI 面板
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

async function wsRecv(ws) {
  return new Promise(r => ws.once('message', d => r(JSON.parse(d))));
}

async function main() {
  const raw = await get(`http://localhost:${CDP_PORT}/json`);
  const targets = JSON.parse(raw);

  // 找主 workbench
  const mainTarget = targets.find(t =>
    t.title.includes('MEMORY.md') && t.type === 'page'
  );

  console.log('[*] 连接主 Workbench...\n');
  const ws = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;

  // 找 Claw 相关的 DOM 节点
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      // 找所有包含 "Claw" 文字的元素
      clawElements: Array.from(document.querySelectorAll('*')).filter(el =>
        el.childNodes.length === 1 && el.textContent.trim() === 'Claw'
      ).map(el => el.tagName + '#' + el.id + '.' + el.className.toString().split(' ')[0]),
      // 找底部面板
      panel: document.querySelector('[class*="panel"]')?.className.toString().slice(0,100),
      // 找所有可能包含输入框的区域
      inputs: Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'))
        .map(el => el.tagName + '#' + el.id + '.' + el.className.toString().slice(0,50))
        .slice(0, 10),
      // 找 role 为 textbox 的元素
      textboxes: Array.from(document.querySelectorAll('[role="textbox"], [role="input"]'))
        .map(el => el.tagName + '#' + el.id + '.' + el.className.toString().slice(0,50))
    })`,
    returnByValue: true
  });

  let resp = await wsRecv(ws);
  console.log('[*] Claw 面板 DOM:\n', JSON.stringify(resp, null, 2));

  // 列出所有 iframe（webview）
  wsSend(ws, id++, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      iframes: frames.length,
      iframeSrcs: Array.from(frames).map(f => f.location.href.slice(0, 80))
    })`,
    returnByValue: true
  });

  resp = await wsRecv(ws);
  console.log('\n[*] 所有 iframe:\n', JSON.stringify(resp, null, 2));

  ws.close();
}

main().catch(e => console.error('Error:', e.message));
