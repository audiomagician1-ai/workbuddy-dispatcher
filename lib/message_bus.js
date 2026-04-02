/**
 * message_bus.js - 内存消息总线
 *
 * 频道模型的消息传递系统，用于跨会话通信。
 * 纯内存实现，进程重启后清空。
 */
const MAX_MESSAGES_PER_CHANNEL = 200;

class MessageBus {
  constructor() {
    this._channels = new Map(); // channel -> [{ sender, content, metadata, timestamp }]
  }

  send(channel, content, sender = '', metadata = null) {
    if (!this._channels.has(channel)) {
      this._channels.set(channel, []);
    }
    const ch = this._channels.get(channel);
    ch.push({
      sender,
      content,
      metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
      timestamp: new Date().toISOString()
    });
    // FIFO trim
    while (ch.length > MAX_MESSAGES_PER_CHANNEL) ch.shift();
    return { ok: true, channelMessageCount: ch.length };
  }

  read(channel, limit = 10, since = null) {
    const ch = this._channels.get(channel);
    if (!ch) return [];

    let msgs = ch;
    if (since) {
      const sinceDate = new Date(since);
      msgs = ch.filter(m => new Date(m.timestamp) > sinceDate);
    }

    return msgs.slice(-limit);
  }

  listChannels() {
    const result = [];
    for (const [name, msgs] of this._channels) {
      result.push({ name, count: msgs.length, lastTimestamp: msgs[msgs.length - 1]?.timestamp });
    }
    return result;
  }

  clear(channel) {
    this._channels.delete(channel);
    return { ok: true };
  }

  stats() {
    let total = 0;
    for (const [, msgs] of this._channels) total += msgs.length;
    return { channelCount: this._channels.size, totalMessages: total };
  }
}

module.exports = { MessageBus };
