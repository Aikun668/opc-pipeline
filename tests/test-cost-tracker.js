#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CostTracker, BudgetExceededError } = require('../src/cost-tracker');

const PRICING_PATH = path.join(__dirname, '..', 'config', 'model-pricing.json');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cost-test-'));
}

// ========== 场景1：单价计算 ==========

test('calculateCallCost: Claude Sonnet 正确计算', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost = tracker.calculateCallCost('claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 1000 });
  const expected = 0.021 * 1 + 0.105 * 1;
  assert(Math.abs(cost - expected) < 0.0001, `expected ${expected}, got ${cost}`);
});

test('calculateCallCost: DeepSeek-R1 含 reasoning', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost = tracker.calculateCallCost('deepseek-r1', { input_tokens: 500, output_tokens: 200, reasoning_tokens: 1000 });
  const expected = 0.004 * 0.5 + 0.016 * 0.2 + 0.004 * 1;
  assert(Math.abs(cost - expected) < 0.0001, `expected ${expected}, got ${cost}`);
});

test('calculateCallCost: 模型别名自动解析 (claude-sonnet-4-6-medium → claude-sonnet-4-6)', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost1 = tracker.calculateCallCost('claude-sonnet-4-6', { input_tokens: 100, output_tokens: 100 });
  const cost2 = tracker.calculateCallCost('claude-sonnet-4-6-medium', { input_tokens: 100, output_tokens: 100 });
  assert(cost1 === cost2, `alias should match: ${cost1} vs ${cost2}`);
});

test('calculateCallCost: 模型别名 (deepseek-reasoner → deepseek-r1)', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost1 = tracker.calculateCallCost('deepseek-r1', { input_tokens: 100, output_tokens: 100, reasoning_tokens: 100 });
  const cost2 = tracker.calculateCallCost('deepseek-reasoner', { input_tokens: 100, output_tokens: 100, reasoning_tokens: 100 });
  assert(cost1 === cost2, `alias should match: ${cost1} vs ${cost2}`);
});

test('calculateCallCost: 未知模型返回 0', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost = tracker.calculateCallCost('unknown-model', { input_tokens: 100, output_tokens: 100 });
  assert(cost === 0, `unknown model should return 0, got ${cost}`);
});

test('calculateCallCost: 缺少 reasoning_tokens 不报错', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost = tracker.calculateCallCost('deepseek-r1', { input_tokens: 100, output_tokens: 100 });
  assert(cost > 0, `should still calculate cost, got ${cost}`);
});

// ========== 场景2：费用累计 ==========

test('recordCall: 单次记录', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const cost = tracker.recordCall('TASK-001', 'planning', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 500 });
  assert(cost > 0, `cost should be positive, got ${cost}`);
  const taskCost = tracker.getTaskCost('TASK-001');
  assert(taskCost !== null, 'should have task record');
  assert(taskCost.phases.length === 1, 'should have 1 phase');
  assert(taskCost.totalCost === cost, `totalCost should match: ${taskCost.totalCost} vs ${cost}`);
});

test('recordCall: 多次累计', () => {
  const tracker = new CostTracker(PRICING_PATH);
  tracker.recordCall('TASK-002', 'planning', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 500 });
  tracker.recordCall('TASK-002', 'coding', 'glm-4-5', { input_tokens: 500, output_tokens: 1000 });
  tracker.recordCall('TASK-002', 'review', 'deepseek-r1', { input_tokens: 400, output_tokens: 1000, reasoning_tokens: 800 });

  const taskCost = tracker.getTaskCost('TASK-002');
  assert(taskCost.phases.length === 3, `should have 3 phases, got ${taskCost.phases.length}`);
  assert(taskCost.totalCost > 0, 'totalCost should be positive');
  assert(taskCost.totalTokens.input === 1900, `total input should be 1900, got ${taskCost.totalTokens.input}`);
  assert(taskCost.totalTokens.output === 2500, `total output should be 2500, got ${taskCost.totalTokens.output}`);
  assert(taskCost.totalTokens.reasoning === 800, `total reasoning should be 800, got ${taskCost.totalTokens.reasoning}`);
});

test('writeReport: 写入 JSON 文件', () => {
  const tracker = new CostTracker(PRICING_PATH);
  tracker.recordCall('TASK-003', 'planning', 'claude-sonnet-4-6', { input_tokens: 100, output_tokens: 50 });
  tracker.recordCall('TASK-003', 'review', 'deepseek-r1', { input_tokens: 200, output_tokens: 100, reasoning_tokens: 500 });

  const tmpDir = createTempDir();
  const filePath = tracker.writeReport('TASK-003', tmpDir);
  assert(filePath !== null, 'should return file path');
  assert(fs.existsSync(filePath), 'file should exist');

  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert(report.taskId === 'TASK-003', `taskId mismatch: ${report.taskId}`);
  assert(report.totalCost > 0, 'totalCost should be positive');
  assert(report.phases.length === 2, `should have 2 phases, got ${report.phases.length}`);
  assert(report.completedAt, 'should have completedAt');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('writeReport: 不存在的任务返回 null', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const result = tracker.writeReport('TASK-NONEXIST', createTempDir());
  assert(result === null, 'should return null for unknown task');
});

test('getTaskCost: 不存在的任务返回 null', () => {
  const tracker = new CostTracker(PRICING_PATH);
  assert(tracker.getTaskCost('NONEXIST') === null, 'should return null');
});

// ========== 总结 ==========

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
