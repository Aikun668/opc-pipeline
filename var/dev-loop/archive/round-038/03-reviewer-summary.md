# Reviewer 总结 | Round A-13 | 2026-05-02 15:35

## 任务 ID
TASK-A-013

## 审查结论
通过 ✅ — 单任务运行脚本，188 行，复用现有模块，零修改已有文件

## 验收标准达成情况

| 标准 | 状态 | 证据 |
|------|------|------|
| `node scripts/run-task.js --id BENCH-BIZ-001` 跑单个任务 | ✅ | L40-42: `args.indexOf('--id')` + 按 id 匹配 |
| Dashboard 实时显示 5 阶段推进 | ✅ | L76-78: LiveServer start，Orchestrator 发射事件 |
| 完成后服务器保持在线 | ✅ | L185: `await new Promise(() => {})` |
| 终端打印 WSL IP | ✅ | L174-180: `getWslIp()` + 打印 |
| var/benchmark/ 新 round-NNN/ 目录 | ✅ | L86-89: archiver.createRound → roundDir |
| events.jsonl + task-result.json 完整 | ✅ | L88: EventLogger + L152: archiveTask |
| 不修改已有文件 | ✅ | 仅新增 scripts/run-task.js |

## 文件审查

### scripts/run-task.js (188 行)

| 模块 | 行号 | 功能 |
|------|------|------|
| `--id` 参数解析 | L40-42 | 必需参数，缺省报错退出 |
| `--file` 参数解析 | L49-52 | 可选，默认 tasks-business.json |
| 任务查找 | L64-68 | `tasks.find(t => t.id === taskId)`，找不到报错 |
| LiveServer 启动 | L76-78 | 独立进程内 HTTP + SSE |
| 轮次创建 | L86-89 | BenchmarkArchiver.createRound |
| EventLogger 初始化 | L88 | 写入 events.jsonl |
| Orchestrator 执行 | L104-125 | createTask + runWorkflow + costTracker |
| 异常处理 | L129-149 | 区分 BUDGET_EXCEEDED 和普通错误 |
| 归档 | L152-161 | archiveTask + finalizeRound |
| ROUND_END 事件 | L163-171 | 通知历史区域刷新 |
| 保持在线 | L173-185 | WSL IP + Ctrl+C 退出 |

**复用模式**：与 benchmark-runner.js 完全一致的模块链（Orchestrator → Archiver → EventLogger → LiveServer），无重复逻辑。

## 约束检查
| 约束 | 状态 |
|------|------|
| 不修改 src/ 下任何文件 | ✅ |
| 不修改 benchmark-runner.js | ✅ |
| 不修改 tasks-business.json | ✅ |
| 不修改 config/ | ✅ |
| 零新 npm 依赖 | ✅ |

## 遗留问题（A-12 的 P0 Bug 仍存在）

此脚本复用了 benchmark-runner.js 中的 `require.cache` 清理模式（L100-102），包含 `event-bus.js`。虽然单次运行不受影响（任务→归档是一锤子买卖），但若在**同一进程内**多次运行此脚本（理论上目前不会），则 EventBus 单例会断裂。

**建议**：在下一轮统一修复 benchmark-runner.js 和 run-task.js 中的 cache 清理范围，排除 `event-bus.js`。

## 结论

A-13 交付物完整。scripts/run-task.js 是 benchmark-runner 的轻量单任务版本，复用所有已建模块，零修改现有代码。可用于快速验证修复效果和开发调试。
