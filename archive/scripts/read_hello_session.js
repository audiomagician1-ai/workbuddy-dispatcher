// read_hello_session.js - 精确查找 "hello" 测试会话的回复
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

  // 找 agentManager page
  const agentPage = targets.find(t => t.url.includes('agentManager.html'));
  if (!agentPage) { console.log('agentManager not found'); return; }

  const ws = new WebSocket(agentPage.webSocketDebuggerUrl);
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
    await cdpSend('Runtime.enable');

    // 获取完整的聊天区域结构——找到每个会话面板
    const structure = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        // 找所有会话容器（每个 tab/panel 对应一个会话）
        // 看看有没有 data-conversation-id 或类似属性
        const allWithId = Array.from(document.querySelectorAll('[data-conversation-id], [data-session-id], [data-id]'));
        const conversations = allWithId.map(el => ({
          tag: el.tagName,
          id: el.getAttribute('data-conversation-id') || el.getAttribute('data-session-id') || el.getAttribute('data-id'),
          class: el.className.substring(0, 60),
          childCount: el.children.length
        }));

        // 找所有 tab 标签
        const tabs = Array.from(document.querySelectorAll('[class*="tab"], [role="tab"]')).filter(t => t.textContent.trim()).map(t => ({
          text: t.textContent.trim().substring(0, 30),
          active: t.classList.toString().includes('active') || t.getAttribute('aria-selected') === 'true',
          class: t.className.substring(0, 60)
        }));

        // 找所有独立的聊天容器
        const chatContainers = Array.from(document.querySelectorAll('[class*="chat-container"], [class*="chatContainer"], [class*="conversation"]')).map(c => ({
          class: c.className.substring(0, 60),
          visible: c.offsetWidth > 0,
          childCount: c.children.length,
          textSnippet: c.textContent.substring(0, 100).trim()
        }));

        return JSON.stringify({ conversations, tabs, chatContainers }, null, 2);
      })()`
    });
    console.log('Page structure:\n', structure.result?.result?.value);

    // 找包含 "hello" 的消息
    const helloMsgs = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        // 找所有包含 "hello" 的文本
        const allElements = document.querySelectorAll('[class*="userMessage"], [class*="assistant"], [class*="chatMessage"]');
        const helloRelated = [];
        allElements.forEach(el => {
          if (el.textContent.includes('hello') || el.textContent.includes('Hello') || el.textContent.includes('HELLO')) {
            // 找它的父容器
            let container = el.closest('[class*="chat-container"], [class*="chatContainer"], [class*="conversation"]');
            if (!container) container = el.parentElement?.parentElement;
            
            helloRelated.push({
              type: el.className.includes('user') ? 'USER' : 
                   el.className.includes('assistant') ? 'ASSISTANT' : 'OTHER',
              class: el.className.substring(0, 40),
              text: el.textContent.substring(0, 200).trim(),
              containerClass: container?.className?.substring(0, 60) || 'none',
              containerVisible: container ? container.offsetWidth > 0 : false
            });
          }
        });
        return JSON.stringify(helloRelated, null, 2);
      })()`
    });
    console.log('\n"hello" related messages:\n', helloMsgs.result?.result?.value);

    ws.close();
  });

  ws.on('error', (e) => console.error(e.message));
}

main().catch(console.error);
