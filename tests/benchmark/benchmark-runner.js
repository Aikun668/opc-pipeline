#!/usr/bin/env node
/**
 * benchmark-runner.js - Phase A 压测主脚本
 * 串行执行多个任务，收集耗时、成本、结果，生成 Markdown 报告
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 在 dotenv 加载前设置 OPC_SPAWN_MODE，防止 .env 文件覆盖
const spawnMode = process.env.OPC_SPAWN_MODE || 'mock';
process.env.OPC_SPAWN_MODE = spawnMode;

const ROOT = path.join(__dirname, '..', '..');
const BENCHMARK_DIR = path.join(ROOT, 'var', 'benchmark');

const args = process.argv.slice(2);
const tasksArgIndex = args.indexOf('--tasks');
const TASKS_PATH = tasksArgIndex !== -1
  ? path.join(__dirname, args[tasksArgIndex + 1])
  : path.join(__dirname, 'tasks.json');

const noDashboard = args.includes('--no-dashboard');
let liveServer;
if (!noDashboard) {
  const { LiveServer } = require('../../src/live-server');
  liveServer = new LiveServer();
  liveServer.start();
}

const { EventBus, EVENTS } = require('../../src/event-bus');
const eventBus = new EventBus();

async function runBenchmark() {
  console.log('🚀 Phase A Benchmark Runner');
  console.log('============================');

  const configsToValidate = [
    'config/models.json',
    'config/budget.json'
  ];
  for (const relPath of configsToValidate) {
    const absPath = path.join(ROOT, relPath);
    try {
      JSON.parse(fs.readFileSync(absPath, 'utf8'));
      console.log(`✅ ${relPath} 格式正确`);
    } catch (e) {
      console.error(`❌ 配置文件损坏: ${relPath}`);
      console.error(`   ${e.message}`);
      process.exit(1);
    }
  }
  console.log('');

  const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
  const results = [];

  const { BenchmarkArchiver } = require('../../src/benchmark-archiver');
  const { EventLogger } = require('../../src/event-logger');
  const archiver = new BenchmarkArchiver();
  const { roundId, roundDir } = archiver.createRound(spawnMode, path.basename(TASKS_PATH));
  const eventLogger = new EventLogger(roundDir);
  console.log(`[Archiver] 创建轮次: ${roundId}`);

  for (const task of tasks) {
    console.log(`\n[Benchmark] 开始任务: ${task.id} - ${task.description}`);

    const taskDir = path.join(os.tmpdir(), `opc-bench-${task.id}-${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const startTime = Date.now();
    let result;
    let error;

    try {
      // 清理所有 src/ 目录下的模块缓存，确保任务间状态隔离
      const srcPath = path.join(ROOT, 'src');
      Object.keys(require.cache)
        .filter(key => key.includes(srcPath))
        .forEach(key => delete require.cache[key]);

      const { Orchestrator } = require('../../src/orchestrator');
      const orchestrator = new Orchestrator();

      // OPC_SPAWN_MODE 已在文件顶部设置

      orchestrator.createTask(task.id, task.type, task.description, {
        projectRoot: taskDir
      });

      const workflowResult = await orchestrator.runWorkflow(task.id);

      const costRecord = orchestrator.costTracker.getTaskCost(task.id);
      const costFile = orchestrator.costTracker.writeReport(task.id, path.join(taskDir, 'cost'));

      result = {
        taskId: task.id,
        description: task.description,
        duration: Date.now() - startTime,
        finalPhase: workflowResult.finalPhase,
        success: workflowResult.finalPhase === 'completed',
        totalCost: costRecord ? costRecord.totalCost : 0,
        totalTokens: costRecord ? costRecord.totalTokens : { input: 0, output: 0, reasoning: 0 },
        phases: costRecord ? costRecord.phases.length : 0,
        costFile: costFile || null,
        workDir: taskDir
      };

      console.log(`  ✅ 完成: ${result.finalPhase}, 耗时: ${result.duration}ms, 成本: ¥${result.totalCost}`);

    } catch (e) {
      error = e;
      const isBudgetTrip = e.message && e.message.includes('BUDGET_EXCEEDED');
      result = {
        taskId: task.id,
        description: task.description,
        duration: Date.now() - startTime,
        finalPhase: isBudgetTrip ? 'tripped' : 'error',
        success: false,
        totalCost: 0,
        totalTokens: { input: 0, output: 0, reasoning: 0 },
        phases: 0,
        costFile: null,
        workDir: taskDir,
        error: e.message,
        tripped: isBudgetTrip
      };
      if (isBudgetTrip) {
        console.log(`  ⚡ 熔断: ${e.message}`);
      } else {
        console.log(`  ❌ 失败: ${e.message}`);
      }
    }

    results.push(result);
    archiver.archiveTask(roundId, task.id, taskDir, result);
  }

  const reportPath = generateReport(results, tasks, roundId);
  printSummary(results, reportPath);

  archiver.finalizeRound(roundId, {
    mode: spawnMode,
    tasksFile: path.basename(TASKS_PATH),
    taskCount: results.length,
    successCount: results.filter(r => r.success).length,
    totalCost: results.reduce((sum, r) => sum + r.totalCost, 0),
    totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
  });

  eventBus.emit(EVENTS.ROUND_END, {
    roundLabel: TASKS_PATH.includes('business') ? '业务题' : '通用题',
    tasks: results.length,
    summary: {
      successRate: (results.filter(r => r.success).length / results.length * 100).toFixed(1) + '%',
      totalCost: results.reduce((sum, r) => sum + r.totalCost, 0).toFixed(4),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
    }
  });

  saveTaskResults(results);
}

function percentile(sorted, p) {
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

function generateReport(results, tasks, roundId) {
  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(BENCHMARK_DIR, `report-${timestamp}.md`);

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success && !r.tripped).length;
  const tripCount = results.filter(r => r.tripped).length;
  const avgDuration = totalDuration / results.length;
  const avgCost = totalCost / results.length;
  const successRate = (successCount / results.length * 100).toFixed(1);

  const durations = results.map(r => r.duration).sort((a, b) => a - b);
  const costs = results.map(r => r.totalCost).sort((a, b) => a - b);
  const p50 = percentile(durations, 0.50);
  const p95 = percentile(durations, 0.95);
  const minDuration = durations[0];
  const maxDuration = durations[durations.length - 1];
  const minCost = costs[0];
  const maxCost = costs[costs.length - 1];
  const minCostTask = results.find(r => r.totalCost === minCost);
  const maxCostTask = results.find(r => r.totalCost === maxCost);
  const typeStats = { feature: { count: 0, success: 0, durationSum: 0, costSum: 0 }, bugfix: { count: 0, success: 0, durationSum: 0, costSum: 0 }, refactor: { count: 0, success: 0, durationSum: 0, costSum: 0 } };
  results.forEach(r => {
    const t = tasks.find(t => t.id === r.taskId)?.type || 'unknown';
    if (typeStats[t]) {
      typeStats[t].count++;
      typeStats[t].durationSum += r.duration;
      typeStats[t].costSum += r.totalCost;
      if (r.success) typeStats[t].success++;
    }
  });
  const tripRecords = results.filter(r => r.tripped);

  const md = `# Phase A Benchmark Report

轮次: ${roundId || 'N/A'}
生成时间: ${new Date().toISOString().replace('T', ' ').substring(0, 16)}

## 引擎健康状态

| 指标 | 数值 |
|------|------|
| 任务总数 | ${results.length} |
| 成功率 | ${successRate}% |
| 成功 | ${successCount} |
| 失败 | ${failCount} |
| 熔断 | ${tripCount} |
| 总耗时 | ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s) |
| 平均耗时 | ${avgDuration.toFixed(0)}ms |
| 总成本 | ¥${totalCost.toFixed(4)} |
| 平均成本 | ¥${avgCost.toFixed(4)} |

## 延迟分布

| 指标 | 数值 |
|------|------|
| P50 | ${p50}ms |
| P95 | ${p95}ms |
| 最短 | ${minDuration}ms |
| 最长 | ${maxDuration}ms |

## 成本分布

| 指标 | 数值 |
|------|------|
| 最低成本 | ¥${minCost.toFixed(4)} (${minCostTask.taskId}) |
| 最高成本 | ¥${maxCost.toFixed(4)} (${maxCostTask.taskId}) |

## 按类型统计

| 类型 | 数量 | 成功 | 成功率 | 平均耗时(ms) | 平均成本(¥) |
|------|------|------|--------|-------------|------------|
| feature | ${typeStats.feature.count} | ${typeStats.feature.success} | ${typeStats.feature.count > 0 ? (typeStats.feature.success / typeStats.feature.count * 100).toFixed(1) : 0}% | ${typeStats.feature.count > 0 ? (typeStats.feature.durationSum / typeStats.feature.count).toFixed(0) : 0} | ${typeStats.feature.count > 0 ? (typeStats.feature.costSum / typeStats.feature.count).toFixed(4) : 0} |
| bugfix | ${typeStats.bugfix.count} | ${typeStats.bugfix.success} | ${typeStats.bugfix.count > 0 ? (typeStats.bugfix.success / typeStats.bugfix.count * 100).toFixed(1) : 0}% | ${typeStats.bugfix.count > 0 ? (typeStats.bugfix.durationSum / typeStats.bugfix.count).toFixed(0) : 0} | ${typeStats.bugfix.count > 0 ? (typeStats.bugfix.costSum / typeStats.bugfix.count).toFixed(4) : 0} |
| refactor | ${typeStats.refactor.count} | ${typeStats.refactor.success} | ${typeStats.refactor.count > 0 ? (typeStats.refactor.success / typeStats.refactor.count * 100).toFixed(1) : 0}% | ${typeStats.refactor.count > 0 ? (typeStats.refactor.durationSum / typeStats.refactor.count).toFixed(0) : 0} | ${typeStats.refactor.count > 0 ? (typeStats.refactor.costSum / typeStats.refactor.count).toFixed(4) : 0} |

## 熔断记录

${tripRecords.length === 0 ? '无熔断记录。' : tripRecords.map(r => `- **${r.taskId}**: ${r.error}`).join('\n')}

## 与通用 10 题基线对比 (A-05)

| 维度 | 通用10题(A-05) | 业务6题(本轮) | 差异 |
|------|---------------|-------------|------|
| 成功率 | 100% | ${successRate}% | ${(successRate - 100).toFixed(1)}% |
| 总耗时 | 775026ms | ${totalDuration}ms | ${(((totalDuration - 775026) / 775026) * 100).toFixed(1)}% |
| 总成本 | ¥0.1607 | ¥${totalCost.toFixed(4)} | ${(((totalCost - 0.1607) / 0.1607) * 100).toFixed(1)}% |
| 平均成本/任务 | ¥0.0161 | ¥${avgCost.toFixed(4)} | ${(((avgCost - 0.0161) / 0.0161) * 100).toFixed(1)}% |

## 任务详情

| 任务ID | 类型 | 描述 | 结果 | 耗时(ms) | 成本(¥) | 阶段数 |
|--------|------|------|------|----------|---------|--------|
${results.map(r => `| ${r.taskId} | ${tasks.find(t => t.id === r.taskId)?.type || '-'} | ${r.description.substring(0, 80)}... | ${r.tripped ? '⚡' : (r.success ? '✅' : '❌')} ${r.finalPhase} | ${r.duration} | ${r.totalCost.toFixed(4)} | ${r.phases} |`).join('\n')}

## 详细记录

${results.map(r => `### ${r.taskId}

- **类型**: ${tasks.find(t => t.id === r.taskId)?.type || '-'}
- **描述**: ${r.description}
- **结果**: ${r.finalPhase}
- **耗时**: ${r.duration}ms
- **成本**: ¥${r.totalCost.toFixed(4)}
- **Tokens**: input=${r.totalTokens.input}, output=${r.totalTokens.output}, reasoning=${r.totalTokens.reasoning}
- **阶段数**: ${r.phases}
${r.error ? `- **错误**: \`\`\`\n${r.error}\n\`\`\`` : ''}
`).join('\n')}

---
*Generated by benchmark-runner.js | Phase A 压测*
`;

  fs.writeFileSync(reportPath, md, 'utf8');
  return reportPath;
}

function printSummary(results, reportPath) {
  console.log('\n============================');
  console.log('Benchmark 完成');
  console.log('============================');

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);
  const successCount = results.filter(r => r.success).length;

  console.log(`任务数: ${results.length}`);
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${results.length - successCount}`);
  console.log(`总耗时: ${totalDuration}ms`);
  console.log(`总成本: ¥${totalCost.toFixed(4)}`);
  console.log(`报告: ${reportPath}`);
}

function saveTaskResults(results) {
  const resultsPath = path.join(BENCHMARK_DIR, 'task-results.json');
  const data = {
    round: new Date().toISOString().split('T')[0].replace(/-/g, ''),
    date: new Date().toISOString().split('T')[0],
    tasks: results.map(r => ({
      taskId: r.taskId,
      workDir: r.workDir || null,
      success: r.success,
      duration: r.duration,
      totalCost: r.totalCost,
      phases: r.phases
    }))
  };
  fs.writeFileSync(resultsPath, JSON.stringify(data, null, 2));
}

process.on('unhandledRejection', (reason) => {
  console.error('[KeepAlive] 未捕获的 Promise 拒绝:', reason instanceof Error ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
  console.error('[KeepAlive] 未捕获的异常:', err.message);
});

function getWslIp() {
  try {
    const { execSync } = require('child_process');
    const ip = execSync('hostname -I', { encoding: 'utf8', timeout: 3000 }).trim().split(' ')[0];
    return ip || null;
  } catch (e) {
    return null;
  }
}

async function main() {
  try {
    await runBenchmark();
  } catch (e) {
    console.error('Benchmark 任务失败:', e.message);
  }

  if (liveServer) {
    const wslIp = getWslIp();
    console.log('\n' + '='.repeat(60));
    console.log('服务器运行中');
    console.log('  实时监控: http://localhost:3456');
    if (wslIp) {
      console.log('  Windows 访问: http://' + wslIp + ':3456');
    }
    console.log('  质量评分: http://localhost:3456/scoring');
    console.log('  按 Ctrl+C 退出');
    console.log('='.repeat(60));
    await new Promise(() => {});
  }
}

main();
