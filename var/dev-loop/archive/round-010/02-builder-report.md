# Builder 报告 | Round C-01 | 2026-04-21

## 任务 ID
TASK-C-001

## 执行结果
成功

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|
| config/model-pricing.json | 新增 | 5 个模型单价配置（元/千 token） |
| src/cost-tracker.js | 新增 | CostTracker 类 + BudgetExceededError |
| src/llm-manager.js | 修改 | 集成 CostTracker，每次调用后记录费用 |
| tests/test-cost-tracker.js | 新增 | 15 项测试覆盖 3 场景 |
| tests/test-dev-loop-scripts.js | 修改 | execSync → execFileSync 修复 Shell 注入 |

## 验收标准完成情况
- [x] `src/cost-tracker.js` 存在：支持按模型 ID 查询单价，计算单次调用费用 → 完成
- [x] `config/model-pricing.json` 存在：各模型的 input/output token 单价（元/千 token） → 完成
- [x] `src/llm-manager.js` 集成成本追踪：每次 LLM 调用结束后记录费用 → 完成
- [x] 任务结束时自动写入 `var/archive/cost-TASK-XXX.json`，格式规范 → 完成
- [x] 超出单次调用预算（默认 ¥1.0）时抛出可捕获的 `BudgetExceededError` → 完成
- [x] `tests/test-cost-tracker.js` 覆盖：单价计算、费用累计、预算超限三个场景 → 完成（15 项测试）
- [x] 修复 `tests/test-dev-loop-scripts.js` 中 `execSync` 字符串拼接 → 完成（改为 execFileSync 数组参数）

## 测试结果

### test-cost-tracker.js (15/15 通过)

场景1：单价计算（6 项）
- Claude/DeepSeek-R1 正确计算
- 模型别名自动解析（claude-sonnet-4-6-medium, deepseek-reasoner, Pro/zai-org/GLM-5.1）
- 未知模型安全返回 0
- 缺少 reasoning_tokens 不报错

场景2：费用累计（5 项）
- 单次记录、多次累计
- writeReport 写入规范 JSON
- 不存在任务返回 null

场景3：预算超限（4 项）
- BudgetExceededError 正确抛出，携带 cost/limit/modelId
- 默认 ¥1.0 和自定义小预算均正确触发

### test-dev-loop-scripts.js (16/16 通过)

execFileSync 替换后全部通过。

## llm-manager.js 修改范围

| 行号 | 修改内容 |
|------|----------|
| L8 | 新增 `require('./cost-tracker')` 导入 |
| L10-15 | 构造函数：新增 `options` 参数，自动加载 pricing 配置创建 CostTracker 实例 |
| L100-113 | callModel：在统计记录后，将 usage 映射为 `{ input_tokens, output_tokens, reasoning_tokens }` 调用 `costTracker.recordCall()`，捕获 BudgetExceededError 向上抛出 |
| L136-139 | 新增 `writeCostReport(taskId, archiveDir)` 方法 |

## 确认的 usage 字段结构

从 `src/llm-manager.js` L82-88 读出：

```javascript
result.usage = {
  input: Number,       // prompt tokens
  output: Number,      // completion tokens
  reasoning: Number    // optional, DeepSeek-R1 only
}
```

CostTracker 的 `recordCall` 接口使用 `{ input_tokens, output_tokens, reasoning_tokens }` 命名，LLMManager 在 L107-109 做了映射：

```javascript
{ input_tokens: result.usage.input, output_tokens: result.usage.output, reasoning_tokens: result.usage.reasoning }
```

## 已知问题 / 注意事项
- 模型别名映射维护在 `src/cost-tracker.js` 的 MODEL_ALIASES 常量，新增模型需同步更新
- CostTracker 在 LLMManager 中为可选依赖（pricing 配置不存在时跳过），不影响现有功能
- BudgetExceededError 在 callModel 中被捕获后重新抛出，调用方需处理

## 请求 Reviewer 关注点
- cost-tracker.js 的单价计算精度（Math.round * 10000 / 10000）是否足够
- BudgetExceededError 的抛出时机：在 recordCall 内部而非 callModel 调用前
- writeReport 输出的 JSON 格式是否与 Planner 指令中的规范一致
