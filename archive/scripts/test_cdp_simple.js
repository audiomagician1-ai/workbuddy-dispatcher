/**
 * WorkBuddy CDP 注入测试 - 极简版
 * 逐个目标测试，打印关键信息
 */

const CDP_PORT = 9222;

async function main() {
  // 获取端点
  const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
  const targets = await resp.json();
  console.log(`[*] 发现 ${targets.length} 个 CDP 目标:\n`);

  for (const t of targets) {
    console.log(`  [${t.type}] ${t.title}`);
    console.log(`    URL: ${t.url.slice(0, 80)}`);
    console.log('');
  }

  // 用 ws 直接连第一个 page，不走 playwright CDP
  const mainTarget = targets.find(t => t.type === 'page');
  if (mainTarget) {
    console.log('[*] 连接主页面:', mainTarget.webSocketDebuggerUrl);
  }
}

main().catch(e => console.error('Error:', e.message));
