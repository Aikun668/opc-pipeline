# Build Report - Alpha Testing

日期: 2026-04-14
状态: 全部完成
验证: 6/6 冒烟通过，Alpha E2E 成功（3 轮迭代后 completed）

## 新增文件

alpha-test.js:Alpha E2E 启动脚本，含阶段计时、Token 统计、报告生成
var/alpha-report.md:Alpha 测试完整报告（API 连通性/时间轴/成本/Diff/异常记录）
utils/health.js:GLM 生成的业务代码，systemCheck() 返回 { timestamp, status: 'Alpha OK' }
tests/health.test.js:DeepSeek 生成的单元测试，assert 验证返回结构和时戳

## 修改文件

circuit-breaker.js:execute() 取消 { success: true, data: result } 包装，直接返回原始 result（修复真实 API 下 content undefined 的严重 bug）
config/models.json:planning maxTokens 400→800；review maxTokens 800→2048；testing provider 临时改为 deepseek-chat；模型名更新为 claude-sonnet-4-6-medium / Pro/zai-org/GLM-5.1
llm-clients/claude-client.js:content 提取增加 thinking block 兼容（中转站在大 maxTokens 下会返回 type=thinking）
orchestrator.js:createTask 新增 git rev-parse HEAD 获取 baseCommit；getCodeDiff 重写为基于 baseCommit 的 git diff；executeCoding 成功后自动调用 applyCodingOutput 落盘 files；extractJSON 增加空值防御和失败日志
prompts/templates.js:buildCodingPrompt 明确要求返回 files 数组，禁止 JSON 内嵌大段代码（解决 GLM 输出超 500 字符被熔断）
smoke-test-api.js:增加延迟统计和 var/smoke-test-report.txt 报告输出
pipe/pipe-manager.js:writeInputBeacon 的 _meta 合并 _meta_extra 字段
llm-manager.js:getClient 支持从环境变量读取各 provider 的 baseURL
.env:新增各厂商 API Key 及中转站 baseURL（CLAUDE_BASE_URL/GLM_BASE_URL/KIMI_BASE_URL）

## 关键修复

Bug: CircuitBreaker 包装返回值导致 LLMManager.callModel 返回 { success, data: { success, content, usage } }
Fix: execute() 直接 return result

Bug: api.gpt.ge 在 maxTokens>=2048 时返回 type=thinking 块（无 text 字段）
Fix: planning maxTokens 降至 800 + claude-client 提取 thinking 字段 fallback

Bug: GLM 将完整 diff 塞进 JSON 的 codePatch 字段，导致 900+ 字符被 hardTruncate 拒绝
Fix: Prompt 改用 files 数组格式，executeCoding 自动将 files 写入磁盘

Bug: DeepSeek-R1 review 返回未闭合 JSON（如 {"pass":true,"summary":"未发现）
Fix: review maxTokens 800→2048

## 已知限制

Kimi Coding Plan:sk-kimi- 前缀的 Key 在 api.kimi.com/coding/v1 被拒绝（仅允许 Coding Agent）。Testing 阶段临时改用 DeepSeek-chat。

Review 瓶颈:DeepSeek-R1 平均耗时 57s/轮，3 轮迭代占总时间 60% 以上。

## Review 关注点

1:circuit-breaker.js 的修复是 breaking change，确认 dispatchToActor / spawnWorker 等旧路径是否仍兼容（已验证：handleNextAction 里 `output.data || output` 兼容两种格式）
2:claude-client 的 thinking fallback 会把思考过程当成 content 输出，可能混入下游 JSON。当前仅作为兜底，实际已靠降 maxTokens 避免触发。
3:alpha-test.js 里状态机 transitionTo 被 monkey-patch 用于计时，这是临时测试代码，不应进入生产主路径。
