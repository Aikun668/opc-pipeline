# Planner 指令 | Round C-03 | 2026-04-22

## 任务 ID
TASK-C-003

## 任务类型
bugfix

## 目标
修复 C phase 遗留两个问题：统一 CostTracker 实例，修补 null 安全访问。

## 验收标准
- [ ] llm-manager.js 不再自己创建 CostTracker 实例，改为从外部注入
- [ ] orchestrator.js 创建 LLMManager 时把自己的 costTracker 传入
- [ ] orchestrator.js L153 的 `this.llmManager.config.models[phase]` 加 null 安全保护，无法获取时抛出清晰错误
- [ ] 现有测试全部通过（npm test 或 node tests/health.test.js）
- [ ] 不引入新的功能或重构

## 约束条件
- 只改 `src/llm-manager.js` 和 `src/orchestrator.js`，不动其他文件
- 保持 LLMManager 的对外接口不变（调用方式不变）
- 不删除 llm-manager 的 `writeCostReport()` 方法，但内部改为调用注入实例

## 关键文件路径
- `src/orchestrator.js` — 持有主 CostTracker 实例（L17, L43, L155）
- `src/llm-manager.js` — 自己也创建了一个 CostTracker（L8, L19），需改为注入
- `config/model-pricing.json` — 定价配置，不需要修改

## 给 Builder 的注意事项
- llm-manager 构造函数 options 里已有 `defaultBudget`，注入时可以传 `costTracker` 作为新 option
- orchestrator 在 `new LLMManager(config, options)` 时，把 `this.costTracker` 加进 options
- L153 的 null 保护：`const modelConfig = this.llmManager.config?.models?.[phase]`，若为 null 则 `throw new Error(\`未找到 phase=${phase} 的模型配置\`)`
- 改完后跑一下 `node tests/health.test.js` 验证基本功能没坏

## 完成后
Builder 填写 `var/dev-loop/active/02-builder-report.md`，格式见模板文件。
