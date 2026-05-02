#!/usr/bin/env node
/**
 * OPC Reviewer Actor - 代码审查 Actor
 * 【修复】fs.watch 事件驱动
 * 【修复】显式 System Prompt
 */

const fs = require('fs');
const path = require('path');
const { PipeManager } = require('../pipe/pipe-manager');
const { TaskWatcher } = require('../pipe/task-watcher');

const PIPE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/pipe';
const MEMORY_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/memory/roles';

class ReviewerActor {
  constructor() {
    this.pipeManager = new PipeManager();
    this.active = false;
    this.watcher = null;
    this.currentTask = null;
    this.systemPrompt = this.loadSystemPrompt();
    this.conversationHistory = [];
  }

  loadSystemPrompt() {
    const profilePath = path.join(MEMORY_DIR, 'reviewer-profile.md');
    if (fs.existsSync(profilePath)) {
      return fs.readFileSync(profilePath, 'utf8');
    }
    return `你是严格的代码审查员，专注安全、风格、性能。
约束：
1. 基于 Git Diff 审查
2. 输出必须 < 500 字符
3. 禁止互相吹捧，必须找出问题`;
  }

  async run() {
    this.active = true;
    console.log('[ReviewerActor] 启动...');

    // 【修复】使用 TaskWatcher 替代 fs.watch，兼容 WSL
    this.watcher = new TaskWatcher(PIPE_DIR, {
      pollInterval: 3000,
      onTask: (taskId) => this.handleTask(taskId),
      // Reviewer 只关心 review 类型的任务
      filter: (input) => input.type === 'review'
    });
    this.watcher.start();

    while (this.active) {
      await sleep(1000);
    }
  }

  async handleTask(taskId) {
    if (this.currentTask) return;
    
    const input = this.pipeManager.readInputBeacon(taskId);
    if (!input || input.type !== 'review') {
      this.currentTask = null;
      return;
    }
    
    this.currentTask = taskId;
    
    try {
      console.log(`[ReviewerActor] 审查: ${taskId}`);
      
      // 读取 code.patch
      const patchPath = input.artifacts?.codePatch;
      const patchContent = patchPath ? this.pipeManager.readArtifact(taskId, 'code.patch') : null;
      
      // 执行审查
      const result = await this.executeReview(input, patchContent);
      
      this.pipeManager.writeOutput(taskId, result);
      this.pipeManager.completeInputBeacon(taskId);
      
    } catch (error) {
      console.error(`[ReviewerActor] 失败: ${taskId}`, error);
      this.pipeManager.writeOutput(taskId, {
        version: '1.0',
        status: 'error',
        summary: 'Review failed',
        nextAction: 'request_fix',
        error: error.message
      });
    } finally {
      this.currentTask = null;
    }
  }

  async executeReview(input, patchContent) {
    // 【修复】基于 Git Diff 审查，不是完整文件
    const reviewPrompt = `
审查以下代码变更：
${patchContent?.substring(0, 2000) || 'No patch provided'}

约束：
1. 找出所有安全、性能、风格问题
2. 输出 JSON，字符 < 500
3. 有严重问题则 status: fail
4. 通过则 status: success

输出格式:
{
  "version": "1.0",
  "status": "success|fail",
  "summary": "审查结论",
  "artifacts": { "reviewReport": "路径" },
  "nextAction": "request_fix|request_test"
}`;

    // 模拟 LLM 调用
    return {
      version: '1.0',
      status: 'success',
      summary: '代码审查通过，无严重问题',
      artifacts: {
        reviewReport: `${PIPE_DIR}/${input._meta?.taskId}/review-report.md`
      },
      nextAction: 'request_test'
    };
  }

  async archiveAndReset() {
    console.log('[ReviewerActor] 遗忘刷新...');
    const archivePath = path.join(MEMORY_DIR, 'reviewer-history.md');
    fs.appendFileSync(archivePath, `\n## ${new Date().toISOString()}\n审查了 ${this.conversationHistory.length} 个任务\n`);
    this.conversationHistory = [];
  }

  stop() {
    this.active = false;
    if (this.watcher) this.watcher.stop();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ReviewerActor };

if (require.main === module) {
  const actor = new ReviewerActor();
  actor.run().catch(console.error);
  process.on('SIGINT', () => { actor.stop(); process.exit(0); });
}
