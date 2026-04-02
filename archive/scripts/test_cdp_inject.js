/**
 * WorkBuddy CDP 注入测试
 * 通过 Chrome DevTools Protocol 注入脚本到 WorkBuddy webview
 *
 * 使用方式:
 * 1. 先以 --remote-debugging-port=9222 启动 WorkBuddy
 * 2. 然后运行此脚本
 */

const { chromium } = require('playwright');

const CDP_PORT = 9222;
const WORKBUDDY_URL = 'ws://localhost:' + CDP_PORT;

async function testCDPInjection() {
  console.log('[*] 尝试通过 CDP 连接 WorkBuddy...');

  let browser;
  try {
    // 连接到已有的 WorkBuddy 实例
    browser = await chromium.connectOverCDP(WORKBUDDY_URL);
    console.log('[+] CDP 连接成功');

    // 获取所有上下文和页面
    const contexts = browser.contexts();
    console.log(`[*] 发现 ${contexts.length} 个浏览器上下文`);

    for (const context of contexts) {
      const pages = context.pages();
      console.log(`  上下文有 ${pages.length} 个页面`);

      for (const page of pages) {
        const url = page.url();
        const title = await page.title();
        console.log(`    页面: ${title}`);
        console.log(`    URL: ${url}`);

        // 检查是否是 webview
        if (url.includes('webview') || url.includes(' WorkBuddy')) {
          console.log('    [+] 发现可能的 WorkBuddy webview');

          // 尝试注入脚本
          try {
            const result = await page.evaluate(() => {
              // 检查 vscode API
              const results = {
                hasVscode: typeof window.vscode !== 'undefined',
                hasCodebuddy: typeof window.codebuddy !== 'undefined',
                windowKeys: Object.keys(window).filter(k =>
                  k.includes('vscode') || k.includes('codebuddy') || k.includes('Codebuddy')
                )
              };

              if (window.vscode) {
                results.vscodeKeys = Object.keys(window.vscode);
              }

              return results;
            });

            console.log('    [*] 注入检测结果:');
            console.log(JSON.stringify(result, null, 4));

            // 尝试通过 vscode API 发送消息
            if (result.hasVscode) {
              console.log('    [*] 尝试通过 vscode.ipcRenderer 发送消息...');

              // 列出所有可用的 channel
              try {
                // 检查 ipcRenderer 的方法
                const ipcMethods = await page.evaluate(() => {
                  if (window.vscode && window.vscode.ipcRenderer) {
                    return {
                      hasSend: typeof window.vscode.ipcRenderer.send === 'function',
                      hasInvoke: typeof window.vscode.ipcRenderer.invoke === 'function',
                      hasOn: typeof window.vscode.ipcRenderer.on === 'function'
                    };
                  }
                  return null;
                });
                console.log('    [*] ipcRenderer 方法:', JSON.stringify(ipcMethods));
              } catch (e) {
                console.log('    [!] 检查 ipcRenderer 失败:', e.message);
              }
            }
          } catch (e) {
            console.log('    [!] 注入失败:', e.message);
          }
        }
      }
    }

    await browser.close();
    return true;

  } catch (error) {
    console.error('[!] CDP 连接失败:', error.message);

    if (error.message.includes('connect')) {
      console.log('[!] 可能的原因:');
      console.log('    1. WorkBuddy 没有以 --remote-debugging-port=9222 启动');
      console.log('    2. WorkBuddy 已经在运行但没有开启 CDP');
      console.log('');
      console.log('[>] 请手动启动 WorkBuddy:');
      console.log('   "A:\\WorkBuddy\\WorkBuddy.exe" --remote-debugging-port=9222');
    }

    return false;
  }
}

// 尝试列出所有 CDP 端点
async function listCDPEndpoints() {
  console.log('[*] 检查 CDP 端点...');
  try {
    const response = await fetch(`http://localhost:${CDP_PORT}/json`);
    if (response.ok) {
      const data = await response.json();
      console.log(`[+] 发现 ${data.length} 个 CDP 目标:`);
      for (const target of data) {
        console.log(`    - ${target.title} (${target.type})`);
        console.log(`      URL: ${target.url}`);
        console.log(`      ID: ${target.id}`);
      }
      return data;
    }
  } catch (e) {
    console.log('[!] 无法获取 CDP 端点列表');
  }
  return [];
}

async function main() {
  console.log('=' .repeat(60));
  console.log('WorkBuddy CDP 注入测试');
  console.log('=' .repeat(60));
  console.log('');

  // 先列出 CDP 端点
  await listCDPEndpoints();
  console.log('');

  // 然后尝试注入
  await testCDPInjection();
}

main().catch(console.error);
