# WorkBuddy Dispatcher V2

通过 CDP 调度 WorkBuddy VS Code 扩展，实现多 Agent 会话协作编排。

## 它能做什么

| 能力 | 说明 |
|------|------|
| **会话管理** | 列出、切换、创建会话，读取消息，状态监控，截图 |
| **消息收发** | 向任意会话发送消息，发送并等待回复，创建新会话发送首条消息 |
| **跨会话通信** | 基于频道的内存消息总线，会话间松耦合信息传递 |
| **任务链** | 多步骤顺序执行，步骤间自动传递上下文，支持 waitUntil 策略 |
| **循环任务** | 多轮驱动 Agent 持续工作，自动检测停止关键词 |
| **定时任务** | 延迟执行、定时重复 |
| **Feature 管理** | 加载、选择、完成、失败追踪，支持分组和依赖 |
| **异常自愈** | 诊断会话问题，自动或手动恢复 |
| **Web 仪表盘** | 浏览器实时监控全局状态 |

## 架构

```
外部程序/MCP Client
    │
    ▼ MCP (JSON-RPC) / REST API
┌──────────────────────────────────────────────┐
│           WorkBuddy Dispatcher V2             │
│           (Node.js, port 5200)                │
│                                               │
│  ┌─────────────┐  ┌───────────┐              │
│  │ SessionMgr  │  │ MessageBus│              │
│  │ 会话生命周期 │  │ 频道消息  │              │
│  └──────┬──────┘  └───────────┘              │
│  ┌──────┴──────────────────────┐             │
│  │     TaskOrchestrator        │             │
│  │ TaskChain + Loop + Delayed  │             │
│  └─────────────────────────────┘             │
│  ┌─────────────┐  ┌─────────────┐            │
│  │ FeatureMgr  │  │ Watcher+    │            │
│  │ Feature管理 │  │ Healer      │            │
│  └─────────────┘  └─────────────┘            │
│                    │                           │
│  ┌─────────────────┴──────────────┐          │
│  │     CDP Client Layer           │          │
│  │ CDPAgent + WorkbenchClient     │          │
│  └─────────────────┬──────────────┘          │
└────────────────────┼─────────────────────────┘
                     │ CDP (port 9222)
┌────────────────────┼─────────────────────────┐
│          WorkBuddy VS Code Extension          │
│  agentManager.html + workbench.html           │
└───────────────────────────────────────────────┘
```

## 快速开始

### 1. 启动 WorkBuddy（带 CDP）

```powershell
A:\WorkBuddy\WorkBuddy.exe --remote-debugging-port=9222
```

### 2. 启动 Dispatcher

```bash
cd A:\GitHub\workbuddy-dispatcher
npm install
node mcp_server.js
```

启动后：
- **MCP 端点**: `http://localhost:5200/mcp`
- **REST API**: `http://localhost:5200/api/overview`
- **Dashboard**: `http://localhost:5200/`

### 3. 在 WorkBuddy 中接入

在 WorkBuddy 的 MCP Server 配置中添加 Streamable HTTP 类型：

```json
{
  "workbuddy-dispatcher": {
    "transport": "streamable-http",
    "url": "http://127.0.0.1:5200/mcp"
  }
}
```

接入后即可调用所有 `wb_*` 工具。

## MCP 工具完整参考

### 会话管理

| 工具 | 说明 |
|------|------|
| `wb_session_list` | 列出所有会话 |
| `wb_session_get` | 获取会话详情 |
| `wb_session_switch` | 切换到指定会话 |
| `wb_session_create` | 创建新会话 |
| `wb_session_messages` | 读取会话消息 |
| `wb_session_status` | 获取会话状态 (idle/working) |
| `wb_session_screenshot` | 截取当前会话截图 |

### 消息

| 工具 | 说明 |
|------|------|
| `wb_message_send` | 发送消息到会话 |
| `wb_message_relay` | 发送消息并等待 Agent 回复 |
| `wb_message_launch` | 创建新会话并发送首条消息 |

### 频道

| 工具 | 说明 |
|------|------|
| `wb_channel_send` | 向频道发送消息 |
| `wb_channel_read` | 从频道读取消息 |
| `wb_channel_list` | 列出所有频道 |

### 任务链

| 工具 | 说明 |
|------|------|
| `wb_chain_create` | 创建多步骤任务链 |
| `wb_chain_start` | 启动任务链（后台运行） |
| `wb_chain_status` | 查看任务链状态 |
| `wb_chain_cancel` | 取消任务链 |

### 循环/定时任务

| 工具 | 说明 |
|------|------|
| `wb_task_loop` | 创建循环任务 |
| `wb_task_delayed` | 创建延迟/定时任务 |
| `wb_task_start` | 启动任务 |
| `wb_task_list` | 列出所有任务 |
| `wb_task_cancel` | 取消任务 |
| `wb_task_logs` | 查看任务日志 |

### Feature 管理

| 工具 | 说明 |
|------|------|
| `wb_feature_load` | 加载 feature_list.json |
| `wb_feature_next` | 获取下一个可用 feature |
| `wb_feature_complete` | 标记 feature 完成 |
| `wb_feature_fail` | 标记 feature 失败 |
| `wb_feature_stats` | Feature 统计 |

### 系统

| 工具 | 说明 |
|------|------|
| `wb_overview` | 全局概览 |
| `wb_watcher_control` | 控制自动监控 |
| `wb_heal_scan` | 扫描异常会话 |
| `wb_heal_recover` | 恢复指定会话 |

## 典型使用场景

### 场景 1: 多步骤任务链

```
# 创建分析→设计→实现→测试的任务链
wb_chain_create(
  name="build-feature",
  steps=[
    { message: "分析需求文档 requirements.md，输出功能拆解", newSession: true },
    { message: "根据分析结果设计技术方案", newSession: true },
    { message: "实现核心功能模块", newSession: true },
    { message: "编写单元测试", newSession: true }
  ]
)
wb_chain_start(name="build-feature")
```

### 场景 2: 跨会话信息传递

```
# 会话 A: 完成研究后发送结果
wb_channel_send(channel="research", content="方案二更优，预计开发 3 天")

# 会话 B: 读取研究结果
wb_channel_read(channel="research")
```

### 场景 3: 循环任务驱动长文档编写

```
wb_task_loop(
  name="write-docs",
  initialMessage="请开始编写 API 文档第一章",
  continueMessage="继续编写下一章",
  maxRounds=8,
  stopKeywords="文档完成,全部写完"
)
wb_task_start(name="write-docs")
```

### 场景 4: Feature 驱动的开发

```
wb_feature_load(filePath="features/feature_list.json")
features = wb_feature_next()
wb_message_send(message=f"请实现 feature {features[0].id}: {features[0].description}")
# ... Agent 完成后 ...
wb_feature_complete(featureIds=[features[0].id])
wb_feature_stats()
```

## 目录结构

```
workbuddy-dispatcher/
├── mcp_server.js              # MCP Server + REST API + Dashboard 服务入口
├── config.json                # 配置
├── package.json
├── dashboard.html             # Web 监控仪表盘
├── lib/
│   ├── cdp_client.js          # CDP 客户端 (CDPAgent + WorkbenchClient)
│   ├── session_manager.js     # 会话管理
│   ├── message_bus.js         # 频道消息总线
│   ├── task_orchestrator.js   # 任务编排 (TaskChain + Loop + Delayed)
│   ├── feature_manager.js     # Feature 管理
│   └── watcher.js             # 异常检测 + 自动恢复
├── scripts/                   # V1 独立脚本 (保留兼容)
│   ├── send_message.js
│   ├── read_messages.js
│   ├── read_sessions.js
│   └── list_targets.js
├── docs/
│   ├── design-v2.md           # V2 设计文档
│   ├── known-issues.md
│   ├── cdp-architecture.md
│   ├── ipc-channels.md
│   └── exploration-log.md
├── templates/                 # 模板文件
└── archive/                   # 历史备份
```

## 关键约束

1. **单前台会话** — WorkBuddy 同一时间只显示一个会话的消息，切换是排他的
2. **消息在 React 内存中** — 无法 API 获取，只能 DOM 提取
3. **CDP 连接可能断开** — VS Code 刷新 agentManager 时需要重连
4. **消息总线是内存的** — 进程重启后清空

## V1 文档

V1 的 CDP 探索、IPC 通道调查、已知问题等详细文档保留在 `docs/` 目录。
