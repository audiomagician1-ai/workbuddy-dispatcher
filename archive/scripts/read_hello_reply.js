// read_hello_reply.js - 点击 "hello" 会话，读取 Agent 回复
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

  const agentPage = targets.find(t => t.url.includes('agentManager.html'));
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

    // 1. 找侧边栏里 "hello" 会话并点击
    console.log('1. Clicking "hello" session in sidebar...');
    const clickResult = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        // 找包含 "hello" 的会话卡片
        const cards = Array.from(document.querySelectorAll('[class*="conversation-item"], [class*="card"]'));
        const helloCard = cards.find(c => c.textContent.includes('hello'));
        
        if (!helloCard) {
          // 也试试在 conversation-list 里找
          const listItems = Array.from(document.querySelectorAll('[class*="conversation-list"] [class*="item"], [class*="conversation-list"] > div > div'));
          const helloItem = listItems.find(c => c.textContent.includes('hello'));
          if (helloItem) {
            helloItem.click();
            return JSON.stringify({ found: true, text: helloItem.textContent.substring(0, 50), class: helloItem.className.substring(0, 50) });
          }
          return 'not found';
        }
        helloCard.click();
        return JSON.stringify({ found: true, text: helloCard.textContent.substring(0, 50), class: helloCard.className.substring(0, 50) });
      })()`
    });
    console.log('   Result:', clickResult.result?.result?.value);

    // 等待切换
    await new Promise(r => setTimeout(r, 2000));

    // 2. 读取当前活跃的聊天内容
    console.log('\n2. Reading active chat content...');
    const chatContent = await cdpSend('Runtime.evaluate', {
      expression: `(function() {
        // 找当前可见的 chat-container
        const containers = Array.from(document.querySelectorAll('[class*="chat-container"]'));
        const visibleContainer = containers.find(c => c.offsetWidth > 0);
        
        if (!visibleContainer) return 'no visible chat container';
        
        // 提取所有 user 和 assistant 消息
        const userMsgs = Array.from(visibleContainer.querySelectorAll('[class*="userMessage"]')).map(e => e.textContent.trim());
        const assistMsgs = Array.from(visibleContainer.querySelectorAll('[class*="assistant"] [class*="text"], [class*="assistantText"]')).map(e => e.textContent.trim());
        const allAssistantText = Array.from(visibleContainer.querySelectorAll('[class*="assistant"]')).map(e => e.textContent.trim());
        
        return JSON.stringify({
          containerClass: visibleContainer.className.substring(0, 60),
          userMsgCount: userMsgs.length,
          userMsgs: userMsgs.slice(-5),
          assistTextCount: assistMsgs.length,
          assistTexts: assistMsgs.slice(-5),
          allAssistantCount: allAssistantText.length,
          allAssistant: allAssistantText.slice(-3).map(t => t.substring(0, 150))
        }, null, 2);
      })()`
    });
    console.log(chatContent.result?.result?.value);

    // 3. 截图
    try {
      const ss = await cdpSend('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync('hello_session.png', Buffer.from(ss.result.data, 'base64'));
      console.log('\nScreenshot: hello_session.png');
    } catch(e) {}

    ws.close();
  });

  ws.on('error', (e) => console.error(e.message));
}

main().catch(console.error);
