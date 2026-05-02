#!/usr/bin/env node
/**
 * OPC Pipeline 修复验证测试
 * 验证所有基础修复和 LLM API 集成
 */

const fs = require('fs');
const path = require('path');
const { PipeManager } = require('../pipe/pipe-manager');

const TEST_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline';
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

async function runTests() {
  console.log('================================');
  console.log('OPC Pipeline 修复验证测试');
  console.log('================================\n');

  // 测试 1: 持久化目录（非 /tmp）
  test('修复1: 管道目录在持久化位置（非 /tmp）', () => {
const { PipeManager } = require('../pipe/pipe-manager');
    const pm = new PipeManager();
    const pipeDir = pm.getTaskPipe('TEST-001');
    const normalizedPath = pipeDir.replace(/\\/g, '/');
    assert(normalizedPath.includes('opc-pipeline/var/pipe'), '目录应在 opc-pipeline/var/pipe');
    assert(!pipeDir.startsWith('/tmp'), '目录不应在 /tmp');
  });

  // 测试 2: 原子信标机制
  test('修复2: 原子信标机制（tmp → ready → processing → done）', () => {
    const pm = new PipeManager();
    const taskId = `TEST-BEACON-${Date.now()}`;

    pm.createTaskPipe(taskId);
    pm.writeInputBeacon(taskId, { description: 'test', projectRoot: '/test' });
    const readyPath = path.join(pm.getTaskPipe(taskId), 'input.json.ready');
    assert(fs.existsSync(readyPath), '应创建 input.json.ready');

    const input = pm.readInputBeacon(taskId);
    assert(input !== null, '应读取到输入');
    assert(!fs.existsSync(readyPath), 'ready 文件应被移除');
    const processingPath = path.join(pm.getTaskPipe(taskId), 'input.json.processing');
    assert(fs.existsSync(processingPath), '应创建 input.json.processing');

    pm.completeInputBeacon(taskId);
    const donePath = path.join(pm.getTaskPipe(taskId), 'input.json.done');
    assert(fs.existsSync(donePath), '应创建 input.json.done');

    pm.cleanupTaskPipe(taskId);
  });

  // 测试 3: 硬截断机制
  test('修复3: 代码层硬截断（不依赖 LLM 自律）', () => {
    const pm = new PipeManager();

    const longOutput = {
      version: '1.0',
      status: 'success',
      summary: 'A'.repeat(200),
      nextAction: 'complete'
    };

    const truncated = pm.hardTruncate(longOutput);
    assert(truncated.summary.length <= 100, 'summary 应被截断到 <= 100');

    const hugeOutput = {
      version: '1.0',
      status: 'success',
      summary: '正常摘要',
      extra: 'X'.repeat(1000),
      nextAction: 'complete'
    };

    const minimal = pm.hardTruncate(hugeOutput);
    const compact = JSON.stringify(minimal);
    assert(compact.length <= 500, `总长度应 <= 500，实际 ${compact.length}`);
  });

  // 测试 4: 模板字符串插值
  test('修复4: 模板字符串正确使用 ${taskId} 插值', () => {
    const orchestratorPath = path.join(TEST_DIR, 'orchestrator.js');
    const content = fs.readFileSync(orchestratorPath, 'utf8');

    assert(content.includes('${taskId}'), '应使用 ${taskId} 插值');
    assert(!content.match(/[^$]\{taskId\}/), '不应有未插值的 {taskId}');
  });

  // 测试 5: 绝对路径传递
  test('修复5: 落盘协议包含绝对路径 projectRoot', () => {
    const pm = new PipeManager();
    const taskId = `TEST-PATH-${Date.now()}`;

    pm.createTaskPipe(taskId);
    pm.writeInputBeacon(taskId, {
      description: 'test',
      projectRoot: '/absolute/path/to/project',
      contextFiles: ['src/auth.ts']
    });

    const input = pm.readInputBeacon(taskId);
    assert(input._meta.projectRoot === '/absolute/path/to/project', '应包含绝对路径');
    assert(path.isAbsolute(input._meta.projectRoot), 'projectRoot 应是绝对路径');

    pm.cleanupTaskPipe(taskId);
  });

  // 测试 6: 显式 System Prompt 管理
  test('修复6: Actor 显式加载 System Prompt（不依赖数组）', () => {
    const coderPath = path.join(TEST_DIR, 'actors/coder-actor.js');
    const content = fs.readFileSync(coderPath, 'utf8');

    assert(content.includes('loadSystemPrompt'), '应有 loadSystemPrompt 方法');
    assert(content.includes('this.systemPrompt'), '应有显式 systemPrompt 属性');
    assert(!content.includes('slice(0, 1)'), '不应使用 slice(0, 1) 假设');
  });

  // 测试 7: 星型拓扑（主控统一调度）
  test('修复7: Spawn Worker 由主控统一调度', () => {
    const orchPath = path.join(TEST_DIR, 'orchestrator.js');
    const content = fs.readFileSync(orchPath, 'utf8');

    assert(content.includes('spawnWorker'), '主控应有 spawnWorker 方法');
    assert(content.includes('spawn_crawler'), '应支持 spawn_crawler 指令');

    const coderPath = path.join(TEST_DIR, 'actors/coder-actor.js');
    const coderContent = fs.readFileSync(coderPath, 'utf8');
    assert(!coderContent.includes('sessions_spawn'), 'Coder 不应直接调用 sessions_spawn');
  });

  // 测试 8: 事件驱动监听（已演进为 TaskWatcher）
  test('修复8: 使用 TaskWatcher 替代 sleep 轮询', () => {
    const coderPath = path.join(TEST_DIR, 'actors/coder-actor.js');
    const content = fs.readFileSync(coderPath, 'utf8');

    assert(content.includes('TaskWatcher'), '应使用 TaskWatcher');
    assert(!content.match(/sleep\s*\(\s*\d+\s*\)/), '不应有裸 sleep 轮询');
  });

  // 测试 9: 角色记忆文件存在
  test('额外: 角色记忆文件已创建', () => {
    const roles = ['coder', 'reviewer', 'tester'];
    for (const role of roles) {
      const profilePath = path.join(TEST_DIR, `memory/roles/${role}-profile.md`);
      assert(fs.existsSync(profilePath), `${role}-profile.md 应存在`);
    }
  });

  // 测试 10: LLMManager 初始化
  await testAsync('测试10: LLMManager 初始化，缺少 API Key 报错正确', async () => {
    const { LLMManager } = require('../src/llm-manager');
    const manager = new LLMManager('./config/models.json');

    try {
      manager.getClient('planning');
      assert(false, '应该抛出错误');
    } catch (e) {
      assert(
        e.message.includes('Missing environment variable'),
        `应该是 Missing env 错误，实际: ${e.message}`
      );
    }
  });

  // 测试 11: extractJSON 容错
  await testAsync('测试11: extractJSON 三种格式容错正确', async () => {
    const { Orchestrator } = require('../src/orchestrator');
    const orchestrator = new Orchestrator();

    const cases = [
      ['{"status":"success"}', { status: 'success' }],
      ['```json\n{"status":"success"}\n```', { status: 'success' }],
      ['some text {"status":"success"} more text', { status: 'success' }],
    ];

    for (const [input, expected] of cases) {
      const result = orchestrator.extractJSON(input);
      assert(result.status === expected.status, `extractJSON 失败: ${input}`);
    }
  });

  // 测试 12: Mock 模式下完整工作流（6阶段）
  await testAsync('测试12: Mock 模式 6 阶段工作流完成', async () => {
    process.env.OPC_SPAWN_MODE = 'mock';
    // 清理 require 缓存，确保读取到新的 spawn-adapter 配置
    delete require.cache[require.resolve('../src/spawn-adapter')];
    delete require.cache[require.resolve('./orchestrator')];
    const { Orchestrator } = require('../src/orchestrator');
    const orchestrator = new Orchestrator();

    const taskId = `TASK-TEST-${Date.now()}`;
    orchestrator.createTask(taskId, 'feature', '测试任务', {
      projectRoot: process.cwd()
    });

    const result = await orchestrator.runWorkflow(taskId);

    assert(result !== null, '工作流应该有返回值');
    assert(result.finalPhase === 'completed', `工作流应到达 completed，实际: ${result.finalPhase}`);
    console.log(`    最终阶段: ${result.finalPhase}`);
  });

  // 测试 13: peekInputBeacon 异常捕获（非法 JSON 信标）
  test('测试13: peekInputBeacon 非法 JSON 信标返回 null', () => {
    const pm = new PipeManager();
    const taskId = `TEST-BADJSON-${Date.now()}`;

    pm.createTaskPipe(taskId);
    const pipeDir = pm.getTaskPipe(taskId);
    const readyPath = path.join(pipeDir, 'input.json.ready');

    fs.writeFileSync(readyPath, '{这不是合法JSON!!!');

    const result = pm.peekInputBeacon(taskId);
    assert(result === null, `peekInputBeacon 应返回 null，实际: ${result}`);

    pm.cleanupTaskPipe(taskId);
  });

  // 测试 14: getCodeDiff 降级策略（非 git 目录）
  test('测试14: getCodeDiff 非 Git 目录返回降级提示', () => {
    const { Orchestrator } = require('../src/orchestrator');
    const orchestrator = new Orchestrator();

    const tmpDir = path.join(require('os').tmpdir(), `opc-nogit-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const taskId = `TEST-DIFF-${Date.now()}`;
    orchestrator.createTask(taskId, 'feature', 'diff test', {
      projectRoot: tmpDir
    });

    const diff = orchestrator.getCodeDiff(taskId, tmpDir);
    assert(
      diff === '项目未初始化 Git 或无基础快照，无法生成标准 Diff',
      `应返回降级提示，实际: ${diff}`
    );

    orchestrator.pipeManager.cleanupTaskPipe(taskId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  console.log('\n================================');
  console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
  console.log('================================');

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
