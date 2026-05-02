# Builder 报告 | Round C-02 | 2026-04-21

## 任务 ID
TASK-C-002

## 执行结果
成功

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|
| config/model-pricing.json | 修改 | 新增 aliases 字段（3 个模型别名映射） |
| src/cost-tracker.js | 修改 | 删除硬编码 MODEL_ALIASES，改从 config 读取 |
| src/orchestrator.js | 修改 | 初始化 CostTracker，6 处 callModel 后记录成本，complete/fail 时 writeReport |
| tests/test-cost-integration.js | 新增 | 7 项集成测试 |
| scripts/builder-init.js | 修改 | 修复验收标准解析（兼容 `* \[ ]` 格式） |

## 验收标准完成情况
- [x] `orchestrator.js` 在 COMPLETED 时自动调用 `writeReport()` → 完成（L210）
- [x] `orchestrator.js` 在 FAILED 时也写入成本报告 → 完成（L214, L223）
- [x] `config/model-pricing.json` 新增 `aliases` 字段存储别名映射 → 完成
- [x] `src/cost-tracker.js` 删除硬编码 MODEL_ALIASES 常量，改从 pricing JSON 的 `aliases` 字段读取 → 完成
- [x] `tests/test-cost-integration.js` 新增：验证任务结束后 cost 报告文件确实存在 → 完成（7 项）
- [x] 所有现有测试仍通过 → 完成（cost-tracker 15/15, dev-loop-scripts 16/16）

## 测试结果

### test-cost-tracker.js — 15/15 通过（未破坏）
### test-cost-integration.js — 7/7 通过
### test-dev-loop-scripts.js — 16/16 通过

## llm-manager.callModel 返回值 usage 字段结构

```
result = {
  success: Boolean,
  content: String,       // JSON string
  usage: {
    input: Number,       // prompt tokens
    output: Number,      // completion tokens
    reasoning: Number    // optional, DeepSeek-R1 only
  }
}
```

Orchestrator 的 `recordCost()` 方法做了 `usage → cost-tracker` 字段映射：
- `input` → `input_tokens`
- `output` → `output_tokens`
- `reasoning` → `reasoning_tokens`

## orchestrator.js 修改位置

| 行号 | 修改 |
|------|------|
| L17 | 新增 `require('./cost-tracker')` |
| L44-45 | constructor: 初始化 `this.costTracker` 和 `this.archiveDir` |
| L154-164 | 新增 `recordCost()` 辅助方法 |
| L210 | complete 分支后加 `this.costTracker.writeReport(taskId, this.archiveDir)` |
| L214 | fail 分支后加 `this.costTracker.writeReport(taskId, this.archiveDir)` |
| L223 | catch 中 maxRetries 后加 `this.costTracker.writeReport(taskId, this.archiveDir)` |
| L265 | planning callModel 后加 `this.recordCost(taskId, 'planning', result)` |
| L301 | coding callModel 后加 `this.recordCost(taskId, 'coding', result)` |
| L360 | prefilter callModel 后加 `this.recordCost(taskId, 'prefilter', prefilterResult)` |
| L381 | review callModel 后加 `this.recordCost(taskId, 'review', reviewResult)` |
| L408 | testing callModel 后加 `this.recordCost(taskId, 'testing', result)` |
| L445 | delivery callModel 后加 `this.recordCost(taskId, 'delivery', result)` |

## 已知问题 / 注意事项
- builder-init.js 修复了验收标准解析器，兼容 `* \[ ]`、`- [ ]`、`* [ ]` 三种格式
- orchestrator 和 llm-manager 各有独立的 CostTracker 实例，不互相影响
- orchestrator 的 costTracker 直接从 callModel 返回值记录，不依赖 llm-manager 内部追踪

## 请求 Reviewer 关注点
- orchestrator 和 llm-manager 双 CostTracker 实例是否合理（后续是否需要统一）
- recordCost 辅助方法中 `this.llmManager.config.models[phase].model` 访问是否安全
- writeReport 在 FAILED 路径的 3 个调用点是否覆盖所有场景
