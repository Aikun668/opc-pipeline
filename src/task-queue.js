const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_STATE_FILE = path.join(__dirname, '..', 'var', 'queue', 'state.json');

class TaskQueueManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 1;
    this.stateFile = options.stateFile || DEFAULT_STATE_FILE;
    this.processing = false;
    this.runningCount = 0;
    this.stats = { enqueued: 0, completed: 0, failed: 0 };

    this._ensureDir();
    const restored = this._loadState();
    this.queue = restored.queue;
    this.history = restored.history || [];
    this.stats = { ...this.stats, ...restored.stats };

    if (this.queue.length > 0) {
      setImmediate(() => this._processQueue());
    }
  }

  _ensureDir() {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _loadState() {
    if (!fs.existsSync(this.stateFile)) {
      return { queue: [], stats: {} };
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const queue = (data.queue || []).map(t => {
        if (t.status === 'processing') {
          t.status = 'pending';
          t.startedAt = null;
        }
        return t;
      });
      return { queue, history: data.history || [], stats: data.stats || {} };
    } catch (e) {
      console.error('[TaskQueue] 加载状态失败:', e.message);
      return { queue: [], stats: {} };
    }
  }

  _saveState() {
    const data = {
      queue: this.queue,
      history: this.history,
      stats: this.stats,
      savedAt: new Date().toISOString()
    };
    const tmpFile = this.stateFile + '.tmp';
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.stateFile);
    } catch (e) {
      console.error('[TaskQueue] 保存状态失败:', e.message);
    }
  }

  enqueue(task) {
    const taskWrapper = {
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: task.description || '',
      type: task.type || 'feature',
      options: task.options || {},
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null
    };

    this.queue.push(taskWrapper);
    this.stats.enqueued++;
    this._saveState();
    this.emit('enqueued', taskWrapper);
    this._processQueue();

    return taskWrapper.id;
  }

  async _processQueue() {
    if (this.processing || this.queue.length === 0 || this.runningCount >= this.concurrency) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.runningCount < this.concurrency) {
      const task = this.queue.shift();
      if (task.status !== 'pending') continue;

      task.status = 'processing';
      task.startedAt = Date.now();
      this.runningCount++;
      this._saveState();
      this.emit('started', task);

      try {
        await this._executeTask(task);
        task.status = 'completed';
        task.completedAt = Date.now();
        this.stats.completed++;
        this.history.push(task);
        this._saveState();
        this.emit('completed', task);
      } catch (error) {
        task.status = 'failed';
        task.completedAt = Date.now();
        task.error = error.message;
        this.stats.failed++;
        this.history.push(task);
        this._saveState();
        this.emit('failed', task, error);
      } finally {
        this.runningCount--;
      }
    }

    this.processing = false;

    if (this.queue.length > 0) {
      setImmediate(() => this._processQueue());
    }
  }

  async _executeTask(task) {
    const srcPath = __dirname;
    Object.keys(require.cache)
      .filter(key => key.startsWith(srcPath + path.sep))
      .forEach(key => delete require.cache[key]);

    const { Orchestrator } = require('./orchestrator');
    const orchestrator = new Orchestrator();

    const projectRoot = task.options.projectRoot || process.cwd();

    orchestrator.createTask(task.id, task.type, task.description, {
      projectRoot,
      ...task.options
    });

    const result = await orchestrator.runWorkflow(task.id);

    if (result.finalPhase === 'failed') {
      throw new Error(`Workflow failed for task ${task.id}`);
    }

    return result;
  }

  getHistory() {
    return [...this.history];
  }

  getStats() {
    return { ...this.stats, pending: this.queue.filter(t => t.status === 'pending').length, running: this.runningCount };
  }

  getQueueStatus() {
    const all = [...this.queue, ...this.history];
    return all.map(t => ({
      id: t.id,
      status: t.status,
      description: t.description
    }));
  }
}

module.exports = { TaskQueueManager };
