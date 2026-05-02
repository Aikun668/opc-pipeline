# Planner 指令 | Round C-02 | 2026-04-21

## 任务 ID

TASK-C-002

## 任务类型

bugfix + refactor

## 目标

补全成本追踪"最后一公里"：orchestrator 任务结束时自动写成本报告；MODEL\_ALIASES 硬编码迁移到配置文件；补充集成测试。

## 验收标准

* \[ ] `orchestrator.js` 在 COMPLETED 时自动调用 `writeReport()`
* \[ ] `orchestrator.js` 在 FAILED 时也写入成本报告
* \[ ] `config/model-pricing.json` 新增 `aliases` 字段存储别名映射
* \[ ] `src/cost-tracker.js` 删除硬编码 MODEL\_ALIASES 常量，改从 pricing JSON 的 `aliases` 字段读取
* \[ ] `tests/test-cost-integration.js` 新增：验证任务结束后 cost 报告文件确实存在
* \[ ] 所有现有测试仍通过（test-cost-tracker.js 的 15 项不得破坏）

## 约束条件

* 只修改 `src/orchestrator.js`、`src/cost-tracker.js`、`config/model-pricing.json`
* 新增 `tests/test-cost-integration.js`
* 不修改 state-machine.js、circuit-breaker.js、llm-manager.js
* CostTracker 在 orchestrator constructor 中初始化，archiveDir 用绝对路径

## 关键文件路径

```
src/orchestrator.js          ← 修改：初始化 CostTracker，任务结束时调 writeReport
src/cost-tracker.js          ← 修改：删 MODEL\_ALIASES 常量，改读 config aliases
config/model-pricing.json    ← 修改：新增 aliases 字段
tests/test-cost-integration.js ← 新建
```

## config/model-pricing.json 新增内容

在现有 JSON 末尾加 `aliases` 字段：

```json
"aliases": {
  "claude-sonnet-4-6-medium": "claude-sonnet-4-6",
  "Pro/zai-org/GLM-5.1": "glm-4-5",
  "deepseek-reasoner": "deepseek-r1"
}
```

## orchestrator.js 修改要点

1. 文件顶部 require 区加：`const { CostTracker } = require('./cost-tracker');`
2. constructor 中加：`this.costTracker = new CostTracker(path.join(\_\_dirname, '..', 'config', 'model-pricing.json')); this.archiveDir = path.join(\_\_dirname, '..', 'var', 'archive');`
3. runWorkflow 的 complete 和 fail 分支各加一行：`this.costTracker.writeReport(taskId, this.archiveDir);`
4. 每处 `await this.llmManager.callModel(...)` 之后，result.success 为 true 时加：`if (result.usage) { this.costTracker.recordCall(taskId, phase, result.model || phase, result.usage); }`
→ 先读 llm-manager.js 的 callModel 返回值确认 usage/model 字段名

## cost-tracker.js 修改要点

* 删除第14-18行 MODEL\_ALIASES 常量
* constructor 中加：`this.aliases = this.pricing.aliases || {};`
* resolveModelId 改为：`return this.aliases\[modelId] || modelId;`

## 给 Builder 的注意事项

1. 先读 `src/llm-manager.js` 的 callModel 返回值，确认 usage/model 字段的实际名称
2. 集成测试用 `os.tmpdir()` 写报告，测试结束后清理，不污染 `var/archive/`
3. writeReport 的 archiveDir 用绝对路径（`path.join(\_\_dirname, '..')` 形式）

## 完成后

填写 `02-builder-report.md`，重点写：

* llm-manager.callModel 返回值中 usage 字段的实际结构
* orchestrator.js 中插入 writeReport 的具体行号
* 集成测试通过情况

