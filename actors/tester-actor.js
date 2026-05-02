#!/usr/bin/env node
/**
 * OPC Tester Actor - 测试执行 Actor
 * 【修复】硬检查 EXIT_CODE，不依赖 AI 解读
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PipeManager } = require('../pipe/pipe-manager');
const { TaskWatcher } = require('../pipe/task-watcher');

const PIPE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/pipe';
const MEMORY_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/memory/roles';

class TesterActor {
  constructor() {
    this.pipeManager = new PipeManager();
    this.active = false;
    this.watcher = null;
    this.currentTask = null;
    this.systemPrompt = this.loadSystemPrompt();
  }

  loadSystemPrompt() {
    const profilePath = path.join(MEMORY_DIR, 'tester-profile.md');
    if (fs.existsSync(profilePath)) {
      return fs.readFileSync(profilePath, 'utf8');
    }
    return `你是测试专家，执行测试并报告结果。
约束：
1. 只认 EXIT_CODE，不认 AI 解读
2. 覆盖率必须 >= 80%
3. 输出 JSON < 500 字符`;
  }

  async run() {
    this.active = true;
    console.log('[TesterActor] 启动...');

    // 【修复】使用 TaskWatcher 替代 fs.watch，兼容 WSL
    this.watcher = new TaskWatcher(PIPE_DIR, {
      pollInterval: 3000,
      onTask: (taskId) => this.handleTask(taskId),
      // Tester 只关心 test 类型的任务
      filter: (input) => input.type === 'test'
    });
    this.watcher.start();

    while (this.active) await sleep(1000);
  }

  async handleTask(taskId) {
    if (this.currentTask) return;
    
    const input = this.pipeManager.readInputBeacon(taskId);
    if (!input || input.type !== 'test') {
      this.currentTask = null;
      return;
    }
    
    this.currentTask = taskId;
    
    try {
      console.log(`[TesterActor] 测试: ${taskId}`);
      
      const projectRoot = input._meta?.projectRoot || process.cwd();
      const result = await this.executeTests(projectRoot, taskId);
      
      this.pipeManager.writeOutput(taskId, result);
      this.pipeManager.completeInputBeacon(taskId);
      
    } catch (error) {
      this.pipeManager.writeOutput(taskId, {
        version: '1.0',
        status: 'error',
        summary: 'Test execution failed',
        nextAction: 'request_fix',
        error: error.message
      });
    } finally {
      this.currentTask = null;
    }
  }

  /**
   * 【修复】硬检查 EXIT_CODE，不依赖 AI 解读
   */
  async executeTests(projectRoot, taskId) {
    const pipeDir = this.pipeManager.getTaskPipe(taskId);
    
    let testExit = 0;
    let coverage = 0;
    let errorOutput = '';
    
    try {
      // 1. 运行测试（捕获 EXIT_CODE）
      const output = execSync('npm test 2>&1', { 
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 120000
      });
      testExit = 0;
    } catch (e) {
      testExit = e.status || 1;
      errorOutput = e.stdout || e.message;
    }
    
    // 2. 提取覆盖率（正则匹配，不依赖 AI，跨平台兼容）
    try {
      const coverageHtml = fs.readFileSync(path.join(projectRoot, 'coverage/lcov-report/index.html'), 'utf8');
      const match = coverageHtml.match(/>(\d+)%/);
      coverage = match ? parseInt(match[1]) : 0;
    } catch (e) {
      coverage = 0;
    }
    
    // 3. 写入详细报告到 artifact
    const reportPath = `${pipeDir}/test-report.json`;
    fs.writeFileSync(reportPath, JSON.stringify({
      exitCode: testExit,
      coverage: coverage,
      error: errorOutput,
      timestamp: Date.now()
    }));
    
    // 4. 【修复】基于硬数据判断，不依赖 AI 解读
    const passed = testExit === 0 && coverage >= 80;
    
    return {
      version: '1.0',
      status: passed ? 'success' : 'fail',
      summary: passed 
        ? `测试通过，覆盖率 ${coverage}%` 
        : `测试失败: exit=${testExit}, coverage=${coverage}%`,
      artifacts: {
        testReport: reportPath
      },
      metrics: {
        testExitCode: testExit,
        coverage: coverage
      },
      nextAction: passed ? 'complete' : 'request_fix',
      error: passed ? null : `Test failed with exit code ${testExit}`
    };
  }

  stop() {
    this.active = false;
    if (this.watcher) this.watcher.stop();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { TesterActor };

if (require.main === module) {
  const actor = new TesterActor();
  actor.run().catch(console.error);
  process.on('SIGINT', () => { actor.stop(); process.exit(0); });
}
