/**
 * test_cdp_claw_simple.js - 简化版，加超时
 */
const { chromium } = require('playwright');

const CLAW_WS = 'ws://localhost:9222/devtools/page/038D6223E03EAE3E069A9EEF5E156478';

async function main() {
  console.log('Connecting to Claw page...');

  let browser;
  try {
    browser = await chromium.connect({ wsEndpoint: CLAW_WS, timeout: 5000 });
    console.log('✅ Connected!');
  } catch(e) {
    console.error('❌ Connection failed:', e.message);
    return;
  }

  console.log('Taking screenshot...');
  try {
    await browser.screenshot({ path: 'claw-simple.png', timeout: 5000 });
    console.log('📸 Screenshot saved');
  } catch(e) {
    console.error('Screenshot error:', e.message);
  }

  console.log('Evaluating...');
  try {
    const result = await browser.evaluate(() => {
      return {
        title: document.title,
        hasVscode: typeof window.vscode,
        keys: Object.keys(window).filter(k => k.toLowerCase().includes('vscode'))
      };
    }, { timeout: 5000 });
    console.log('Result:', JSON.stringify(result));
  } catch(e) {
    console.error('Evaluate error:', e.message);
  }

  await browser.close();
  console.log('Done');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });