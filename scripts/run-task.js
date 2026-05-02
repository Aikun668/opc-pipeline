#!/usr/bin/env node
/**
 * run-task.js - 单任务运行脚本
 * 按任务 ID 从 tasks JSON 文件中读取描述，启动 Dashboard，跑完后保持服务器在线。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 在 dotenv 加载前设置 OPC_SPAWN_MODE
const spawnMode = process.env.OPC_SPAWN_MODE || 'mock';
process.env.OPC_SPAWN_MODE = spawnMode;

const ROOT = path.join(__dirname, '..');

// 全局异常兜底
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
  const args = process.argv.slice(2);

  // 解析 --id
  const idArgIndex = args.indexOf('--id');
  const taskId = idArgIndex !== -1 ? args[idArgIndex + 1] : null;

  if (!taskId) {
    console.error('用法: node scripts/run-task.js --id <任务ID> [--file <tasks.json>]');
    process.exit(1);
  }

  // 解析 --file
  const fileArgIndex = args.indexOf('--file');
  const tasksFilePath = fileArgIndex !== -1
    ? path.resolve(ROOT, args[fileArgIndex + 1])
    : path.join(ROOT, 'tests', 'benchmark', 'tasks-business.json');

  // 加载 tasks
  let tasks;
  try {
    tasks = JSON.parse(fs.readFileSync(tasksFilePath, 'utf8'));
  } catch (e) {
    console.error(`❌ 无法加载 tasks 文件: ${tasksFilePath}`);
    console.error(`   ${e.message}`);
    process.exit(1);
  }

  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    console.error(`❌ 任务 ${taskId} 未在 ${tasksFilePath} 中找到`);
    process.exit(1);
  }

  console.log(`🚀 单任务运行: ${task.id}`);
  console.log(`   描述: ${task.description.substring(0, 60)}...`);
  console.log(`   模式: ${spawnMode}`);
  console.log('');

  // 启动 LiveServer
  const { LiveServer } = require(path.join(ROOT, 'src', 'live-server'));
  const liveServer = new LiveServer();
  liveServer.start();

  // 创建轮次
  const { BenchmarkArchiver } = require(path.join(ROOT, 'src', 'benchmark-archiver'));
  const { EventLogger } = require(path.join(ROOT, 'src', 'event-logger'));
  const { EventBus, EVENTS } = require(path.join(ROOT, 'src', 'event-bus'));
  const eventBus = new EventBus();

  const archiver = new BenchmarkArchiver();
  const { roundId, roundDir } = archiver.createRound(spawnMode, path.basename(tasksFilePath));
  const eventLogger = new EventLogger(roundDir);
  console.log(`[Archiver] 创建轮次: ${roundId}`);

  // 运行任务
  const taskDir = path.join(os.tmpdir(), `opc-task-${task.id}-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  const startTime = Date.now();
  let result;

  try {
    const srcPath = path.join(ROOT, 'src');
    Object.keys(require.cache)
      .filter(key => key.includes(srcPath))
      .forEach(key => delete require.cache[key]);

    const { Orchestrator } = require(path.join(ROOT, 'src', 'orchestrator'));
    const orchestrator = new Orchestrator();

    orchestrator.createTask(task.id, task.type, task.description, {
      projectRoot: taskDir
    });

    const workflowResult = await orchestrator.runWorkflow(task.id);

    const costRecord = orchestrator.costTracker.getTaskCost(task.id);

    result = {
      taskId: task.id,
      description: task.description,
      duration: Date.now() - startTime,
      finalPhase: workflowResult.finalPhase,
      success: workflowResult.finalPhase === 'completed',
      totalCost: costRecord ? costRecord.totalCost : 0,
      totalTokens: costRecord ? costRecord.totalTokens : { input: 0, output: 0, reasoning: 0 },
      phases: costRecord ? costRecord.phases.length : 0,
      workDir: taskDir
    };

    console.log(`✅ 完成: ${result.finalPhase}, 耗时: ${result.duration}ms, 成本: ¥${result.totalCost}`);

  } catch (e) {
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
      workDir: taskDir,
      error: e.message,
      tripped: isBudgetTrip
    };
    if (isBudgetTrip) {
      console.log(`⚡ 熔断: ${e.message}`);
    } else {
      console.log(`❌ 失败: ${e.message}`);
    }
  }

  // 归档
  archiver.archiveTask(roundId, task.id, taskDir, result);

  archiver.finalizeRound(roundId, {
    mode: spawnMode,
    tasksFile: path.basename(tasksFilePath),
    taskCount: 1,
    successCount: result.success ? 1 : 0,
    totalCost: result.totalCost,
    totalDuration: result.duration
  });

  eventBus.emit(EVENTS.ROUND_END, {
    roundLabel: '单任务',
    tasks: 1,
    summary: {
      successRate: result.success ? '100%' : '0%',
      totalCost: result.totalCost.toFixed(4),
      totalDuration: result.duration
    }
  });

  // 保持在线
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

main();
