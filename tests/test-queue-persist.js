#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

process.env.OPC_SPAWN_MODE = 'mock';

const TEST_STATE_FILE = path.join(__dirname, '..', 'var', 'queue', 'test-state.json');

function cleanup() {
  if (fs.existsSync(TEST_STATE_FILE)) {
    fs.unlinkSync(TEST_STATE_FILE);
  }
  const tmpFile = TEST_STATE_FILE + '.tmp';
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }
}

async function main() {

// ========== 场景1：状态文件创建 ==========

await testAsync('enqueue 后状态文件被创建', async () => {
  cleanup();

  const { TaskQueueManager } = require('../src/task-queue');
  const qm = new TaskQueueManager({ stateFile: TEST_STATE_FILE });

  const taskDir = path.join(os.tmpdir(), `opc-persist-1-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({ id: 'PERSIST-001', description: '测试任务', type: 'feature', options: { projectRoot: taskDir } });

  await new Promise(resolve => setTimeout(resolve, 100));

  assert(fs.existsSync(TEST_STATE_FILE), '状态文件应被创建');

  const data = JSON.parse(fs.readFileSync(TEST_STATE_FILE, 'utf8'));
  const allTasks = [...(data.queue || []), ...(data.history || [])];
  assert(allTasks.length >= 1, '状态文件中应有任务记录');
  assert(allTasks.some(t => t.id === 'PERSIST-001'), '任务 ID 应匹配');
});

// ========== 场景2：状态恢复 ==========

await testAsync('重新实例化后任务能恢复并继续执行', async () => {
  cleanup();

  const { TaskQueueManager: TQM1 } = require('../src/task-queue');
  const qm1 = new TQM1({ stateFile: TEST_STATE_FILE });

  const taskDir = path.join(os.tmpdir(), `opc-persist-2-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm1.enqueue({ id: 'PERSIST-002', description: '恢复测试', type: 'feature', options: { projectRoot: taskDir } });

  await new Promise(resolve => setTimeout(resolve, 100));

  const stats1 = qm1.getStats();
  assert(stats1.completed >= 1, 'qm1 应已完成 PERSIST-002');

  delete require.cache[require.resolve('../src/task-queue')];

  const { TaskQueueManager: TQM2 } = require('../src/task-queue');
  const qm2 = new TQM2({ stateFile: TEST_STATE_FILE });

  const history = qm2.getHistory();
  const restoredTask = history.find(t => t.id === 'PERSIST-002');
  assert(restoredTask !== undefined, '恢复后历史应包含 PERSIST-002');
  assert(restoredTask.status === 'completed', `恢复后任务状态应为 completed，实际: ${restoredTask.status}`);
});

// ========== 场景3：processing 状态回滚 ==========

await testAsync('processing 任务恢复为 pending', async () => {
  cleanup();

  const stateData = {
    queue: [
      { id: 'ROLLBACK-001', description: '中断任务', type: 'feature', status: 'processing', options: {}, createdAt: Date.now() }
    ],
    stats: { enqueued: 1, completed: 0, failed: 0 }
  };
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(stateData), 'utf8');

  delete require.cache[require.resolve('../src/task-queue')];
  const { TaskQueueManager } = require('../src/task-queue');
  const qm = new TaskQueueManager({ stateFile: TEST_STATE_FILE });

  const task = qm.queue.find(t => t.id === 'ROLLBACK-001');
  assert(task !== undefined, '任务应被恢复');
  assert(task.status === 'pending', `processing 任务应回滚为 pending，实际: ${task.status}`);
  assert(task.startedAt === null, 'startedAt 应被重置');
});

// ========== 场景4：安全写入 ==========

await testAsync('使用 tmp + rename 安全写入', async () => {
  cleanup();

  const { TaskQueueManager } = require('../src/task-queue');
  const qm = new TaskQueueManager({ stateFile: TEST_STATE_FILE });

  const taskDir = path.join(os.tmpdir(), `opc-persist-4-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({ id: 'SAFE-001', description: '安全写入测试', type: 'feature', options: { projectRoot: taskDir } });

  await new Promise(resolve => setTimeout(resolve, 100));

  assert(fs.existsSync(TEST_STATE_FILE), '最终状态文件应存在');
  assert(!fs.existsSync(TEST_STATE_FILE + '.tmp'), '临时文件不应残留');

  const data = JSON.parse(fs.readFileSync(TEST_STATE_FILE, 'utf8'));
  assert(data.savedAt !== undefined, '应有 savedAt 字段');
});

// ========== 场景5：enqueue 原子性 ==========

await testAsync('多次 enqueue 后状态文件包含所有任务', async () => {
  cleanup();

  const { TaskQueueManager } = require('../src/task-queue');
  const qm = new TaskQueueManager({ stateFile: TEST_STATE_FILE });

  const taskDir = path.join(os.tmpdir(), `opc-persist-5-${Date.now()}`);
  fs.mkdirSync(taskDir, { recursive: true });

  qm.enqueue({ id: 'ATOM-001', description: '任务1', type: 'feature', options: { projectRoot: taskDir } });
  qm.enqueue({ id: 'ATOM-002', description: '任务2', type: 'bugfix', options: { projectRoot: taskDir } });
  qm.enqueue({ id: 'ATOM-003', description: '任务3', type: 'refactor', options: { projectRoot: taskDir } });

  await new Promise(resolve => setTimeout(resolve, 100));

  const data = JSON.parse(fs.readFileSync(TEST_STATE_FILE, 'utf8'));
  const historyIds = data.history.map(t => t.id);
  assert(historyIds.includes('ATOM-001'), '历史记录应包含 ATOM-001');
  assert(historyIds.includes('ATOM-002'), '历史记录应包含 ATOM-002');
  assert(historyIds.includes('ATOM-003'), '历史记录应包含 ATOM-003');
});

// 清理
cleanup();

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
}

main();
