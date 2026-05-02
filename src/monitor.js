#!/usr/bin/env node
/**
 * OPC Monitor - 实时监控面板
 * 显示任务状态、角色活动、错误统计、性能指标和 Token 用量
 */

const fs = require('fs');
const path = require('path');
const { CircuitBreakerManager } = require('./circuit-breaker');
const { MemoryManager } = require('../memory/memory-manager');
const { LLMManager } = require('./llm-manager');

const STATE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/state';
const PIPE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/pipe';
const ESCALATION_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/escalations';

class Monitor {
  constructor(llmManager, taskQueue) {
    this.breakerManager = new CircuitBreakerManager();
    this.memoryManager = new MemoryManager();
    this.llmManager = llmManager || null;
    this.taskQueue = taskQueue || null;
    this.refreshInterval = 2000;
    this.running = false;
  }

  start() {
    this.running = true;
    console.log('OPC Pipeline Monitor 启动中...\n');
    this.render();
  }

  stop() {
    this.running = false;
  }

  async render() {
    while (this.running) {
      console.clear();
      const data = await this.collectData();

      this.renderHeader();
      this.renderTaskStatus(data.tasks);
      this.renderCircuitBreakers(data.breakers);
      this.renderMemoryStats(data.memory);
      this.renderTokenStats(data.tokens);
      this.renderQueueStats(data.queue);
      this.renderEscalations(data.escalations);
      this.renderPerformance(data.performance);
      this.renderFooter();

      await sleep(this.refreshInterval);
    }
  }

  async collectData() {
    return {
      tasks: this.getTaskStatus(),
      breakers: this.breakerManager.getAllStatus(),
      memory: this.memoryManager.getStats(),
      tokens: this.llmManager ? this.llmManager.getStats() : null,
      escalations: this.breakerManager.getPendingEscalations(),
      performance: this.getPerformanceMetrics(),
      queue: this.taskQueue ? this.taskQueue.getStats() : null
    };
  }

  getTaskStatus() {
    const tasks = [];
    if (!fs.existsSync(STATE_DIR)) return tasks;

    const files = fs.readdirSync(STATE_DIR);
    files.forEach(file => {
      if (file.startsWith('TASK-') && file.endsWith('.json')) {
        try {
          const filePath = path.join(STATE_DIR, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          tasks.push(data);
        } catch (e) {
          // 忽略损坏的文件
        }
      }
    });

    return tasks.sort((a, b) => b.startTime - a.startTime).slice(0, 10);
  }

  getPerformanceMetrics() {
    const tasks = this.getTaskStatus();
    if (tasks.length === 0) {
      return {
        avgDuration: 0,
        successRate: 0,
        totalTasks: 0
      };
    }

    const completed = tasks.filter(t => t.currentPhase === 'completed');
    const failed = tasks.filter(t => t.currentPhase === 'failed');

    const totalDuration = completed.reduce((sum, t) => {
      return sum + (t.phaseHistory?.reduce((s, p) => s + p.duration, 0) || 0);
    }, 0);

    return {
      avgDuration: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
      successRate: tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0,
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length
    };
  }

  renderHeader() {
    const now = new Date().toLocaleString('zh-CN');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    OPC Pipeline Monitor                       ');
    console.log(`                    ${now}                    `);
    console.log('═══════════════════════════════════════════════════════════════\n');
  }

  renderTaskStatus(tasks) {
    console.log('📋 任务状态 (最近10个)');
    console.log('───────────────────────────────────────────────────────────────');
    if (tasks.length === 0) {
      console.log('  暂无任务\n');
      return;
    }
    tasks.forEach(task => {
      const status = this.getPhaseEmoji(task.currentPhase);
      const duration = this.formatDuration(Date.now() - task.startTime);
      const retries = Object.values(task.retryCount || {}).reduce((a, b) => a + b, 0);
      console.log(`  ${status} ${task.taskId}`);
      console.log(`     阶段: ${task.currentPhase} | 耗时: ${duration} | 重试: ${retries}`);
    });
    console.log('');
  }

  renderCircuitBreakers(breakers) {
    console.log('🔌 熔断器状态');
    console.log('───────────────────────────────────────────────────────────────');
    if (breakers.length === 0) {
      console.log('  暂无熔断器\n');
      return;
    }
    breakers.forEach(breaker => {
      const stateEmoji = this.getBreakerEmoji(breaker.state);
      const failureRate = breaker.failureThreshold > 0
        ? Math.round((breaker.failureCount / breaker.failureThreshold) * 100)
        : 0;
      console.log(`  ${stateEmoji} ${breaker.name}`);
      console.log(`     状态: ${breaker.state} | 失败: ${breaker.failureCount}/${breaker.failureThreshold} (${failureRate}%)`);
      if (breaker.timeSinceLastFailure !== null) {
        console.log(`     上次失败: ${this.formatDuration(breaker.timeSinceLastFailure)}前`);
      }
    });
    console.log('');
  }

  renderMemoryStats(memory) {
    console.log('🧠 记忆统计');
    console.log('───────────────────────────────────────────────────────────────');
    if (!memory.roles || memory.roles.length === 0) {
      console.log('  暂无记忆数据\n');
      return;
    }
    memory.roles.forEach(role => {
      const lastArchive = role.lastArchive
        ? this.formatDuration(Date.now() - role.lastArchive) + '前'
        : '从未';
      console.log(`  👤 ${role.role}`);
      console.log(`     历史: ${role.historyLength} 条 | 上次归档: ${lastArchive}`);
    });
    console.log(`  📦 总归档数: ${memory.totalArchives}\n`);
  }

  /**
   * 新增：Token 用量统计
   */
  renderTokenStats(stats) {
    console.log('💸 Token 用量统计');
    console.log('───────────────────────────────────────────────────────────────');
    if (!stats) {
      console.log('  未启用 LLMManager 统计\n');
      return;
    }
    console.log(`  总调用次数: ${stats.totalCalls}`);
    console.log(`  输入 token: ${stats.totalTokens.input}`);
    console.log(`  输出 token: ${stats.totalTokens.output}`);
    console.log(`  推理 token (R1): ${stats.totalTokens.reasoning || 0}`);
    console.log(`  合计 token: ${stats.totalTokens.input + stats.totalTokens.output + (stats.totalTokens.reasoning || 0)}\n`);
  }

  renderQueueStats(stats) {
    console.log('📥 任务队列状态');
    console.log('───────────────────────────────────────────────────────────────');
    if (!stats) {
      console.log('  未启用任务队列\n');
      return;
    }
    const stateEmoji = stats.running > 0 ? '🟢' : '⚪';
    console.log(`  ${stateEmoji} 状态: ${stats.running > 0 ? '运行中' : '空闲'}`);
    console.log(`  待处理: ${stats.pending} | 执行中: ${stats.running}`);
    console.log(`  已完成: ${stats.completed} | 失败: ${stats.failed}`);
    console.log(`  总入队: ${stats.enqueued}`);

    const inboxDir = path.join(__dirname, '..', 'var', 'queue', 'inbox');
    let inboxCount = 0;
    try {
      if (fs.existsSync(inboxDir)) {
        inboxCount = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json') || f.endsWith('.md')).length;
      }
    } catch (e) {
      inboxCount = 0;
    }
    console.log(`  投递箱: ${inboxCount} 个文件等待处理\n`);
  }

  renderEscalations(escalations) {
    console.log('🚨 待处理升级');
    console.log('───────────────────────────────────────────────────────────────');
    if (escalations.length === 0) {
      console.log('  ✅ 无待处理升级\n');
      return;
    }
    escalations.slice(0, 5).forEach(esc => {
      const timeSince = this.formatDuration(Date.now() - esc.timestamp);
      console.log(`  ⚠️  ${esc.breaker}`);
      console.log(`     ${esc.message}`);
      console.log(`     时间: ${timeSince}前`);
    });
    if (escalations.length > 5) {
      console.log(`  ... 还有 ${escalations.length - 5} 个升级\n`);
    } else {
      console.log('');
    }
  }

  renderPerformance(perf) {
    console.log('📊 性能指标');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  总任务数: ${perf.totalTasks}`);
    console.log(`  已完成: ${perf.completedTasks} | 失败: ${perf.failedTasks}`);
    console.log(`  成功率: ${perf.successRate}%`);
    console.log(`  平均耗时: ${this.formatDuration(perf.avgDuration)}\n`);
  }

  renderFooter() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  按 Ctrl+C 退出监控');
    console.log('═══════════════════════════════════════════════════════════════');
  }

  getPhaseEmoji(phase) {
    const emojis = {
      planning: '📝',
      coding: '💻',
      review: '👀',
      testing: '🧪',
      delivery: '📦',
      completed: '✅',
      failed: '❌'
    };
    return emojis[phase] || '❓';
  }

  getBreakerEmoji(state) {
    const emojis = {
      closed: '🟢',
      open: '🔴',
      half_open: '🟡'
    };
    return emojis[state] || '⚪';
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
  let llmManager = null;
  try {
    llmManager = new LLMManager(path.join(__dirname, 'config', 'models.json'));
  } catch (e) {
    // 配置文件或 API key 缺失时，静默降级
  }

  let taskQueue = null;
  try {
    const { TaskQueueManager } = require('./task-queue');
    taskQueue = new TaskQueueManager();
  } catch (e) {
  }

  const monitor = new Monitor(llmManager, taskQueue);

  process.on('SIGINT', () => {
    console.log('\n\n正在退出监控...');
    monitor.stop();
    process.exit(0);
  });

  monitor.start();
}

module.exports = { Monitor };
