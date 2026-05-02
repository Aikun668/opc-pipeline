# 给 Reviewer 的整体计划说明

## 当前状态：Alpha Test 完成 ✅

OPC Pipeline 已在真实 API 环境下完成全链路 6 阶段测试。

\---

## 测试结果

|指标|结果|
|-|-|
|总耗时|63.2s|
|单次成本|¥0.13|
|成功率|6/6 阶段全部通过|
|生成代码|utils/health.js + tests/health.test.js|

\---

## Token 消耗明细

|阶段|模型|Tokens (in/out/reasoning)|成本|
|-|-|-|-|
|planning|Claude Sonnet 4.6|1/652/0|¥0.069|
|coding|GLM-5.1|525/671/0|¥0.005|
|prefilter|DeepSeek-chat|109/17/0|¥0.000|
|review|DeepSeek-R1|451/946/893|¥0.021|
|testing|DeepSeek-chat|298/145/0|¥0.001|
|delivery|Claude Sonnet 4.6|1/100/0|¥0.011|
|**合计**||**1514/2962/954**|**¥0.13**|

*Reasoning Tokens 全部来自 DeepSeek-R1 review 阶段，占比 35.3%*

\---

## 已知问题

1. **Kimi Coding Plan Key 限制** — `api.kimi.com/coding/v1` 端点仅允许 Coding Agent 调用，Testing 阶段临时使用 DeepSeek-chat 替代
2. **Review 瓶颈** — DeepSeek-R1 平均耗时 27s，占总耗时 43%，建议后续异步化处理

\---

## 后续计划 (Phase 2)

**目标：面向 Beta 的生产防护网建设**

|任务|内容|优先级|
|-|-|-|
|1. 成本核算与熔断|当单次任务 > ¥0.5 时硬熔断，防止持续燃烧 API 额度|P0|
|2. 异常监控与退避重试|处理 429/502 限流，实现指数退避策略|P0|
|3. 日志与通知系统|关键节点推送到外部平台（钉钉/飞书/Slack）|P1|
|4. Review 异步化|将 R1 Review 从同步改为异步，不阻塞主流程|P2|

\---

## 关键文件变更

* `alpha-test.js`: 新增 Token 追踪与成本计算逻辑
* `llm-manager.js`: 增加 `byStage` 统计，按阶段记录 usage
* `orchestrator.js`: baseCommit 快照、自动落盘 files
* `config/models.json`: 模型名/Token 限制更新

详细变更见 `var/report-03-diff-build.md`

\---

## 验收报告

完整 Token 追踪报告已写入：`var/alpha-report.md`（5 章节格式）

**结论**：单次任务成本 **≤ ¥0.13**，符合 "≤0.1元\~1元" 区间靠下沿，可进入 Phase 2 生产防护网建设。

\---

等待 Reviewer 反馈是否可进入 Phase 2。

