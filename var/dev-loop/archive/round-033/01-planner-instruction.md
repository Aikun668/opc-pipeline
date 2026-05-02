# Planner 指令 | Round A-02 | 2026-04-22

## 任务 ID
TASK-A-002

## 任务类型
bugfix

## 目标
修复 benchmark-runner.js 的任务间状态隔离问题，确保每个任务运行在完全干净的模块环境中，保证压测数据的可信度。

## 验收标准
- [ ] `benchmark-runner.js` 的 require 缓存清理覆盖所有被 Orchestrator 依赖的本地模块（至少包含 `state-machine`、`circuit-breaker`、`llm-manager`、`cost-tracker`、`orchestrator` 本身）
- [ ] 两个 task 连续执行后，第二个 task 的初始状态不受第一个 task 的任何残留影响（用日志或断言验证）
- [ ] 支持通过环境变量 `OPC_SPAWN_MODE` 配置执行模式（mock/api/cli），默认值为 `mock`
- [ ] 跑 `node tests/benchmark/benchmark-runner.js` 仍然通过

## 约束条件
- 只改 `tests/benchmark/benchmark-runner.js`，不动 `src/` 下任何文件

## 关键文件路径
- `tests/benchmark/benchmark-runner.js` — 唯一需要修改的文件

## 给 Builder 的注意事项
- Node.js 的 require 缓存清理方式：遍历 `require.cache`，删除路径中包含项目 `src/` 目录的所有条目
- 比单独列出模块名更可靠：`Object.keys(require.cache).filter(k => k.includes('/opc-pipeline/src/')).forEach(k => delete require.cache[k])`
- OPC_SPAWN_MODE 读取：`const spawnMode = process.env.OPC_SPAWN_MODE || 'mock'`，传给 Orchestrator 的 options

## 完成后
Builder 填写 `var/dev-loop/active/02-builder-report.md`，格式见模板文件。
