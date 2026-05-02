#!/usr/bin/env node
/**
 * OPC Supervisor - Actor 守护进程
 * 【修复】Actor 崩溃无自愈机制：通过这个管理器监控并自动重启所有常驻 Actor
 */

const { spawn } = require('child_process');
const path = require('path');

const ACTORS_DIR = path.join(__dirname, 'actors');

// 需要守护的 Actor 列表
const ACTORS = [
  { name: 'Coder', script: 'coder-actor.js' },
  { name: 'Reviewer', script: 'reviewer-actor.js' },
  { name: 'Tester', script: 'tester-actor.js' }
];

class Supervisor {
  constructor() {
    this.processes = new Map();
    this.active = true;

    // 重启控制配置
    this.restartPolicy = {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      maxRetries: 10,
      resetWindowMs: 60000 // 如果稳定运行超过 1 分钟，重置重试计数
    };

    this.restartState = new Map();
  }

  startAll() {
    console.log('[Supervisor] 启动所有 Actor...');
    for (const actor of ACTORS) {
      this.restartState.set(actor.name, { count: 0, lastRestart: 0 });
      this.spawnActor(actor);
    }
  }

  spawnActor(actor) {
    if (!this.active) return;

    const scriptPath = path.join(ACTORS_DIR, actor.script);
    console.log(`[Supervisor] 正在拉起 ${actor.name} (${actor.script})`);

    const p = spawn('node', [scriptPath], {
      stdio: 'inherit', // 继承标准输出/错误，方便集中查看日志
      env: process.env
    });

    this.processes.set(actor.name, p);

    // 监听退出事件
    p.on('exit', (code, signal) => {
      this.processes.delete(actor.name);

      if (!this.active) {
        console.log(`[Supervisor] ${actor.name} 正常停止`);
        return;
      }

      console.warn(`[Supervisor] ⚠️ ${actor.name} 退出了! Code: ${code}, Signal: ${signal}`);
      this.handleCrash(actor);
    });

    p.on('error', (err) => {
      console.error(`[Supervisor] ❌ ${actor.name} 进程错误:`, err);
    });
  }

  handleCrash(actor) {
    const state = this.restartState.get(actor.name);
    const now = Date.now();

    // 如果距离上次重启已经过了一段稳定时间，重置计数器
    if (now - state.lastRestart > this.restartPolicy.resetWindowMs) {
      state.count = 0;
    }

    if (state.count >= this.restartPolicy.maxRetries) {
      console.error(`[Supervisor] 🚨 ${actor.name} 崩溃过于频繁，已达到最大重试次数 (${this.restartPolicy.maxRetries})。放弃重启。`);
      return;
    }

    // 指数退避计算延迟
    const delay = Math.min(
      this.restartPolicy.maxDelayMs,
      this.restartPolicy.baseDelayMs * Math.pow(2, state.count)
    );

    state.count++;
    state.lastRestart = now;

    console.log(`[Supervisor] 将在 ${delay}ms 后尝试重启 ${actor.name} (第 ${state.count} 次重试)...`);

    setTimeout(() => {
      this.spawnActor(actor);
    }, delay);
  }

  stopAll() {
    console.log('[Supervisor] 正在停止所有 Actor...');
    this.active = false;

    for (const [name, p] of this.processes.entries()) {
      console.log(`[Supervisor] 发送 SIGINT 给 ${name}`);
      p.kill('SIGINT');

      // 兜底强制杀进程
      setTimeout(() => {
        try {
          if (!p.killed) {
            console.log(`[Supervisor] 强制杀死 ${name}`);
            p.kill('SIGKILL');
          }
        } catch (e) {
          // 忽略已退出的错误
        }
      }, 5000);
    }
  }
}

// CLI
if (require.main === module) {
  const supervisor = new Supervisor();
  supervisor.startAll();

  // 优雅退出
  const shutdown = () => {
    console.log('\n[Supervisor] 收到退出信号');
    supervisor.stopAll();
    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { Supervisor };
