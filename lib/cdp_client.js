/**
 * cdp_client.js - CDP 客户端模块
 *
 * 封装与 WorkBuddy Electron 的 CDP 通信：
 * - CDPAgent: 连接 agentManager.html（DOM 操作、消息收发）
 * - WorkbenchClient: 连接 workbench.html（IPC 调用获取会话元数据）
 */
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULT_PORT = 9222;

// ---- shared ----

function getTargets(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid CDP response')); }
      });
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ CDPAgent ============

class CDPAgent {
  #ws;
  #msgId = 0;
  #pending = {};
  #connected = false;

  constructor(wsUrl) { this.wsUrl = wsUrl; }

  static async create(port = DEFAULT_PORT) {
    const targets = await getTargets(port);
    const target = targets.find(t => t.type === 'page' && t.url.includes('agentManager'));
    if (!target) throw new Error('Agent Manager target not found');
    const agent = new CDPAgent(target.webSocketDebuggerUrl);
    await agent.connect();
    return agent;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(this.wsUrl);
      this.#ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id && this.#pending[msg.id]) {
            clearTimeout(this.#pending[msg.id].timer);
            this.#pending[msg.id].resolve(msg);
            delete this.#pending[msg.id];
          }
        } catch { /* ignore */ }
      });
      this.#ws.on('open', () => { this.#connected = true; resolve(); });
      this.#ws.on('error', reject);
      this.#ws.on('close', () => { this.#connected = false; });
    });
  }

  #send(method, params = {}, timeout = 30000) {
    if (!this.#connected) return Promise.reject(new Error('Not connected'));
    return new Promise((resolve, reject) => {
      const id = ++this.#msgId;
      const timer = setTimeout(() => {
        delete this.#pending[id];
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.#pending[id] = { resolve, timer };
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr, awaitPromise = true) {
    const r = await this.#send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise
    });
    if (r.error) throw new Error(`CDP error: ${r.error.message}`);
    if (r.result?.exceptionDetails) {
      const desc = r.result.exceptionDetails.exception?.description
        || r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails);
      throw new Error(`Eval error: ${desc}`);
    }
    return r.result?.result?.value;
  }

  async typeText(text) {
    for (const char of text) {
      const code = char.length === 1 ? `Key${char.toUpperCase()}` : 'Unidentified';
      await this.#send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: char, text: char, code,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await delay(20);
      await this.#send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: char, code,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await delay(20);
    }
  }

  async pressEnter() {
    await this.#send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await delay(50);
    await this.#send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
  }

  async screenshot(format = 'png') {
    const r = await this.#send('Page.captureScreenshot', { format });
    return Buffer.from(r.result.data, 'base64');
  }

  get connected() { return this.#connected; }

  disconnect() {
    if (this.#ws) {
      this.#connected = false;
      this.#ws.close();
      this.#ws = null;
    }
  }
}

// ============ WorkbenchClient ============

class WorkbenchClient {
  #ws;
  #msgId = 0;
  #pending = {};
  #connected = false;

  constructor(wsUrl) { this.wsUrl = wsUrl; }

  static async create(port = DEFAULT_PORT) {
    const targets = await getTargets(port);
    const target = targets.find(t =>
      t.type === 'page' && t.url.includes('workbench.html') && !t.url.includes('agentManager')
    );
    if (!target) throw new Error('Workbench target not found');
    const client = new WorkbenchClient(target.webSocketDebuggerUrl);
    await client.connect();
    return client;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(this.wsUrl);
      this.#ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id && this.#pending[msg.id]) {
            clearTimeout(this.#pending[msg.id].timer);
            this.#pending[msg.id].resolve(msg);
            delete this.#pending[msg.id];
          }
        } catch { /* ignore */ }
      });
      this.#ws.on('open', () => { this.#connected = true; resolve(); });
      this.#ws.on('error', reject);
      this.#ws.on('close', () => { this.#connected = false; });
    });
  }

  #send(method, params = {}, timeout = 15000) {
    if (!this.#connected) return Promise.reject(new Error('Not connected'));
    return new Promise((resolve, reject) => {
      const id = ++this.#msgId;
      const timer = setTimeout(() => {
        delete this.#pending[id];
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.#pending[id] = { resolve, timer };
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr, awaitPromise = true) {
    const r = await this.#send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise
    });
    if (r.error) throw new Error(`CDP error: ${r.error.message}`);
    return r.result?.result?.value;
  }

  async getSessions() {
    const raw = await this.evaluate(`(async () => {
      const r = await window.vscode.ipcRenderer.invoke('codebuddy:getSessions');
      return JSON.stringify(r);
    })()`);
    return raw ? JSON.parse(raw) : { sessions: [], total: 0 };
  }

  async getClawSessions() {
    const raw = await this.evaluate(`(async () => {
      const r = await window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions');
      return JSON.stringify(r);
    })()`);
    return raw ? JSON.parse(raw) : { sessions: [], total: 0 };
  }

  get connected() { return this.#connected; }

  disconnect() {
    if (this.#ws) {
      this.#connected = false;
      this.#ws.close();
      this.#ws = null;
    }
  }
}

// ============ vscdb Reader ============

function readSessionsFromDB() {
  let Database;
  try { Database = require('better-sqlite3'); }
  catch { return []; }

  const appData = process.env.APPDATA
    || path.join('C:', 'Users', os.userInfo().username, 'AppData', 'Roaming');
  const dbPath = path.join(appData, 'WorkBuddy', 'codebuddy-sessions.vscdb');
  if (!fs.existsSync(dbPath)) return [];

  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'session:%'").all();
    db.close();
    return rows
      .map(r => { try { return JSON.parse(r.value.toString()); } catch { return null; } })
      .filter(Boolean)
      .filter(s => s.conversationId);
  } catch (e) {
    console.warn(`vscdb read error: ${e.message}`);
    return [];
  }
}

module.exports = { CDPAgent, WorkbenchClient, readSessionsFromDB, getTargets, delay, DEFAULT_PORT };
