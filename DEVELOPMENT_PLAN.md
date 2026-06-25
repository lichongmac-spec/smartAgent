# SmartAgent 开发计划

> 最后更新：2026-06-25

---

## 一、项目概述

SmartAgent 是一个 TypeScript ESM 的 AI Agent 框架，支持 ReAct 循环、工具调用、MCP 协议、长期记忆、安全沙箱、任务队列、Webhook 通知等完整功能，并计划提供 Electron 桌面应用。

| 指标 | 数值 |
|:---|:---|
| 源代码文件（src/） | 78 个 `.ts` 文件 |
| Electron 文件 | 11 个（`.ts`/`.tsx`/`.css`/`.html`） |
| 测试文件 | 48 个 |
| 测试套件 | 45 套（41 CLI + 4 Electron） |
| 依赖包 | pnpm 管理，精简后无冗余 |
| 语言/运行时 | TypeScript ESM，Node.js ≥22 |

---

## 二、模块进度

| 模块 | 状态 | 完成度 | 说明 |
|:---|:---|:---|:---|
| CLI 基础层 | ✅ 完成 | 100% | 命令解析、别名、自动补全、分页、加密、配置管理 |
| LLM 客户端层 | ✅ 完成 | 100% | Mock + Ollama + OpenAI + DeepSeek + 错误处理 + 日志 + Function Calling |
| 上下文管理层 | ✅ 完成 | 100% | ContextManager + TokenCounter + 滑动窗口 + 序列化 |
| Agent Loop (ReAct) | ✅ 完成 | 100% | LoopEngine + ReAct 循环 + 工具调用 + 中断 + 回调 |
| 工具系统 | ✅ 完成 | 100% | ToolRegistry + 4 内置工具 + 工具显示 |
| Memory 系统 | ✅ 完成 | 100% | Mock/Ollama 嵌入 + 向量存储 + 衰减 + 遗忘 |
| 安全沙箱 | ✅ 完成 | 100% | Sandbox 类：路径/命令/大小/超时控制 |
| MCP 协议 | ✅ 完成 | 100% | Server + Client + stdio/HTTP 传输 + 工具适配器 |
| Skills 系统 | ✅ 完成 | 100% | SkillLoader + 文件夹加载 + 命名空间隔离 + 集成 |
| 心跳与健康监控 | ✅ 完成 | 100% | HeartbeatManager + 3级状态 + 内置检查 + CLI集成 |
| 任务队列 | ✅ 完成 | 100% | TaskQueue + 优先级 + 并发控制 + 指数退避重试 + 事件驱动 |
| Webhook 通知 | ✅ 完成 | 100% | WebhookNotifier + 端点管理 + 重试发送 + 并行通知 |
| Electron 桌面应用 | 🔨 环境搭建 | 15% | 环境搭建 + IPC 骨架 + 79 项测试 |

---

## 三、测试覆盖

### 3.1 测试体系

| 层级 | 框架 | 套件数 | 测试数 | 状态 |
|:---|:---|:---|:---|:---|
| CLI 单元/集成 | 自建 test() + assert | 37 | ~400+ | ✅ |
| CLI E2E | tsx spawn | 1 | 12 | ✅ |
| Electron | Vitest | 4 | 79 | ✅ |
| **总计** | | **45** | **~500+** | ✅ |

### 3.2 测试文件清单

**CLI 单元/集成（37 套件）：**
`advanced-commands`、`alias`、`autocomplete`、`config-manager`、`context-aware`、`context-manager`、`debug`、`encrypt`、`env-check`、`error-handler`、`heartbeat`、`history`、`interactive-debugger`、`llm-client`、`logger`、`loop-engine`、`mcp`、`memory-demo`、`mock-client`、`ollama-client`、`openai-client`、`pager`、`profile`、`progress`、`progress-enhanced`、`queue`、`retry`、`sandbox`、`secrets`、`session`、`skills`、`stream-handler`、`table`、`timeout`、`token-counter`、`tool-display`、`webhook`

**CLI E2E（1 套件）：**
`agent-flow` — 完整的 agent 对话流程测试

**Electron（4 套件）：**
`agent-service`（18 项）、`ipc-handlers`（21 项）、`preload`（23 项）、`integration`（17 项）

---

## 四、待实现

### 4.1 功能开发

| 功能 | 优先级 | 说明 |
|:---|:---|:---|
| 代码执行沙箱 | P2 | vm2 / isolated-vm 实现真实代码执行 |
| Electron 桌面 UI 组件 | P1 | ChatPanel / ToolManager / MemoryViewer / Settings / Scheduler / Dashboard |
| Electron 桌面打包与分发 | P1 | macOS .dmg / Windows .exe 打包 |

### 4.2 已知技术债务

| 问题 | 优先级 | 影响范围 | 说明 |
|:---|:---|:---|:---|
| 工具调用裁剪 | P3 | context/ | trimTo/countMessages 未计入 tool_calls 字段 |
| SessionManager 同步 I/O | P3 | cli/ | 大量会话时阻塞事件循环 |
| Sandbox.executeCommand 模拟 | P3 | sandbox/ | 返回硬编码结果，未实现真实命令执行 |

---

## 五、近期变更记录

### 2026-06-25 — 回归测试

- 运行全部 45 套件（41 CLI + 4 Electron），0 失败

### 2026-06-25 — 代码清理

- 移除 67 处未使用导入（src 23 + electron 1 + tests 43）
- 移除 9 处死代码/未使用变量（logger color 对象、sessionId 字段等）
- 移除 3 个未使用依赖（@tanstack/react-router、zustand、electron-forge v5）
- 删除 3 个冗余配置文件（tsconfig.tsnode.json、package-lock.json、vitest empty setupFiles）
- 根目录临时脚本移至 scripts/，tsconfig.json exclude 完善
- pnpm install 清理 475 个传递依赖

### 2026-06-25 — 代码与测试优化修复

- **P0（4 项）**：tests 中移除 4 个 `|| true` 掩盖的失败测试
- **P1（8 项）**：config set 添加 key 校验、loadConfig 改为 throw Error、TaskQueue.drain 检查 pendingRetries、preload 监听器泄漏修复、retry signal 检查、E2E 测试 try/finally 清理
- **P2（3 项）**：queue.test.ts 确定性优先级、错误处理测试统一 combined output
- E2E 测试修复：tsx shell 脚本 → 绝对路径 `tsx/dist/esm/index.mjs`

### 2026-06-24 — Electron 环境搭建 + 测试

- Electron 环境搭建完成（15 个源文件 + 6 个配置文件）
- 安装依赖：electron、vite、react、tailwindcss v3、zustand、vitest 等
- 创建 4 套 Electron 测试（79 项），全部通过
- 11 个 IPC 通道：agent:ask/ask-stream/interrupt、tools:list、memory:search、config:get/set、scheduler:list/add、heartbeat:status、queue:stats

### 2026-06-23 — 任务队列 + Webhook 通知

- TaskQueue 完整实现（优先级 + 并发控制 + 指数退避重试 + 事件驱动）
- WebhookNotifier 完整实现（端点管理 + 重试发送 + 并行通知）
- 26 项队列测试 + 18 项 webhook 测试

### 2026-06-22 — 心跳与健康监控 + Skills 系统

- HeartbeatManager 完整实现（3级状态 + 内置检查 + CLI 集成）
- SkillLoader 完整实现（文件夹加载 + 命名空间隔离 + 集成）
- 23 项心跳测试 + 18 项 skills 测试

### 更早

- MCP 协议（Server + Client + stdio/HTTP 传输 + 工具适配器，57 项测试）
- 安全沙箱（路径/命令/大小/超时控制）
- Memory 系统（Mock/Ollama 嵌入 + 向量存储 + 衰减 + 遗忘）
- ReAct Loop 引擎 + 工具系统 + LLM 客户端层 + CLI 基础层 + 上下文管理层

---

## 六、变更日志

| 日期 | 类型 | 描述 |
|:---|:---|:---|
| 2026-06-25 | Test | 回归测试全部 45 套件通过 |
| 2026-06-25 | Clean | 代码清理：67 处未使用导入、9 处死代码、3 个未使用依赖、3 个冗余配置 |
| 2026-06-25 | Fix | 代码与测试优化：修复 15 项问题（4 P0 + 8 P1 + 3 P2） |
| 2026-06-24 | Add | Electron 桌面环境搭建 + 4 套测试（79 项） |
| 2026-06-24 | Test | 回归测试全部通过 |
| 2026-06-23 | Add | 任务队列 + Webhook 通知器 |
| 2026-06-22 | Add | 心跳与健康监控 + Skills 系统 |
| 2026-06-21 | Add | MCP 协议 |
| 2026-06-20 | Add | 安全沙箱 |
| 2026-06-19 | Add | Memory 系统 |
| 2026-06-18 | Add | ReAct Loop 引擎 + 工具系统 |
| 2026-06-17 | Add | LLM 客户端层 + 上下文管理层 |
| 2026-06-16 | Init | CLI 基础层搭建 |
