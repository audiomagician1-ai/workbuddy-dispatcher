/**
 * WorkBuddy CDP 注入测试 v2
 * 先获取正确的 CDP 端点，再连接
 */

const { chromium } = require('playwright');

const CDP_PORT = 9222;

async function main() {
  console.log('[*] 获取 CDP 端点列表...');

  try {
    const response = await fetch(`http://localhost:${CDP_PORT}/json`);
    if (!response.ok) {
      console.log(`[!] HTTP ${response.status}`);
      return;
    }

    const targets = await response.json();
    console.log(`[+] 发现 ${targets.length} 个 CDP 目标:\n`);

    for (const target of targets) {
      console.log(`  Title: ${target.title}`);
      console.log(`  URL:   ${target.url}`);
      console.log(`  Type:  ${target.type}`);
      console.log(`  ID:    ${target.id}`);
      console.log(`  WS:    ${target.webSocketDebuggerUrl}`);
      console.log('');
    }

    // 尝试连接到第一个 page 类型的 target
    const pageTarget = targets.find(t => t.type === 'page');
    if (pageTarget) {
      console.log('[*] 连接到:', pageTarget.webSocketDebuggerUrl);

      const browser = await chromium.connectOverCDP(pageTarget.webSocketDebuggerUrl);
      console.log('[+] CDP 连接成功!');

      const context = browser.contexts()[0];
      const pages = context.pages();
      console.log(`[*] 发现 ${pages.length} 个页面`);

      for (const page of pages) {
        console.log(`\n[*] 页面: ${page.url()}`);
        const result = await page.evaluate(() => {
          return {
            hasVscode: typeof window.vscode !== 'undefined',
            hasCodebuddy: typeof window.codebuddy !== 'undefined',
            vscodeKeys: typeof window.vscode !== 'undefined' ? Object.keys(window.vscode) : [],
          };
        });
        console.log(JSON.stringify(result, null, 2));
      }

      await browser.close();
    }

  } catch (error) {
    console.error('[!] 错误:', error.message);
  }
}

main();
