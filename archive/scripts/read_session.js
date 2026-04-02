// read_session.js - 读取指定 CDP target 中的聊天内容
const WebSocket = require('ws');
const http = require('http');

async function getTargetId(index) {
  const targets = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  return targets[index];
}

async function main() {
  // 先列出所有 targets 找到 agentManager 和 会话页面
  const targets = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const pages = targets.filter(t => t.type === 'page');
  console.log('Pages:');
  pages.forEach((p, i) => console.log(`  [${i}] ${p.title.substring(0, 60)} (${p.id})`));

  // 扫描所有 page 找有聊天内容的
  for (const page of pages) {
    try {
      const result = await new Promise((resolve) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let mid = 0;
        const timer = setTimeout(() => { ws.close(); resolve(null); }, 8000);
        
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.enable' }));
          // 查找所有消息
          ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.evaluate', params: {
            expression: `(function() {
              // 找所有 user 和 assistant 消息
              const allMsgs = [];
              
              // 尝试多种选择器
              const selectors = {
                userMessage: '[class*="userMessage"]',
                assistantMessage: '[class*="assistant"]',
                chatMessage: '[class*="chatMessage"]',
                messageContent: '[class*="messageContent"]',
                thinkingBlock: '[class*="thinking"]',
              };
              
              for (const [name, sel] of Object.entries(selectors)) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                  allMsgs.push({
                    selector: name,
                    count: els.length,
                    texts: Array.from(els).slice(-3).map(e => e.textContent.substring(0, 80).trim())
                  });
                }
              }
              
              // 也找 contenteditable
              const editable = document.querySelector('[contenteditable="true"]');
              
              return JSON.stringify({
                title: document.title,
                msgGroups: allMsgs,
                hasInput: !!editable,
                inputText: editable ? editable.textContent.substring(0, 50) : null
              });
            })()`
          }}));
        });

        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === 2) {
            clearTimeout(timer);
            ws.close();
            try { resolve(JSON.parse(msg.result?.result?.value || '{}')); }
            catch { resolve(null); }
          }
        });
        ws.on('error', () => { clearTimeout(timer); ws.close(); resolve(null); });
      });

      if (result && result.msgGroups && result.msgGroups.length > 0) {
        console.log(`\n=== ${result.title} ===`);
        console.log(`Input: "${result.inputText}"`);
        for (const g of result.msgGroups) {
          console.log(`\n  [${g.selector}] (${g.count} total):`);
          g.texts.forEach(t => console.log(`    - ${t}`));
        }
      }
    } catch(e) {}
  }
}

main().catch(console.error);
