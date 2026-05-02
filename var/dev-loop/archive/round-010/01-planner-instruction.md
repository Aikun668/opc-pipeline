# Planner 指令 | Round C-01 | 2026-04-21

## 任务 ID
TASK-C-001

## 任务类型
infra（基础设施）

## 目标
创建成本追踪模块，集成到 LLMManager，实现每次 LLM 调用的 token→费用自动记录、任务级成本汇总、以及基于预算阈值的报错。同时修复上轮测试脚本的 shell 注入问题。

## 验收标准
- [ ] `src/cost-tracker.js` 存在：支持按模型 ID 查询单价，计算单次调用费用
- [ ] `config/model-pricing.json` 存在：各模型的 input/output token 单价（元/千 token）
- [ ] `src/llm-manager.js` 集成成本追踪：每次 LLM 调用结束后记录费用
- [ ] 任务结束时自动写入 `var/archive/cost-TASK-XXX.json`，格式规范
- [ ] 超出单次调用预算（默认 ¥1.0）时抛出可捕获的 `BudgetExceededError`
- [ ] `tests/test-cost-tracker.js` 覆盖：单价计算、费用累计、预算超限三个场景
- [ ] 修复 `tests/test-dev-loop-scripts.js` 中 `execSync` 字符串拼接（改为 `execFileSync` 数组参数）

## 约束条件
- 不引入新 npm 依赖（只用 Node.js 内置模块 + 已有 axios、dotenv）
- 不修改 `src/circuit-breaker.js` 和 `src/state-machine.js`
- 成本日志写文件，不写数据库
- 模型单价在 `config/model-pricing.json` 维护，不硬编码

## 关键文件路径
```
src/llm-manager.js             ← 需要集成成本追踪（修改）
src/cost-tracker.js            ← 新建
config/model-pricing.json      ← 新建
tests/test-cost-tracker.js     ← 新建
tests/test-dev-loop-scripts.js ← 修复 execSync 安全问题
var/archive/                   ← 成本报告写入目录
```

## 模型单价参考（填入 model-pricing.json，单位：元/千 token）

| 模型 | input | output | reasoning |
|------|-------|--------|-----------|
| claude-sonnet-4-6 | 0.021 | 0.105 | 0 |
| glm-4-5 | 0.006 | 0.006 | 0 |
| deepseek-chat | 0.002 | 0.008 | 0 |
| deepseek-r1 | 0.004 | 0.016 | 0.004 |
| moonshot-v1-8k | 0.012 | 0.012 | 0 |

## cost-tracker.js 接口设计

```javascript
class CostTracker {
  constructor(pricingConfigPath, options = {})
  calculateCallCost(modelId, usage)    // usage: { input_tokens, output_tokens, reasoning_tokens? }
  recordCall(taskId, phase, modelId, usage)
  getTaskCost(taskId)
  writeReport(taskId, archiveDir)
  checkBudget(cost, limit)             // 超出则抛出 BudgetExceededError
}
```

## var/archive/cost-TASK-XXX.json 格式

```json
{
  "taskId": "TASK-XXX-NNN",
  "completedAt": "ISO时间",
  "totalCost": 0.1149,
  "totalTokens": { "input": 1589, "output": 2724, "reasoning": 1388 },
  "phases": [
    {
      "phase": "planning",
      "model": "claude-sonnet-4-6",
      "tokens": { "input": 1, "output": 659 },
      "cost": 0.069
    }
  ]
}
```

## 给 Builder 的注意事项

1. 先读 `src/llm-manager.js` 确认 LLM 调用后返回的 usage 字段结构，再接入
2. `execSync` 修复：`execFileSync(process.execPath, ['scripts/xxx.js'])` 替代字符串拼接，需引入 `{ execFileSync } = require('child_process')`
3. `var/archive/` 目录可能不存在，写报告前 `mkdirSync({ recursive: true })`
4. 本轮**不需要**修改 circuit-breaker，只做追踪和报错，熔断集成留下一轮

## 完成后

填写 `02-builder-report.md`，重点写清楚：
- `llm-manager.js` 的修改范围（哪几行、改了什么）
- 测试覆盖了哪三个场景
- 实际确认的 usage 字段结构（从代码中读出来写在报告里）
