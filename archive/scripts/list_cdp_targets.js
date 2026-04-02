/**
 * list_cdp_targets.js
 * 列出所有 CDP target，帮助找到正确的 page ID
 */
const http = require('http');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const targets = await fetchJSON('http://localhost:9222/json');
  console.log('📋 CDP Targets:');
  targets.forEach((t, i) => {
    const type = t.type || 'unknown';
    const title = t.title || '';
    const url = t.url || '';
    const id = t.id;
    const ws = t.webSocketDebuggerUrl || '';
    console.log(`\n[${i}] ${type}: "${title}"`);
    console.log(`    ID: ${id}`);
    console.log(`    URL: ${url}`);
  });
}

main().catch(console.error);