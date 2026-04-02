/**
 * task_orchestrator.js - 任务编排引擎
 *
 * 支持：
 * - TaskChain: 多步骤顺序任务链，步骤间自动传递结果
 * - LoopTask: 多轮循环任务（自动发送"继续"消息）
 * - DelayedTask: 延迟/定时重复任务
 */
const { delay } = require('./cdp_client');

// ============ TaskChain ============

class TaskChain {
  constructor(name, steps, sessionManager, messageBus) {
    this.name = name;
    this.steps = steps; // [{ sessionConfig, message, waitUntil, timeout }]
    this.sm = sessionManager;
    this.bus = messageBus;
    this.status = 'pending'; // pending | running | completed | failed | cancelled
    this.currentStep = -1;
    this.logs = [];
    this.stepResults = [];
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;
  }

  async start() {
    if (this.status === 'running') throw new Error('Chain already running');
    this.status = 'running';
    this.startedAt = new Date().toISOString();
    this._log('Chain started', { steps: this.steps.length });

    try {
      for (let i = 0; i < this.steps.length; i++) {
        if (this.status === 'cancelled') break;
        this.currentStep = i;
        const step = this.steps[i];
        this._log(`Step ${i + 1}/${this.steps.length} starting`, { message: step.message.slice(0, 100) });

        try {
          const result = await this._executeStep(step, i);
          this.stepResults.push(result);
          this._log(`Step ${i + 1} completed`, { status: result.status });
        } catch (err) {
          this._log(`Step ${i + 1} failed`, { error: err.message });
          this.status = 'failed';
          throw err;
        }
      }
      this.status = 'completed';
      this.completedAt = new Date().toISOString();
      this._log('Chain completed');
    } catch (err) {
      if (this.status !== 'cancelled') {
        this.status = 'failed';
      }
    }

    return this.getStatus();
  }

  async _executeStep(step, index) {
    const { sessionConfig, message, waitUntil, timeout = 300000 } = step;

    // Build message with context from previous steps
    let fullMessage = message;
    if (index > 0) {
      const prevResults = this.stepResults.slice(Math.max(0, index - 3)); // last 3 results
      const context = prevResults.map((r, i) =>
        `--- Step ${index - prevResults.length + i + 1} result ---\n${r.agentResponse || '(no response)'}`
      ).join('\n\n');
      fullMessage = `${message}\n\n以下是前序步骤的结果，请参考：\n\n${context}`;
    }

    // Resolve target session
    let targetSession = null;
    if (sessionConfig?.newSession !== false && !sessionConfig?.sessionId) {
      // Create new session
      const active = await this.sm.createSession();
      targetSession = active.conversationId;
      this._log(`Created new session: ${targetSession}`);
    } else if (sessionConfig?.sessionId) {
      targetSession = sessionConfig.sessionId;
    }

    // Send message
    await this.sm.sendMessage(fullMessage, targetSession);

    // Wait for response
    const waitResult = await this._waitUntil(waitUntil || 'complete', timeout);

    // Read agent response
    let agentResponse = '';
    try {
      const msgs = await this.sm.readMessages(targetSession);
      const lastAgent = [...msgs].reverse().find(m => m.role === 'agent');
      agentResponse = lastAgent?.content || '';
    } catch (e) {
      this._log('Failed to read messages', { error: e.message });
    }

    // Publish result to message bus
    if (this.bus) {
      this.bus.send(`chain:${this.name}:step:${index + 1}`, agentResponse, 'orchestrator');
    }

    return {
      step: index + 1,
      session: targetSession,
      status: waitResult.status,
      agentResponse: agentResponse.slice(0, 5000)
    };
  }

  async _waitUntil(condition, timeout) {
    const parts = String(condition).split('|').map(s => s.trim());
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (this.status === 'cancelled') return { status: 'cancelled' };

      for (const part of parts) {
        const result = await this._checkCondition(part);
        if (result) return result;
      }
      await delay(3000);
    }

    return { status: 'timeout' };
  }

  async _checkCondition(cond) {
    if (cond === 'complete' || cond === 'idle') {
      const status = await this.sm.getStatus();
      if (status === 'idle') return { status: 'complete' };
    } else if (cond.startsWith('message_contains:')) {
      const keyword = cond.slice('message_contains:'.length);
      const active = await this.sm.getActiveSession();
      const newMsgs = await this.sm.readNewMessages(active.conversationId);
      const found = newMsgs.find(m =>
        m.role === 'agent' && m.content.includes(keyword)
      );
      if (found) return { status: 'matched', keyword };
    } else if (cond.startsWith('timeout:')) {
      // timeout condition is handled by outer loop
      return null;
    }
    return null;
  }

  cancel() {
    if (this.status === 'running') {
      this.status = 'cancelled';
      this._log('Chain cancelled');
    }
  }

  _log(action, data = {}) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      action,
      ...data
    });
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      currentStep: this.currentStep + 1,
      totalSteps: this.steps.length,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      logs: this.logs
    };
  }
}

// ============ LoopTask ============

class LoopTask {
  constructor(name, config, sessionManager, messageBus) {
    this.name = name;
    this.config = config; // { initialMessage, continueMessage, maxRounds, stopKeywords, intervalSeconds }
    this.sm = sessionManager;
    this.bus = messageBus;
    this.status = 'pending'; // pending | running | completed | failed | cancelled
    this.currentRound = 0;
    this.logs = [];
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;
    this._session = null;
    this._cancelled = false;
  }

  async start() {
    if (this.status === 'running') throw new Error('Task already running');
    this.status = 'running';
    this.startedAt = new Date().toISOString();
    this._cancelled = false;
    this._log('Loop task started', this.config);

    try {
      // Create session
      const active = await this.sm.createSession();
      this._session = active.conversationId;

      // Send initial message
      this._log(`Round 1/${this.config.maxRounds}`, { message: this.config.initialMessage.slice(0, 100) });
      await this.sm.sendMessage(this.config.initialMessage, this._session);
      await this.sm.waitForResponse();
      this.currentRound = 1;

      // Check stop keywords after first round
      if (await this._checkStopKeywords()) {
        this.status = 'completed';
        this.completedAt = new Date().toISOString();
        this._log('Completed (stop keyword detected in round 1)');
        return this.getStatus();
      }

      // Continue rounds
      const continueMsg = this.config.continueMessage || '继续';
      while (this.currentRound < this.config.maxRounds && !this._cancelled) {
        await delay(this.config.intervalSeconds ? this.config.intervalSeconds * 1000 : 2000);
        if (this._cancelled) break;

        this.currentRound++;
        this._log(`Round ${this.currentRound}/${this.config.maxRounds}`);

        await this.sm.sendMessage(continueMsg, this._session);
        await this.sm.waitForResponse();

        if (await this._checkStopKeywords()) {
          this.status = 'completed';
          this.completedAt = new Date().toISOString();
          this._log('Completed (stop keyword detected)');
          break;
        }
      }

      if (this.currentRound >= this.config.maxRounds && this.status !== 'completed') {
        this.status = 'completed';
        this.completedAt = new Date().toISOString();
        this._log('Completed (max rounds reached)');
      }

    } catch (err) {
      this.status = 'failed';
      this._log('Failed', { error: err.message });
    }

    return this.getStatus();
  }

  async _checkStopKeywords() {
    const keywords = (this.config.stopKeywords || '任务完成,已完成,DONE,完毕').split(',').map(s => s.trim());
    try {
      const msgs = await this.sm.readMessages(this._session);
      const lastAgent = [...msgs].reverse().find(m => m.role === 'agent');
      if (!lastAgent) return false;
      return keywords.some(kw => lastAgent.content.includes(kw));
    } catch { return false; }
  }

  cancel() {
    this._cancelled = true;
    this.status = 'cancelled';
    this._log('Cancelled');
  }

  _log(action, data = {}) {
    this.logs.push({ timestamp: new Date().toISOString(), action, ...data });
  }

  getStatus() {
    return {
      name: this.name,
      type: 'loop',
      status: this.status,
      currentRound: this.currentRound,
      maxRounds: this.config.maxRounds,
      session: this._session,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      logs: this.logs
    };
  }
}

// ============ DelayedTask ============

class DelayedTask {
  constructor(name, config, sessionManager, messageBus) {
    this.name = name;
    this.config = config; // { message, delaySeconds, repeatInterval }
    this.sm = sessionManager;
    this.bus = messageBus;
    this.status = 'pending';
    this.logs = [];
    this.createdAt = new Date().toISOString();
    this.runs = 0;
    this._timer = null;
    this._cancelled = false;
  }

  async start() {
    this.status = 'running';
    this._cancelled = false;
    this._log('Delayed task started', { delay: this.config.delaySeconds, repeat: this.config.repeatInterval });

    // Initial delay
    await delay((this.config.delaySeconds || 0) * 1000);
    if (this._cancelled) return this.getStatus();

    // Execute
    await this._execute();

    // Repeat
    if (this.config.repeatInterval && this.config.repeatInterval > 0) {
      this._timer = setInterval(async () => {
        if (this._cancelled) {
          clearInterval(this._timer);
          return;
        }
        await this._execute();
      }, this.config.repeatInterval * 1000);
    } else {
      this.status = 'completed';
    }

    return this.getStatus();
  }

  async _execute() {
    this.runs++;
    this._log(`Run #${this.runs}`, { message: this.config.message.slice(0, 100) });
    try {
      await this.sm.sendMessage(this.config.message);
      this._log(`Run #${this.runs} message sent`);
    } catch (err) {
      this._log(`Run #${this.runs} failed`, { error: err.message });
    }
  }

  cancel() {
    this._cancelled = true;
    if (this._timer) clearInterval(this._timer);
    this.status = 'cancelled';
    this._log('Cancelled');
  }

  _log(action, data = {}) {
    this.logs.push({ timestamp: new Date().toISOString(), action, ...data });
  }

  getStatus() {
    return {
      name: this.name,
      type: 'delayed',
      status: this.status,
      runs: this.runs,
      createdAt: this.createdAt,
      logs: this.logs
    };
  }
}

// ============ TaskOrchestrator ============

class TaskOrchestrator {
  constructor(sessionManager, messageBus) {
    this.sm = sessionManager;
    this.bus = messageBus;
    this._chains = new Map();
    this._tasks = new Map();
  }

  // ---- Chains ----

  createChain(name, steps) {
    if (this._chains.has(name)) throw new Error(`Chain "${name}" already exists`);
    const chain = new TaskChain(name, steps, this.sm, this.bus);
    this._chains.set(name, chain);
    return chain.getStatus();
  }

  async startChain(name) {
    const chain = this._chains.get(name);
    if (!chain) throw new Error(`Chain "${name}" not found`);
    return await chain.start();
  }

  cancelChain(name) {
    const chain = this._chains.get(name);
    if (!chain) throw new Error(`Chain "${name}" not found`);
    chain.cancel();
    return chain.getStatus();
  }

  chainStatus(name) {
    const chain = this._chains.get(name);
    if (!chain) throw new Error(`Chain "${name}" not found`);
    return chain.getStatus();
  }

  // ---- Loop Tasks ----

  createLoopTask(name, config) {
    if (this._tasks.has(name)) throw new Error(`Task "${name}" already exists`);
    const task = new LoopTask(name, config, this.sm, this.bus);
    this._tasks.set(name, task);
    return task.getStatus();
  }

  // ---- Delayed Tasks ----

  createDelayedTask(name, config) {
    if (this._tasks.has(name)) throw new Error(`Task "${name}" already exists`);
    const task = new DelayedTask(name, config, this.sm, this.bus);
    this._tasks.set(name, task);
    return task.getStatus();
  }

  // ---- Common ----

  async startTask(name) {
    const task = this._tasks.get(name);
    if (!task) throw new Error(`Task "${name}" not found`);
    return await task.start();
  }

  cancelTask(name) {
    const task = this._tasks.get(name);
    if (task) task.cancel();
    return { ok: true };
  }

  cancelAll() {
    for (const [, chain] of this._chains) chain.cancel();
    for (const [, task] of this._tasks) task.cancel();
    return { ok: true, chainsCancelled: this._chains.size, tasksCancelled: this._tasks.size };
  }

  listTasks() {
    const chains = [];
    for (const [, c] of this._chains) chains.push(c.getStatus());
    const tasks = [];
    for (const [, t] of this._tasks) tasks.push(t.getStatus());
    return { chains, tasks };
  }

  taskLogs(name, limit = 20) {
    const chain = this._chains.get(name);
    if (chain) return chain.logs.slice(-limit);
    const task = this._tasks.get(name);
    if (task) return task.logs.slice(-limit);
    throw new Error(`Task/chain "${name}" not found`);
  }
}

module.exports = { TaskOrchestrator, TaskChain, LoopTask, DelayedTask };
