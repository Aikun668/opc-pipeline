const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_INBOX = path.join(__dirname, '..', 'var', 'queue', 'inbox');
const DEFAULT_PROCESSED = path.join(__dirname, '..', 'var', 'queue', 'processed');
const DEFAULT_REJECTED = path.join(__dirname, '..', 'var', 'queue', 'rejected');

class QueueWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.inboxDir = options.inboxDir || DEFAULT_INBOX;
    this.processedDir = options.processedDir || DEFAULT_PROCESSED;
    this.rejectedDir = options.rejectedDir || DEFAULT_REJECTED;
    this.interval = options.interval || 5000;
    this.taskQueue = options.taskQueue;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._ensureDirs();
    this._poll();
    this.timer = setInterval(() => this._poll(), this.interval);
    this.emit('started');
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('stopped');
  }

  _ensureDirs() {
    [this.inboxDir, this.processedDir, this.rejectedDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async _poll() {
    try {
      const files = fs.readdirSync(this.inboxDir);
      const tasks = files.filter(f => f.endsWith('.json') || f.endsWith('.md'));

      for (const file of tasks) {
        const filePath = path.join(this.inboxDir, file);
        await this._processFile(filePath);
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  async _processFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const ext = path.extname(filePath).toLowerCase();
      let task;

      if (ext === '.json') {
        task = this._parseJson(content);
      } else if (ext === '.md') {
        task = this._parseMarkdown(content);
      }

      if (!task || !task.description) {
        throw new Error('无法解析任务内容');
      }

      const taskId = this.taskQueue.enqueue(task);
      this._moveFile(filePath, this.processedDir);
      this.emit('processed', { file: path.basename(filePath), taskId });
    } catch (e) {
      this._moveFile(filePath, this.rejectedDir);
      this.emit('rejected', { file: path.basename(filePath), error: e.message });
    }
  }

  _parseJson(content) {
    const data = JSON.parse(content);
    return {
      id: data.id,
      type: data.type || 'feature',
      description: data.description || '',
      options: data.options || {}
    };
  }

  _parseMarkdown(content) {
    const lines = content.split('\n').filter(l => l.trim());
    const firstLine = lines[0] || '';
    const titleMatch = firstLine.match(/^#\s*(.+)/);
    const description = titleMatch ? titleMatch[1].trim() : firstLine.trim();

    const typeMatch = content.match(/type:\s*(\w+)/);
    const type = typeMatch ? typeMatch[1] : 'feature';

    return {
      id: null,
      type,
      description,
      options: {}
    };
  }

  _moveFile(filePath, destDir) {
    const basename = path.basename(filePath);
    const destPath = path.join(destDir, basename);
    fs.renameSync(filePath, destPath);
  }
}

module.exports = { QueueWatcher };
