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

const TEST_DIR = path.join(os.tmpdir(), `opc-watcher-${Date.now()}`);
const INBOX = path.join(TEST_DIR, 'inbox');
const PROCESSED = path.join(TEST_DIR, 'processed');
const REJECTED = path.join(TEST_DIR, 'rejected');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function setupDirs() {
  cleanup();
  fs.mkdirSync(INBOX, { recursive: true });
  fs.mkdirSync(PROCESSED, { recursive: true });
  fs.mkdirSync(REJECTED, { recursive: true });
}

async function main() {

setupDirs();

const { TaskQueueManager } = require('../src/task-queue');
const { QueueWatcher } = require('../src/queue-watcher');

const taskQueue = new TaskQueueManager({ stateFile: path.join(TEST_DIR, 'state.json') });

await testAsync('JSON 文件被解析并入队', async () => {
  const watcher = new QueueWatcher({
    inboxDir: INBOX,
    processedDir: PROCESSED,
    rejectedDir: REJECTED,
    interval: 100,
    taskQueue
  });

  fs.writeFileSync(path.join(INBOX, 'task-001.json'), JSON.stringify({
    id: 'DROP-001',
    type: 'feature',
    description: '从 JSON 投递的任务'
  }), 'utf8');

  watcher.start();
  await new Promise(resolve => setTimeout(resolve, 300));
  watcher.stop();

  const status = taskQueue.getQueueStatus();
  assert(status.some(t => t.id === 'DROP-001'), '队列应包含 DROP-001');
  assert(!fs.existsSync(path.join(INBOX, 'task-001.json')), '原文件应从 inbox 移除');
  assert(fs.existsSync(path.join(PROCESSED, 'task-001.json')), '文件应移动到 processed');
});

await testAsync('Markdown 文件被解析并入队', async () => {
  const watcher = new QueueWatcher({
    inboxDir: INBOX,
    processedDir: PROCESSED,
    rejectedDir: REJECTED,
    interval: 100,
    taskQueue
  });

  fs.writeFileSync(path.join(INBOX, 'task-002.md'), '# 实现用户登录功能\n\n这是详细描述。', 'utf8');

  watcher.start();
  await new Promise(resolve => setTimeout(resolve, 300));
  watcher.stop();

  const status = taskQueue.getQueueStatus();
  assert(status.some(t => t.description === '实现用户登录功能'), '队列应包含 Markdown 任务');
  assert(fs.existsSync(path.join(PROCESSED, 'task-002.md')), 'MD 文件应移动到 processed');
});

await testAsync('无效文件被移入 rejected', async () => {
  const watcher = new QueueWatcher({
    inboxDir: INBOX,
    processedDir: PROCESSED,
    rejectedDir: REJECTED,
    interval: 100,
    taskQueue
  });

  fs.writeFileSync(path.join(INBOX, 'bad.json'), '这不是有效 JSON', 'utf8');

  watcher.start();
  await new Promise(resolve => setTimeout(resolve, 300));
  watcher.stop();

  assert(!fs.existsSync(path.join(INBOX, 'bad.json')), '无效文件应从 inbox 移除');
  assert(fs.existsSync(path.join(REJECTED, 'bad.json')), '无效文件应移动到 rejected');
});

await testAsync('空描述 Markdown 被 reject', async () => {
  const watcher = new QueueWatcher({
    inboxDir: INBOX,
    processedDir: PROCESSED,
    rejectedDir: REJECTED,
    interval: 100,
    taskQueue
  });

  fs.writeFileSync(path.join(INBOX, 'empty.md'), '\n\n   \n', 'utf8');

  watcher.start();
  await new Promise(resolve => setTimeout(resolve, 300));
  watcher.stop();

  assert(fs.existsSync(path.join(REJECTED, 'empty.md')), '空 MD 应移动到 rejected');
});

await testAsync('轮询多次发现新文件', async () => {
  const watcher = new QueueWatcher({
    inboxDir: INBOX,
    processedDir: PROCESSED,
    rejectedDir: REJECTED,
    interval: 100,
    taskQueue
  });

  watcher.start();

  fs.writeFileSync(path.join(INBOX, 'multi-1.json'), JSON.stringify({ id: 'M001', description: '任务1' }), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 300));

  fs.writeFileSync(path.join(INBOX, 'multi-2.json'), JSON.stringify({ id: 'M002', description: '任务2' }), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 300));

  watcher.stop();

  const status = taskQueue.getQueueStatus();
  assert(status.some(t => t.id === 'M001'), '应发现 multi-1');
  assert(status.some(t => t.id === 'M002'), '应发现 multi-2');
});

cleanup();

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
}

main();
