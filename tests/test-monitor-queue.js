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

const TEST_DIR = path.join(os.tmpdir(), `opc-monitor-${Date.now()}`);

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

async function main() {

cleanup();
fs.mkdirSync(TEST_DIR, { recursive: true });

const { Monitor } = require('../src/monitor');
const { TaskQueueManager } = require('../src/task-queue');

await testAsync('Monitor 接收 taskQueue 后 collectData 正常', async () => {
  const taskQueue = new TaskQueueManager({ stateFile: path.join(TEST_DIR, 'state.json') });
  const monitor = new Monitor(null, taskQueue);

  const data = await monitor.collectData();

  assert(data.queue !== undefined, 'data.queue 应存在');
  assert(data.queue !== null, 'data.queue 不应为 null');
  assert(data.queue.enqueued !== undefined, 'data.queue.enqueued 应存在');
  assert(data.queue.pending !== undefined, 'data.queue.pending 应存在');
  assert(data.queue.running !== undefined, 'data.queue.running 应存在');
  assert(data.queue.completed !== undefined, 'data.queue.completed 应存在');
  assert(data.queue.failed !== undefined, 'data.queue.failed 应存在');
});

await testAsync('Monitor 未传 taskQueue 时 queue 为 null', async () => {
  const monitor = new Monitor();

  const data = await monitor.collectData();

  assert(data.queue === null, '未传 taskQueue 时 data.queue 应为 null');
});

await testAsync('Monitor 向后兼容（只传 llmManager）', async () => {
  const monitor = new Monitor(null);

  const data = await monitor.collectData();

  assert(data.queue === null, '只传 llmManager 时 data.queue 应为 null');
  assert(data.tokens === null, 'data.tokens 应为 null');
});

await testAsync('renderQueueStats 不报错', async () => {
  const taskQueue = new TaskQueueManager({ stateFile: path.join(TEST_DIR, 'state2.json') });
  const monitor = new Monitor(null, taskQueue);

  const data = await monitor.collectData();

  monitor.renderQueueStats(data.queue);
});

await testAsync('renderQueueStats 显示 inbox 文件数', async () => {
  const inboxDir = path.join(TEST_DIR, 'inbox');
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(path.join(inboxDir, 'test.json'), '{"id":"T1","description":"test"}', 'utf8');
  fs.writeFileSync(path.join(inboxDir, 'test.md'), '# Test', 'utf8');

  const taskQueue = new TaskQueueManager({ stateFile: path.join(TEST_DIR, 'state3.json') });
  const monitor = new Monitor(null, taskQueue);

  const data = await monitor.collectData();

  assert(data.queue !== null, 'queue 不应为 null');
});

cleanup();

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
}

main();
