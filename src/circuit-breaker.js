/**
 * OPC Circuit Breaker - 熔断器模块
 * 防止系统在持续失败时无限重试，提供降级和人工升级机制
 */

const fs = require('fs');
const path = require('path');

const STATE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/state';
const ESCALATION_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/escalations';

// 熔断器状态
const BREAKER_STATES = {
  CLOSED: 'closed',       // 正常工作
  OPEN: 'open',           // 熔断打开，拒绝请求
  HALF_OPEN: 'half_open'  // 半开，尝试恢复
};

// 默认配置
const DEFAULT_CONFIG = {
  failureThreshold: 5,      // 失败阈值
  successThreshold: 2,      // 恢复阈值
  timeout: 60000,           // 熔断超时（1分钟）
  halfOpenMaxAttempts: 3,   // 半开状态最大尝试次数
  monitorWindow: 300000,    // 监控窗口（5分钟）
  singleCallBudget: 1.0,    // 单次调用预算上限（元）
  taskBudget: 10.0          // 任务累计预算上限（元）
};

class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = BREAKER_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.recentEvents = []; // 最近的事件记录
    this.ensureDirectories();
  }

  ensureDirectories() {
    [STATE_DIR, ESCALATION_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 执行操作（带熔断保护）
   */
  async execute(operation, context = {}) {
    // 检查熔断器状态
    if (this.state === BREAKER_STATES.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(BREAKER_STATES.HALF_OPEN);
      } else {
        return this.handleOpenState(context);
      }
    }

    try {
      const result = await operation();
      this.onSuccess(context);
      return result;

    } catch (error) {
      this.onFailure(error, context);
      return { success: false, error: error.message, breaker: this.getStatus() };
    }
  }

  /**
   * 成功回调
   */
  onSuccess(context) {
    this.recordEvent('success', context);
    this.successCount++;

    if (this.state === BREAKER_STATES.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(BREAKER_STATES.CLOSED);
        this.reset();
      }
    } else if (this.state === BREAKER_STATES.CLOSED) {
      // 成功时重置失败计数
      this.failureCount = 0;
    }
  }

  /**
   * 失败回调
   */
  onFailure(error, context) {
    this.recordEvent('failure', { error: error.message, ...context });
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === BREAKER_STATES.HALF_OPEN) {
      // 半开状态失败，立即打开熔断器
      this.transitionTo(BREAKER_STATES.OPEN);
    } else if (this.state === BREAKER_STATES.CLOSED) {
      // 检查是否达到失败阈值
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(BREAKER_STATES.OPEN);
        this.triggerEscalation(context);
      }
    }
  }

  /**
   * 检查是否应该尝试重置
   */
  shouldAttemptReset() {
    if (!this.lastFailureTime) return false;
    const elapsed = Date.now() - this.lastFailureTime;
    return elapsed >= this.config.timeout;
  }

  /**
   * 处理熔断打开状态
   */
  handleOpenState(context) {
    console.log(`[CircuitBreaker:${this.name}] 熔断器打开，拒绝请求`);
    return {
      success: false,
      error: 'Circuit breaker is OPEN',
      breaker: this.getStatus(),
      suggestion: '系统检测到持续失败，已触发熔断保护。请检查错误日志或等待自动恢复。'
    };
  }

  /**
   * 状态转换
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    console.log(`[CircuitBreaker:${this.name}] 状态转换: ${oldState} -> ${newState}`);

    this.recordEvent('state_change', {
      from: oldState,
      to: newState,
      failureCount: this.failureCount,
      successCount: this.successCount
    });

    this.persistState();
  }

  /**
   * 重置熔断器
   */
  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    console.log(`[CircuitBreaker:${this.name}] 熔断器已重置`);
  }

  /**
   * 记录事件
   */
  recordEvent(type, data) {
    const event = {
      timestamp: Date.now(),
      type,
      state: this.state,
      ...data
    };

    this.recentEvents.push(event);

    // 只保留监控窗口内的事件
    const cutoff = Date.now() - this.config.monitorWindow;
    this.recentEvents = this.recentEvents.filter(e => e.timestamp > cutoff);
  }

  /**
   * 触发人工升级
   */
  triggerEscalation(context) {
    console.log(`[CircuitBreaker:${this.name}] 触发人工升级`);

    const escalation = {
      timestamp: Date.now(),
      breaker: this.name,
      state: this.state,
      failureCount: this.failureCount,
      recentEvents: this.recentEvents.slice(-10), // 最近 10 个事件
      context,
      status: 'pending',
      message: `熔断器 ${this.name} 已打开，失败次数: ${this.failureCount}/${this.config.failureThreshold}`
    };

    const escalationPath = path.join(
      ESCALATION_DIR,
      `${this.name}-${Date.now()}.json`
    );

    fs.writeFileSync(escalationPath, JSON.stringify(escalation, null, 2));

    console.log(`[CircuitBreaker:${this.name}] 升级记录已保存: ${escalationPath}`);
  }

  /**
   * 持久化状态
   */
  persistState() {
    const statePath = path.join(STATE_DIR, `breaker-${this.name}.json`);
    const state = {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      recentEvents: this.recentEvents
    };

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  /**
   * 加载状态
   */
  loadState() {
    const statePath = path.join(STATE_DIR, `breaker-${this.name}.json`);
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      this.state = state.state;
      this.failureCount = state.failureCount;
      this.successCount = state.successCount;
      this.lastFailureTime = state.lastFailureTime;
      this.lastStateChange = state.lastStateChange;
      this.recentEvents = state.recentEvents || [];
      return true;
    }
    return false;
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.config.failureThreshold,
      lastFailureTime: this.lastFailureTime,
      timeSinceLastFailure: this.lastFailureTime ? Date.now() - this.lastFailureTime : null,
      recentEventsCount: this.recentEvents.length
    };
  }

  /**
   * 手动打开熔断器
   */
  manualOpen() {
    this.transitionTo(BREAKER_STATES.OPEN);
  }

  /**
   * 手动关闭熔断器
   */
  manualClose() {
    this.transitionTo(BREAKER_STATES.CLOSED);
    this.reset();
  }
}

/**
 * 熔断器管理器
 */
class CircuitBreakerManager {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * 获取或创建熔断器
   */
  getBreaker(name, config) {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, config);
      breaker.loadState();
      this.breakers.set(name, breaker);
    }
    return this.breakers.get(name);
  }

  /**
   * 获取所有熔断器状态
   */
  getAllStatus() {
    const status = [];
    this.breakers.forEach((breaker, name) => {
      status.push(breaker.getStatus());
    });
    return status;
  }

  /**
   * 检查是否有熔断器打开
   */
  hasOpenBreakers() {
    for (const breaker of this.breakers.values()) {
      if (breaker.state === BREAKER_STATES.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取待处理的升级
   */
  getPendingEscalations() {
    if (!fs.existsSync(ESCALATION_DIR)) {
      return [];
    }

    const files = fs.readdirSync(ESCALATION_DIR);
    const escalations = [];

    files.forEach(file => {
      if (file.endsWith('.json')) {
        const filePath = path.join(ESCALATION_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.status === 'pending') {
          escalations.push({ ...data, file: filePath });
        }
      }
    });

    return escalations.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 标记升级已处理
   */
  resolveEscalation(filePath, resolution) {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data.status = 'resolved';
      data.resolution = resolution;
      data.resolvedAt = Date.now();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  checkBudget(taskId, singleCallCost, totalTaskCost, options = {}) {
    const singleCallLimit = options.singleCallBudget || DEFAULT_CONFIG.singleCallBudget;
    const taskLimit = options.taskBudget || DEFAULT_CONFIG.taskBudget;

    if (singleCallCost > singleCallLimit) {
      return { allowed: false, reason: `BUDGET_EXCEEDED: 单次调用 ¥${singleCallCost.toFixed(4)} 超过限额 ¥${singleCallLimit} (task: ${taskId})` };
    }

    if (totalTaskCost > taskLimit) {
      return { allowed: false, reason: `BUDGET_EXCEEDED: 任务累计 ¥${totalTaskCost.toFixed(4)} 超过限额 ¥${taskLimit} (task: ${taskId})` };
    }

    return { allowed: true, reason: '' };
  }
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerManager,
  BREAKER_STATES
};
