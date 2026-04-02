#!/usr/bin/env node
/**
 * list_targets.js - 列出 WorkBuddy 所有 CDP targets
 * 用法: node list_targets.js
 */
const http = require('http');

async function main() {
  try {
    const targets = await new Promise((resolve, reject) => {
      http.get('http://localhost:9222/json', res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        });
      }).on('error', reject);
    });

    const pages = targets.filter(t => t.type === 'page');
    const iframes = targets.filter(t => t.type === 'iframe');

    console.log(`\n📋 CDP Targets (${targets.length} total, ${pages.length} pages)\n`);

    pages.forEach((t, i) => {
      const hasInput = t.url.includes('agentManager') ? ' [HAS INPUT]' : '';
      console.log(`[${i}] ${t.title.substring(0, 60)}${hasInput}`);
      console.log(`    ID: ${t.id}`);
      console.log(`    URL: ${t.url.substring(0, 80)}...`);
      console.log();
    });

    if (iframes.length > 0) {
      console.log(`--- ${iframes.length} iframes (omitted) ---`);
    }
  } catch (e) {
    console.error('❌ Cannot connect to CDP. Is WorkBuddy running with --remote-debugging-port=9222?');
    console.error(`   Error: ${e.message}`);
    process.exit(1);
  }
}

main();
