const fs = require('fs');
const path = require('path');

const PIPE_BASE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/pipe';
const LOCK_TIMEOUT_MS = 30000;

class PipeManager {
  constructor() {
    this.ensureBaseDir();
  }

  ensureBaseDir() {
    if (!fs.existsSync(PIPE_BASE_DIR)) {
      fs.mkdirSync(PIPE_BASE_DIR, { recursive: true, mode: 0o755 });
    }
  }

  createTaskPipe(taskId, type = 'unknown') {
    const pipeDir = path.join(PIPE_BASE_DIR, taskId);

    if (fs.existsSync(pipeDir)) {
      this.cleanupTaskPipe(taskId);
    }

    fs.mkdirSync(pipeDir, { recursive: true, mode: 0o755 });

    fs.writeFileSync(
      path.join(pipeDir, '.meta'),
      JSON.stringify({ taskId, type, createdAt: Date.now(), createdBy: process.pid })
    );

    return pipeDir;
  }

  getTaskPipe(taskId) {
    return path.join(PIPE_BASE_DIR, taskId);
  }

  /**
   * 【修复】原子信标写入：tmp → ready
   * 主控调用：写入任务并标记为 ready
   */
  writeInputBeacon(taskId, inputData) {
    const pipeDir = this.getTaskPipe(taskId);
    
    if (!fs.existsSync(pipeDir)) {
      throw new Error(`Pipe directory not found: ${taskId}`);
    }
    
    const tmpPath = path.join(pipeDir, 'input.json.tmp');
    const readyPath = path.join(pipeDir, 'input.json.ready');
    
    // 删除旧信标（如果存在）
    if (fs.existsSync(readyPath)) fs.unlinkSync(readyPath);
    
    const payload = {
      ...inputData,
      _meta: {
        taskId,
        createdAt: Date.now(),
        projectRoot: inputData.projectRoot || process.cwd(),
        ...(inputData._meta_extra || {})
      }
    };
    delete payload._meta_extra;
    
    // 先写入 tmp，再原子重命名为 ready
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tmpPath, readyPath);
    
    return readyPath;
  }

  /**
   * 【修复】原子信标读取：ready → processing
   * Coder调用：接走任务并标记为 processing
   */
  readInputBeacon(taskId) {
    const pipeDir = this.getTaskPipe(taskId);
    const readyPath = path.join(pipeDir, 'input.json.ready');
    const processingPath = path.join(pipeDir, 'input.json.processing');

    if (!fs.existsSync(readyPath)) {
      return null;
    }

    // 原子移动表示"已接走"
    // 防御性 try-catch：如果多实例竞争，rename 失败说明已被其他 Actor 接走
    try {
      fs.renameSync(readyPath, processingPath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        // 已被其他进程抢走，正常返回 null
        return null;
      }
      throw e; // 其他错误继续抛出
    }

    const content = fs.readFileSync(processingPath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * 【新增】非消费式读取信标
   * Orchestrator 内置阶段使用，不移动信标状态
   */
  peekInputBeacon(taskId) {
    const pipeDir = this.getTaskPipe(taskId);
    const candidates = [
      path.join(pipeDir, 'input.json.ready'),
      path.join(pipeDir, 'input.json.processing'),
      path.join(pipeDir, 'input.json.done')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const content = fs.readFileSync(candidate, 'utf8');
          return JSON.parse(content);
        } catch (e) {
          // 文件损坏或无效 JSON，跳过继续尝试下一个候选
          continue;
        }
      }
    }

    return null;
  }

  /**
   * 【修复】完成任务：processing → done
   */
  completeInputBeacon(taskId) {
    const pipeDir = this.getTaskPipe(taskId);
    const processingPath = path.join(pipeDir, 'input.json.processing');
    const donePath = path.join(pipeDir, 'input.json.done');
    
    if (fs.existsSync(processingPath)) {
      fs.renameSync(processingPath, donePath);
    }
  }

  /**
   * 【修复】硬截断 + 验证输出
   */
  writeOutput(taskId, outputData, options = {}) {
    const pipeDir = this.getTaskPipe(taskId);
    
    // 1. 【修复】代码层硬截断（不依赖 LLM 自律）
    const truncated = this.hardTruncate(outputData, options, taskId);
    
    // 2. 验证
    const validation = this.validateOutput(truncated);
    if (!validation.valid) {
      return {
        success: false,
        error: `FUSE_BLOWN: ${validation.reason}`,
        details: validation.details
      };
    }
    
    // 3. 原子写入
    const outputPath = path.join(pipeDir, 'output.json');
    const tmpPath = `${outputPath}.tmp.${process.pid}`;
    
    fs.writeFileSync(tmpPath, JSON.stringify(truncated, null, 2));
    fs.renameSync(tmpPath, outputPath);
    
    this.updateHeartbeat(taskId);
    
    return { success: true, path: outputPath };
  }

  /**
   * 【关键修复】硬截断机制
   * 不期望 LLM 自律，代码层强制截断
   */
  hardTruncate(output, options = {}, taskId) {
    const maxChars = options.maxOutputChars || 500;
    const maxSummary = options.maxSummaryChars || 100;
    
    // 深拷贝避免修改原对象
    const result = JSON.parse(JSON.stringify(output));
    
    // 1. 截断 summary
    if (result.summary && result.summary.length > maxSummary) {
      result.summary = result.summary.substring(0, maxSummary - 3) + '...';
    }
    
    // 2. 截断 error
    if (result.error && result.error.length > 200) {
      result.error = result.error.substring(0, 197) + '...';
    }
    
    // 3. 检查总长度，超出则进一步压缩
    let compact = JSON.stringify(result);
    if (compact.length > maxChars) {
      // 极端情况：只保留核心字段
      const minimal = {
        version: result.version || '1.0',
        status: result.status,
        summary: result.summary?.substring(0, 50) + '...' || 'truncated',
        nextAction: result.nextAction,
        error: result.error ? 'Error occurred (see artifacts)' : null,
        artifacts: result.artifacts || {}
      };
      
      // 确保 artifacts 引用存在
      if (result.error && !minimal.artifacts.errorLog) {
        minimal.artifacts.errorLog = `${this.getTaskPipe(taskId)}/error.log`;
      }
      
      return minimal;
    }
    
    return result;
  }

  validateOutput(output) {
    const required = ['version', 'status', 'summary', 'nextAction'];
    
    for (const field of required) {
      if (!(field in output)) {
        return { valid: false, reason: `Missing field: ${field}` };
      }
    }
    
    if (!['success', 'fail', 'error'].includes(output.status)) {
      return { valid: false, reason: `Invalid status: ${output.status}` };
    }
    
    const compact = JSON.stringify(output);
    if (compact.length > 500) {
      return { valid: false, reason: `Output ${compact.length} > 500 chars` };
    }
    
    return { valid: true };
  }

  /**
   * 读取 Actor 的输出文件
   * @param {string} taskId
   * @param {boolean} consume - 为 true 时读取后删除（消费模式）
   */
  readOutput(taskId, consume = false) {
    const pipeDir = this.getTaskPipe(taskId);
    const outputPath = path.join(pipeDir, 'output.json');

    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'No output file' };
    }

    try {
      const content = fs.readFileSync(outputPath, 'utf8');
      const data = JSON.parse(content);

      if (consume) {
        fs.unlinkSync(outputPath);
      }

      return { success: true, data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  writeArtifact(taskId, filename, content) {
    const pipeDir = this.getTaskPipe(taskId);
    const artifactPath = path.join(pipeDir, filename);
    const tmpPath = `${artifactPath}.tmp.${process.pid}`;
    
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, artifactPath);
    
    return artifactPath;
  }

  readArtifact(taskId, filename) {
    const artifactPath = path.join(this.getTaskPipe(taskId), filename);
    return fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : null;
  }

  updateHeartbeat(taskId) {
    const heartbeatPath = path.join(this.getTaskPipe(taskId), '.heartbeat');
    fs.writeFileSync(heartbeatPath, Date.now().toString());
  }

  isHeartbeatExpired(taskId, timeoutMs = 300000) {
    const heartbeatPath = path.join(this.getTaskPipe(taskId), '.heartbeat');
    if (!fs.existsSync(heartbeatPath)) return true;
    const heartbeat = parseInt(fs.readFileSync(heartbeatPath, 'utf8'));
    return Date.now() - heartbeat > timeoutMs;
  }

  cleanupTaskPipe(taskId) {
    const pipeDir = this.getTaskPipe(taskId);
    if (!fs.existsSync(pipeDir)) return { cleaned: false };
    
    try {
      fs.rmSync(pipeDir, { recursive: true, force: true });
      return { cleaned: true };
    } catch (e) {
      return { cleaned: false, error: e.message };
    }
  }

  listTaskPipes() {
    if (!fs.existsSync(PIPE_BASE_DIR)) return [];
    return fs.readdirSync(PIPE_BASE_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }
}

module.exports = { PipeManager };
