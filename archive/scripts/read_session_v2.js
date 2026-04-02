// read_session_v2.js - 逐个 page 读取，区分会话
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

  const pages = targets.filter(t => t.type === 'page');
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const result = await new Promise((resolve) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      let mid = 0;
      const timer = setTimeout(() => { ws.close(); resolve(null); }, 8000);
      
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.enable' }));
        ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.evaluate', params: {
          expression: `(function() {
            const userMsgs = Array.from(document.querySelectorAll('[class*="userMessage"]')).map(e => e.textContent.trim()).filter(t => t.length > 0);
            const assistMsgs = Array.from(document.querySelectorAll('[class*="assistant"]')).map(e => e.textContent.trim()).filter(t => t.length > 0);
            const editable = document.querySelector('[contenteditable="true"]');
            
            return JSON.stringify({
              title: document.title,
              userMsgs: userMsgs.slice(-5),
              assistMsgs: assistMsgs.slice(-3),
              hasInput: !!editable,
              inputText: editable ? editable.textContent.trim().substring(0, 40) : null
            });
          })()`
        }}));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 2) { clearTimeout(timer); ws.close(); try { resolve(JSON.parse(msg.result?.result?.value || 'null')); } catch { resolve(null); } }
      });
      ws.on('error', () => { clearTimeout(timer); ws.close(); resolve(null); });
    });

    if (result && (result.userMsgs.length > 0 || result.hasInput)) {
      console.log(`\n=== Page [${i}]: ${result.title} ===`);
      console.log(`Input: "${result.inputText}"`);
      if (result.userMsgs.length > 0) {
        console.log(`User msgs (${result.userMsgs.length}):`);
        result.userMsgs.forEach(m => console.log(`  U: ${m.substring(0, 80)}`));
      }
      if (result.assistMsgs.length > 0) {
        console.log(`Assistant msgs (${result.assistMsgs.length}):`);
        result.assistMsgs.forEach(m => console.log(`  A: ${m.substring(0, 120)}`));
      }
    }
  }
}

main().catch(console.error);
