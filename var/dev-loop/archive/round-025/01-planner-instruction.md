# Planner 指令 | Round C-04 | 2026-04-22

## 任务 ID
TASK-C-004

## 任务类型
feature

## 目标
将预算熔断逻辑集成到 circuit-breaker.js：当单次调用成本或任务累计成本超过阈值时，触发熔断。

## 验收标准
- [ ] circuit-breaker.js 新增 `checkBudget(taskId, currentCost, options)` 方法：超过 `singleCallLimit` 时返回 OPEN 状态
- [ ] orchestrator.js 在每次 LLM 调用后，把本次 cost 传入 circuit-breaker 进行预算检查
- [ ] 预算超限时 orchestrator 抛出带明确说明的错误（如 `BudgetExceededError`），不继续调用
- [ ] 阈值可配置（从 config 读取，或 orchestrator 构造时传入），有合理默认值
- [ ] `node tests/health.test.js` 通过

## 约束条件
- 只改 `src/circuit-breaker.js` 和 `src/orchestrator.js`
- 不改 cost-tracker.js、llm-manager.js 的对外接口
- 熔断逻辑与现有的失败率熔断逻辑共存，不替换

## 关键文件路径
- `src/circuit-breaker.js` — 现有熔断器，基于失败率；需新增预算维度
- `src/orchestrator.js` — L155 附近记录 cost，在此之后插入预算检查
- `config/model-pricing.json` — 可参考现有配置结构，决定是否在此加预算字段

## 给 Builder 的注意事项
- checkBudget 不需要状态机，只需简单阈值比对，返回 `{ allowed: bool, reason: string }`
- orchestrator 已有 `this.costTracker`，调用后可用 `this.costTracker.getTaskCost(taskId)` 获取累计值（若方法不存在则自行统计）
- 错误命名建议：`throw new Error('BUDGET_EXCEEDED: ...')`，不需要新建 Error 类

## 完成后
Builder 填写 `var/dev-loop/active/02-builder-report.md`，格式见模板文件。
