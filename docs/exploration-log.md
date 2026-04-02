# 探索过程记录

## 时间线

### Phase 1: 初步探索（agent-infra 仓库）

1. **尝试 Playwright 连接** — `playwright.chromium.connect()` 卡住超时
2. **切换到原生 WebSocket** — `test_ws_api.js` 成功连接 CDP
3. **扫描 targets** — 发现 workbench、Claw page、Agent Manager page

### Phase 2: IPC 通道探索

4. **测试错误通道名** — `codebuddy:session.create` 返回 `{}`（fire-and-forget）
5. **搜索源码** — 在 `main.js` 中找到正确的通道名
6. **测试正确通道** — `codebuddy:getClawSessions` 成功返回数据 ✅
7. **upsertSession 测试** — 参数格式不对导致 `paths[0]` 错误
8. **session/new 测试** — "Unsupported event IPC channel"（仅 extension 内部）

### Phase 3: DOM 操作探索

9. **Agent Manager DOM 分析** — 发现 Slate.js 编辑器、React 组件
10. **尝试 textContent 输入** — 不触发 React 状态更新 ❌
11. **CDP Input.dispatchKeyEvent** — 成功输入文字 ✅
12. **发现 char 事件导致重复** — 去掉 char 事件后正常 ✅
13. **Enter 发送** — 成功发送消息，输入框清空 ✅

### Phase 4: 获取回复

14. **MutationObserver 监听** — 检测到 "思考中..." 但误读了其他会话
15. **发现 DOM 混合问题** — agentManager 所有会话 DOM 同时存在
16. **点击侧边栏切换** — React 异步更新，切换后读取不精确
17. **IPC 获取会话数据** — getSessions 返回空，getClawSessions 有数据但不含消息内容

## 关键脚本索引

| 脚本 | 作用 | 结果 |
|------|------|------|
| `test_ws_api.js` | 原生 WebSocket CDP 连接 | ✅ 基础框架 |
| `test_cdp_final.js` | ID-based 消息路由 | ✅ 稳定连接 |
| `test_cdp_analyze_send.js` | DOM 结构分析 | ✅ 找到 Slate 编辑器 |
| `test_cdp_send_v2.js` | 动态查找 target + 发送 | ✅ 端到端发送 |
| `test_cdp_send_v3.js` | 修复字符重复 | ✅ 完整发送 |
| `read_session.js` / `read_session_v2.js` | 读取会话内容 | ⚠️ DOM 混合 |
| `read_hello_reply.js` | 切换到 hello 会话 | ⚠️ 不精确 |
| `read_sessions_ipc.js` | IPC 获取会话列表 | ✅ getClawSessions 可用 |
| `read_wb_sessions.js` | 获取 WB 会话 | ⚠️ sessions 为空 |
| `search_codebuddy.js` 系列 | 搜索源码找通道名 | ✅ 找到正确通道 |

## 经验总结

1. **CDP 连接 Electron**: 原生 WebSocket > Playwright（Playwright 会卡住）
2. **消息路由**: 必须用 ID-based pending map，不能用 `ws.once`（会乱序匹配）
3. **Slate.js 输入**: 只发 keyDown + keyUp，不发 char 事件
4. **React 组件交互**: 不能直接操作 DOM，必须模拟用户输入事件
5. **IPC Promise**: CDP 无法直接获取 Promise resolved value，需在 page 内部处理
6. **多会话 DOM**: agentManager 是 SPA，所有会话 DOM 同时存在，需精确选择器
