# WorkBuddy Dispatcher

通过 Chrome DevTools Protocol (CDP) 调度 WorkBuddy Agent，实现外部程序触发 Agent 任务并获取回复。

## 架构概览

```
外部程序 → CDP WebSocket (port 9222) → WorkBuddy Electron → Agent Manager → LLM Agent
```

WorkBuddy 基于 VS Code Electron，启动时可通过 `--remote-debugging-port=9222` 开启 CDP 调试端口。

## 快速开始

### 启动 WorkBuddy（带 CDP）

```powershell
A:\WorkBuddy\WorkBuddy.exe --remote-debugging-port=9222
```

或使用快捷方式 `A:\WorkBuddy\WorkBuddy-CDP-9222.lnk`。

### 验证连接

```bash
node scripts/list_targets.js
```

### 发送消息到 Agent

```bash
node scripts/send_message.js "你的消息"
```

## 核心发现

### 1. CDP Target 结构

WorkBuddy 启动后，CDP 会暴露多个 page target：

| Target | 说明 |
|--------|------|
| `workbench.html` | 主编辑器 workbench |
| `agentManager.html` | Agent Manager 页面（核心） |
| `Claw - WorkBuddy` | Claw AI 专用页面 |
| 各种 `vscode-webview://` | Webview iframe |

**Agent Manager 页面**（`agentManager.html`）是调度入口，包含：
- 侧边栏会话列表
- 聊天输入框（Slate.js 编辑器）
- 聊天消息区域

### 2. 聊天输入框

```html
<div contenteditable="true" data-slate-editor data-slate-node
     class="_editable_vx5q9_1" role="textbox"
     placeholder="输入消息...">
```

- **编辑器**: Slate.js（React 组件）
- **React 事件**: 通过 `__reactFiber$` 绑定，无 `onkeydown` HTML 属性
- **发送**: Enter 键发送（Shift+Enter 换行）

### 3. 输入方法

**正确方式** — 使用 CDP `Input.dispatchKeyEvent`（只发 keyDown + keyUp，不发 char 事件）：

```javascript
// 逐字符输入（避免重复）
for (const char of message) {
  await cdpSend('Input.dispatchKeyEvent', {
    type: 'keyDown', key: char, text: char,
    code: `Key${char.toUpperCase()}`,
    windowsVirtualKeyCode: char.charCodeAt(0),
    nativeVirtualKeyCode: char.charCodeAt(0)
  });
  await cdpSend('Input.dispatchKeyEvent', {
    type: 'keyUp', key: char,
    code: `Key${char.toUpperCase()}`,
    windowsVirtualKeyCode: char.charCodeAt(0),
    nativeVirtualKeyCode: char.charCodeAt(0)
  });
}

// Enter 发送
await cdpSend('Input.dispatchKeyEvent', {
  type: 'keyDown', key: 'Enter', code: 'Enter',
  windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
});
await cdpSend('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 'Enter', code: 'Enter',
  windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
});
```

**错误方式**:
- ❌ 直接设置 `textContent` — 不触发 React 状态更新
- ❌ 发送 `char` 类型事件 — Slate 会重复输入（"hello" → "hheelllloo"）
- ❌ `document.execCommand('insertText')` — 不触发 Slate onChange

### 4. IPC 通道

通过 workbench renderer 的 `window.vscode.ipcRenderer.invoke(channel)` 可调用：

| 通道 | 返回 | 说明 |
|------|------|------|
| `codebuddy:getSessions` | `{sessions:[], total:0}` | WorkBuddy 会话列表 |
| `codebuddy:getClawSessions` | `{sessions:[...], total:N}` | Claw 会话列表 |
| `codebuddy:getSession` | 需要参数 | 获取单个会话（需 conversationId） |
| `codebuddy:upsertSession` | undefined (成功) | 创建/更新会话 |

**不可用的通道**（仅 extension 内部）：
- `session/new` — "Unsupported event IPC channel"
- `session/prompt` — 同上
- `codebuddy:listSessions` — No handler
- `codebuddy:chat.sessionList` — No handler
- `codebuddy:chat.history` — No handler
- `codebuddy:getMessages` — No handler

### 5. DOM 消息结构

Agent Manager 是**单页应用**，所有会话的 DOM 同时存在，通过 CSS 切换可见性：

```
agentManager.html
├── conversation-sidebar
│   ├── conversation-list-tabs (新建任务 / Claw / 专家 / 技能 / 自动化)
│   └── conversation-list
│       ├── conversation-item[data-id] "hello" ← CDP 测试创建
│       └── conversation-item[data-id] ...
├── chat-container (active)
│   ├── [class*="userMessage"] ← 用户消息
│   └── [class*="assistant"] ← Agent 回复
│       ├── [class*="assistantMessageContent"]
│       └── [class*="assistantTextContent"]
└── 输入区域
    ├── _mainArea_li9tf_41
    ├── _content_li9tf_7
    └── _container_li9tf_2
        └── [contenteditable="true"] ← 输入框
```

### 6. 未解决的问题

- **获取 Agent 回复**: agentManager DOM 里所有会话混合，无法精确区分哪个 `<div class="assistant">` 属于哪个会话
- **会话切换**: 点击侧边栏后 React 状态异步更新，需要等待 + 轮询确认
- **CDP 截图**: `Page.captureScreenshot` 偶尔超时（page 加载中时）

## 目录结构

```
workbuddy-dispatcher/
├── README.md              # 本文档
├── docs/
│   ├── cdp-architecture.md    # CDP 架构详解
│   ├── ipc-channels.md        # IPC 通道完整调查
│   ├── exploration-log.md     # 探索过程记录
│   └── known-issues.md        # 已知问题和解决方案
├── scripts/
│   ├── list_targets.js        # 列出 CDP targets
│   ├── send_message.js        # 发送消息到 Agent（主脚本）
│   └── read_sessions.js       # 读取会话列表
├── archive/                   # 过程文件备份
│   ├── scripts/               # 早期探索脚本
│   └── logs/                  # 输出日志
└── setup/
    └── create_shortcut.ps1    # 创建 CDP 快捷方式
```

## 参考文件位置

| 文件 | 说明 |
|------|------|
| `A:\WorkBuddy\resources\app\out\codebuddy\main.js` | WorkBuddy 扩展主代码 |
| `A:\WorkBuddy\resources\app\out\vs\base\parts\sandbox\electron-sandbox\preload.js` | Electron preload (IPC 实现) |
