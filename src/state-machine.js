/**
 * OPC 状态机 - 定义工作流的 6 个阶段
 * Planning → Coding → Review → Testing → Delivery → Completed
 */

const PHASES = {
  PLANNING: 'planning',
  CODING: 'coding',
  REVIEW: 'review',
  TESTING: 'testing',
  DELIVERY: 'delivery',
  FAILED: 'failed',
  COMPLETED: 'completed'
};

const PHASE_CONFIG = {
  [PHASES.PLANNING]: {
    timeout: 60000, // 1分钟
    maxRetries: 2,
    nextPhase: PHASES.CODING,
    description: '任务分解和规划'
  },
  [PHASES.CODING]: {
    timeout: 180000, // 3分钟
    maxRetries: 3,
    nextPhase: PHASES.REVIEW,
    description: '代码实现'
  },
  [PHASES.REVIEW]: {
    timeout: 120000, // 2分钟
    maxRetries: 1,
    nextPhase: PHASES.TESTING,
    description: '代码审查'
  },
  [PHASES.TESTING]: {
    timeout: 90000, // 1.5分钟
    maxRetries: 2,
    nextPhase: PHASES.DELIVERY,
    description: '测试验证'
  },
  [PHASES.DELIVERY]: {
    timeout: 60000, // 1分钟
    maxRetries: 1,
    nextPhase: PHASES.COMPLETED,
    description: '交付检查'
  },
  [PHASES.COMPLETED]: {
    timeout: 0,
    maxRetries: 0,
    nextPhase: PHASES.COMPLETED,
    description: '已完成'
  },
  [PHASES.FAILED]: {
    timeout: 0,
    maxRetries: 0,
    nextPhase: PHASES.FAILED,
    description: '已失败'
  }
};

class StateMachine {
  constructor(taskId) {
    this.taskId = taskId;
    this.currentPhase = PHASES.PLANNING;
    this.phaseHistory = [];
    this.retryCount = {};
    this.startTime = Date.now();
    this.phaseStartTime = Date.now();
  }

  /**
   * 获取当前阶段配置
   */
  getCurrentConfig() {
    return PHASE_CONFIG[this.currentPhase];
  }

  /**
   * 检查是否超时
   */
  isPhaseTimeout() {
    const config = this.getCurrentConfig();
    const elapsed = Date.now() - this.phaseStartTime;
    return elapsed > config.timeout;
  }

  /**
   * 检查是否可以重试
   */
  canRetry() {
    const config = this.getCurrentConfig();
    const count = this.retryCount[this.currentPhase] || 0;
    return count < config.maxRetries;
  }

  /**
   * 记录重试
   */
  recordRetry() {
    this.retryCount[this.currentPhase] = (this.retryCount[this.currentPhase] || 0) + 1;
  }

  /**
   * 切换到下一阶段
   */
  transitionTo(nextPhase, reason = '') {
    const prevPhase = this.currentPhase;

    this.phaseHistory.push({
      phase: prevPhase,
      startTime: this.phaseStartTime,
      endTime: Date.now(),
      duration: Date.now() - this.phaseStartTime,
      retries: this.retryCount[prevPhase] || 0,
      reason
    });

    this.currentPhase = nextPhase;
    this.phaseStartTime = Date.now();

    return {
      from: prevPhase,
      to: nextPhase,
      reason
    };
  }

  /**
   * 根据输出决定下一步
   * 【注意】不再内部调用 transitionTo，由 Orchestrator 统一控制
   */
  decideNextAction(result) {
    const { status, nextAction } = result;
    const phaseConfig = this.getCurrentConfig();

    // 强制回退到 coding（delivery 判断不通过 或 review 发现严重问题）
    if (nextAction === 'request_coding' || nextAction === 'request_fix') {
      return { action: 'transition', phase: PHASES.CODING };
    }

    // 成功处理
    if (status === 'success') {
      if (nextAction === 'complete' || phaseConfig.nextPhase === PHASES.COMPLETED) {
        return { action: 'complete', phase: PHASES.COMPLETED };
      }
      return { action: 'transition', phase: phaseConfig.nextPhase };
    }

    // 失败处理：检查重试次数
    if (this.canRetry()) {
      this.recordRetry();
      return { action: 'retry', phase: this.currentPhase };
    }

    return { action: 'fail', phase: PHASES.FAILED };
  }

  /**
   * 获取状态摘要
   */
  getSummary() {
    return {
      taskId: this.taskId,
      currentPhase: this.currentPhase,
      totalDuration: Date.now() - this.startTime,
      phaseDuration: Date.now() - this.phaseStartTime,
      phaseHistory: this.phaseHistory,
      retryCount: this.retryCount,
      isCompleted: this.currentPhase === PHASES.COMPLETED,
      isFailed: this.currentPhase === PHASES.FAILED
    };
  }

  /**
   * 序列化状态（用于持久化）
   */
  serialize() {
    return JSON.stringify({
      taskId: this.taskId,
      currentPhase: this.currentPhase,
      phaseHistory: this.phaseHistory,
      retryCount: this.retryCount,
      startTime: this.startTime,
      phaseStartTime: this.phaseStartTime
    });
  }

  /**
   * 反序列化状态（用于恢复）
   */
  static deserialize(data) {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    const sm = new StateMachine(obj.taskId);
    sm.currentPhase = obj.currentPhase;
    sm.phaseHistory = obj.phaseHistory;
    sm.retryCount = obj.retryCount;
    sm.startTime = obj.startTime;
    sm.phaseStartTime = obj.phaseStartTime;
    return sm;
  }
}

module.exports = { StateMachine, PHASES, PHASE_CONFIG };
