# IPC 通道完整调查

## 调查方法

1. 搜索 `A:\WorkBuddy\resources\app\out\codebuddy\main.js` 中的 IPC handler 注册
2. 搜索 `onDidReceiveMessage`、`registerHandler` 等关键词
3. 通过 CDP 实际调用验证

## 可用通道

### codebuddy:getSessions

```javascript
const result = await window.vscode.ipcRenderer.invoke('codebuddy:getSessions');
// 返回: { sessions: [], total: 0, hasMore: false }
```

- 返回 WorkBuddy Agent Manager 的会话列表
- 当前返回空数组（会话管理可能走另一套机制）

### codebuddy:getClawSessions

```javascript
const result = await window.vscode.ipcRenderer.invoke('codebuddy:getClawSessions');
// 返回: { sessions: [...], total: 2, hasMore: false }
```

- 返回 Claw 专用会话
- 每个 session 包含: conversationId, cwd, userId, title, customTitle, status, createdAt, updatedAt

### codebuddy:getSession

```javascript
const result = await window.vscode.ipcRenderer.invoke('codebuddy:getSession', conversationId);
// 需要 conversationId 参数
// 不传参数会报: Cannot read properties of undefined (reading 'substring')
```

### codebuddy:upsertSession

```javascript
// 参数格式: { conversationId, cwd, userId, customTitle, status }
const result = await window.vscode.ipcRenderer.invoke('codebuddy:upsertSession', params);
// 返回: undefined（成功时无返回值）
// 报错: paths[0] argument must be string（参数格式不对时）
```

## 不可用通道

### session/new

```
Error invoking remote method 'session/new': 
Error: Unsupported event IPC channel 'session/new'
```

- 仅在 extension 内部使用（不是 renderer → extension 通道）

### 其他已确认无 handler 的通道

- `codebuddy:listSessions` — No handler registered
- `codebuddy:chat.sessionList` — No handler registered
- `codebuddy:chat.history` — No handler registered
- `codebuddy:getMessages` — No handler registered
- `codebuddy:session.create` — No handler（在 Claw page 中测试）
- `codebuddy:deleteSession` — 未测试

## 源码中搜索到的通道名

通过搜索 `main.js` 找到的通道（未全部验证）：

```
codebuddy:upsertSession
codebuddy:deleteSession
codebuddy:getSessions
codebuddy:getClawSessions
codebuddy:getSession
session/cancel
session/fork
session/list
session/new
session/prompt
```

## IPC 消息传递机制

### Renderer → Extension

```
window.vscode.ipcRenderer.invoke(channel, ...args)
  → preload.js invoke(e, ...r) → ipcRenderer.invoke(e, ...r)
    → Extension host handler
```

### preload.js invoke 实现

```javascript
invoke(e, ...r) {
  return t(e),      // 参数类型校验
  o.invoke(e, ...r) // 实际调用
}
```

**注意**: `...r` 展开会将对象参数解构。如果 handler 期望接收单个对象，
需要确保调用时不被展开。实际行为取决于 handler 端的参数接收方式。

### 返回值

- 大部分通道返回 Promise
- CDP `Runtime.evaluate` 的 `returnByValue: true` 无法正确序列化 Promise 结果
- 建议使用 `awaitPromise: true` 或在 page 内部 resolve 后存储到 window 变量
