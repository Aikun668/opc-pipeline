/**
 * Task Watcher - 跨平台任务监听器
 *
 * 为什么不直接用 fs.watch：
 * 1. fs.watch({ recursive: true }) 在 Linux/WSL 下不可靠
 * 2. WSL 跨文件系统时 inotify 事件经常丢失
 * 3. 不同平台行为不一致（macOS FSEvents, Linux inotify, Windows RDCW）
 *
 * 解决方案：混合策略
 * - 主要靠轮询（polling）扫描目录，保证跨平台可靠
 * - 轮询间隔可配置（默认 3 秒，足够快且不浪费 CPU）
 * - 如果 fs.watch 可用就额外监听，收到事件时立即触发一次扫描
 *   （加速响应，但不依赖它）
 */

const fs = require('fs');
const path = require('path');

class TaskWatcher {
  /**
   * @param {string} pipeDir - 监听的管道目录
   * @param {Object} options
   * @param {number} options.pollInterval - 轮询间隔（毫秒），默认 3000
   * @param {Function} options.onTask - 发现新任务的回调 (taskId) => void
   * @param {Function} options.filter - 可选的过滤函数 (inputData) => boolean
   */
  constructor(pipeDir, options = {}) {
    this.pipeDir = pipeDir;
    this.pollInterval = options.pollInterval || 3000;
    this.onTask = options.onTask || (() => {});
    this.filter = options.filter || null;
    this.active = false;
    this.watcher = null;
    this.pollTimer = null;
    this.knownReady = new Set(); // 已经通知过的 ready 文件，防止重复触发
  }

  /**
   * 启动监听
   */
  start() {
    this.active = true;

    // 1. 启动轮询（核心机制，保证可靠）
    this.startPolling();

    // 2. 尝试启动 fs.watch（加速响应，失败不影响）
    this.tryStartFsWatch();

    console.log(`[TaskWatcher] 启动, 轮询间隔: ${this.pollInterval}ms, 目录: ${this.pipeDir}`);
  }

  /**
   * 停止监听
   */
  stop() {
    this.active = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    console.log('[TaskWatcher] 已停止');
  }

  /**
   * 轮询扫描：定期检查目录下的 input.json.ready 文件
   */
  startPolling() {
    // 立即扫一次
    this.scan();

    // 定时扫描
    this.pollTimer = setInterval(() => {
      if (this.active) {
        this.scan();
      }
    }, this.pollInterval);
  }

  /**
   * 扫描 pipe 目录，找出所有有 input.json.ready 的任务
   */
  scan() {
    if (!fs.existsSync(this.pipeDir)) return;

    try {
      const entries = fs.readdirSync(this.pipeDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const taskId = entry.name;
        const readyPath = path.join(this.pipeDir, taskId, 'input.json.ready');

        if (fs.existsSync(readyPath) && !this.knownReady.has(taskId)) {
          this.knownReady.add(taskId);

          // 如果有过滤器，先读内容判断
          if (this.filter) {
            try {
              const content = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
              if (!this.filter(content)) continue;
            } catch (e) {
              continue; // 文件读取失败，跳过
            }
          }

          this.onTask(taskId);
        }
      }

      // 清理已处理的 knownReady（ready 文件已不存在的）
      for (const taskId of this.knownReady) {
        const readyPath = path.join(this.pipeDir, taskId, 'input.json.ready');
        if (!fs.existsSync(readyPath)) {
          this.knownReady.delete(taskId);
        }
      }

    } catch (e) {
      // 目录读取失败（可能是瞬态错误），静默跳过
    }
  }

  /**
   * 尝试启动 fs.watch 加速（非必须，失败不影响轮询）
   */
  tryStartFsWatch() {
    try {
      this.watcher = fs.watch(this.pipeDir, { recursive: true }, (eventType, filename) => {
        // 收到事件时立即触发一次扫描（加速响应）
        if (filename && filename.endsWith('input.json.ready')) {
          this.scan();
        }
      });

      this.watcher.on('error', (err) => {
        // fs.watch 出错不影响轮询，只打个日志
        console.log(`[TaskWatcher] fs.watch 出错 (不影响轮询): ${err.message}`);
        this.watcher = null;
      });

    } catch (e) {
      // fs.watch 不可用（比如 WSL 某些场景），完全依赖轮询
      console.log(`[TaskWatcher] fs.watch 不可用，完全依赖轮询: ${e.message}`);
      this.watcher = null;
    }
  }
}

module.exports = { TaskWatcher };
