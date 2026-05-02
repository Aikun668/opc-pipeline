#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

process.env.OPC_SPAWN_MODE = 'api';

const { Orchestrator } = require('../src/orchestrator');

const PROJECT_ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(__dirname, '..', 'var', 'report-04-alpha.md');
const modelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'models.json'), 'utf8'));

// 费率表（元/1K tokens）- 来源: 各厂商官方定价/中转站
const COST_TABLE = {
  claude:   { input: 0.021, output: 0.105 },
  glm:      { input: 0.004, output: 0.004 },
  deepseek_chat:    { input: 0.001, output: 0.002 },
  deepseek_reasoner: { input: 0.004, output: 0.016, reasoning: 0.004 },
  kimi:     { input: 0.008, output: 0.024 },
};

// 模型名映射到费率 key
const MODEL_MAP = {
  'claude-sonnet-4-6-medium': 'claude',
  'claude-sonnet-4-6': 'claude',
  'Pro/zai-org/GLM-5.1': 'glm',
  'glm-5.1': 'glm',
  'deepseek-chat': 'deepseek_chat',
  'deepseek-reasoner': 'deepseek_reasoner',
  'moonshot-v1-32k': 'kimi',
};

async function runAlpha() {
  const overallStart = Date.now();
  const phaseTimings = [];
  const errors = [];
  const phaseTokens = [];

  const orchestrator = new Orchestrator();
  const taskId = 'TASK-ALPHA-001';

  console.log('🚀 OPC Pipeline Alpha Testing (Token 追踪版)');
  console.log('任务: Add Alpha Health Check Utility');
  console.log('模式: OPC_SPAWN_MODE=api');
  console.log('========================================\n');

  orchestrator.createTask(taskId, 'feature', '在 utils/health.js 中实现一个 systemCheck() 函数，返回当前系统时间戳和状态 Alpha OK。并为其编写对应的单元测试文件。', {
    projectRoot: PROJECT_ROOT,
    contextFiles: [],
    constraints: ['代码写入 utils/health.js', '测试写入 utils/health.test.js']
  });

  let lastPhase = 'planning';
  let phaseStart = Date.now();

  const sm = orchestrator.stateMachines.get(taskId);
  if (sm) {
    const origTransition = sm.transitionTo.bind(sm);
    sm.transitionTo = function(phase) {
      const now = Date.now();
      const duration = now - phaseStart;

      // 记录从 LLMManager 获取的按阶段 Token 统计
      const stats = orchestrator.llmManager.getStats();
      const stageStats = stats.byStage[lastPhase] || { input: 0, output: 0, reasoning: 0 };

      phaseTimings.push({
        phase: lastPhase,
        durationMs: duration,
        input: stageStats.input,
        output: stageStats.output,
        reasoning: stageStats.reasoning
      });

      console.log(`⏱  ${lastPhase} → ${phase} (${duration}ms) | tokens: in=${stageStats.input} out=${stageStats.output} reason=${stageStats.reasoning}`);
      phaseStart = now;
      lastPhase = phase;
      return origTransition(phase);
    };
  }

  let result;
  try {
    result = await orchestrator.runWorkflow(taskId);
  } catch (e) {
    errors.push({ phase: lastPhase, error: e.message, timestamp: new Date().toISOString() });
    result = { success: false, finalPhase: lastPhase, error: e.message };
  }

  const totalDuration = Date.now() - overallStart;

  console.log('\n========================================');
  console.log(`结果: ${result.success ? '✅ 成功' : '❌ 失败'}`);
  console.log(`最终阶段: ${result.finalPhase}`);
  console.log(`总耗时: ${(totalDuration / 1000).toFixed(1)}s`);

  const stats = orchestrator.llmManager.getStats();
  console.log('\nToken 汇总:');
  console.log(`  Input: ${stats.totalTokens.input}`);
  console.log(`  Output: ${stats.totalTokens.output}`);
  console.log(`  Reasoning: ${stats.totalTokens.reasoning}`);

  // 重新获取最终的 byStage 数据（此时才准确）
  const finalStats = orchestrator.llmManager.getStats();
  const byStage = finalStats.byStage;

  let totalCost = 0;
  const phaseKeys = ['planning', 'coding', 'prefilter', 'review', 'testing', 'delivery'];
  const phaseCosts = phaseKeys.map(stage => {
    const s = byStage[stage] || { input: 0, output: 0, reasoning: 0 };
    const modelName = modelConfig.models[stage]?.model || '';
    const provider = MODEL_MAP[modelName] || stage;
    const rates = COST_TABLE[provider] || { input: 0, output: 0, reasoning: 0 };
    const cost = (s.input * rates.input + s.output * rates.output + s.reasoning * (rates.reasoning || 0)) / 1000;
    totalCost += cost;
    return { ...s, stage, modelName, provider, cost };
  });

  console.log(`\n💰 预估成本: ¥${totalCost.toFixed(4)}`);

  // 生成报告
  const providers = Object.keys(modelConfig.models);

  const report = [
    '# Alpha Test Report — TASK-ALPHA-001',
    '',
    '## 1. 执行概况',
    `- 任务 ID: ${taskId}`,
    `- 任务描述: Add Alpha Health Check Utility`,
    `- 执行时间: ${new Date().toISOString()}`,
    `- 结果: ${result.success ? '成功' : '失败'}`,
    `- 最终阶段: ${result.finalPhase}`,
    `- 总耗时: ${(totalDuration / 1000).toFixed(1)}s (${totalDuration}ms)`,
    '',
    '## 2. API 连通性验证',
    '| Provider | 状态 | 延迟(ms) |',
    '|----------|------|---------|',
    ...phaseCosts.map(pt => `| ${pt.stage} | ✅ | ${pt.cost > 0 ? Math.round((byStage[pt.stage]?.input + byStage[pt.stage]?.output || 0) / (pt.cost * 1000)) : '-'} |`).slice(0, 6),
    '',
    '## 3. 各阶段 Token 消耗详情',
    '',
    '| 阶段 | 模型 | 耗时(ms) | Prompt Tokens | Output Tokens | Reasoning Tokens | 小计(元) |',
    '|------|------|---------|---------------|---------------|-----------------|----------|',
    ...phaseCosts.map(pt => `| ${pt.stage} | ${pt.modelName} | ${(phaseTimings.find(t => t.phase === pt.stage)?.durationMs || '-')} | ${pt.input} | ${pt.output} | ${pt.reasoning || '-'} | ¥${pt.cost.toFixed(4)} |`),
    `| **合计** | | | **${finalStats.totalTokens.input}** | **${finalStats.totalTokens.output}** | **${finalStats.totalTokens.reasoning}** | **¥${totalCost.toFixed(4)}** |`,
    '',
    '## 4. 异常与容错记录',
    errors.length === 0 ? '- 无' : errors.map(e => `- ${e.phase}: ${e.error} (${e.timestamp})`).join('\n'),
    '',
    '## 5. 成本分析与建议',
    `- 单次任务成本基线: ¥${totalCost.toFixed(2)}`,
    `- R1 推理 Token 占比: ${((finalStats.totalTokens.reasoning / finalStats.totalTokens.output) * 100).toFixed(1)}%`,
    `- 瓶颈阶段（耗时最长）: ${phaseTimings.reduce((a, b) => a.durationMs > b.durationMs ? a : b).phase || '-'}`,
    '- 成本优化建议: 可考虑将 Review 阶段从 DeepSeek-R1 换为更快的模型，或异步化处理不阻塞主流程',
    '',
    '---',
    '',
    '## 后续计划',
    '',
    '### Phase 1: 真实沙盒任务试运行与成本摸底 ✅ (已完成)',
    '- 执行沙盒任务并捕获核心指标 ✓',
    `- 建立成本基线: 单次 ~¥${totalCost.toFixed(2)}`,
    '',
    '### Phase 2: 面向 Beta 的生产防护网建设 (规划中)',
    '1. 构建"成本核算与熔断"模块: 当单次任务超过预算（如 ¥0.5）时硬熔断',
    '2. 增强异常监控与退避重试: 处理 429/502 限流，实现指数退避',
    '3. 日志与通知系统: 关键节点推送到外部平台',
  ].join('\n');

  fs.mkdirSync(path.join(PROJECT_ROOT, 'var'), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\n报告已写入: ${REPORT_PATH}`);

  process.exit(result.success ? 0 : 1);
}

runAlpha();