// read_wb_sessions.js - 获取 WorkBuddy (非Claw) 会话数据
const WebSocket = require('ws');
const http = require('http');

async function main() {
  const targets = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const workbench = targets.find(t => t.type === 'page' && t.url.includes('workbench.html') && !t.url.includes('agentManager'));
  console.log(`Connecting to: ${workbench.title}`);

  const ws = new WebSocket(workbench.webSocketDebuggerUrl);
  let mid = 0;
  const pending = {};
  function cdpSend(method, params, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const id = ++mid;
      const timer = setTimeout(() => { delete pending[id]; reject(new Error('timeout')); }, timeout);
      pending[id] = { resolve, timer };
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending[msg.id]) {
      clearTimeout(pending[msg.id].timer);
      pending[msg.id].resolve(msg);
      delete pending[msg.id];
    }
  });

  ws.on('open', async () => {
    console.log('Connected\n');
    await cdpSend('Runtime.enable');

    // 测试多个 IPC 通道
    const channels = [
      'codebuddy:getSessions',
      'codebuddy:getSession',
      'codebuddy:listSessions',
      'codebuddy:chat.sessionList',
      'codebuddy:chat.history',
      'codebuddy:getMessages',
    ];

    for (const channel of channels) {
      try {
        const r = await cdpSend('Runtime.evaluate', {
          expression: `(async function() {
            try {
              const result = await window.vscode.ipcRenderer.invoke('${channel}');
              return JSON.stringify({ ok: true, type: typeof result, value: result });
            } catch(e) {
              return JSON.stringify({ ok: false, error: e.message });
            }
          })()`,
          awaitPromise: true,
          returnByValue: true
        });
        const val = r.result?.result?.value;
        const parsed = JSON.parse(val || '{}');
        console.log(`${channel}: ${parsed.ok ? '✅' : '❌'} ${parsed.ok ? JSON.stringify(parsed.value).substring(0, 300) : parsed.error}`);
      } catch(e) {
        console.log(`${channel}: ❌ ${e.message}`);
      }
    }

    // 试试看有没有获取单个会话消息的通道
    // 先从 agentManager 的 DOM 获取会话 ID
    console.log('\n--- Getting session IDs from DOM ---');
    const agentPage = targets.find(t => t.url.includes('agentManager.html'));
    if (agentPage) {
      const ws2 = new WebSocket(agentPage.webSocketDebuggerUrl);
      let mid2 = 0;
      const pending2 = {};
      function cdpSend2(method, params, timeout = 8000) {
        return new Promise((resolve, reject) => {
          const id = ++mid2;
          const timer = setTimeout(() => { delete pending2[id]; reject(new Error('timeout')); }, timeout);
          pending2[id] = { resolve, timer };
          ws2.send(JSON.stringify({ id, method, params }));
        });
      }
      ws2.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pending2[msg.id]) {
          clearTimeout(pending2[msg.id].timer);
          pending2[msg.id].resolve(msg);
          delete pending2[msg.id];
        }
      });

      await new Promise((resolve) => {
        ws2.on('open', async () => {
          await cdpSend2('Runtime.enable');
          
          const ids = await cdpSend2('Runtime.evaluate', {
            expression: `(function() {
              // 找 conversation-item 里的 data attributes
              const items = document.querySelectorAll('[class*="conversation-item"]');
              return Array.from(items).map(item => {
                const allAttrs = {};
                for (const attr of item.attributes) {
                  if (attr.name.startsWith('data-')) allAttrs[attr.name] = attr.value;
                }
                return {
                  text: item.textContent.substring(0, 40).trim(),
                  attrs: allAttrs,
                  class: item.className.substring(0, 40)
                };
              });
            })()`
          });
          console.log('Session items:', ids.result?.result?.value);
          ws2.close();
          resolve();
        });
        ws2.on('error', () => { resolve(); });
      });
    }

    ws.close();
  });

  ws.on('error', (e) => console.error(e.message));
}

main().catch(console.error);
