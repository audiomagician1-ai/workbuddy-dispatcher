# WorkBuddy Dispatcher V2 — 设计文档

## 1. 定位

独立的多 Agent 编排系统，通过 CDP 调度 WorkBuddy VS Code 扩展的多个会话，协作完成复杂软件工程。

**对标能力**：
| 来源 | 能力 | V2 实现方式 |
|------|------|-------------|
| echo-scheduler | 会话监控、跨会话消息、定时任务、异常自愈 | CDP + 内存状态 |
| agent-swarm | Feature 拆解、Worker 编排、评估验证、多轮循环 | 本地 TaskChain + FeatureManager |

**与 echo-scheduler 的关键区别**：
- echo-scheduler 通过 HTTP API 调用 Echo Agent（有自己的后端）
- V2 通过 CDP 操控 WorkBuddy UI（VS Code 扩展，无自有后端 API）
- 因此：消息获取靠 DOM 提取，会话切换靠 DOM 点击，会话创建靠 UI 操作

## 2. 架构

```
┌─────────────────────────────────────────────────────────────┐
│                   WorkBuddy Dispatcher V2                    │
│                    (Node.js, port 5200)                       │
│                                                               │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ MCP 工具  │  │  REST API    │  │  Web Dashboard       │  │
│  │ (对外暴露) │  │  (Dashboard) │  │  (监控+控制)          │  │
│  └─────┬─────┘  └──────┬───────┘  └──────────┬───────────┘  │
│        │               │                     │              │
│  ┌─────┴───────────────┴─────────────────────┴──────────┐   │
│  │                    Core Engine                         │   │
│  │  ┌────────────┐  ┌─────────────┐  ┌──────────────┐  │   │
│  │  │ SessionMgr  │  │ MessageBus  │  │ TaskOrchestr. │  │   │
│  │  │ 会话生命周期 │  │ 频道消息总线 │  │ 任务链编排引擎 │  │   │
│  │  └──────┬─────┘  └─────────────┘  └──────┬───────┘  │   │
│  │         │                                   │          │   │
│  │  ┌──────┴──────┐  ┌────────────────────────┴───────┐ │   │
│  │  │ FeatureMgr   │  │ Watcher + Healer              │ │   │
│  │  │ Feature 管理 │  │ 异常检测 + 自动恢复            │ │   │
│  │  └─────────────┘  └────────────────────────────────┘ │   │
│  └───────────────────────────┬───────────────────────────┘   │
│                              │                               │
│  ┌───────────────────────────┴───────────────────────────┐   │
│  │                  CDP Client Layer                      │   │
│  │  CDPAgent — WebSocket → agentManager.html              │   │
│  │  WorkbenchClient — WebSocket → workbench.html (IPC)   │   │
│  └───────────────────────────┬───────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────┘
                               │ CDP (port 9222)
┌──────────────────────────────┼──────────────────────────────┐
│              WorkBuddy VS Code Extension                    │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐   │
│  │ agentManager │  │ Session DOM   │  │ Chat Input     │   │
│  │ .html        │  │ (messages in  │  │ (Slate.js)     │   │
│  │              │  │  React state) │  │                │   │
│  └──────────────┘  └───────────────┘  └────────────────┘   │
│  ┌──────────────┐  ┌───────────────┐                       │
│  │ vscdb        │  │ workbench IPC │                       │
│  │ (session meta)│ │ (getSessions) │                       │
│  └──────────────┘  └───────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## 3. 模块设计

### 3.1 CDP Client Layer

```js
// lib/cdp_client.js
class CDPAgent {
  connect(port)          // 连接到 agentManager target
  evaluate(expr)         // 在 agentManager 中执行 JS
  typeText(text)         // 通过 CDP KeyEvent 模拟输入
  pressEnter()           // 模拟回车发送
  screenshot()           // 截取 agentManager 页面
  disconnect()
}

class WorkbenchClient {
  connect(port)          // 连接到 workbench target
  getSessions()          // IPC: codebuddy:getSessions
  getClawSessions()      // IPC: codebuddy:getClawSessions
  getSession(id)         // IPC: codebuddy:getSession
  disconnect()
}
```

**连接策略**：
- 启动时自动发现 target（`/json` API）
- CDPAgent 连 agentManager.html，WorkbenchClient 连 workbench.html
- 支持重连（CDP 连接可能因页面刷新断开）

### 3.2 Session Manager

```js
// lib/session_manager.js
class SessionManager {
  // 会话列表
  listSessions()               // vscdb + DOM 双源合并
  getSession(id)               // 单个会话详情

  // 会话切换
  switchTo(id)                 // CDP click conversation-item，等待就绪

  // 会话创建
  createSession(title?)        // CDP click "新建任务" 按钮

  // 消息读取
  readMessages(id)             // 切换到会话 → DOM 提取消息列表
  readMessagesSince(id, ts)    // 增量读取（对比上次快照）

  // 会话状态
  getStatus(id)                // 读取 DOM 推断: idle/working/error
  screenshot(id)               // 截图辅助诊断

  // 监控
  watchAll(pollInterval)       // 轮询所有会话状态变化
}
```

**消息提取增强**（相对现有 read_messages.js）：
- 区分 user/agent/system 消息（已有基础）
- 提取消息时间戳（如 DOM 中存在）
- 增量读取：记录上次提取的消息 hash，只返回新增
- 结构化输出：每条消息独立对象 `{ role, content, timestamp }`

### 3.3 Message Bus

```js
// lib/message_bus.js
class MessageBus {
  send(channel, content, sender?)     // 发送到频道
  read(channel, limit?, since?)       // 从频道读取
  listChannels()                      // 列出所有频道
  clear(channel)                      // 清空频道
}
```

**实现**：纯内存 `Map<string, Message[]>`，每频道 FIFO 200 条。
不依赖 WorkBuddy 的任何存储——这是 dispatcher 自己维护的。

**用途**：
- 会话 A 完成分析 → 发到 `research-results` 频道 → 会话 B 读取
- 状态广播：所有 Worker 把进度发到 `project-status` 频道
- Orchestrator 通过频道接收 Worker 完成通知

### 3.4 Task Orchestrator

```js
// lib/task_orchestrator.js
class TaskOrchestrator {
  // ---- 简单任务 ----
  createDelayedTask(name, sessionConfig, message, delay, repeat?)
  createLoopTask(name, sessionConfig, initialMsg, continueMsg, maxRounds)
  listTasks()
  cancelTask(name)
  taskLogs(name)

  // ---- 任务链（核心） ----
  createChain(name, steps)         // steps = [{ sessionConfig, message, waitUntil }]
  startChain(name)
  chainStatus(name)
  
  // ---- 配置 ----
  // sessionConfig = { newSession: true/false, sessionTitle?, session id? }
  // waitUntil = 'complete' | 'idle' | 'message_contains:xxx' | timeout:N
}
```

**任务链是核心概念**：
```
Step 1: 创建会话 → 发送 "分析需求文档" → 等待完成
  ↓ (自动)
Step 2: 创建会话 → 发送 "根据分析结果设计架构" + Step1结果 → 等待完成
  ↓ (自动)
Step 3: 创建会话 → 发送 "实现核心模块" + Step2结果 → 等待完成
  ↓ (自动)
Step 4: 创建会话 → 发送 "编写测试" + Step3结果 → 等待完成
```

**waitUntil 等略**：
- `complete` — 会话状态变为 idle（Agent 完成回复）
- `message_contains:xxx` — Agent 最新消息包含指定文本
- `timeout:N` — 最多等待 N 秒
- 组合：`complete | timeout:300`

### 3.5 Feature Manager

参考 agent-swarm 的 FeatureSelector，但简化实现：

```js
// lib/feature_manager.js
class FeatureManager {
  loadFromJSON(path)              // 加载 feature_list.json
  loadFromMarkdown(path)          // 从 Markdown 文档解析 features
  
  selectNext(preferGroup?)        // 选择下一个可实现的 feature
  markCompleted(featureIds)       // 标记完成
  markFailed(featureIds, reason)  // 标记失败
  getStats()                      // total/passed/failed/available
  
  allDone()                       // 所有 feature 是否完成
}
```

**与 agent-swarm 的区别**：
- agent-swarm 用 Git 做协调（原子锁在文件系统）
- V2 用 CDP 做 UI 操作，同一时间只有一个活跃会话操作 agentManager
- 因此不需要文件锁，但需要 **会话序列化**（一次只能有一个会话在前台）

### 3.6 Watcher + Healer

```js
// lib/watcher.js
class Watcher {
  start(pollInterval?)
  stop()
  status()                         // 运行统计
}

// lib/healer.js  
class Healer {
  diagnose(sessionId)              // 诊断会话问题
  recover(sessionId, action)       // 执行恢复: compact/retry/new
  scanAndRecover(autoFix?)         // 全局扫描
}
```

**诊断规则**（适配 WorkBuddy）：
- 会话长时间 working（>10min）→ 可能卡死 → 建议: 等待或新建会话
- 消息中出现 "error"/"failed" → 任务失败 → 建议: 重发或跳过
- 消息长度异常短且包含停止标志 → Agent 自行中止

**恢复动作**：
- `retry` — 向同一会话重新发送指令
- `new_session` — 创建新会话重做
- `skip` — 跳过当前步骤，继续链中下一步
- `notify` — 通过 MessageBus 发送通知给 Supervisor 会话

### 3.7 MCP Server

```js
// mcp_server.js
// 暴露 ~20 个 MCP 工具，命名空间: wb_
```

### 3.8 Web Dashboard

单文件 HTML，类似 echo-scheduler 的 dashboard，展示：
- 会话列表和状态
- 任务链进度
- Feature 完成度
- 消息频道

## 4. 关键约束

1. **同一时间只有一个前台会话** — WorkBuddy UI 只显示一个会话的消息，切换是排他的
2. **消息在 React 内存中** — 无法直接 API 获取，只能 DOM 提取
3. **消息格式扁平** — DOM 中 user/agent 消息混在一个容器，需遍历+过滤
4. **CDP 连接可能断开** — VS Code 刷新 agentManager 时需要重连
5. **创建会话是 UI 操作** — 点击"新建任务"按钮，无 API
6. **输入是模拟键盘** — Slate.js 不支持直接 set，必须 CDP KeyEvent

## 5. 会话序列化策略

因为只有 UI 一个前台，多个 Worker 不能同时操作。解决方案：

```
┌──────────────────────────────────┐
│         Session Queue            │
│  [WorkerA等待] [WorkerB执行中]   │
│  [WorkerC等待]                   │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│      Orchestrator Loop           │
│                                  │
│  1. 从队列取下一个任务            │
│  2. 切换到对应会话（CDP click）   │
│  3. 发送指令（CDP typeText）      │
│  4. waitUntil 条件满足            │
│  5. 读取结果（CDP DOM extract）   │
│  6. 结果 → MessageBus / 下一步    │
│  7. 回到 1                        │
└──────────────────────────────────┘
```

**并行策略**：
- 多个会话可以同时在 WorkBuddy 中存在（多个 conversation-item）
- 但只有一个在前台显示
- Orchestrator 按优先级轮流切换前台会话，检查各会话状态
- 一个会话在后台（hidden）时，WorkBuddy 的 Agent 可能仍在执行

## 6. 文件结构

```
workbuddy-dispatcher/
├── mcp_server.js              # MCP Server 入口 (所有工具注册在此)
├── config.json                # 配置文件
├── package.json               # 依赖
├── lib/
│   ├── cdp_client.js          # CDP 客户端 (CDPAgent + WorkbenchClient)
│   ├── session_manager.js     # 会话管理
│   ├── message_bus.js         # 消息总线
│   ├── task_orchestrator.js   # 任务编排引擎 (TaskChain + Loop + Delayed)
│   ├── feature_manager.js     # Feature 管理
│   ├── watcher.js             # 异常检测 Watcher
│   ├── healer.js              # 异常恢复
│   └── dashboard.js           # Dashboard HTTP 服务
├── scripts/                   # 现有独立脚本 (保留兼容)
│   ├── send_message.js
│   ├── read_messages.js
│   ├── read_sessions.js
│   └── list_targets.js
├── templates/
│   ├── feature_list.json      # Feature 清单模板
│   └── task_chain.json        # 任务链模板
├── docs/
│   ├── design-v2.md           # 本文档
│   ├── known-issues.md        # 已知问题
│   └── cdp-architecture.md    # CDP 架构
└── dashboard.html             # Web Dashboard (单文件)
```

## 7. MCP 工具清单

### 会话管理 (wb_session_*)
| 工具 | 说明 |
|------|------|
| `wb_session_list` | 列出所有会话（状态、标题、时间） |
| `wb_session_get` | 获取单个会话详情 |
| `wb_session_switch` | 切换到指定会话 |
| `wb_session_create` | 创建新会话（可选标题） |
| `wb_session_messages` | 读取指定会话消息 |
| `wb_session_status` | 获取会话状态（idle/working/error） |
| `wb_session_screenshot` | 截取当前会话截图 |

### 消息 (wb_message_*)
| 工具 | 说明 |
|------|------|
| `wb_message_send` | 向当前/指定会话发送消息 |
| `wb_message_relay` | 向指定会话发送消息并等待回复 |
| `wb_message_launch` | 创建新会话并发送首条消息 |

### 频道 (wb_channel_*)
| 工具 | 说明 |
|------|------|
| `wb_channel_send` | 向频道发送消息 |
| `wb_channel_read` | 从频道读取消息 |
| `wb_channel_list` | 列出所有频道 |

### 任务 (wb_task_*)
| 工具 | 说明 |
|------|------|
| `wb_task_chain_create` | 创建任务链 |
| `wb_task_chain_start` | 启动任务链 |
| `wb_task_chain_status` | 查看任务链状态 |
| `wb_task_loop_create` | 创建循环任务 |
| `wb_task_delayed_create` | 创建延迟/定时任务 |
| `wb_task_list` | 列出所有任务 |
| `wb_task_cancel` | 取消任务 |
| `wb_task_logs` | 查看任务日志 |

### Feature (wb_feature_*)
| 工具 | 说明 |
|------|------|
| `wb_feature_load` | 加载 feature 清单 |
| `wb_feature_next` | 选择下一个 feature |
| `wb_feature_complete` | 标记 feature 完成 |
| `wb_feature_fail` | 标记 feature 失败 |
| `wb_feature_stats` | Feature 统计 |

### 系统 (wb_*)
| 工具 | 说明 |
|------|------|
| `wb_overview` | 全局概览（会话数、任务数、频道数） |
| `wb_watcher_control` | 控制 Watcher（start/stop/status） |
| `wb_heal_scan` | 扫描异常会话 |
| `wb_heal_recover` | 恢复指定会话 |

## 8. 实现优先级

**Phase 1 — 基础设施**（先跑通）
1. `lib/cdp_client.js` — 重构现有散落的 CDP 代码
2. `lib/session_manager.js` — 整合 list/switch/read
3. `mcp_server.js` — 先暴露基础会话工具

**Phase 2 — 通信与任务**
4. `lib/message_bus.js` — 频道消息
5. `lib/task_orchestrator.js` — 任务链 + 循环 + 延迟
6. 扩展 MCP 工具

**Phase 3 — 高级编排**
7. `lib/feature_manager.js` — Feature 管理
8. `lib/watcher.js` + `lib/healer.js` — 异常自愈
9. `dashboard.html` — Web 监控面板

**Phase 4 — 生态集成**
10. 与 echo-scheduler 互通（通过 MessageBus）
11. 支持从 agent-swarm 的 feature_list.json 格式导入
