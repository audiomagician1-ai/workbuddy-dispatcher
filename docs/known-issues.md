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

## 问题 5: Agent Manager DOM 混合

**现象**: 查询 `[class*="userMessage"]` 返回所有会话的消息

**原因**: agentManager 是单页应用，所有会话 DOM 同时存在，通过 CSS display 切换

**解决** (待验证):
- 方案 A: 找每个会话的独立容器 div，限定查询范围
- 方案 B: 使用 `data-conversation-id` 属性过滤
- 方案 C: 使用 IPC 通道获取消息数据（需找到正确的通道）

## 问题 6: Page.captureScreenshot 超时

**现象**: 截图命令偶尔超时

**原因**: 可能在 page 加载/导航过程中调用

**解决**: 添加重试逻辑，或在 `Page.loadEventFired` 后调用

## 问题 7: preload.js invoke 参数展开

**现象**: IPC 调用参数不匹配（如 `paths[0]` 错误）

**原因**: preload.js 的 `invoke(e, ...r)` 会展开参数数组

**影响**: 传递 `{key: value}` 对象时，可能被展开为多个参数

**解决**: 需要确认具体 handler 的参数接收方式，适当包装/不包装参数
