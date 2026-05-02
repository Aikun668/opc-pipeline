# Planner 指令 | Round C-05 | 2026-04-22

## 任务 ID
TASK-C-005

## 任务类型
refactor / test

## 目标
重构预算检查逻辑，去除冗余；补充预算检查专用的集成测试。彻底收口 Phase C。

## 验收标准
- [ ] 移除 `src/cost-tracker.js` 内部的 `checkBudget` 逻辑（保持 CostTracker 纯粹负责算账，不负责阻断）
- [ ] 确保 `src/circuit-breaker.js` 的 `checkBudget` 是唯一判断熔断的地方
- [ ] 新建 `tests/test-budget-circuit.js` 专用测试，覆盖单次超限和累计超限场景
- [ ] 将预算配置（如 `singleCallLimit`, `taskLimit`）单独提取到 `config/budget.json`（若还未剥离）或集成在现有配置中
- [ ] 测试运行通过：`node tests/test-budget-circuit.js`

## 约束条件
- 不破坏现有功能的调用链路
- 保证抛出的是 `BUDGET_EXCEEDED` 错误格式

## 关键文件路径
- `src/cost-tracker.js` — 移除越权检查代码
- `src/circuit-breaker.js` — 确认检查逻辑正常
- `src/orchestrator.js` — 确认读取外部 budget 阈值
- `tests/test-budget-circuit.js` — 新建

## 给 Builder 的注意事项
- 检查 orchestrator.js 实例化 circuit-breaker 的地方，确保 budget options 正确传入
- 新测试可以 mock LLMManager 返回假数据（或固定消耗 token），然后触发 budget breaker
- 这是一轮清理任务，把上轮的坑填平

## 完成后
Builder 填写 `var/dev-loop/active/02-builder-report.md`，格式见模板文件。
