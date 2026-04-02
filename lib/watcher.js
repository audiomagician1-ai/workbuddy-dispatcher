/**
 * watcher.js + healer.js - 异常检测与自动恢复
 *
 * Watcher: 定期轮询会话状态，检测异常
 * Healer: 诊断和恢复异常会话
 */
const { delay } = require('./cdp_client');

// ============ Healer ============

class Healer {
  constructor(sessionManager, messageBus) {
    this.sm = sessionManager;
    this.bus = messageBus;
    this.recoveryLog = [];
  }

  async diagnose(conversationId) {
    const issues = [];
    const suggestions = [];

    try {
      // Switch and check status
      await this.sm.switchTo(conversationId);
      const status = await this.sm.getStatus();
      const msgs = await this.sm.readMessages(conversationId);
      const lastAgent = [...msgs].reverse().find(m => m.role === 'agent');
      const lastContent = lastAgent?.content || '';

      if (status === 'working') {
        issues.push({ type: 'long_running', severity: 'warning', message: 'Agent has been working for an extended period' });
        suggestions.push({ action: 'wait_or_new', description: 'Wait longer, or create a new session to continue' });
      }

      // Check for error patterns in last agent message
      const errorPatterns = [
        /error/i, /failed/i, /exception/i, /timeout/i,
        /cannot\s+find/i, /not\s+found/i, /permission\s+denied/i
      ];
      for (const pat of errorPatterns) {
        if (pat.test(lastContent)) {
          issues.push({ type: 'error_message', severity: 'error', message: `Last agent message contains error pattern: ${pat.source}`, excerpt: lastContent.slice(0, 300) });
          break;
        }
      }

      // Check for very short responses (agent gave up)
      if (lastAgent && lastContent.length < 50 && lastContent.length > 0) {
        issues.push({ type: 'short_response', severity: 'warning', message: 'Last agent response is very short, may indicate premature stop' });
        suggestions.push({ action: 'retry', description: 'Retry with more specific instructions' });
      }

      // Check if there are no agent messages at all
      const agentMsgs = msgs.filter(m => m.role === 'agent');
      if (agentMsgs.length === 0) {
        issues.push({ type: 'no_response', severity: 'error', message: 'No agent responses found in this session' });
        suggestions.push({ action: 'retry', description: 'Send the message again or create a new session' });
      }

      if (issues.length === 0) {
        issues.push({ type: 'none', severity: 'ok', message: 'No issues detected' });
      }
    } catch (err) {
      issues.push({ type: 'diagnosis_error', severity: 'error', message: `Diagnosis failed: ${err.message}` });
    }

    return {
      conversationId,
      issues,
      suggestions
    };
  }

  async recover(conversationId, action = 'auto') {
    let actualAction = action;
    this._log('recover', { conversationId, action });

    if (action === 'auto') {
      const diag = await this.diagnose(conversationId);
      if (diag.issues.some(i => i.type === 'no_response' || i.type === 'error_message')) {
        actualAction = 'retry';
      } else if (diag.issues.some(i => i.type === 'long_running')) {
        actualAction = 'skip';
      } else {
        actualAction = 'skip';
      }
    }

    switch (actualAction) {
      case 'retry':
        // Read the last user message and resend it
        const msgs = await this.sm.readMessages(conversationId);
        const lastUser = [...msgs].reverse().find(m => m.role === 'user');
        if (lastUser) {
          await this.sm.sendMessage(lastUser.content, conversationId);
          this._log('retry_sent', { conversationId });
          return { ok: true, action: 'retry', message: 'Resent last user message' };
        }
        return { ok: false, action: 'retry', message: 'No user message found to retry' };

      case 'new_session':
        const active = await this.sm.createSession();
        this._log('new_session', { oldSession: conversationId, newSession: active.conversationId });
        return { ok: true, action: 'new_session', newSession: active.conversationId, message: 'Created new session' };

      case 'skip':
        this._log('skip', { conversationId });
        return { ok: true, action: 'skip', message: 'Skipped this session' };

      case 'notify':
        if (this.bus) {
          this.bus.send('healer:recovery_needed', JSON.stringify({ conversationId }), 'healer');
        }
        this._log('notify', { conversationId });
        return { ok: true, action: 'notify', message: 'Notification sent via message bus' };

      default:
        return { ok: false, action: actualAction, message: `Unknown action: ${actualAction}` };
    }
  }

  async scanAndRecover(autoFix = false) {
    const sessions = await this.sm.listSessions();
    const issues = [];
    const fixed = [];

    for (const session of sessions) {
      if (!session.inDOM) continue;
      try {
        const diag = await this.diagnose(session.conversationId);
        if (diag.issues.some(i => i.severity === 'error' || i.severity === 'warning')) {
          issues.push({ conversationId: session.conversationId, title: session.title, issues: diag.issues });

          if (autoFix) {
            const result = await this.recover(session.conversationId, 'auto');
            fixed.push({ conversationId: session.conversationId, result });
          }
        }
      } catch (err) {
        issues.push({ conversationId: session.conversationId, error: err.message });
      }
    }

    return { scannedAt: new Date().toISOString(), totalScanned: sessions.length, issues, fixed, summary: { totalIssues: issues.length, totalFixed: fixed.length } };
  }

  _log(action, data = {}) {
    this.recoveryLog.push({ timestamp: new Date().toISOString(), action, ...data });
  }

  getLog(limit = 50) {
    return this.recoveryLog.slice(-limit);
  }
}

// ============ Watcher ============

class Watcher {
  constructor(sessionManager, healer) {
    this.sm = sessionManager;
    this.healer = healer;
    this._running = false;
    this._interval = null;
    this._pollIntervalMs = 60000; // default 1 min
    this._stats = { startedAt: null, polls: 0, eventsDetected: 0, sessionsRecovered: 0 };
  }

  start(pollIntervalMs = 60000) {
    if (this._running) return { ok: true, message: 'Already running' };
    this._running = true;
    this._pollIntervalMs = pollIntervalMs;
    this._stats.startedAt = new Date().toISOString();

    this._interval = setInterval(async () => {
      if (!this._running) return;
      try {
        await this._poll();
      } catch (err) {
        console.error('Watcher poll error:', err.message);
      }
    }, this._pollIntervalMs);

    return { ok: true, message: 'Watcher started', pollIntervalMs };
  }

  stop() {
    this._running = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    return { ok: true, message: 'Watcher stopped' };
  }

  status() {
    return {
      running: this._running,
      pollIntervalMs: this._pollIntervalMs,
      stats: this._stats
    };
  }

  async _poll() {
    this._stats.polls++;
    const sessions = await this.sm.listSessions();

    for (const session of sessions) {
      if (!session.inDOM) continue;
      try {
        await this.sm.switchTo(session.conversationId);
        const status = await this.sm.getStatus();

        if (status === 'working') {
          // Check for long-running sessions (simplified)
          const msgs = await this.sm.readMessages(session.conversationId);
          const agentMsgs = msgs.filter(m => m.role === 'agent');
          // If working but last message was long ago, might be stuck
          // (Can't check timing from DOM alone, so skip for now)
        }
      } catch (err) {
        this._stats.eventsDetected++;
      }
    }
  }
}

module.exports = { Healer, Watcher };
