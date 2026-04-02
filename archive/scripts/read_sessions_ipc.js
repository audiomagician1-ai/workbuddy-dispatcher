// read_sessions_ipc.js - 通过 IPC 获取 hello 会话的完整对话数据
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

  // 找主 workbench（不是 agentManager）
  const workbench = targets.find(t => t.type === 'page' && t.url.includes('workbench.html') && !t.url.includes('agentManager'));
  if (!workbench) { console.log('No workbench found'); return; }
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

    // 通过 IPC 获取 Claw sessions
    console.log('Fetching Claw sessions via IPC...');
    const sessions = await cdpSend('Runtime.evaluate', {
      expression: `(async function() {
        if (!window.vscode || !window.vscode.ipcRenderer) return 'no vscode API';
        try {
          const result = await window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions');
          return JSON.stringify({ type: typeof result, value: result });
        } catch(e) {
          return JSON.stringify({ error: e.message });
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    
    const sessionsData = sessions.result?.result?.value;
    console.log('Sessions result:', sessionsData);

    // 解析 sessions 找 hello 会话
    if (sessionsData) {
      try {
        // sessionsData 可能是嵌套的 JSON 字符串
        const parsed = JSON.parse(sessionsData);
        console.log('\nParsed sessions:', JSON.stringify(parsed, null, 2).substring(0, 2000));
      } catch(e) {
        console.log('Raw sessions:', sessionsData.substring(0, 2000));
      }
    }

    ws.close();
  });

  ws.on('error', (e) => console.error(e.message));
}

main().catch(console.error);
