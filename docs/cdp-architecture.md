# CDP 架构详解

## WorkBuddy Electron CDP 端口

WorkBuddy 基于 VS Code Electron，默认不开启 CDP。通过命令行参数启动：

```powershell
A:\WorkBuddy\WorkBuddy.exe --remote-debugging-port=9222
```

启动后可通过 `http://localhost:9222/json` 获取所有 target 列表。

## Target 类型

### page 类型

| URL 特征 | 说明 | 有 vscode API | 有输入框 |
|----------|------|:---:|:---:|
| `workbench/workbench.html` | 主编辑器 | ✅ | ❌ |
| `workbench/agentManager.html` | Agent Manager | ✅ | ✅ |
| `vscode-file://.../workbench.html` (Claw) | Claw 专用 | ✅ | ❌ |

### iframe 类型

| URL 特征 | 说明 |
|----------|------|
| `vscode-webview://...extensionId=CodeBuddy.overlay` | CodeBuddy overlay |
| `vscode-webview://...extensionId=Tencent-Cloud.coding-copilot` | Chat UI webview |

**注意**: Webview iframe 是沙箱化的，无法访问 `window.vscode` API。

## 连接方式

### 方式 1: 原生 WebSocket（推荐）

```javascript
const WebSocket = require('ws');

// 获取 target 列表
const targets = await fetch('http://localhost:9222/json').then(r => r.json());

// 连接到指定 target
const ws = new WebSocket(target.webSocketDebuggerUrl);
```

**关键**: 使用 ID-based 消息路由，不要用 `ws.once`（会匹配到错误的消息）。

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

### 方式 2: Playwright（不推荐）

`playwright.chromium.connect()` 在连接 WorkBuddy Electron 时会卡住（超时）。
原因未明，可能与 Electron 的特殊 CDP 实现有关。

## CDP 命令

### 已验证可用

| 命令 | 用途 | 备注 |
|------|------|------|
| `Runtime.enable` | 启用运行时 | 必须先调用 |
| `Runtime.evaluate` | 执行 JS | 支持 `awaitPromise: true` |
| `Log.enable` | 启用日志 | Claw page 日志量很大 |
| `Input.dispatchMouseEvent` | 鼠标事件 | 用于点击/聚焦 |
| `Input.dispatchKeyEvent` | 键盘事件 | 用于输入文字 |
| `Page.captureScreenshot` | 截图 | 偶尔超时 |

### Runtime.evaluate 注意事项

- `returnByValue: true` — 返回值会被序列化为 JSON（Promise 返回 `{}` 而非实际值）
- `returnByValue: false` — 返回 RemoteObject（可获取 Promise 的 resolved value，但更复杂）
- `awaitPromise: true` — 等待 Promise resolve 后返回结果
- **CDP 无法正确序列化 Promise 的 resolved value** — `returnByValue: true` 时返回 `undefined`

## 关键发现：预加载脚本中的 invoke 实现

```javascript
// preload.js 中的 invoke 实现
invoke(e, ...r) {
  return t(e),                          // 参数校验
  o.invoke(e, ...r)                     // 调用实际的 ipcRenderer.invoke
}
```

`...r` 展开意味着传递的 object 参数会被展开为多个参数。
Extension handler 期望 `invoke(channel, dataObj)`，但如果传 `{key: value}`，
实际调用的是 `invoke(channel, key, value)`。

这解释了为什么某些 IPC 调用参数不匹配（如 `paths[0]` 错误）。
