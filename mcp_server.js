#!/usr/bin/env node
/**
 * mcp_server.js - WorkBuddy Dispatcher MCP Server
 *
 * 通过 MCP 协议暴露 WorkBuddy 会话管理、消息收发、任务编排等全部能力。
 * 同时提供 REST API 供 Dashboard 使用。
 *
 * 启动: node mcp_server.js [--port 5200]
 *
 * MCP endpoint: http://localhost:5200/mcp
 * REST API:      http://localhost:5200/api/...
 * Dashboard:    http://localhost:5200/
 */
const http = require('http');
const { URL } = require('url');

const { SessionManager } = require('./lib/session_manager');
const { MessageBus } = require('./lib/message_bus');
const { TaskOrchestrator } = require('./lib/task_orchestrator');
const { FeatureManager } = require('./lib/feature_manager');
const { Healer, Watcher } = require('./lib/watcher');
const { DEFAULT_PORT } = require('./lib/cdp_client');

// ============ Global State ============

const messageBus = new MessageBus();
let sessionManager = null;
let taskOrchestrator = null;
let featureManager = null;
let healer = null;
let watcher = null;
let initialized = false;
let serverStartTime = new Date().toISOString();

// ============ MCP Protocol Handler ============

/**
 * Handle MCP JSON-RPC request
 */
async function handleMCPRequest(body, res) {
  const { id, method, params, jsonrpc } = body;

  // Response helper
  const respond = (result) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: id || null, result }));
  };

  const respondError = (code, message) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: id || null, error: { code, message } }));
  };

  try {
    // Initialize
    if (method === 'initialize') {
      initialized = true;
      return respond({
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: true }, resources: {} },
        serverInfo: { name: 'workbuddy-dispatcher', version: '2.0.0' }
      });
    }

    if (method === 'notifications/initialized') {
      // Notification, no response needed but we send 202 Accepted
      res.writeHead(202);
      res.end('');
      return;
    }

    if (!initialized) {
      return respondError(-32002, 'Server not initialized');
    }

    // Ping
    if (method === 'ping') {
      return respond({});
    }

    // List tools
    if (method === 'tools/list') {
      return respond({ tools: getToolDefinitions() });
    }

    // Call tool
    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const result = await callTool(toolName, args);
      return respond(result);
    }

    // List resources
    if (method === 'resources/list') {
      return respond({ resources: [] });
    }

    respondError(-32601, `Method not found: ${method}`);
  } catch (err) {
    respondError(-32603, err.message);
  }
}

// ============ Tool Definitions ============

function getToolDefinitions() {
  return [
    // ---- Session Management ----
    {
      name: 'wb_session_list',
      description: 'List all WorkBuddy sessions with status, title, and timestamps',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'wb_session_get',
      description: 'Get details of a specific session',
      inputSchema: {
        type: 'object',
        properties: { conversationId: { type: 'string', description: 'Session conversation ID' } },
        required: ['conversationId']
      }
    },
    {
      name: 'wb_session_switch',
      description: 'Switch to a specific session (brings it to foreground)',
      inputSchema: {
        type: 'object',
        properties: { conversationId: { type: 'string', description: 'Session conversation ID' } },
        required: ['conversationId']
      }
    },
    {
      name: 'wb_session_create',
      description: 'Create a new WorkBuddy session',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', description: 'Optional title for the new session' } },
        required: []
      }
    },
    {
      name: 'wb_session_messages',
      description: 'Read messages from a session (switches to it first)',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Session ID (optional, uses current if omitted)' },
          newOnly: { type: 'boolean', description: 'Only return new messages since last read' }
        },
        required: []
      }
    },
    {
      name: 'wb_session_status',
      description: 'Get session status: idle or working',
      inputSchema: {
        type: 'object',
        properties: { conversationId: { type: 'string', description: 'Session ID (optional)' } },
        required: []
      }
    },
    {
      name: 'wb_session_screenshot',
      description: 'Take a screenshot of the current WorkBuddy session (returns base64 PNG)',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },

    // ---- Messaging ----
    {
      name: 'wb_message_send',
      description: 'Send a message to a session',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send' },
          conversationId: { type: 'string', description: 'Target session ID (optional)' }
        },
        required: ['message']
      }
    },
    {
      name: 'wb_message_relay',
      description: 'Send a message to a session and wait for agent to complete response',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send' },
          conversationId: { type: 'string', description: 'Target session ID (optional)' },
          timeout: { type: 'number', description: 'Max wait time in seconds (default 300)' }
        },
        required: ['message']
      }
    },
    {
      name: 'wb_message_launch',
      description: 'Create a new session and send the first message',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'First message to send' },
          wait: { type: 'boolean', description: 'Wait for agent response (default false)' },
          timeout: { type: 'number', description: 'Max wait time in seconds (default 300)' }
        },
        required: ['message']
      }
    },

    // ---- Channels ----
    {
      name: 'wb_channel_send',
      description: 'Send a message to a channel (cross-session communication)',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel name' },
          content: { type: 'string', description: 'Message content' },
          sender: { type: 'string', description: 'Sender identifier' },
          metadata: { type: 'string', description: 'Optional JSON metadata' }
        },
        required: ['channel', 'content']
      }
    },
    {
      name: 'wb_channel_read',
      description: 'Read messages from a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel name' },
          limit: { type: 'number', description: 'Max messages to return (default 10)' },
          since: { type: 'string', description: 'Only messages after this ISO timestamp' }
        },
        required: ['channel']
      }
    },
    {
      name: 'wb_channel_list',
      description: 'List all channels and their message counts',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },

    // ---- Task Chains ----
    {
      name: 'wb_chain_create',
      description: 'Create a multi-step task chain. Steps execute sequentially with auto context passing.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique chain name' },
          steps: {
            type: 'array',
            description: 'Array of step objects',
            items: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Message to send' },
                newSession: { type: 'boolean', description: 'Create new session for this step (default true)' },
                sessionId: { type: 'string', description: 'Use existing session (if newSession is false)' },
                waitUntil: { type: 'string', description: 'Wait condition: complete, message_contains:xxx, timeout:N (default complete)' },
                timeout: { type: 'number', description: 'Timeout in seconds (default 300)' }
              },
              required: ['message']
            }
          }
        },
        required: ['name', 'steps']
      }
    },
    {
      name: 'wb_chain_start',
      description: 'Start a task chain (runs in background)',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Chain name' } },
        required: ['name']
      }
    },
    {
      name: 'wb_chain_status',
      description: 'Get task chain status',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Chain name' } },
        required: ['name']
      }
    },
    {
      name: 'wb_chain_cancel',
      description: 'Cancel a running task chain',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Chain name' } },
        required: ['name']
      }
    },

    // ---- Loop / Delayed Tasks ----
    {
      name: 'wb_task_loop',
      description: 'Create a loop task that drives an agent through multiple rounds',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique task name' },
          initialMessage: { type: 'string', description: 'First message' },
          continueMessage: { type: 'string', description: 'Message for subsequent rounds (default: continue)' },
          maxRounds: { type: 'number', description: 'Maximum rounds (default 10)' },
          stopKeywords: { type: 'string', description: 'Comma-separated stop keywords' },
          intervalSeconds: { type: 'number', description: 'Delay between rounds in seconds' }
        },
        required: ['name', 'initialMessage']
      }
    },
    {
      name: 'wb_task_delayed',
      description: 'Create a delayed or repeating task',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique task name' },
          message: { type: 'string', description: 'Message to send' },
          delaySeconds: { type: 'number', description: 'Delay before first execution (default 60)' },
          repeatInterval: { type: 'number', description: 'Repeat interval in seconds (0 = no repeat)' }
        },
        required: ['name', 'message']
      }
    },
    {
      name: 'wb_task_start',
      description: 'Start a loop or delayed task',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Task name' } },
        required: ['name']
      }
    },
    {
      name: 'wb_task_list',
      description: 'List all chains and tasks',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'wb_task_cancel',
      description: 'Cancel a chain or task by name',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Task/chain name' } },
        required: ['name']
      }
    },
    {
      name: 'wb_task_logs',
      description: 'Get logs for a chain or task',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Task/chain name' },
          limit: { type: 'number', description: 'Max log entries (default 20)' }
        },
        required: ['name']
      }
    },

    // ---- Features ----
    {
      name: 'wb_feature_load',
      description: 'Load a feature list from a JSON file',
      inputSchema: {
        type: 'object',
        properties: { filePath: { type: 'string', description: 'Path to feature_list.json' } },
        required: ['filePath']
      }
    },
    {
      name: 'wb_feature_next',
      description: 'Get the next available feature(s) to work on',
      inputSchema: {
        type: 'object',
        properties: { preferGroup: { type: 'boolean', description: 'Prefer grouped features (default true)' } },
        required: []
      }
    },
    {
      name: 'wb_feature_complete',
      description: 'Mark feature(s) as completed',
      inputSchema: {
        type: 'object',
        properties: {
          featureIds: { type: 'array', items: { type: 'string' }, description: 'Feature ID(s)' }
        },
        required: ['featureIds']
      }
    },
    {
      name: 'wb_feature_fail',
      description: 'Mark feature(s) as failed',
      inputSchema: {
        type: 'object',
        properties: {
          featureIds: { type: 'array', items: { type: 'string' }, description: 'Feature ID(s)' },
          reason: { type: 'string', description: 'Failure reason' }
        },
        required: ['featureIds']
      }
    },
    {
      name: 'wb_feature_stats',
      description: 'Get feature progress statistics',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },

    // ---- System ----
    {
      name: 'wb_overview',
      description: 'Get global overview: sessions, tasks, channels, features',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'wb_watcher_control',
      description: 'Control the session watcher (auto-monitor)',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'], description: 'Action' },
          pollInterval: { type: 'number', description: 'Poll interval in seconds (when starting)' }
        },
        required: ['action']
      }
    },
    {
      name: 'wb_heal_scan',
      description: 'Scan all sessions for issues',
      inputSchema: {
        type: 'object',
        properties: { autoFix: { type: 'boolean', description: 'Automatically fix issues' } },
        required: []
      }
    },
    {
      name: 'wb_heal_recover',
      description: 'Recover a specific session',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Session ID' },
          action: { type: 'string', enum: ['auto', 'retry', 'new_session', 'skip', 'notify'], description: 'Recovery action' }
        },
        required: ['conversationId']
      }
    }
  ];
}

// ============ Tool Dispatcher ============

async function callTool(name, args) {
  // Auto-init on first tool call
  if (!sessionManager) {
    sessionManager = new SessionManager();
    await sessionManager.init(DEFAULT_PORT);
    taskOrchestrator = new TaskOrchestrator(sessionManager, messageBus);
    featureManager = new FeatureManager();
    healer = new Healer(sessionManager, messageBus);
    watcher = new Watcher(sessionManager, healer);
  }

  const textResult = (text) => ({ content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) }] });

  switch (name) {
    // ---- Sessions ----
    case 'wb_session_list': {
      const sessions = await sessionManager.listSessions();
      return textResult(sessions);
    }
    case 'wb_session_get': {
      const sessions = await sessionManager.listSessions();
      const s = sessions.find(x => x.conversationId === args.conversationId);
      if (!s) return textResult({ error: 'Session not found' });
      return textResult(s);
    }
    case 'wb_session_switch': {
      const result = await sessionManager.switchTo(args.conversationId);
      return textResult(result);
    }
    case 'wb_session_create': {
      const result = await sessionManager.createSession(args.title);
      return textResult(result);
    }
    case 'wb_session_messages': {
      const msgs = args.newOnly
        ? await sessionManager.readNewMessages(args.conversationId)
        : await sessionManager.readMessages(args.conversationId);
      return textResult(msgs);
    }
    case 'wb_session_status': {
      const status = await sessionManager.getStatus(args.conversationId);
      return textResult({ status });
    }
    case 'wb_session_screenshot': {
      const buf = await sessionManager.screenshot();
      return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }] };
    }

    // ---- Messages ----
    case 'wb_message_send': {
      const result = await sessionManager.sendMessage(args.message, args.conversationId);
      return textResult(result);
    }
    case 'wb_message_relay': {
      const timeout = (args.timeout || 300) * 1000;
      await sessionManager.sendMessage(args.message, args.conversationId);
      const waitResult = await sessionManager.waitForResponse(timeout);
      const active = await sessionManager.getActiveSession();
      const msgs = await sessionManager.readNewMessages(active.conversationId);
      return textResult({ waitResult, newMessages: msgs });
    }
    case 'wb_message_launch': {
      const active = await sessionManager.createSession();
      await sessionManager.sendMessage(args.message, active.conversationId);
      if (args.wait) {
        const timeout = (args.timeout || 300) * 1000;
        await sessionManager.waitForResponse(timeout);
        const msgs = await sessionManager.readMessages(active.conversationId);
        return textResult({ sessionId: active.conversationId, messages: msgs });
      }
      return textResult({ sessionId: active.conversationId, message: 'Session created and message sent' });
    }

    // ---- Channels ----
    case 'wb_channel_send': {
      const result = messageBus.send(args.channel, args.content, args.sender || '', args.metadata);
      return textResult(result);
    }
    case 'wb_channel_read': {
      const msgs = messageBus.read(args.channel, args.limit || 10, args.since);
      return textResult(msgs);
    }
    case 'wb_channel_list': {
      return textResult(messageBus.listChannels());
    }

    // ---- Chains ----
    case 'wb_chain_create': {
      const steps = args.steps.map(s => ({
        sessionConfig: {
          newSession: s.newSession !== false,
          sessionId: s.sessionId
        },
        message: s.message,
        waitUntil: s.waitUntil || 'complete',
        timeout: (s.timeout || 300) * 1000
      }));
      const result = taskOrchestrator.createChain(args.name, steps);
      return textResult(result);
    }
    case 'wb_chain_start': {
      // Run chain in background
      taskOrchestrator.startChain(args.name).catch(err => {
        console.error(`Chain "${args.name}" error:`, err.message);
      });
      return textResult({ status: 'started', message: `Chain "${args.name}" started` });
    }
    case 'wb_chain_status': {
      return textResult(taskOrchestrator.chainStatus(args.name));
    }
    case 'wb_chain_cancel': {
      return textResult(taskOrchestrator.cancelChain(args.name));
    }

    // ---- Tasks ----
    case 'wb_task_loop': {
      const result = taskOrchestrator.createLoopTask(args.name, {
        initialMessage: args.initialMessage,
        continueMessage: args.continueMessage || '继续',
        maxRounds: args.maxRounds || 10,
        stopKeywords: args.stopKeywords,
        intervalSeconds: args.intervalSeconds
      });
      return textResult(result);
    }
    case 'wb_task_delayed': {
      const result = taskOrchestrator.createDelayedTask(args.name, {
        message: args.message,
        delaySeconds: args.delaySeconds || 60,
        repeatInterval: args.repeatInterval || 0
      });
      return textResult(result);
    }
    case 'wb_task_start': {
      taskOrchestrator.startTask(args.name).catch(err => {
        console.error(`Task "${args.name}" error:`, err.message);
      });
      return textResult({ status: 'started' });
    }
    case 'wb_task_list': {
      return textResult(taskOrchestrator.listTasks());
    }
    case 'wb_task_cancel': {
      return textResult(taskOrchestrator.cancelTask(args.name));
    }
    case 'wb_task_logs': {
      return textResult(taskOrchestrator.taskLogs(args.name, args.limit || 20));
    }

    // ---- Features ----
    case 'wb_feature_load': {
      const result = featureManager.loadFromJSON(args.filePath);
      return textResult(result);
    }
    case 'wb_feature_next': {
      const features = featureManager.getNext(args.preferGroup !== false);
      return textResult(features || { message: 'No available features' });
    }
    case 'wb_feature_complete': {
      return textResult(featureManager.markCompleted(args.featureIds));
    }
    case 'wb_feature_fail': {
      return textResult(featureManager.markFailed(args.featureIds, args.reason));
    }
    case 'wb_feature_stats': {
      return textResult(featureManager.getStats());
    }

    // ---- System ----
    case 'wb_overview': {
      const sessions = await sessionManager.listSessions();
      const tasks = taskOrchestrator.listTasks();
      const channels = messageBus.listChannels();
      const features = featureManager.getStats();
      return textResult({
        timestamp: new Date().toISOString(),
        uptime: serverStartTime,
        sessions: { total: sessions.length, active: sessions.filter(s => s.active).length },
        tasks: { chains: tasks.chains.length, tasks: tasks.tasks.length },
        channels: { count: channels.length },
        features
      });
    }
    case 'wb_watcher_control': {
      if (args.action === 'start') {
        return textResult(watcher.start((args.pollInterval || 60) * 1000));
      } else if (args.action === 'stop') {
        return textResult(watcher.stop());
      } else {
        return textResult(watcher.status());
      }
    }
    case 'wb_heal_scan': {
      return textResult(await healer.scanAndRecover(args.autoFix || false));
    }
    case 'wb_heal_recover': {
      return textResult(await healer.recover(args.conversationId, args.action || 'auto'));
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ============ HTTP Server ============

function startServer(port = 5200) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end('');
      return;
    }

    // MCP endpoint
    if (url.pathname === '/mcp' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          handleMCPRequest(parsed, res);
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // REST API endpoints
    if (url.pathname.startsWith('/api/')) {
      await handleREST(url, req, res);
      return;
    }

    // Dashboard
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const fs = require('fs');
      const path = require('path');
      try {
        const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf-8');
        res.end(html);
      } catch {
        res.end('<h1>WorkBuddy Dispatcher V2</h1><p>Dashboard not found. <a href="/api/overview">API</a></p>');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`\n  WorkBuddy Dispatcher V2`);
    console.log(`  MCP:       http://localhost:${port}/mcp`);
    console.log(`  REST API:  http://localhost:${port}/api/overview`);
    console.log(`  Dashboard: http://localhost:${port}/\n`);
  });

  return server;
}

// ============ REST API ============

async function handleREST(url, req, res) {
  const respondJSON = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    // Auto-init
    if (!sessionManager) {
      sessionManager = new SessionManager();
      await sessionManager.init(DEFAULT_PORT);
      taskOrchestrator = new TaskOrchestrator(sessionManager, messageBus);
      featureManager = new FeatureManager();
      healer = new Healer(sessionManager, messageBus);
      watcher = new Watcher(sessionManager, healer);
    }

    const path = url.pathname;

    if (path === '/api/overview') {
      const sessions = await sessionManager.listSessions();
      const tasks = taskOrchestrator.listTasks();
      return respondJSON({
        timestamp: new Date().toISOString(),
        sessions: { total: sessions.length, active: sessions.filter(s => s.active).length },
        tasks: { chains: tasks.chains.length, tasks: tasks.tasks.length },
        channels: messageBus.stats()
      });
    }

    if (path === '/api/sessions') {
      return respondJSON(await sessionManager.listSessions());
    }

    if (path === '/api/channels') {
      return respondJSON(messageBus.listChannels());
    }

    if (path === '/api/tasks') {
      return respondJSON(taskOrchestrator.listTasks());
    }

    if (path === '/api/features') {
      return respondJSON(featureManager.getStats());
    }

    respondJSON({ error: 'Not found' }, 404);
  } catch (err) {
    respondJSON({ error: err.message }, 500);
  }
}

// ============ Main ============

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) : 5200;

startServer(port);
