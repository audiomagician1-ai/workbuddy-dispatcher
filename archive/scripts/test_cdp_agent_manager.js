// test_cdp_agent_manager.js - 分析 Agent Manager UI 和交互方式
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};

function send(method, params, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { delete pending[id]; reject(new Error(`Timeout: ${method}`)); }, timeout);
    pending[id] = { resolve };
    function msgHandler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending[msg.id]) { clearTimeout(pending[msg.id].timeout); const { resolve: r } = pending[msg.id]; delete pending[msg.id]; r(msg); }
    }
    if (!ws._handler) { ws._handler = msgHandler; ws.on('message', msgHandler); }
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.on('open', async () => {
  console.log('Connected\n');
  await send('Runtime.enable');
  await send('Log.enable');
  await new Promise(r => setTimeout(r, 2000));

  // 深度分析 Agent Manager 元素
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      const el = document.querySelector('.codebuddy-agent-manager-text') ||
                 document.querySelector('[class*="agent-manager"]') ||
                 document.querySelector('[class*="claw"]') ||
                 Array.from(document.querySelectorAll('*')).find(e =>
                   e.className && typeof e.className === 'string' &&
                   (e.className.includes('agent') || e.className.includes('claw')) &&
                   e.children.length > 0 && e.children.length < 20
                 );

      if (!el) return 'no agent/claw element found';

      const info = {
        tag: el.tagName,
        class: el.className,
        id: el.id,
        childCount: el.children.length,
        childTags: Array.from(el.children).map(c => c.tagName + '.' + c.className.substring(0, 30)),
        childIds: Array.from(el.children).map(c => c.id).filter(Boolean),
        // 找 input
        inputs: Array.from(el.querySelectorAll('input, textarea')).map(i => ({
          tag: i.tagName, id: i.id, class: i.className.substring(0, 40), placeholder: i.placeholder
        })),
        // 找 button
        buttons: Array.from(el.querySelectorAll('button')).map(b => ({
          text: b.textContent.trim().substring(0, 30), class: b.className.substring(0, 40)
        })),
        // 找 shadow DOM
        shadowRoot: !!el.shadowRoot,
        shadowChildren: el.shadowRoot ? el.shadowRoot.children.length : 0
      };
      return JSON.stringify(info);
    })()`
  });
  console.log('Agent element:', JSON.stringify(JSON.parse(r1.result?.result?.value || '{}'), null, 2));

  // 分析整个 document 的结构
  const r2 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 找 body 下的直接子元素
      const bodyKids = Array.from(document.body.children).map((el, i) => ({
        tag: el.tagName, id: el.id, class: el.className.substring(0, 50),
        childCount: el.children.length
      }));

      // 找 workbench 的 panel area
      const panel = document.querySelector('#workbench.parts.panel, [id*="panel"], [class*="panel"]');

      // 找所有包含 "input" 的元素
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).slice(0, 10).map(i => ({
        tag: i.tagName, id: i.id, class: i.className.substring(0, 50), type: i.type, placeholder: i.placeholder
      }));

      return JSON.stringify({ bodyKids, panelFound: !!panel, inputs });
    })()`
  });
  console.log('\nDoc structure:', JSON.stringify(JSON.parse(r2.result?.result?.value || '{}'), null, 2));

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));