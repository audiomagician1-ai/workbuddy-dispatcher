/**
 * test_cdp_e2e.js
 * 端到端测试：通过 CDP 向 WorkBuddy Claw Agent 发送任务
 * 用法: node test_cdp_e2e.js
 */
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connect({
    wsEndpoint: 'ws://localhost:9222/devtools/page/CA9A2A9B7F2D4E3F2A1B9C8D7E6F5A4B'
  });

  console.log('✅ Connected to Claw page via CDP');

  // 方案A: 直接通过 DOM 操作（如果 input 在主 workbench）
  const workbenchPage = await chromium.connect({
    wsEndpoint: 'ws://localhost:9222/devtools/page/0F3A2E1D9C8B7A6F5E4D3C2B1A9F8E7D'
  });

  console.log('✅ Connected to workbench');

  // 先看看 workbench 里有什么可用的 DOM API
  const result = await workbenchPage.evaluate(() => {
    // 检查 window 上有哪些 vscode API
    const apis = {
      hasVscode: typeof window.vscode !== 'undefined',
      hasCodebuddy: typeof window.codebuddy !== 'undefined',
      hasVscodeIpc: typeof window.vscode?.ipcRenderer !== 'undefined',
    };

    // 找输入框
    const inputs = Array.from(document.querySelectorAll('textarea, input[contenteditable="true"], [contenteditable="true"]'));
    const inputInfo = inputs.map(el => ({
      tag: el.tagName,
      class: el.className,
      id: el.id,
      placeholder: el.placeholder || el.getAttribute('placeholder'),
      visible: el.offsetWidth > 0 && el.offsetHeight > 0
    }));

    // 找包含 "Claw" 或 "Agent" 字样的元素
    const clawElements = Array.from(document.querySelectorAll('*')).filter(el =>
      (el.textContent || '').includes('Claw') && el.children.length === 0
    ).slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className,
      text: el.textContent.trim().substring(0, 50)
    }));

    return { apis, inputInfo, clawElements };
  });

  console.log('\n📊 Workbench 分析:');
  console.log(JSON.stringify(result, null, 2));

  // 截图 workbench
  await workbenchPage.screenshot({ path: 'workbench-analysis.png' });
  console.log('\n📸 截图保存到 workbench-analysis.png');

  // 尝试在 workbench 里找到 AI 输入框并发送内容
  const inputResult = await workbenchPage.evaluate(() => {
    // 尝试找 textarea（通常 AI 输入框是 textarea）
    const textarea = document.querySelector('textarea');
    if (textarea) {
      return { found: 'textarea', class: textarea.className, id: textarea.id };
    }

    // 尝试 contenteditable
    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
      return { found: 'contenteditable', class: editable.className, id: editable.id };
    }

    return { found: 'none' };
  });
  console.log('\n🔍 输入框:', inputResult);

  await browser.close();
  await workbenchPage.close();
}

main().catch(console.error);