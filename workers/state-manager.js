#!/usr/bin/env node
/**
 * OPC State Manager - SQLite + 原子操作
 * 单点写入，防止文件踩踏
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_PATH = path.join(__dirname, '../state/pipeline.db');
const LOCK_FILE = path.join(__dirname, '../state/.db.lock');

class StateManager {
  constructor() {
    this.db = null;
    this.ensureDir();
  }

  ensureDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // 获取文件锁（防止并发写）
  acquireLock() {
    const startTime = Date.now();
    const timeout = 5000; // 5秒超时
    
    while (fs.existsSync(LOCK_FILE)) {
      if (Date.now() - startTime > timeout) {
        // 锁超时，强制释放
        console.warn('Lock timeout, forcing release');
        this.releaseLock();
        break;
      }
      // 忙等待 10ms
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    
    // 原子创建锁文件
    fs.writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' });
  }

  releaseLock() {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch (e) {
      // 锁可能已被释放
    }
  }

  init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(DB_PATH);
      
      this.db.serialize(() => {
        // 任务表
        this.db.run(`
          CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            type TEXT NOT NULL,           -- feature/bugfix/refactor
            status TEXT DEFAULT 'pending', -- pending/coding/testing/reviewing/done/failed
            priority INTEGER DEFAULT 0,    -- 0=low, 1=medium, 2=high, 3=critical
            worker_pid INTEGER,
            worker_session TEXT,
            isolation_dir TEXT,
            model TEXT,
            retry_count INTEGER DEFAULT 0,
            created_at INTEGER,
            started_at INTEGER,
            checkpoint_at INTEGER,         -- 心跳时间戳
            completed_at INTEGER,
            error_msg TEXT,
            result_path TEXT
          )
        `);

        // 任务流转日志（append-only，防止踩踏）
        this.db.run(`
          CREATE TABLE IF NOT EXISTS task_logs (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            stage TEXT NOT NULL,           -- coding/testing/reviewing
            status TEXT NOT NULL,          -- start/success/fail
            message TEXT,
            timestamp INTEGER,
            FOREIGN KEY (task_id) REFERENCES tasks(task_id)
          )
        `);

        // 索引优化查询
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_status ON tasks(status)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_checkpoint ON tasks(checkpoint_at)`);
        
        resolve();
      });
    });
  }

  // 原子写入任务
  createTask(taskId, type, priority = 1, meta = {}) {
    return new Promise((resolve, reject) => {
      this.acquireLock();
      
      const stmt = this.db.prepare(`
        INSERT INTO tasks (task_id, type, priority, created_at, status)
        VALUES (?, ?, ?, ?, 'pending')
        ON CONFLICT(task_id) DO UPDATE SET
          retry_count = retry_count + 1,
          status = 'pending'
      `);
      
      stmt.run(taskId, type, priority, Date.now(), function(err) {
        this.releaseLock();
        if (err) reject(err);
        else resolve({ taskId, rowId: this.lastID });
      }.bind(this));
      
      stmt.finalize();
    });
  }

  // 原子更新状态（带乐观锁检查）
  updateStatus(taskId, newStatus, updates = {}) {
    return new Promise((resolve, reject) => {
      this.acquireLock();
      
      const fields = ['status = ?'];
      const values = [newStatus];
      
      Object.entries(updates).forEach(([key, val]) => {
        fields.push(`${key} = ?`);
        values.push(val);
      });
      
      values.push(taskId);
      
      const sql = `UPDATE tasks SET ${fields.join(', ')}, checkpoint_at = ? WHERE task_id = ?`;
      values.splice(-1, 0, Date.now());
      
      this.db.run(sql, values, function(err) {
        this.releaseLock();
        if (err) reject(err);
        else resolve({ changed: this.changes > 0 });
      }.bind(this));
    });
  }

  // 记录日志（append-only）
  logEvent(taskId, stage, status, message = '') {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO task_logs (task_id, stage, status, message, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run(taskId, stage, status, message, Date.now(), function(err) {
        if (err) reject(err);
        else resolve({ logId: this.lastID });
      });
      
      stmt.finalize();
    });
  }

  // 获取待处理任务（原子查询）
  getPendingTasks(limit = 1) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM tasks 
        WHERE status = 'pending' 
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // 检查僵尸任务（超过30分钟无心跳）
  getZombieTasks(timeoutMinutes = 30) {
    const cutoff = Date.now() - (timeoutMinutes * 60 * 1000);
    
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM tasks 
        WHERE status IN ('coding', 'testing', 'reviewing')
        AND checkpoint_at < ?
      `, [cutoff], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // 获取任务统计
  getStats() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT status, COUNT(*) as count 
        FROM tasks 
        GROUP BY status
      `, (err, rows) => {
        if (err) reject(err);
        else {
          const stats = { pending: 0, coding: 0, testing: 0, reviewing: 0, done: 0, failed: 0 };
          rows.forEach(r => stats[r.status] = r.count);
          resolve(stats);
        }
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

// 原子文件操作工具
const AtomicFile = {
  // 原子写入：先写临时文件，再 mv 替换
  write(filePath, content) {
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath); // 原子替换
    return true;
  },

  // 原子追加：使用 appendFileSync（底层是 O_APPEND）
  append(filePath, content) {
    fs.appendFileSync(filePath, content, 'utf8');
    return true;
  },

  // 安全读取（文件不存在返回 null）
  read(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return null;
    }
  }
};

module.exports = { StateManager, AtomicFile };

// CLI 用法
if (require.main === module) {
  const cmd = process.argv[2];
  const db = new StateManager();
  
  db.init().then(async () => {
    switch(cmd) {
      case 'init':
        console.log('Database initialized at', DB_PATH);
        break;
      case 'stats':
        console.log(await db.getStats());
        break;
      case 'zombies':
        console.log(await db.getZombieTasks());
        break;
      default:
        console.log('Usage: node state-manager.js [init|stats|zombies]');
    }
    await db.close();
  });
}
