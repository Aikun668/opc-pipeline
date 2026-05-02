#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Orchestrator } = require('../src/orchestrator');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failCount++;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cost-integ-'));
}

test('CostTracker 在 Orchestrator constructor 中初始化', () => {
  const orchestrator = new Orchestrator();
  assert(orchestrator.costTracker !== undefined, 'costTracker 应该被初始化');
  assert(orchestrator.archiveDir !== undefined, 'archiveDir 应该被设置');
  assert(orchestrator.archiveDir.includes('var/archive'), `archiveDir 路径不正确: ${orchestrator.archiveDir}`);
});

test('recordCost 方法存在', () => {
  const orchestrator = new Orchestrator();
  assert(typeof orchestrator.recordCost === 'function', 'recordCost 应该是函数');
});

test('recordCost 正确记录 usage', () => {
  const orchestrator = new Orchestrator();
  const result = { success: true, usage: { input: 100, output: 50, reasoning: 10 } };
  orchestrator.recordCost('TASK-INT-001', 'planning', result);

  const taskCost = orchestrator.costTracker.getTaskCost('TASK-INT-001');
  assert(taskCost !== null, '应该有任务成本记录');
  assert(taskCost.phases.length === 1, '应该有 1 个阶段');
  assert(taskCost.totalTokens.input === 100, `input 应该是 100, got ${taskCost.totalTokens.input}`);
  assert(taskCost.totalTokens.output === 50, `output 应该是 50, got ${taskCost.totalTokens.output}`);
});

test('recordCost result.success=false 时不记录', () => {
  const orchestrator = new Orchestrator();
  const result = { success: false, usage: { input: 100, output: 50 } };
  orchestrator.recordCost('TASK-INT-002', 'planning', result);

  const taskCost = orchestrator.costTracker.getTaskCost('TASK-INT-002');
  assert(taskCost === null, '失败结果不应记录成本');
});

test('Mock 模式完整工作流后成本报告文件存在', async () => {
  process.env.OPC_SPAWN_MODE = 'mock';

  delete require.cache[require.resolve('../src/orchestrator')];
  delete require.cache[require.resolve('../src/llm-manager')];
  delete require.cache[require.resolve('../src/cost-tracker')];
  delete require.cache[require.resolve('../src/spawn-adapter')];

  const { Orchestrator: FreshOrchestrator } = require('../src/orchestrator');

  const tmpDir = createTempDir();
  const orchestrator = new FreshOrchestrator();
  orchestrator.archiveDir = tmpDir;

  const taskId = `TASK-INTEG-${Date.now()}`;
  orchestrator.createTask(taskId, 'feature', '集成测试任务', {
    projectRoot: process.cwd()
  });

  const result = await orchestrator.runWorkflow(taskId);

  assert(result !== null, '工作流应有返回值');
  assert(result.finalPhase === 'completed', `应到达 completed, got ${result.finalPhase}`);

  const costFile = path.join(tmpDir, `cost-${taskId}.json`);
  assert(fs.existsSync(costFile), `成本报告应存在: ${costFile}`);

  const report = JSON.parse(fs.readFileSync(costFile, 'utf8'));
  assert(report.taskId === taskId, `taskId 不匹配: ${report.taskId}`);
  assert(report.totalCost > 0, `totalCost 应大于 0: ${report.totalCost}`);
  assert(report.phases.length > 0, '应有至少一个阶段');
  assert(report.completedAt, '应有 completedAt');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('FAILED 任务也写入成本报告', async () => {
  process.env.OPC_SPAWN_MODE = 'mock';

  delete require.cache[require.resolve('../src/orchestrator')];
  delete require.cache[require.resolve('../src/llm-manager')];
  delete require.cache[require.resolve('../src/cost-tracker')];
  delete require.cache[require.resolve('../src/spawn-adapter')];

  const { Orchestrator: FreshOrchestrator } = require('../src/orchestrator');

  const tmpDir = createTempDir();
  const orchestrator = new FreshOrchestrator();
  orchestrator.archiveDir = tmpDir;

  const taskId = `TASK-FAIL-${Date.now()}`;
  orchestrator.createTask(taskId, 'feature', '失败测试', {
    projectRoot: '/nonexistent/path/to/trigger/error'
  });

  await orchestrator.runWorkflow(taskId);

  const costFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('cost-'));
  assert(costFiles.length > 0, 'FAILED 任务也应生成成本报告文件');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('aliases 从 config/model-pricing.json 读取', () => {
  const { CostTracker } = require('../src/cost-tracker');
  const tracker = new CostTracker(path.join(__dirname, '..', 'config', 'model-pricing.json'));

  assert(tracker.aliases !== undefined, 'aliases 应该被初始化');
  assert(tracker.aliases['claude-sonnet-4-6-medium'] === 'claude-sonnet-4-6', 'Claude 别名不正确');
  assert(tracker.aliases['deepseek-reasoner'] === 'deepseek-r1', 'DeepSeek 别名不正确');
  assert(tracker.aliases['Pro/zai-org/GLM-5.1'] === 'glm-4-5', 'GLM 别名不正确');
});

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
