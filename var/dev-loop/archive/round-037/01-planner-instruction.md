# Planner 指令 | Round A-11 | 2026-05-01

## 任务 ID
TASK-A-011

## 任务类型
test

## 背景

A-10 完成了轮次归档系统，事件持久化、文件归档、历史回放全部就绪。现在用 6 个业务任务跑一轮真实 API 压测，走通完整闭环：实时监控 → 文件归档 → 历史回放 → 打分。

## 目标

用真实 DeepSeek API（OPC_SPAWN_MODE=api）串行跑 6 个业务任务，产出 round-NNN 完整归档，验证 A-07~A-10 全部功能在真实场景下正常工作。

## 验收标准
- [ ] `OPC_SPAWN_MODE=api` 跑完 6 个业务任务，无 crash
- [ ] `var/benchmark/round-NNN/` 目录完整：meta.json + events.jsonl（>100 行）+ results.json + tasks/ 下 6 个子目录
- [ ] 浏览器 `http://localhost:3456` 实时看到阶段推进，跑完后历史轮次出现新记录
- [ ] 浏览器 `http://localhost:3456/scoring` 选最新轮次，文件树点开可见代码，可完成一次人工打分
- [ ] 报告含基线对比（与 A-06 对比）

## 运行方式
```bash
OPC_SPAWN_MODE=api node tests/benchmark/benchmark-runner.js --tasks tasks-business.json
```

## 约束条件
- 不动任何 `src/` 文件
- 不动 `config/`
- 不动 `tasks-business.json`
- 本轮只运行压测，不写代码

## 预期结果

| 任务 | 预期 | 原因 |
|------|------|------|
| BIZ-001 数据清洗 | ✅ | 简单任务，A-06 已验证 |
| BIZ-002 Todo CLI | ✅ | 简单任务，A-06 已验证 |
| BIZ-003 订单看板 | ✅ | 中等任务，A-06 已验证 |
| BIZ-004 API 聚合 | ✅ | 中等任务，A-06 已验证 |
| BIZ-005 日程助手 | ⚠️ 可能失败 | 3 星复杂度，A-06 挂于 DS 上下文限制 |
| BIZ-006 SaaS 平台 | ⚠️ 可能失败 | 5 星复杂度，A-06 挂于 DS 上下文限制 |

BIZ-005/006 失败不是 Pipeline 的问题——是 DeepSeek 的上下文和稳定性限制。如果失败，在评分中记录原因即可。

## 完成后
Builder 填写 `var/dev-loop/active/02-builder-report.md`，报告附：
1. 轮次编号（round-XXX）
2. 6 任务逐条结果
3. events.jsonl 行数
4. 报告文件路径
5. 与 A-06 基线对比
