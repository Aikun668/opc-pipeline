#!/usr/bin/env node
/**
 * OPC Coder Actor - 静态常驻 Actor
 * 【修复】使用 fs.watch 事件驱动，替代 sleep 轮询
 * 【修复】显式 System Prompt 管理，不依赖数组假设
 */

const fs = require('fs');
const path = require('path');
const { PipeManager } = require('../pipe/pipe-manager');
const { TaskWatcher } = require('../pipe/task-watcher');
const { MemoryManager } = require('../memory/memory-manager');

const PIPE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/pipe';
const MEMORY_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/memory/roles';

class CoderActor {
  constructor() {
    this.pipeManager = new PipeManager();
    this.memoryManager = new MemoryManager();
    this.active = false;
    this.watcher = null;
    this.currentTask = null;
    this.role = 'coder';

    // 【修复】显式 System Prompt，不依赖数组假设
    this.systemPrompt = this.loadSystemPrompt();
  }

  /**
   * 【修复】从外置文件加载 System Prompt
   */
  loadSystemPrompt() {
    const profilePath = path.join(MEMORY_DIR, 'coder-profile.md');
    if (fs.existsSync(profilePath)) {
      return fs.readFileSync(profilePath, 'utf8');
    }
    // 默认 System Prompt
    return `你是专业 Coder，负责写代码、改文件。
约束：
1. 输出必须 < 500 字符
2. 超大内容写入 artifacts 文件
3. 只返回 JSON 格式`;
  }

  /**
   * 【修复】混合策略：轮询 + fs.watch 兜底，兼容 WSL
   */
  async run() {
    this.active = true;
    console.log('[CoderActor] 启动，监听任务...');

    // 使用 TaskWatcher 替代裸 fs.watch
    this.watcher = new TaskWatcher(PIPE_DIR, {
      pollInterval: 3000,
      onTask: (taskId) => {
        console.log(`[CoderActor] 检测到新任务: ${taskId}`);
        this.handleTask(taskId);
      }
    });
    this.watcher.start();

    // 保持进程运行
    while (this.active) {
      await delay(1000);
    }
  }

  /**
   * 处理任务
   */
  async handleTask(taskId) {
    if (this.currentTask) {
      console.log(`[CoderActor] 忙，跳过任务: ${taskId}`);
      return; // 一次只处理一个任务
    }
    
    this.currentTask = taskId;
    
    try {
      // 1. 读取任务（原子信标：ready → processing）
      const input = this.pipeManager.readInputBeacon(taskId);
      if (!input) {
        console.log(`[CoderActor] 任务已被其他 Actor 接走: ${taskId}`);
        this.currentTask = null;
        return;
      }
      
      console.log(`[CoderActor] 开始处理: ${taskId}`);
      
      // 2. 加载项目上下文（【修复】使用绝对路径）
      const projectRoot = input._meta?.projectRoot || process.cwd();
      const contextFiles = (input.contextFiles || []).map(f => 
        path.isAbsolute(f) ? f : path.join(projectRoot, f)
      );
      
      // 3. 执行编码任务（这里会调用 LLM）
      const result = await this.executeCoding(input, contextFiles, projectRoot);
      
      // 4. 写入输出（硬截断 + 验证）
      const writeResult = this.pipeManager.writeOutput(taskId, result);
      if (!writeResult.success) {
        console.error(`[CoderActor] 输出验证失败: ${writeResult.error}`);
        // 重试一次，使用极简输出
        const minimalResult = {
          version: '1.0',
          status: 'error',
          summary: 'Output validation failed',
          nextAction: 'request_fix',
          error: writeResult.error,
          artifacts: {}
        };
        this.pipeManager.writeOutput(taskId, minimalResult);
      }
      
      // 5. 标记完成（processing → done）
      this.pipeManager.completeInputBeacon(taskId);
      
    } catch (error) {
      console.error(`[CoderActor] 任务失败: ${taskId}`, error);
      // 写入错误输出
      this.pipeManager.writeOutput(taskId, {
        version: '1.0',
        status: 'error',
        summary: 'Task execution failed',
        nextAction: 'request_fix',
        error: error.message,
        artifacts: { errorLog: `${PIPE_DIR}/${taskId}/error.log` }
      });
    } finally {
      this.currentTask = null;
    }
  }

  /**
   * 执行编码（调用 LLM）
   * 【优化】集成记忆管理
   */
  async executeCoding(input, contextFiles, projectRoot) {
    // 构建 LLM 请求
    const userMessage = this.buildPrompt(input, contextFiles, projectRoot);

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userMessage }
    ];

    // 【优化】检查是否需要归档
    if (this.memoryManager.shouldArchive(this.role)) {
      await this.archiveAndReset();
    }

    // 记录到记忆管理器
    this.memoryManager.addConversation(this.role, {
      role: 'user',
      content: input.description,
      taskId: input._meta?.taskId
    });

    // 这里调用实际的 LLM（简化示例）
    // const response = await callLLM(messages, { maxTokens: 150 });

    // 模拟返回
    const result = {
      version: '1.0',
      status: 'success',
      summary: `完成编码: ${input.description?.substring(0, 30)}...`,
      artifacts: {
        codePatch: `${PIPE_DIR}/${input._meta?.taskId}/code.patch`
      },
      nextAction: 'request_review'
    };

    // 记录响应
    this.memoryManager.addConversation(this.role, {
      role: 'assistant',
      content: JSON.stringify(result),
      taskId: input._meta?.taskId
    });

    return result;
  }

  /**
   * 构建 Prompt
   * 【修复】使用绝对路径
   */
  buildPrompt(input, contextFiles, projectRoot) {
    return `
任务: ${input.description}
类型: ${input.type || 'feature'}
项目根目录: ${projectRoot}
上下文文件:
${contextFiles.map(f => `- ${f}`).join('\n')}

约束:
1. 输出必须是 JSON，总字符 < 500
2. 代码变更写入 artifacts.codePatch 文件
3. summary 必须 < 100 字
4. nextAction 必须是: request_review | request_test | complete

输出格式:
{
  "version": "1.0",
  "status": "success",
  "summary": "一句话结果",
  "artifacts": { "codePatch": "文件路径" },
  "nextAction": "request_review"
}
`;
  }

  /**
   * 【优化】遗忘刷新机制 - 使用 MemoryManager
   */
  async archiveAndReset(context = {}) {
    console.log('[CoderActor] 执行遗忘刷新...');

    const result = await this.memoryManager.archiveAndReset(this.role, context);

    if (result.archived) {
      console.log(`[CoderActor] 归档成功: ${result.archivePath}`);
      console.log(`[CoderActor] 摘要: ${result.summary.summary}`);
      console.log(`[CoderActor] 保留热缓存: ${result.hotCacheSize} 条`);
    } else {
      console.log('[CoderActor] 归档失败或无需归档');
    }

    return result;
  }

  /**
   * 【废弃】旧的摘要生成方法
   */
  generateSessionSummary() {
    const history = this.memoryManager.getRoleHistory(this.role);
    return `处理了 ${history.length} 条对话`;
  }

  stop() {
    this.active = false;
    if (this.watcher) {
      this.watcher.stop();
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { CoderActor };

// CLI
if (require.main === module) {
  const actor = new CoderActor();
  actor.run().catch(console.error);
  
  process.on('SIGINT', () => {
    console.log('\n[CoderActor] 收到退出信号');
    actor.stop();
    process.exit(0);
  });
}
