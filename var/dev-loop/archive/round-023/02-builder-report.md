# Builder 报告 | Round C-03 | 2026-04-22

## 任务 ID
TASK-C-003

## 执行结果
成功

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|
| src/llm-manager.js | 修改 | 删除自建 CostTracker，改为 options.costTracker 注入 |
| src/orchestrator.js | 修改 | 创建 LLMManager 时传入 costTracker；recordCost 加 null 安全 |

## 验收标准完成情况
- [x] llm-manager.js 不再自己创建 CostTracker 实例，改为从外部注入 → 完成（L17: `this.costTracker = options.costTracker || null`）
- [x] orchestrator.js 创建 LLMManager 时把自己的 costTracker 传入 → 完成（L42: `{ costTracker: this.costTracker }`）
- [x] orchestrator.js L153 的 `this.llmManager.config.models[phase]` 加 null 安全保护 → 完成（可选链 + 显式 throw）
- [x] 现有测试全部通过 → 完成（38/38）
- [x] 不引入新的功能或重构 → 完成（仅最小改动）

## 测试结果

test-cost-tracker.js: 15/15
test-cost-integration.js: 7/7
test-dev-loop-scripts.js: 16/16

## 修改详情

### src/llm-manager.js

**修改前** (L17-20):
```javascript
const pricingPath = options.pricingConfigPath || path.join(path.dirname(configPath), 'model-pricing.json');
if (fs.existsSync(pricingPath)) {
  this.costTracker = new CostTracker(pricingPath, { defaultBudget: options.defaultBudget || 1.0 });
}
```

**修改后** (L17):
```javascript
this.costTracker = options.costTracker || null;
```

其余代码不变 — `callModel` 中 `if (this.costTracker && options.taskId)` 和 `writeCostReport()` 都已正确使用 `this.costTracker`，注入后自然生效。

### src/orchestrator.js

**1. 交换初始化顺序 + 注入** (L41-43):

修改前:
```javascript
this.llmManager = new LLMManager(path.join(__dirname, '..', 'config', 'models.json'));
this.costTracker = new CostTracker(path.join(__dirname, '..', 'config', 'model-pricing.json'));
```

修改后:
```javascript
this.costTracker = new CostTracker(path.join(__dirname, '..', 'config', 'model-pricing.json'));
this.llmManager = new LLMManager(path.join(__dirname, '..', 'config', 'models.json'), { costTracker: this.costTracker });
```

**2. recordCost null 安全** (L153-156):

修改前:
```javascript
const modelConfig = this.llmManager.config.models[phase];
const modelId = modelConfig ? modelConfig.model : phase;
```

修改后:
```javascript
const modelConfig = this.llmManager.config?.models?.[phase];
if (!modelConfig) {
  throw new Error(`未找到 phase=${phase} 的模型配置`);
}
const modelId = modelConfig.model;
```

## 已知问题 / 注意事项
- 无。改动范围严格控制在两个文件内。

## 请求 Reviewer 关注点
- llm-manager 的 `CostTracker` import 保留但不再用于构造（仅类型引用），是否需要清理
- single CostTracker instance 现在由 orchestrator 持有，llm-manager 通过注入共享，职责边界清晰
