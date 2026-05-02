#!/usr/bin/env node
/**
 * Isolation Manager - Worker 隔离目录管理
 * 每个 Worker 独立 /tmp 目录，用完清理
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_ISOLATION_DIR = '/tmp/opc-isolation';
const MAIN_PROJECT_DIR = process.env.OPC_PROJECT_DIR || process.cwd();

class IsolationManager {
  constructor() {
    this.ensureBaseDir();
  }

  ensureBaseDir() {
    if (!fs.existsSync(BASE_ISOLATION_DIR)) {
      fs.mkdirSync(BASE_ISOLATION_DIR, { recursive: true });
    }
  }

  /**
   * 创建隔离工作目录
   * @param {string} taskId - 任务ID
   * @param {string} stage - 阶段 (coder/tester/reviewer)
   * @returns {Object} 隔离目录信息
   */
  createWorkspace(taskId, stage) {
    const timestamp = Date.now();
    const pid = process.pid;
    const dirName = `${taskId}-${stage}-${timestamp}-${pid}`;
    const workspacePath = path.join(BASE_ISOLATION_DIR, dirName);

    // 创建目录结构
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'test-results'), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'reports'), { recursive: true });

    // 写入元数据（用于追踪）
    const meta = {
      taskId,
      stage,
      createdAt: timestamp,
      pid,
      mainProject: MAIN_PROJECT_DIR
    };
    fs.writeFileSync(
      path.join(workspacePath, '.opc-meta.json'),
      JSON.stringify(meta, null, 2)
    );

    return {
      path: workspacePath,
      srcDir: path.join(workspacePath, 'src'),
      testResultsDir: path.join(workspacePath, 'test-results'),
      reportsDir: path.join(workspacePath, 'reports'),
      metaPath: path.join(workspacePath, '.opc-meta.json')
    };
  }

  /**
   * 从主项目同步代码到隔离目录
   * @param {string} workspacePath - 隔离目录路径
   * @param {Array<string>} files - 指定文件（null=全量）
   */
  syncFromMain(workspacePath, files = null) {
    const srcDir = path.join(workspacePath, 'src');
    
    if (files) {
      // 只同步指定文件
      files.forEach(file => {
        const src = path.join(MAIN_PROJECT_DIR, file);
        const dst = path.join(srcDir, file);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
      });
    } else {
      // 全量克隆（使用 git 保持干净）
      try {
        execSync(`git clone --depth 1 file://${MAIN_PROJECT_DIR} ${srcDir}`, {
          stdio: 'pipe',
          timeout: 30000
        });
      } catch (e) {
        // git 失败则直接复制
        this.copyRecursive(MAIN_PROJECT_DIR, srcDir);
      }
    }

    // 写入上下文提示文件
    const context = this.gatherContext();
    fs.writeFileSync(
      path.join(workspacePath, '.opc-context.json'),
      JSON.stringify(context, null, 2)
    );

    return srcDir;
  }

  /**
   * 将隔离目录的修改同步回主项目（通过 Git Patch）
   * @param {string} workspacePath - 隔离目录
   * @returns {Object} 同步结果
   */
  syncToMain(workspacePath) {
    const srcDir = path.join(workspacePath, 'src');
    const metaPath = path.join(workspacePath, '.opc-meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    
    // 生成 patch 文件
    const patchPath = path.join(workspacePath, 'changes.patch');
    
    try {
      // 在隔离目录生成 diff
      execSync(`cd ${srcDir} && git diff HEAD > ${patchPath}`, {
        stdio: 'pipe'
      });
      
      // 应用到主项目
      execSync(`cd ${MAIN_PROJECT_DIR} && git apply ${patchPath}`, {
        stdio: 'pipe'
      });
      
      return { success: true, patch: patchPath };
    } catch (e) {
      // 应用失败，返回错误
      return { 
        success: false, 
        error: e.message,
        patch: patchPath 
      };
    }
  }

  /**
   * 清理隔离目录
   * @param {string} workspacePath - 要清理的目录
   * @param {boolean} force - 强制清理（即使 meta 文件不存在）
   */
  cleanup(workspacePath, force = false) {
    if (!fs.existsSync(workspacePath)) {
      return { cleaned: false, reason: 'not_exists' };
    }

    const metaPath = path.join(workspacePath, '.opc-meta.json');
    
    if (!force && !fs.existsSync(metaPath)) {
      return { cleaned: false, reason: 'no_meta_file' };
    }

    try {
      // 递归删除
      fs.rmSync(workspacePath, { recursive: true, force: true });
      return { cleaned: true, path: workspacePath };
    } catch (e) {
      return { cleaned: false, error: e.message };
    }
  }

  /**
   * 清理所有孤儿目录（无活跃进程的隔离目录）
   */
  cleanupOrphans() {
    const entries = fs.readdirSync(BASE_ISOLATION_DIR);
    const results = [];

    for (const entry of entries) {
      const fullPath = path.join(BASE_ISOLATION_DIR, entry);
      const metaPath = path.join(fullPath, '.opc-meta.json');

      if (!fs.existsSync(metaPath)) {
        // 无元数据，直接清理
        results.push({ path: entry, action: 'cleaned_no_meta' });
        this.cleanup(fullPath, true);
        continue;
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      
      // 检查进程是否还在
      const isAlive = this.isProcessAlive(meta.pid);
      const age = Date.now() - meta.createdAt;
      const isOld = age > 2 * 60 * 60 * 1000; // 超过2小时

      if (!isAlive || isOld) {
        const result = this.cleanup(fullPath, true);
        results.push({ 
          path: entry, 
          action: 'cleaned',
          reason: !isAlive ? 'dead_pid' : 'too_old'
        });
      }
    }

    return results;
  }

  /**
   * 检查进程是否存活
   */
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 递归复制目录
   */
  copyRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        this.copyRecursive(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  /**
   * 收集项目上下文（已有工具、代码风格等）
   */
  gatherContext() {
    const context = {
      existingUtils: [],
      codingStyle: null,
      constraints: [],
      techStack: {}
    };

    // 扫描 utils 目录
    const utilsDir = path.join(MAIN_PROJECT_DIR, 'src/utils');
    if (fs.existsSync(utilsDir)) {
      context.existingUtils = fs.readdirSync(utilsDir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
        .map(f => `src/utils/${f}`);
    }

    // 读取 coding-style 记忆
    const styleFile = path.join(MAIN_PROJECT_DIR, 'memory/coding-style.md');
    if (fs.existsSync(styleFile)) {
      context.codingStyle = styleFile;
    }

    // 检测技术栈
    if (fs.existsSync(path.join(MAIN_PROJECT_DIR, 'package.json'))) {
      context.techStack.node = true;
    }
    if (fs.existsSync(path.join(MAIN_PROJECT_DIR, 'pyproject.toml')) || 
        fs.existsSync(path.join(MAIN_PROJECT_DIR, 'requirements.txt'))) {
      context.techStack.python = true;
    }

    context.constraints = [
      '复用已有 utils 函数，不要重复造轮子',
      '保持与现有代码风格一致',
      '修改前先阅读相关文件'
    ];

    return context;
  }

  /**
   * 获取隔离目录统计
   */
  getStats() {
    if (!fs.existsSync(BASE_ISOLATION_DIR)) {
      return { total: 0, active: 0, orphans: 0 };
    }

    const entries = fs.readdirSync(BASE_ISOLATION_DIR);
    let active = 0;
    let orphans = 0;

    for (const entry of entries) {
      const metaPath = path.join(BASE_ISOLATION_DIR, entry, '.opc-meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (this.isProcessAlive(meta.pid)) {
          active++;
        } else {
          orphans++;
        }
      } else {
        orphans++;
      }
    }

    return { total: entries.length, active, orphans };
  }
}

module.exports = { IsolationManager };

// CLI 用法
if (require.main === module) {
  const cmd = process.argv[2];
  const manager = new IsolationManager();

  switch(cmd) {
    case 'cleanup':
      console.log(manager.cleanupOrphans());
      break;
    case 'stats':
      console.log(manager.getStats());
      break;
    case 'test':
      const ws = manager.createWorkspace('TEST-001', 'coder');
      console.log('Created:', ws);
      manager.syncFromMain(ws.path);
      console.log('Synced files');
      setTimeout(() => {
        manager.cleanup(ws.path);
        console.log('Cleaned up');
      }, 5000);
      break;
    default:
      console.log('Usage: node isolation-manager.js [cleanup|stats|test]');
  }
}
