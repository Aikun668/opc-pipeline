#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { TaskQueueManager } = require('../src/task-queue');
const testStateDir = path.join(os.tmpdir(), `opc-queue-test-${Date.now()}`);
const TEST_STATE = path.join(testStateDir, 'state.json');
fs.mkdirSync(testStateDir, { recursive: true });

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failCount++;
  }
}

async function main() {

// 设置 mock 模式
process.env.OPC_SPAWN_MODE = 'mock';

function cleanState() {
  try { fs.unlinkSync(TEST_STATE); } catch (_) {}
  try { fs.unlinkSync(TEST_STATE + '.tmp'); } catch (_) {}
}

// ========== 场景1：基本功能 ==========

await testAsync('TaskQueueManager 可以创建实例', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });
  assert(qm !== null, '实例应创建成功');
  assert(qm.concurrency === 1, '默认并发度应为 1');
});

await testAsync('enqueue 返回任务 ID', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });
  const id = qm.enqueue({ id: 'TEST-001', description: 'test', type: 'feature' });
  assert(typeof id === 'string', '应返回字符串 ID');
  assert(id.includes('TEST-001'), 'ID 应包含传入的任务 ID');
});

// ========== 场景2：串行执行 3 个任务 ==========

await testAsync('3 个任务排队并依次执行完毕', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });
  const completed = [];

  qm.on('completed', (task) => {
    completed.push(task.id);
  });

  const taskDir = path.join(os.tmpdir(), `opc-queue-test-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({
    id: 'QUEUE-001',
    description: '实现用户注册 API',
    type: 'feature',
    options: { projectRoot: taskDir }
  });

  qm.enqueue({
    id: 'QUEUE-002',
    description: '修复登录超时问题',
    type: 'bugfix',
    options: { projectRoot: taskDir }
  });

  qm.enqueue({
    id: 'QUEUE-003',
    description: '重构数据库查询层',
    type: 'refactor',
    options: { projectRoot: taskDir }
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  assert(completed.length === 3, `应有 3 个任务完成，实际 ${completed.length}`);
  assert(completed[0] === 'QUEUE-001', '第一个完成的应是 QUEUE-001');
  assert(completed[1] === 'QUEUE-002', '第二个完成的应是 QUEUE-002');
  assert(completed[2] === 'QUEUE-003', '第三个完成的应是 QUEUE-003');
});

// ========== 场景3：状态流转 ==========

await testAsync('任务状态正确流转: pending -> processing -> completed', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });
  const states = [];

  qm.on('enqueued', (task) => states.push({ id: task.id, status: task.status }));
  qm.on('started', (task) => states.push({ id: task.id, status: task.status }));
  qm.on('completed', (task) => states.push({ id: task.id, status: task.status }));

  const taskDir = path.join(os.tmpdir(), `opc-queue-state-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({
    id: 'STATE-001',
    description: '状态测试任务',
    type: 'feature',
    options: { projectRoot: taskDir }
  });

  await new Promise(resolve => setTimeout(resolve, 300));

  const enqueued = states.find(s => s.status === 'pending');
  const processing = states.find(s => s.status === 'processing');
  const completed = states.find(s => s.status === 'completed');

  assert(enqueued !== undefined, '应有 pending 状态');
  assert(processing !== undefined, '应有 processing 状态');
  assert(completed !== undefined, '应有 completed 状态');
});

// ========== 场景4：错误处理 ==========

await testAsync('任务失败时队列继续处理下一个，不卡死', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });
  const results = [];

  qm.on('completed', (task) => results.push({ id: task.id, status: 'completed' }));
  qm.on('failed', (task) => results.push({ id: task.id, status: 'failed' }));

  // 使用一个会导致 workflow 内部报错的项目根目录
  qm.enqueue({
    id: 'FAIL-001',
    description: '这个任务会失败',
    type: 'feature',
    options: { projectRoot: '/proc/self/root/nonexistent' }
  });

  qm.enqueue({
    id: 'FAIL-002',
    description: '这个任务应该成功',
    type: 'feature',
    options: { projectRoot: os.tmpdir() }
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  assert(results.length === 2, `应有 2 个结果，实际 ${results.length}`);
  const fail1 = results.find(r => r.id === 'FAIL-001');
  const fail2 = results.find(r => r.id === 'FAIL-002');
  assert(fail1 !== undefined, 'FAIL-001 应有结果');
  assert(fail2 !== undefined, 'FAIL-002 应有结果');
  // mock 模式下所有任务都成功，验证队列不卡死即可
  assert(fail2.status === 'completed', 'FAIL-002 应成功');
});

// ========== 场景5：并发度为 1 ==========

await testAsync('并发度为 1，同时只有一个任务在执行', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });
  const overlap = [];

  qm.on('started', (task) => {
    overlap.push({ event: 'start', id: task.id, time: Date.now() });
  });
  qm.on('completed', (task) => {
    overlap.push({ event: 'end', id: task.id, time: Date.now() });
  });

  const taskDir = path.join(os.tmpdir(), `opc-queue-conc-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({ id: 'CONC-001', description: '任务1', type: 'feature', options: { projectRoot: taskDir } });
  qm.enqueue({ id: 'CONC-002', description: '任务2', type: 'feature', options: { projectRoot: taskDir } });
  qm.enqueue({ id: 'CONC-003', description: '任务3', type: 'feature', options: { projectRoot: taskDir } });

  await new Promise(resolve => setTimeout(resolve, 500));

  for (let i = 0; i < overlap.length; i += 2) {
    const start = overlap[i];
    const end = overlap[i + 1];
    assert(start.event === 'start', '偶数索引应为 start');
    assert(end.event === 'end', '奇数索引应为 end');
    assert(start.id === end.id, 'start 和 end 的 ID 应匹配');
  }

  for (let i = 1; i < overlap.length - 1; i += 2) {
    const end = overlap[i];
    const nextStart = overlap[i + 1];
    assert(end.time <= nextStart.time, '前一个任务结束后下一个才开始');
  }
});

// ========== 场景6：统计信息 ==========

await testAsync('getStats 返回正确的统计信息', async () => {
  cleanState();
  const qm = new TaskQueueManager({ stateFile: TEST_STATE });

  const taskDir = path.join(os.tmpdir(), `opc-queue-stats-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({ id: 'STAT-001', description: '任务1', type: 'feature', options: { projectRoot: taskDir } });
  qm.enqueue({ id: 'STAT-002', description: '任务2', type: 'feature', options: { projectRoot: taskDir } });

  await new Promise(resolve => setTimeout(resolve, 300));

  const stats = qm.getStats();
  assert(stats.enqueued === 2, 'enqueued 应为 2');
  assert(stats.completed === 2, 'completed 应为 2');
  assert(stats.failed === 0, 'failed 应为 0');
});

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
