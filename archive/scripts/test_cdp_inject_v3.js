/**
 * WorkBuddy CDP 注入测试 v3
 * 连接到具体的 webview 页面，检查 API
 */

const { chromium } = require('playwright');

const CDP_PORT = 9222;

async function main() {
  // 获取端点
  const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
  const targets = await resp.json();

  // 找主页面
  const mainPage = targets.find(t => t.title.includes('MEMORY.md'));
  const codebuddyOverlay = targets.find(t => t.url.includes('CodeBuddy.overlay'));
  const copilotWebview = targets.find(t => t.url.includes('Tencent-Cloud.coding-copilot'));

  console.log('[*] 目标页面:');
  if (mainPage) console.log('  主页面:', mainPage.title);
  if (codebuddyOverlay) console.log('  CodeBuddy overlay:', codebuddyOverlay.url.slice(0, 80));
  if (copilotWebview) console.log('  Copilot webview:', copilotWebview.url.slice(0, 80));

  // 连接主页面
  if (mainPage) {
    console.log('\n[*] 连接主页面...');
    const browser = await chromium.connectOverCDP(mainPage.webSocketDebuggerUrl);
    const page = browser.contexts()[0].pages()[0];

    const result = await page.evaluate(() => {
      const info = {
        hasVscode: typeof window.vscode !== 'undefined',
        hasCodebuddy: typeof window.codebuddy !== 'undefined',
        vscodeKeys: [],
        codebuddyKeys: [],
        allWindowKeys: Object.keys(window).filter(k =>
          k.toLowerCase().includes('vscode') ||
          k.toLowerCase().includes('codebuddy') ||
          k.toLowerCase().includes('webview')
        )
      };
      if (window.vscode) info.vscodeKeys = Object.keys(window.vscode);
      if (window.codebuddy) info.codebuddyKeys = Object.keys(window.codebuddy);
      return info;
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  }

  // 连接 CodeBuddy overlay webview
  if (codebuddyOverlay) {
    console.log('\n[*] 连接 CodeBuddy overlay webview...');
    const browser = await chromium.connectOverCDP(codebuddyOverlay.webSocketDebuggerUrl);
    const page = browser.contexts()[0].pages()[0];

    const result = await page.evaluate(() => {
      return {
        hasVscode: typeof window.vscode !== 'undefined',
        hasCodebuddy: typeof window.codebuddy !== 'undefined',
        vscodeKeys: [],
        location: window.location.href.slice(0, 100),
        origin: window.location.origin
      };
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  }

  // 连接 coding-copilot webview（主 AI 对话面板）
  if (copilotWebview) {
    console.log('\n[*] 连接 coding-copilot webview...');
    const browser = await chromium.connectOverCDP(copilotWebview.webSocketDebuggerUrl);
    const page = browser.contexts()[0].pages()[0];

    const result = await page.evaluate(() => {
      return {
        hasVscode: typeof window.vscode !== 'undefined',
        hasCodebuddy: typeof window.codebuddy !== 'undefined',
        vscodeKeys: window.vscode ? Object.keys(window.vscode) : [],
        codebuddyKeys: window.codebuddy ? Object.keys(window.codebuddy) : [],
        location: window.location.href.slice(0, 100)
      };
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  }
}

main().catch(e => console.error(e));
