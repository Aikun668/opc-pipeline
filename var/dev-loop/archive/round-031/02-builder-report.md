# Builder 报告 | Round C-05 | 2026-04-22

## 任务 ID
TASK-C-005

## 执行结果
成功

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|
| src/cost-tracker.js | 修改 | 移除 checkBudget 逻辑和 defaultBudget，纯记账 |
| src/llm-manager.js | 修改 | 移除 BudgetExceededError 捕获（cost-tracker 不再抛错） |
| src/circuit-breaker.js | 已有 | checkBudget 是唯一熔断判定处（C-04 已添加） |
| src/orchestrator.js | 修改 | budgetConfig 改为从 config/budget.json 读取 |
| config/budget.json | 新增 | 统一预算阈值配置 |
| tests/test-budget-circuit.js | 新增 | 8 项预算熔断专用测试 |
| tests/test-cost-tracker.js | 修改 | 移除 4 项预算相关测试（已迁移到 test-budget-circuit.js） |

## 验收标准完成情况
- [x] 移除 `src/cost-tracker.js` 内部的 `checkBudget` 逻辑 → 完成（删除 checkBudget 方法、defaultBudget、constructor options）
- [x] 确保 `src/circuit-breaker.js` 的 `checkBudget` 是唯一判断熔断的地方 → 完成（grep 确认全 src/ 仅 circuit-breaker.js 有 checkBudget）
- [x] 新建 `tests/test-budget-circuit.js` 专用测试 → 完成（8 项覆盖单次/累计/边界/集成/默认值）
- [x] 将预算配置提取到 `config/budget.json` → 完成（singleCallBudget: 1.0, taskBudget: 10.0）
- [x] 测试运行通过 → 完成（42/42）

## 测试结果

| 测试文件 | 通过 |
|----------|------|
| test-cost-tracker.js | 11/11 |
| test-cost-integration.js | 7/7 |
| test-budget-circuit.js | 8/8 |
| test-dev-loop-scripts.js | 16/16 |
| **合计** | **42/42** |

## 架构变化

### Before（C-04 及之前）
```
cost-tracker.js ── checkBudget() ── 抛出 BudgetExceededError
     ↑
orchestrator.js ── recordCost() ── 也调用 breakerManager.checkBudget()
```
双重检查：cost-tracker 内部检查 + circuit-breaker 外部检查

### After（C-05）
```
cost-tracker.js ── 纯记账（recordCall/calculateCallCost/writeReport）
     ↑
orchestrator.js ── recordCost() ── 唯一调用 breakerManager.checkBudget()
     ↑
circuit-breaker.js ── checkBudget() ── 唯一熔断判定
```
单一职责：cost-tracker 只管算账，circuit-breaker 只管熔断

## 配置提取

config/budget.json:
```json
{
  "singleCallBudget": 1.0,
  "taskBudget": 10.0
}
```

orchestrator.js loadBudgetConfig():
- 读取 config/budget.json
- 不存在时回退到默认值 { singleCallBudget: 1.0, taskBudget: 10.0 }

## 已知问题 / 注意事项
- BudgetExceededError 类仍保留在 cost-tracker.js 中（供导出），但不再由 cost-tracker 抛出
- llm-manager.js 的 costTracker.recordCall try/catch 已简化，不再特殊处理 BudgetExceededError

## 请求 Reviewer 关注点
- 单一职责分离是否彻底（cost-tracker 是否还有任何阻断逻辑残留）
- config/budget.json 的结构是否足够扩展（后续可能需要按模型/阶段分别配置）
- test-budget-circuit.js 的 8 项测试是否覆盖了所有边界场景
