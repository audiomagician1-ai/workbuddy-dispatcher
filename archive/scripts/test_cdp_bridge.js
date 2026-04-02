// test_cdp_bridge.js - 注入 bridge 到 workbench，让 CDP 可以调用 extension 并获取返回值
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

  // 注入 bridge - 在 window 上暴露一个 callChannel 方法
  // CDP 通过这个方法调用 extension 并获取返回值
  console.log('Injecting bridge...\n');
  const r0 = await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.vscode?.ipcRenderer) return 'no vscode';

      // 创建 bridge 对象
      window.__agentBridge = {
        calls: [],
        results: {},
        callId: 0,
        // 同步调用 ipcRenderer.invoke 并等待结果
        syncCall: function(channel, data) {
          const id = ++this.callId;
          const start = Date.now();
          const self = this;

          // 同步调用（会阻塞，但 IPC 是异步的所以不会真正阻塞）
          this.calls.push({id, channel, data, start});

          // 我们用同步的外层 + async 的内层来获取结果
          // 通过返回一个 Promise，在 resolve 时存储结果
          const p = new Promise(function(resolve) {
            window.vscode.ipcRenderer.invoke(channel, data).then(function(r) {
              self.results[id] = { ok: true, result: r, ms: Date.now() - start };
              resolve(r);
            }).catch(function(e) {
              self.results[id] = { ok: false, error: e.message, ms: Date.now() - start };
              resolve({__error: e.message});
            });
          });

          // CDP 无法 await Promise，但我们可以用另一个 hack：
          // 在 window 上直接存储结果
          return id; // 返回 call ID
        },
        // 获取结果
        getResult: function(id) {
          return this.results[id] || null;
        }
      };

      // 直接调用并存储结果
      window.__doCall = function(channel, data) {
        const id = ++window.__agentBridge.callId;
        window.vscode.ipcRenderer.invoke(channel, data).then(function(r) {
          window.__agentBridge.results[id] = {ok: true, result: r};
        }).catch(function(e) {
          window.__agentBridge.results[id] = {ok: false, error: e.message};
        });
        return id;
      };

      return 'bridge installed, callId=' + window.__agentBridge.callId;
    })()`
  });
  console.log('Bridge injection:', JSON.stringify(r0.result?.result));

  await new Promise(r => setTimeout(r, 1000));

  // 通过 bridge 调用 getClawSessions
  const cwd = 'c:/Users/Gu YongSheng/WorkBuddy/Claw';

  console.log('\nCalling getClawSessions via bridge...');
  // 先调用
  const callId = await send('Runtime.evaluate', {
    expression: `window.__doCall('codebuddy:getClawSessions', {limit:100,offset:0,userId:'test'})`
  });
  console.log('Call ID:', callId.result?.result?.value);

  // 等待 extension 处理
  await new Promise(r => setTimeout(r, 3000));

  // 获取结果
  console.log('\nGetting result...');
  const r1 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__agentBridge.results)`
  });
  console.log('Results:', r1.result?.result?.value);

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));