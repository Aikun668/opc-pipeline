# Planner 指令 | Round A-03 | 2026-04-22 16:09

## 任务 ID
TASK-A-003

## 任务类型
feature / test

## 目标
扩充压测题库至 10 个有代表性的真实任务，以 mock 模式跑完整压测，生成真实汇总报告，完成 Phase A 核心交付。

## 验收标准
- [ ] `tests/benchmark/tasks.json` 扩充至 10 个任务，覆盖 feature、bugfix、refactor 三种类型，描述清晰具体（不能是"实现一个求和函数"这种过于简单的题目）
- [ ] `node tests/benchmark/benchmark-runner.js` 串行跑完全部 10 个任务，无崩溃
- [ ] `var/benchmark/` 下生成真实的汇总报告，包含每个任务的耗时、成本、结果，以及整体成功率、平均耗时、平均成本
- [ ] 报告 Markdown 文件名格式：`report-{timestamp}.md`，内容可读性好，便于 Planner 直接判断引擎健康状态

## 约束条件
- 本轮用 `OPC_SPAWN_MODE=mock` 跑，不消耗真实 API（真实 API 压测留到 Phase A 收尾时做）
- 只改 `tests/benchmark/tasks.json` 和报告生成逻辑（如有需要），不动 `src/`

## 关键文件路径
- `tests/benchmark/tasks.json` — 扩充题库
- `tests/benchmark/benchmark-runner.js` — 如报告格式需调整可小改
- `var/benchmark/` — 报告输出目录

## 给 Builder 的注意事项
- 10 个任务题目建议覆盖：API 路由新增、已知 Bug 修复、函数重构、单元测试补充、配置文件解析、错误处理改进等场景
- 汇总报告格式建议：表格列出每个任务结果，底部统计成功率/耗时/成本均值

## ⚠️ 报告时间格式规范（三个角色统一执行）
从本轮起，所有角色（Planner / Builder / Reviewer）在写报告和指令文件的日期字段时，**必须精确到分钟**：

- ✅ 正确格式：`2026-04-22 16:09`
- ❌ 错误格式：`2026-04-22`

涉及位置：指令文件标题行、报告标题行、报告内的 started/completed 时间字段。

## 完成后
Builder 填写 `var/dev-loop/active/02-builder-report.md`，格式见模板文件。标题行时间精确到分钟。
