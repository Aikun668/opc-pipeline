#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CircuitBreakerManager } = require('../src/circuit-breaker');
const { CostTracker } = require('../src/cost-tracker');

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

// ========== 场景1：单次调用超额 ==========

test('checkBudget: 单次调用未超额', () => {
  const manager = new CircuitBreakerManager();
  const result = manager.checkBudget('TASK-001', 0.5, 2.0, { singleCallBudget: 1.0, taskBudget: 10.0 });
  assert(result.allowed === true, '应允许通过');
  assert(result.reason === '', '不应有原因');
});

test('checkBudget: 单次调用超额', () => {
  const manager = new CircuitBreakerManager();
  const result = manager.checkBudget('TASK-002', 1.5, 0.5, { singleCallBudget: 1.0, taskBudget: 10.0 });
  assert(result.allowed === false, '应拒绝');
  assert(result.reason.includes('BUDGET_EXCEEDED'), '原因应包含 BUDGET_EXCEEDED');
  assert(result.reason.includes('单次调用'), '原因应说明是单次调用');
  assert(result.reason.includes('TASK-002'), '原因应包含 taskId');
});

// ========== 场景2：累计调用超额 ==========

test('checkBudget: 累计未超额', () => {
  const manager = new CircuitBreakerManager();
  const result = manager.checkBudget('TASK-003', 0.5, 5.0, { singleCallBudget: 1.0, taskBudget: 10.0 });
  assert(result.allowed === true, '应允许通过');
});

test('checkBudget: 累计超额', () => {
  const manager = new CircuitBreakerManager();
  const result = manager.checkBudget('TASK-004', 0.5, 10.5, { singleCallBudget: 1.0, taskBudget: 10.0 });
  assert(result.allowed === false, '应拒绝');
  assert(result.reason.includes('BUDGET_EXCEEDED'), '原因应包含 BUDGET_EXCEEDED');
  assert(result.reason.includes('任务累计'), '原因应说明是任务累计');
});

// ========== 场景3：边界值 ==========

test('checkBudget: 刚好等于阈值', () => {
  const manager = new CircuitBreakerManager();
  const result = manager.checkBudget('TASK-005', 1.0, 10.0, { singleCallBudget: 1.0, taskBudget: 10.0 });
  assert(result.allowed === true, '等于阈值应允许通过');
});

// ========== 场景4：与 CostTracker 集成 ==========

test('完整链路：CostTracker 记账 + checkBudget 熔断', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const manager = new CircuitBreakerManager();

  const taskId = 'TASK-FLOW-001';
  const budget = { singleCallBudget: 0.05, taskBudget: 0.1 };

  // 第一次调用：通过
  const cost1 = tracker.recordCall(taskId, 'planning', 'claude-sonnet-4-6', { input_tokens: 100, output_tokens: 100 });
  const record1 = tracker.getTaskCost(taskId);
  const check1 = manager.checkBudget(taskId, cost1, record1.totalCost, budget);
  assert(check1.allowed === true, '第一次应通过');

  // 第二次调用：通过
  const cost2 = tracker.recordCall(taskId, 'coding', 'glm-4-5', { input_tokens: 200, output_tokens: 200 });
  const record2 = tracker.getTaskCost(taskId);
  const check2 = manager.checkBudget(taskId, cost2, record2.totalCost, budget);
  assert(check2.allowed === true, '第二次应通过');

  // 第三次调用：单次超额先触发（单次检查在累计检查之前）
  const cost3 = tracker.recordCall(taskId, 'review', 'deepseek-r1', { input_tokens: 5000, output_tokens: 5000, reasoning_tokens: 5000 });
  const record3 = tracker.getTaskCost(taskId);
  const check3 = manager.checkBudget(taskId, cost3, record3.totalCost, budget);
  assert(check3.allowed === false, '第三次应拒绝');
  assert(check3.reason.includes('BUDGET_EXCEEDED'), '应包含 BUDGET_EXCEEDED');
});

test('完整链路：单次调用超额直接拒绝', () => {
  const tracker = new CostTracker(PRICING_PATH);
  const manager = new CircuitBreakerManager();

  const taskId = 'TASK-FLOW-002';
  const budget = { singleCallBudget: 0.01, taskBudget: 10.0 };

  const cost = tracker.recordCall(taskId, 'planning', 'claude-sonnet-4-6', { input_tokens: 500, output_tokens: 500 });
  const record = tracker.getTaskCost(taskId);
  const check = manager.checkBudget(taskId, cost, record.totalCost, budget);

  assert(check.allowed === false, '单次超额应直接拒绝');
  assert(check.reason.includes('单次调用'), '应是单次超额');
});

// ========== 场景5：默认值 ==========

test('checkBudget: 不传 options 使用默认值', () => {
  const manager = new CircuitBreakerManager();
  const result = manager.checkBudget('TASK-DEF', 0.5, 5.0);
  assert(result.allowed === true, '默认值下应通过');
});

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
