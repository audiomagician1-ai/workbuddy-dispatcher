#!/usr/bin/env node
/**
 * read_sessions.js - 通过 CDP 读取 WorkBuddy 会话信息
 * 用法: node read_sessions.js [--claw]
 */
const WebSocket = require('ws');
const http = require('http');

async function main() {
  const showClaw = process.argv.includes('--claw');
  
  const targets = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const workbench = targets.find(t => t.type === 'page' && t.url.includes('workbench.html') && !t.url.includes('agentManager'));
  if (!workbench) {
    console.error('❌ Workbench not found');
    process.exit(1);
  }

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
    await cdpSend('Runtime.enable');

    if (showClaw) {
      console.log('=== Claw Sessions ===\n');
      const r = await cdpSend('Runtime.evaluate', {
        expression: `(async () => {
          const result = await window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions');
          return JSON.stringify(result, null, 2);
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      console.log(r.result?.result?.value);
    } else {
      console.log('=== WorkBuddy Sessions ===\n');
      const r = await cdpSend('Runtime.evaluate', {
        expression: `(async () => {
          const result = await window.vscode.ipcRenderer.invoke('codebuddy:getSessions');
          return JSON.stringify(result, null, 2);
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      console.log(r.result?.result?.value);
    }

    ws.close();
  });

  ws.on('error', (e) => console.error('❌', e.message));
}

main().catch(console.error);
