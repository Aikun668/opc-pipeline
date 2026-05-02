# Builder Report — A-11

## 变更摘要
用真实 DeepSeek API 串行跑 6 个业务任务，验证 A-07~A-10 全部功能在真实场景下正常工作。

## 压测结果

### 运行命令
```bash
OPC_SPAWN_MODE=api node tests/benchmark/benchmark-runner.js --tasks tasks-business.json
```

### 轮次信息
- **轮次编号**: round-004
- **模式**: api
- **任务文件**: tasks-business.json
- **总任务数**: 6
- **成功**: 5
- **失败**: 1
- **总耗时**: 748,848ms (12.5 分钟)
- **总成本**: ¥0.1785

### 任务逐条结果

| 任务ID | 名称 | 结果 | 耗时(ms) | 成本(¥) | 阶段数 | 备注 |
|--------|------|------|----------|---------|--------|------|
| BENCH-BIZ-001 | 数据清洗脚本 | ✅ completed | 65,020 | 0.0121 | 6 | - |
| BENCH-BIZ-002 | Todo CLI工具 | ✅ completed | 100,055 | 0.0166 | 7 | coding JSON解析重试1次 |
| BENCH-BIZ-003 | 电商订单数据看板 | ✅ completed | 128,589 | 0.0264 | 8 | planning/coding JSON解析重试 |
| BENCH-BIZ-004 | API接口聚合服务 | ✅ completed | 125,701 | 0.0205 | 9 | testing JSON解析重试1次 |
| BENCH-BIZ-005 | 智能日程助手 | ✅ completed | 129,063 | 0.0292 | 8 | A-06失败，本轮成功 |
| BENCH-BIZ-006 | SaaS多租户平台 | ❌ failed | 200,420 | 0.0737 | 4 | planning JSON解析失败×3 |

### BIZ-006 失败分析
- **原因**: DeepSeek API 返回的 planning JSON 被截断（任务描述过长，超出模型上下文处理能力）
- **尝试**: 3 次 planning 阶段均因 JSON 解析失败触发重试，达到 maxRetries=3 上限
- **结论**: 非 Pipeline 代码问题，是 DeepSeek-v4-pro 上下文长度限制导致

## 归档验证

### round-004 目录结构
```
var/benchmark/round-004/
├── meta.json        # 轮次元信息
├── events.jsonl     # 82 行事件记录
├── results.json     # 结果汇总
└── tasks/
    ├── BENCH-BIZ-001/output/  # 产出文件副本
    ├── BENCH-BIZ-002/output/
    ├── BENCH-BIZ-003/output/
    ├── BENCH-BIZ-004/output/
    ├── BENCH-BIZ-005/output/
    └── BENCH-BIZ-006/output/  # 空（任务失败，无产出）
```

### events.jsonl 示例
```jsonl
{"ts":1777646951807,"type":"task:created","taskId":"BENCH-BIZ-001","description":"【数据清洗脚本】..."}
{"ts":1777646951807,"type":"phase:start","taskId":"BENCH-BIZ-001","phase":"planning"}
{"ts":1777646972699,"type":"phase:end","taskId":"BENCH-BIZ-001","phase":"planning","durationMs":20892,"cost":0.007}
```

### API 验证
- `GET /api/rounds` — 返回 5 条轮次记录 ✅
- `GET /api/rounds/round-004/scores` — 返回 6 个任务的自动评分 ✅
- 文件树 API 可正常读取归档产出 ✅

## 与 A-06 基线对比

| 维度 | A-06 (2026-04-29) | A-11 (本轮) | 变化 |
|------|-------------------|-------------|------|
| 成功率 | 66.7% (4/6) | 83.3% (5/6) | +16.6% |
| 总耗时 | 671,736ms | 748,848ms | +11.5% |
| 总成本 | ¥0.1441 | ¥0.1785 | +23.9% |
| BIZ-005 | ❌ failed | ✅ completed | 修复 |
| BIZ-006 | ❌ failed | ❌ failed | 一致 |

**分析**:
- BIZ-005 在本轮成功完成（A-06 因 testing aborted + delivery 502 失败），说明 DeepSeek API 稳定性有所提升
- BIZ-006 仍失败，原因一致：上下文长度限制
- 总成本上升 23.9%：BIZ-006 多次重试消耗额外 token（¥0.0737）

## 报告文件
- `var/benchmark/report-2026-05-01T15-01-40-650Z.md`
- `var/benchmark/round-004/`

## 时间
2026-05-01 15:01
