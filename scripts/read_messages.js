#!/usr/bin/env node
/**
 * read_messages.js - 通过 CDP 读取 WorkBuddy Agent Manager 的会话消息
 * 
 * 原理：
 *   - 会话元数据：codebuddy-sessions.vscdb (SQLite)
 *   - 消息内容：CDP 从当前可见会话的 DOM 提取
 *   - 会话切换：CDP 点击 conversation-item[data-conversation-id]
 * 
 * 已知限制：
 *   - 消息存在 React 内存 state 中，不持久化到文件
 *   - DOM 中的消息结构是扁平化的（所有消息在一个容器内）
 *   - 只能读取当前显示的会话消息
 *   - 长消息可能被截断（CDP returnByValue 限制）
 * 
 * 用法:
 *   node read_messages.js                    # 读取当前会话消息
 *   node read_messages.js --sessions         # 列出所有会话
 *   node read_messages.js --id <convId>      # 切换到指定会话并读取
 *   node read_messages.js --full             # 输出完整消息文本
 */
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const CDP_PORT = 9222;

// --- CDP ---

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CDPAgent {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = {};
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.pending[msg.id]) {
          clearTimeout(this.pending[msg.id].timer);
          this.pending[msg.id].resolve(msg);
          delete this.pending[msg.id];
        }
      });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(method, params, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => { delete this.pending[id]; reject(new Error('timeout')); }, timeout);
      this.pending[id] = { resolve, timer };
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.error) throw new Error(`CDP: ${r.error.message}`);
    if (r.result?.exceptionDetails) throw new Error(`Eval: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  }
  disconnect() { if (this.ws) this.ws.close(); }
}

// --- 注入脚本 ---

// 从 _cbChat 容器中提取结构化消息
const EXTRACT_MESSAGES = `
(function() {
  var cbChat = document.querySelector('[class*="cbChat"]');
  if (!cbChat) return { error: 'cbChat container not found' };
  
  var blocks = [];
  var children = cbChat.children;
  
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    var style = window.getComputedStyle(el);
    if (style.display === 'none') continue;
    
    var rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    
    var cls = (el.className || '').toString();
    var text = el.textContent.trim();
    
    if (text.length < 2) continue;
    
    // 跳过空的小元素
    if (text.length < 10 && el.children.length > 0 && el.children.length < 5) continue;
    
    // 判断角色
    var role = 'unknown';
    var innerHtml = el.innerHTML.slice(0, 2000);
    
    if (/[class*="user"]|data-role="user"|avatar-user|message-role-user/i.test(cls + innerHtml)) {
      role = 'user';
    } else if (/[class*="agent"]|data-role="agent"|avatar-agent|message-role-agent|assistant/i.test(cls + innerHtml)) {
      role = 'agent';
    } else if (/[class*="system"]|data-role="system"/i.test(cls + innerHtml)) {
      role = 'system';
    }
    
    blocks.push({
      index: i,
      role: role,
      tag: el.tagName,
      class: cls.split(/\\s+/).slice(0, 3).join(' '),
      text: text.slice(0, 2000),
      textLength: text.length,
      childCount: el.children.length,
      top: Math.round(rect.top)
    });
  }
  
  return { error: null, blockCount: blocks.length, blocks: blocks };
})()
`;

// 获取当前活跃会话 ID
const GET_ACTIVE_SESSION = `
(function() {
  var items = document.querySelectorAll('.conversation-item');
  for (var i = 0; i < items.length; i++) {
    var cls = (items[i].className || '').toString();
    if (/active|selected|current/i.test(cls)) {
      return {
        conversationId: items[i].getAttribute('data-conversation-id'),
        title: items[i].textContent.trim().slice(0, 100)
      };
    }
  }
  // fallback: topbar text
  var topbar = document.querySelector('.workbuddy-topbar');
  return {
    conversationId: null,
    title: topbar ? topbar.textContent.trim().slice(0, 100) : ''
  };
})()
`;

// 切换会话
const CLICK_SESSION = `
function(cid) {
  var el = document.querySelector('.conversation-item[data-conversation-id="' + cid + '"]');
  if (!el) return { ok: false, err: 'not found' };
  el.click();
  return { ok: true, title: el.textContent.trim().slice(0, 100) };
}
`;

// 获取会话列表
const GET_SESSIONS = `
(function() {
  var items = document.querySelectorAll('.conversation-item');
  return Array.from(items).map(function(el) {
    var cls = (el.className || '').toString();
    return {
      conversationId: el.getAttribute('data-conversation-id'),
      title: el.textContent.trim().slice(0, 100),
      active: /active|selected|current/i.test(cls)
    };
  });
})()
`;

// --- vscdb ---

function readSessionsFromDB() {
  const Database = require('better-sqlite3');
  const appData = process.env.APPDATA || path.join('C:', 'Users', 'Gu YongSheng', 'AppData', 'Roaming');
  const dbPath = path.join(appData, 'WorkBuddy', 'codebuddy-sessions.vscdb');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'session:%'").all();
  db.close();
  return rows.map(r => { try { return JSON.parse(r.value.toString()); } catch(e) { return null; } }).filter(Boolean).filter(s => s.conversationId);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Output helpers ---

function formatMessage(block) {
  const icon = block.role === 'user' ? '👤' : block.role === 'agent' ? '🤖' : block.role === 'system' ? '⚙️' : '📄';
  const text = block.text;
  return `${icon} [${block.role}] (${block.textLength} chars)\n${text.split('\n').map(l => '   ' + l).join('\n')}`;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const showSessions = args.includes('--sessions');
  const showFull = args.includes('--full');
  const idIdx = args.indexOf('--id');
  const targetId = idIdx >= 0 ? args[idIdx + 1] : null;

  if (showSessions) {
    const sessions = readSessionsFromDB();
    console.log('=== Sessions ===\n');
    sessions.forEach(s => {
      const icon = s.status === 'Working' ? '🔄' : s.status === 'Completed' ? '✅' : '⏹️';
      console.log(`${icon} ${s.conversationId}`);
      console.log(`   ${s.title || s.customTitle || '(no title)'}`);
      console.log(`   cwd=${s.cwd} status=${s.status}`);
      console.log(`   updated=${new Date(s.updatedAt).toLocaleString()}`);
      console.log();
    });
    return;
  }

  // 连接
  const targets = await getTargets();
  const target = targets.find(t => t.type === 'page' && t.url.includes('agentManager'));
  if (!target) { console.error('❌ Agent Manager not found'); process.exit(1); }

  const agent = new CDPAgent(target.webSocketDebuggerUrl);
  await agent.connect();
  await agent.send('Runtime.enable');

  // 切换会话（如果指定）
  if (targetId) {
    console.log(`🔄 Switching to ${targetId}...`);
    const r = await agent.evaluate(`${CLICK_SESSION}('${targetId}')`);
    if (!r?.ok) {
      console.error(`❌ ${r.err}`);
      const sessions = await agent.evaluate(GET_SESSIONS);
      console.log('Available:');
      sessions.forEach(s => console.log(`  ${s.conversationId} ${s.active ? '[ACTIVE]' : ''} ${s.title}`));
      agent.disconnect();
      process.exit(1);
    }
    console.log(`   → ${r.title}`);
    await sleep(2000);
  }

  // 当前会话
  const active = await agent.evaluate(GET_ACTIVE_SESSION);
  console.log(`📋 Active: ${active.conversationId || '(unknown)'} — ${active.title}\n`);

  // 提取消息
  const result = await agent.evaluate(EXTRACT_MESSAGES, false);
  // 注意：不能传参给 IIFE，直接用默认值
  
  if (result.error) {
    console.log(`⚠️ ${result.error}`);
    const text = await agent.evaluate('document.body.innerText.slice(0, 5000)');
    console.log(text);
  } else {
    console.log(`Found ${result.blockCount} blocks:\n`);
    result.blocks.forEach(b => console.log(formatMessage(b) + '\n'));
  }

  agent.disconnect();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
