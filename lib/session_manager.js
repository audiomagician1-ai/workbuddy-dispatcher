/**
 * session_manager.js - 会话管理模块
 *
 * 管理 WorkBuddy 会话的完整生命周期：
 * 列表、切换、创建、读取消息、状态监控、截图
 */
const { CDPAgent, WorkbenchClient, readSessionsFromDB, delay } = require('./cdp_client');

// ---- DOM 注入脚本 ----

const GET_SESSIONS = `(function() {
  var items = document.querySelectorAll('.conversation-item');
  return Array.from(items).map(function(el) {
    var cls = (el.className || '').toString();
    return {
      conversationId: el.getAttribute('data-conversation-id'),
      title: el.textContent.trim().slice(0, 200),
      active: /active|selected|current/i.test(cls)
    };
  });
})()`;

const GET_ACTIVE_SESSION = `(function() {
  var items = document.querySelectorAll('.conversation-item');
  for (var i = 0; i < items.length; i++) {
    var cls = (items[i].className || '').toString();
    if (/active|selected|current/i.test(cls)) {
      return {
        conversationId: items[i].getAttribute('data-conversation-id'),
        title: items[i].textContent.trim().slice(0, 200)
      };
    }
  }
  var topbar = document.querySelector('.workbuddy-topbar');
  return { conversationId: null, title: topbar ? topbar.textContent.trim().slice(0, 200) : '' };
})()`;

const CLICK_SESSION = `function(cid) {
  var el = document.querySelector('.conversation-item[data-conversation-id="' + cid + '"]');
  if (!el) return { ok: false, err: 'not found' };
  el.click();
  return { ok: true, title: el.textContent.trim().slice(0, 200) };
}`;

const CREATE_NEW_SESSION = `(function() {
  var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
    return b.textContent.trim().includes('新建');
  });
  if (btn) { btn.click(); return { ok: true }; }
  return { ok: false, err: 'new-task button not found' };
})()`;

const EXTRACT_MESSAGES = `(function() {
  var cbChat = document.querySelector('[class*="cbChat"]');
  if (!cbChat) return { error: 'cbChat container not found' };
  var messages = [];
  var children = cbChat.children;
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    var style = window.getComputedStyle(el);
    if (style.display === 'none') continue;
    var rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    var text = el.textContent.trim();
    if (text.length < 2) continue;
    if (text.length < 10 && el.children.length > 0 && el.children.length < 5) continue;

    var role = 'unknown';
    var inner = el.innerHTML.slice(0, 3000);
    if (/[class*="user"]|data-role="user"|avatar-user|message-role-user/i.test((el.className || '') + inner)) {
      role = 'user';
    } else if (/[class*="agent"]|data-role="agent"|avatar-agent|message-role-agent|assistant/i.test((el.className || '') + inner)) {
      role = 'agent';
    } else if (/[class*="system"]|data-role="system"/i.test((el.className || '') + inner)) {
      role = 'system';
    }
    messages.push({
      role: role,
      content: text,
      contentLength: text.length,
      tag: el.tagName,
      index: i
    });
  }
  return { error: null, count: messages.length, messages: messages };
})()`;

const CHECK_AGENT_STATUS = `(function() {
  // Check if agent is currently working by looking for loading/typing indicators
  var indicators = document.querySelectorAll('[class*="loading"],[class*="typing"],[class*="thinking"],[class*="spinner"]');
  var working = false;
  for (var i = 0; i < indicators.length; i++) {
    var s = window.getComputedStyle(indicators[i]);
    if (s.display !== 'none' && s.visibility !== 'hidden' && indicators[i].getBoundingClientRect().height > 0) {
      working = true;
      break;
    }
  }
  // Also check send button state
  var sendBtn = Array.from(document.querySelectorAll('button')).find(function(b) {
    return b.textContent.trim() === '' || b.getAttribute('aria-label')?.includes('stop');
  });
  return { working: working };
})()`;

// ---- SessionManager ----

class SessionManager {
  constructor() {
    this._agent = null;
    this._wb = null;
    this._port = 9222;
    this._messageCache = new Map(); // conversationId -> last messages snapshot
  }

  async init(port = 9222) {
    this._port = port;
    this._agent = await CDPAgent.create(port);
    this._wb = await WorkbenchClient.create(port);
  }

  // ---- Session List ----

  async listSessions() {
    // Merge vscdb metadata + DOM list
    const dbSessions = readSessionsFromDB();
    const domSessions = await this._agent.evaluate(GET_SESSIONS) || [];
    const activeDom = domSessions.find(s => s.active);

    return dbSessions.map(s => {
      const dom = domSessions.find(d => d.conversationId === s.conversationId);
      return {
        conversationId: s.conversationId,
        title: s.title || s.customTitle || dom?.title || '(untitled)',
        status: s.status || 'unknown',
        cwd: s.cwd || null,
        updatedAt: s.updatedAt || null,
        active: activeDom?.conversationId === s.conversationId,
        inDOM: !!dom
      };
    });
  }

  async getActiveSession() {
    return await this._agent.evaluate(GET_ACTIVE_SESSION);
  }

  // ---- Session Switch ----

  async switchTo(conversationId) {
    const r = await this._agent.evaluate(`${CLICK_SESSION}('${conversationId}')`);
    if (!r?.ok) {
      // List available sessions for debugging
      const domSessions = await this._agent.evaluate(GET_SESSIONS) || [];
      throw new Error(`Session ${conversationId} not found in DOM. Available: ${domSessions.map(s => s.conversationId).join(', ')}`);
    }
    await delay(2000); // Wait for React to update
    return r;
  }

  // ---- Session Create ----

  async createSession(title) {
    const r = await this._agent.evaluate(CREATE_NEW_SESSION);
    if (!r?.ok) throw new Error(r.err || 'Failed to create session');
    await delay(2000);

    if (title) {
      // The new session becomes active, set its title
      // (WorkBuddy may auto-generate a title based on first message)
      // Title can be set by sending a system message or via conversation rename
      // For now, just note the title for reference
    }

    const active = await this.getActiveSession();
    return active;
  }

  // ---- Messages ----

  async readMessages(conversationId) {
    if (conversationId) {
      await this.switchTo(conversationId);
    }
    const result = await this._agent.evaluate(EXTRACT_MESSAGES);
    if (result.error) throw new Error(result.error);

    const msgs = result.messages.map(m => ({
      role: m.role,
      content: m.content,
      length: m.contentLength
    }));

    // Update cache for incremental reading
    const active = await this.getActiveSession();
    if (active.conversationId) {
      this._messageCache.set(active.conversationId, msgs);
    }

    return msgs;
  }

  async readNewMessages(conversationId) {
    if (conversationId) {
      await this.switchTo(conversationId);
    }

    const result = await this._agent.evaluate(EXTRACT_MESSAGES);
    if (result.error) throw new Error(result.error);

    const currentMsgs = result.messages.map(m => ({
      role: m.role,
      content: m.content,
      length: m.contentLength
    }));

    const active = await this.getActiveSession();
    const cacheKey = active.conversationId;
    const cached = this._messageCache.get(cacheKey) || [];

    // Find new messages by comparing content length
    const newMsgs = [];
    let cacheIdx = 0;
    for (const msg of currentMsgs) {
      if (cacheIdx < cached.length
        && msg.role === cached[cacheIdx].role
        && msg.length === cached[cacheIdx].length) {
        cacheIdx++;
      } else {
        newMsgs.push(msg);
      }
    }

    this._messageCache.set(cacheKey, currentMsgs);
    return newMsgs;
  }

  // ---- Status ----

  async getStatus(conversationId) {
    if (conversationId) {
      await this.switchTo(conversationId);
    }
    const status = await this._agent.evaluate(CHECK_AGENT_STATUS);
    return status?.working ? 'working' : 'idle';
  }

  async screenshot() {
    return await this._agent.screenshot();
  }

  // ---- Send message ----

  async sendMessage(message, conversationId) {
    if (conversationId) {
      await this.switchTo(conversationId);
      await delay(500);
    }

    // Focus input
    await this._agent.evaluate(`document.querySelector('[contenteditable="true"]')?.focus()`);
    await delay(200);

    // Type text
    await this._agent.typeText(message);
    await delay(200);

    // Verify input
    const inputText = await this._agent.evaluate(
      `document.querySelector('[contenteditable="true"]')?.textContent`
    );

    // Send with Enter
    await this._agent.pressEnter();
    await delay(1000);

    // Verify sent
    const afterSend = await this._agent.evaluate(
      `document.querySelector('[contenteditable="true"]')?.textContent`
    );

    return {
      inputBefore: inputText,
      inputAfter: afterSend,
      sent: !afterSend || afterSend === '' || afterSend.includes('输入消息')
    };
  }

  // ---- Wait for agent response ----

  async waitForResponse(timeoutMs = 300000, pollIntervalMs = 3000) {
    const start = Date.now();
    let lastCount = 0;

    while (Date.now() - start < timeoutMs) {
      await delay(pollIntervalMs);
      const status = await this._agent.evaluate(CHECK_AGENT_STATUS);
      if (!status?.working) {
        // Agent stopped working, read new messages
        const active = await this.getActiveSession();
        const newMsgs = await this.readNewMessages(active.conversationId);
        if (newMsgs.length > 0) {
          return { status: 'complete', newMessages: newMsgs };
        }
        return { status: 'complete', newMessages: [] };
      }
    }

    return { status: 'timeout' };
  }

  // ---- Lifecycle ----

  get agent() { return this._agent; }
  get workbench() { return this._wb; }

  disconnect() {
    this._agent?.disconnect();
    this._wb?.disconnect();
  }
}

module.exports = { SessionManager };
