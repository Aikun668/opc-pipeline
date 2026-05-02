require('dotenv').config();

const fs = require('fs');
const path = require('path');

process.env.OPC_SPAWN_MODE = 'api';

const ROOT = path.join(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'var', 'real-api-trial');

if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

const TASKS = [
  path.join(__dirname, 'task-01-simple-feature.json'),
  path.join(__dirname, 'task-02-bugfix.json'),
  path.join(__dirname, 'task-03-refactor.json')
];

const results = [];

async function runTask(taskFile) {
  const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  console.log(`\n[${taskData.id}] 开始执行: ${taskData.description.slice(0, 50)}...`);

  const startTime = Date.now();
  let result = { finalPhase: 'failed', error: '未执行' };
  let cost = 0;

  try {
    const srcPath = path.join(__dirname, '..', '..', 'src');
    Object.keys(require.cache)
      .filter(key => key.startsWith(srcPath + path.sep))
      .forEach(key => delete require.cache[key]);

    const { Orchestrator } = require('../../src/orchestrator');
    const orchestrator = new Orchestrator();

    orchestrator.createTask(taskData.id, taskData.type, taskData.description, taskData.options || {});
    result = await orchestrator.runWorkflow(taskData.id);

    const costTracker = orchestrator.costTracker;
    if (costTracker) {
      const taskCost = costTracker.getTaskCost(taskData.id);
      if (taskCost) {
        cost = taskCost.totalCost;
      }
    }
  } catch (e) {
    result = { finalPhase: 'failed', error: e.message };
  }

  const duration = Date.now() - startTime;
  const status = result.finalPhase === 'completed' ? '成功' :
                 result.finalPhase === 'failed' ? '失败' : '熔断';

  console.log(`[${taskData.id}] 结果: ${status} | 耗时: ${duration}ms | 成本: ¥${cost.toFixed(4)}`);

  return {
    taskId: taskData.id,
    type: taskData.type,
    description: taskData.description,
    status,
    duration,
    cost,
    error: result.error || null
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              OPC Pipeline 真实 API 试验启动');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`预算保护: 单次 ¥1.0 | 累计 ¥3.0`);
  console.log(`API 模式: ${process.env.OPC_SPAWN_MODE}`);

  for (const taskFile of TASKS) {
    const result = await runTask(taskFile);
    results.push(result);

    const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
    if (totalCost >= 3.0) {
      console.log(`\n⚠️ 累计成本 ¥${totalCost.toFixed(4)} 超过预算上限 ¥3.0，终止后续任务`);
      break;
    }
  }

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const successCount = results.filter(r => r.status === '成功').length;
  const failedCount = results.filter(r => r.status === '失败').length;
  const breakerCount = results.filter(r => r.status === '熔断').length;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        试验汇总');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`总任务: ${results.length} | 成功: ${successCount} | 失败: ${failedCount} | 熔断: ${breakerCount}`);
  console.log(`总耗时: ${totalDuration}ms | 总成本: ¥${totalCost.toFixed(4)}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `report-${timestamp}.md`);

  const report = `# 真实 API 试验报告

**时间**: ${new Date().toLocaleString('zh-CN')}
**API 模式**: ${process.env.OPC_SPAWN_MODE}
**预算上限**: 单次 ¥1.0 | 累计 ¥3.0

## 汇总

| 指标 | 数值 |
|------|------|
| 总任务 | ${results.length} |
| 成功 | ${successCount} |
| 失败 | ${failedCount} |
| 熔断 | ${breakerCount} |
| 总耗时 | ${totalDuration}ms |
| 总成本 | ¥${totalCost.toFixed(4)} |

## 详细结果

${results.map(r => `
### ${r.taskId} (${r.type})

- **描述**: ${r.description}
- **状态**: ${r.status}
- **耗时**: ${r.duration}ms
- **成本**: ¥${r.cost.toFixed(4)}
${r.error ? `- **错误**: ${r.error}` : ''}
`).join('\n')}

## 结论

${totalCost >= 3.0 ? '⚠️ 累计成本触及预算上限，试验提前终止。' : '✅ 试验在预算范围内完成。'}
`;

  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\n报告已保存: ${reportPath}`);
}

main().catch(e => {
  console.error('试验失败:', e.message);
  process.exit(1);
});
