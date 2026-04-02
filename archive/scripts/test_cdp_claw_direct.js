/**
 * test_cdp_claw_direct.js
 * 直接连接 Claw page，测试 IPC 发送任务
 */
const { chromium } = require('playwright');

const CLAW_WS = 'ws://localhost:9222/devtools/page/038D6223E03EAE3E069A9EEF5E156478';

async function main() {
  const browser = await chromium.connect({ wsEndpoint: CLAW_WS });
  console.log('✅ Connected to Claw page');

  // 截图看当前状态
  await browser.screenshot({ path: 'claw-direct.png' });
  console.log('📸 截图: claw-direct.png');

  // 获取页面基本信息
  const info = await browser.evaluate(() => {
    return {
      title: document.title,
      hasVscode: typeof window.vscode !== 'undefined',
      hasVscodeIpc: typeof window.vscode?.ipcRenderer !== 'undefined',
      // 看看有哪些全局函数
      globalKeys: Object.keys(window).filter(k => k.includes('vscode') || k.includes('codebuddy'))
    };
  });
  console.log('\n📊 页面信息:', JSON.stringify(info, null, 2));

  // 尝试调用 vscode.ipcRenderer.invoke
  const result = await browser.evaluate(async () => {
    if (!window.vscode?.ipcRenderer) return { error: 'no ipcRenderer' };

    // 测试几个通道
    const channels = [
      'codebuddy:session.create',
      'codebuddy:agent.list',
      'codebuddy:chat.sessionList',
      'codebuddy:webview.postMessage'
    ];

    const results = {};
    for (const channel of channels) {
      try {
        const r = await window.vscode.ipcRenderer.invoke(channel, {});
        results[channel] = { ok: true, result: r };
      } catch (e) {
        results[channel] = { ok: false, error: e.message };
      }
    }
    return results;
  });

  console.log('\n📡 IPC 调用结果:');
  console.log(JSON.stringify(result, null, 2));

  // 尝试创建一个会话并发送消息
  console.log('\n🚀 尝试创建会话并发送任务...');

  const sessionResult = await browser.evaluate(async () => {
    if (!window.vscode?.ipcRenderer) return { error: 'no ipcRenderer' };

    try {
      // 创建会话
      const sessionId = await window.vscode.ipcRenderer.invoke('codebuddy:session.create', {
        type: 'agent',
        config: {}
      });
      console.log('session created:', sessionId);

      // 发送消息
      const msgResult = await window.vscode.ipcRenderer.invoke('codebuddy:agent.send', {
        sessionId,
        message: '你好，测试消息'
      });
      console.log('message sent:', msgResult);

      return { sessionId, msgResult };
    } catch (e) {
      return { error: e.message, stack: e.stack };
    }
  });

  console.log('\n🧪 会话创建结果:', JSON.stringify(sessionResult, null, 2));

  await browser.close();
}

main().catch(console.error);