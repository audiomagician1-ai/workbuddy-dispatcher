# 已知问题和解决方案

## 问题 1: Playwright connect 卡住

**现象**: `playwright.chromium.connect('http://localhost:9222')` 超时

**原因**: 未确认，可能与 Electron 的特殊 CDP 实现有关

**解决**: 使用原生 `ws` 库的 WebSocket 连接

## 问题 2: ws.once 消息乱序

**现象**: CDP 响应与请求不匹配，拿到错误的结果

**原因**: `ws.once('message')` 只等下一条消息，但 CDP 可能有事件消息插入

**解决**: 使用 ID-based pending map，根据 `msg.id` 匹配请求和响应

```javascript
const pending = {};
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending[msg.id]) {
    clearTimeout(pending[msg.id].timer);
    pending[msg.id].resolve(msg);
    delete pending[msg.id];
  }
});
```

## 问题 3: Slate.js 字符重复

**现象**: 输入 "hello" 变成 "hheelllloo"

**原因**: Slate 对 `keyDown` 事件的 `text` 字段和 `char` 类型事件都会触发输入

**解决**: 只发 `keyDown` + `keyUp`，不发 `char` 事件

## 问题 4: CDP 无法获取 Promise resolved value

**现象**: `Runtime.evaluate` 返回 `undefined`，但实际 extension handler 返回了数据

**原因**: `returnByValue: true` 无法序列化 Promise 的 resolved value

**解决**: 
- 方案 A: 使用 `awaitPromise: true`（部分情况有效）
- 方案 B: 在 page 内部 await 后存储到 `window.__result`，再读取

## 问题 5: Agent Manager DOM 混合 ✅ 已解决

**现象**: 查询 `[class*="userMessage"]` 返回所有会话的消息

**原因**: agentManager 是单页应用，所有会话 DOM 同时存在，通过 CSS display 切换

**解决** (2026-04-03):
- `data-conversation-id` 属性存在于 `.conversation-item` 元素上
- 当前可见会话的 DOM 有 `display: block`，隐藏会话为 `display: none`
- 通过 `document.body.innerText` 或 `.chat-container > [class*="cbChat"]` 可提取当前会话消息
- 使用 `.conversation-item[data-conversation-id="xxx"].click()` 可切换会话
- 会话元数据存储在 `codebuddy-sessions.vscdb` (SQLite)，key 格式为 `session:<conversationId>`

**已知限制**:
- 消息存在 React 内存 state 中，**不持久化到文件系统**
- `genie-history/<workspace>/conversations/<id>/` 目录始终为空
- DOM 中的消息结构是扁平化的，所有消息在 `_cbChat_hash` 容器内
- 无法直接获取 JSON 格式的结构化消息（CDP 序列化限制：`Object reference chain is too long`）

## 问题 6: Page.captureScreenshot 超时

**现象**: 截图命令偶尔超时

**原因**: 可能在 page 加载/导航过程中调用

**解决**: 添加重试逻辑，或在 `Page.loadEventFired` 后调用

## 问题 7: preload.js invoke 参数展开

**现象**: IPC 调用参数不匹配（如 `paths[0]` 错误）

**原因**: preload.js 的 `invoke(e, ...r)` 会展开参数数组

**影响**: 传递 `{key: value}` 对象时，可能被展开为多个参数

**解决**: 需要确认具体 handler 的参数接收方式，适当包装/不包装参数

## 问题 8: CDP 序列化 React state 失败 (2026-04-03)

**现象**: 通过 CDP `Runtime.evaluate` 尝试返回 React fiber tree 的 state 时，报错 `Object reference chain is too long`

**原因**: React state 中的对象引用链太深，超出 V8 序列化限制

**解决**: 
- 不尝试序列化 React state，改为直接从 DOM 提取文本
- 使用 `document.body.innerText` 或 `element.textContent` 获取纯文本
- 对于需要结构化数据的场景，需要进一步 hook React 的 dispatch 或使用 MutationObserver

---

## 附录: WorkBuddy 消息架构分析 (2026-04-03)

### IPC 通道 (preload.bundle.js)
- `CodeBuddy:sdk-request-v1` — webview → 主进程 (通过 `ipcRenderer.sendToHost`)
- `CodeBuddy:sdk-response-v1` — 主进程 → webview (通过 `ipcRenderer.on`)
- `CodeBuddy:windowClose` — 关闭窗口
- `CodeBuddy:onClick` — DOM 点击事件传递
- `CodeBuddy:onSelectElement` — 元素选择信息
- `CodeBuddy:toggleHighlight` — 切换高亮
- `CodeBuddy:previewDomEdit` — 预览 DOM 编辑
- `window.codeBuddy.postCodeBuddyMessage()` — SDK 消息发送 API

### 消息存储
- **会话元数据**: `codebuddy-sessions.vscdb` → `ItemTable` → key=`session:<conversationId>`
  - 字段: conversationId, cwd, userId, title, customTitle, status, createdAt, updatedAt
- **消息内容**: React 内存 state（**不持久化**）
- **genie-history**: `conversations/<id>/` 始终为空
- **todos**: `globalStorage/tencent-cloud.coding-copilot/todos/<conversationId>.json`
- **file-changes**: `globalStorage/tencent-cloud.coding-copilot/file-changes/<conversationId>/`

### Agent Manager DOM 结构
```
body.agent-ui-theme
  .conversation-sidebar
    .conversation-list
      .conversation-section
        .conversation-section-content
          .conversation-item[data-conversation-id=xxx]  ← 会话列表项
  .main-content
    .workbuddy-topbar  ← 当前会话标题
    .teams-main-content
      .chat-container
        ._cbChat_hash (children=93)  ← 所有消息的容器
          ._chatMessageContainer_hash._chatMessage_hash  ← 消息包装
            ._chatMessageBox_hash  ← 消息内容
```

### 脚本使用
```bash
# 列出所有会话（从 vscdb 读取）
node read_messages.js --sessions

# 读取当前可见会话的消息
node read_messages.js

# 切换到指定会话并读取消息
node read_messages.js --id <conversationId>

# 发送消息到 Agent Manager
node send_message.js "你的消息" [--new]
```
