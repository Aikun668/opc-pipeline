#!/usr/bin/env node
/**
 * OPC Orchestrator - 主控调度器
 * 【重构】6 阶段 LLM API 驱动工作流
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PipeManager } = require('../pipe/pipe-manager');
const { StateMachine, PHASES, PHASE_CONFIG } = require('./state-machine');
const { CircuitBreakerManager } = require('./circuit-breaker');
const { sessions_spawn } = require('./spawn-adapter');
const { LLMManager } = require('./llm-manager');
const { CostTracker } = require('./cost-tracker');
const { EventBus, EVENTS } = require('./event-bus');
const {
  buildPlanningPrompt,
  buildCodingPrompt,
  buildPrefilterPrompt,
  buildReviewPrompt,
  buildTestingPrompt,
  buildDeliveryPrompt
} = require('../prompts/templates');

const PIPE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/var/pipe';
const STATE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/state';
const MODELS = [
  { id: 'kimi/kimi-code', timeout: 300 },
  { id: 'anthropic/claude-sonnet-4', timeout: 300 },
  { id: 'openai/o3-mini', timeout: 240 }
];

class Orchestrator {
  constructor() {
    this.pipeManager = new PipeManager();
    this.breakerManager = new CircuitBreakerManager();
    this.active = true;
    this.taskQueue = [];
    this.stateMachines = new Map();
    this.taskMeta = new Map();
    this.costTracker = new CostTracker(path.join(__dirname, '..', 'config', 'model-pricing.json'));
    this.llmManager = new LLMManager(path.join(__dirname, '..', 'config', 'models.json'), { costTracker: this.costTracker });
    this.archiveDir = path.join(__dirname, '..', 'var', 'archive');
    this.budgetConfig = this.loadBudgetConfig();
    this.eventBus = new EventBus();
    this.ensureStateDir();
  }

  loadBudgetConfig() {
    const budgetPath = path.join(__dirname, '..', 'config', 'budget.json');
    if (fs.existsSync(budgetPath)) {
      return JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
    }
    return { singleCallBudget: 1.0, taskBudget: 10.0 };
  }

  ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
  }

  emitLog(taskId, level, message) {
    this.eventBus.emit(EVENTS.LOG, { taskId, level, message, ts: Date.now() });
  }

  /**
   * 【保留】崩溃恢复：重启后扫描未完成任务
   */
  resumePendingTasks() {
    if (!fs.existsSync(STATE_DIR)) return [];

    const resumed = [];
    const stateFiles = fs.readdirSync(STATE_DIR)
      .filter(f => f.startsWith('TASK-') && f.endsWith('.json'));

    for (const file of stateFiles) {
      try {
        const statePath = path.join(STATE_DIR, file);
        const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const taskId = data.taskId;

        if (data.currentPhase === PHASES.COMPLETED || data.currentPhase === PHASES.FAILED) {
          continue;
        }

        const stateMachine = StateMachine.deserialize(data);
        this.stateMachines.set(taskId, stateMachine);

        const pipeDir = path.join(PIPE_DIR, taskId);
        const hasOutput = fs.existsSync(path.join(pipeDir, 'output.json'));
        const hasDone = fs.existsSync(path.join(pipeDir, 'input.json.done'));
        const hasProcessing = fs.existsSync(path.join(pipeDir, 'input.json.processing'));
        const hasReady = fs.existsSync(path.join(pipeDir, 'input.json.ready'));

        let action;
        if (hasOutput) {
          action = 'consume_output';
        } else if (hasDone) {
          action = 'redispatch';
        } else if (hasProcessing) {
          const heartbeatExpired = this.pipeManager.isHeartbeatExpired(taskId, 120000);
          action = heartbeatExpired ? 'redispatch' : 'wait';
        } else if (hasReady) {
          action = 'wait';
        } else {
          action = 'redispatch';
        }

        console.log(`[Orchestrator] 恢复任务: ${taskId}, 阶段: ${data.currentPhase}, 动作: ${action}`);
        resumed.push({ taskId, phase: data.currentPhase, action });
      } catch (e) {
        console.error(`[Orchestrator] 恢复失败: ${file}`, e.message);
      }
    }

    return resumed;
  }

  /**
   * 【保留】创建任务
   */
  createTask(taskId, type, description, options = {}) {
    const projectRoot = options.projectRoot || process.cwd();

    let baseCommit = null;
    try {
      baseCommit = execSync(['git', 'rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 5000
      }).trim();
    } catch (e) {
      // 非 Git 目录或 git 不可用，保持 null
    }

    const stateMachine = new StateMachine(taskId);
    this.stateMachines.set(taskId, stateMachine);
    this.saveState(taskId, stateMachine);

    this.pipeManager.createTaskPipe(taskId, type);
    this.pipeManager.writeInputBeacon(taskId, {
      taskId,
      type,
      description,
      projectRoot,
      contextFiles: (options.contextFiles || []).map(f =>
        path.isAbsolute(f) ? f : path.join(projectRoot, f)
      ),
      constraints: options.constraints || [],
      priority: options.priority || 1,
      _meta_extra: { baseCommit }
    });

    console.log(`[Orchestrator] 任务创建: ${taskId}, 初始阶段: ${stateMachine.currentPhase}`);
    this.emitLog(taskId, 'info', `任务创建: ${taskId}, 初始阶段: ${stateMachine.currentPhase}`);
    this.taskMeta.set(taskId, { projectRoot });
    this.eventBus.emit(EVENTS.TASK_CREATED, { taskId, taskType: type, description });
    return taskId;
  }

  saveState(taskId, stateMachine) {
    const statePath = path.join(STATE_DIR, `${taskId}.json`);
    fs.writeFileSync(statePath, stateMachine.serialize());
  }

  recordCost(taskId, phase, result) {
    if (result.success && result.usage) {
      const modelConfig = this.llmManager.config?.models?.[phase];
      if (!modelConfig) {
        throw new Error(`未找到 phase=${phase} 的模型配置`);
      }
      const modelId = modelConfig.model;
      const cost = this.costTracker.recordCall(taskId, phase, modelId, {
        input_tokens: result.usage.input || 0,
        output_tokens: result.usage.output || 0,
        reasoning_tokens: result.usage.reasoning || 0
      });
      this.emitLog(taskId, 'info', `[CostTracker] ${phase}: ${modelId}, ¥${cost.toFixed(4)}`);

      const taskRecord = this.costTracker.getTaskCost(taskId);
      const budgetCheck = this.breakerManager.checkBudget(taskId, cost, taskRecord.totalCost, this.budgetConfig);
      if (!budgetCheck.allowed) {
        throw new Error(budgetCheck.reason);
      }
    }
  }

  loadState(taskId) {
    const statePath = path.join(STATE_DIR, `${taskId}.json`);
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, 'utf8');
      return StateMachine.deserialize(data);
    }
    return null;
  }

  /**
   * 【重构】运行完整工作流 - 6 阶段 LLM 驱动
   */
  async runWorkflow(taskId) {
    const stateMachine = this.stateMachines.get(taskId) || this.loadState(taskId);
    if (!stateMachine) {
      throw new Error(`Task not found: ${taskId}`);
    }
    this.stateMachines.set(taskId, stateMachine);

    let retryCount = 0;
    const maxRetries = 3;

    while (stateMachine.currentPhase !== PHASES.COMPLETED && stateMachine.currentPhase !== PHASES.FAILED && retryCount < maxRetries) {
      const phase = stateMachine.currentPhase;
      console.log(`[Orchestrator] 执行阶段: ${phase}`);
      this.emitLog(taskId, 'info', `执行阶段: ${phase}`);
      this.eventBus.emit(EVENTS.PHASE_START, { taskId, phase });
      const phaseStartTime = Date.now();

      try {
        let result;

        switch (phase) {
          case PHASES.PLANNING:
            result = await this.executePlanning(taskId);
            break;
          case PHASES.CODING:
            result = await this.executeCoding(taskId);
            break;
          case PHASES.REVIEW:
            result = await this.executeReview(taskId);
            break;
          case PHASES.TESTING:
            result = await this.executeTesting(taskId);
            break;
          case PHASES.DELIVERY:
            result = await this.executeDelivery(taskId);
            break;
          default:
            throw new Error(`Unknown phase: ${phase}`);
        }

        const phaseDuration = Date.now() - phaseStartTime;
        const phaseCost = this.costTracker.getTaskCost(taskId)?.phases?.find(p => p.phase === phase)?.cost || 0;
        this.eventBus.emit(EVENTS.PHASE_END, { taskId, phase, durationMs: phaseDuration, cost: phaseCost });

        const decision = stateMachine.decideNextAction(result);

        if (decision.action === 'transition') {
          stateMachine.transitionTo(decision.phase);
          this.saveState(taskId, stateMachine);
        } else if (decision.action === 'retry') {
          retryCount++;
          console.log(`[Orchestrator] 重试 ${phase}, 次数: ${retryCount}`);
          this.emitLog(taskId, 'warn', `重试 ${phase}, 次数: ${retryCount}`);
          this.eventBus.emit(EVENTS.PHASE_RETRY, { taskId, phase, attempt: retryCount, reason: result.summary || 'retry' });
        } else if (decision.action === 'complete') {
          stateMachine.transitionTo(PHASES.COMPLETED);
          this.saveState(taskId, stateMachine);
          this.costTracker.writeReport(taskId, this.archiveDir);
          break;
        } else if (decision.action === 'fail') {
          stateMachine.transitionTo(PHASES.FAILED);
          this.saveState(taskId, stateMachine);
          this.costTracker.writeReport(taskId, this.archiveDir);
          break;
        }
      } catch (error) {
        console.error(`[Orchestrator] 阶段失败: ${phase}`, error);
        this.emitLog(taskId, 'error', `阶段失败: ${phase}, ${error.message}\n${error.stack || ''}`);
        this.eventBus.emit(EVENTS.TASK_FAILED, { taskId, error: error.message, phase });
        retryCount++;
        if (retryCount >= maxRetries) {
          stateMachine.transitionTo(PHASES.FAILED);
          this.saveState(taskId, stateMachine);
          this.costTracker.writeReport(taskId, this.archiveDir);
          break;
        }
      }
    }

    const result = {
      success: stateMachine.currentPhase === PHASES.COMPLETED,
      taskId,
      finalPhase: stateMachine.currentPhase,
      summary: stateMachine.getSummary()
    };
    if (result.success) {
      const meta = this.taskMeta.get(taskId) || {};
      this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId, result, workDir: meta.projectRoot });
    }
    return result;
  }

  /**
   * Planning 阶段（Claude）
   */
  async executePlanning(taskId) {
    const input = this.pipeManager.peekInputBeacon(taskId);
    if (!input) {
      throw new Error(`No input beacon found for task: ${taskId}`);
    }
    const projectStructure = this.getProjectStructure(input._meta.projectRoot);

    const prompt = buildPlanningPrompt(input.description, projectStructure);
    const result = await this.llmManager.callModel('planning', [
      { role: 'user', content: prompt }
    ]);
    this.recordCost(taskId, 'planning', result);

    if (!result.success) throw new Error(result.error);

    const spec = await this.extractJSONWithFallback(result.content, 'planning', taskId);
    if (!Array.isArray(spec.files_to_touch)) {
      throw new Error('Planning spec invalid: missing files_to_touch array');
    }
    const specPath = path.join(PIPE_DIR, taskId, 'spec.json');
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));

    return {
      status: 'success',
      nextAction: 'request_coding',
      artifacts: { spec: specPath }
    };
  }

  /**
   * Coding 阶段（GLM-5.1）
   */
  async executeCoding(taskId) {
    const specPath = path.join(PIPE_DIR, taskId, 'spec.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

    // 检查是否有打回的 patch 指令
    const patchInstructionsPath = path.join(PIPE_DIR, taskId, 'patch-instructions.json');
    let patchInstructions = null;
    if (fs.existsSync(patchInstructionsPath)) {
      patchInstructions = JSON.parse(fs.readFileSync(patchInstructionsPath, 'utf8'));
    }

    const contextFiles = this.loadContextFiles(spec.files_to_touch);
    const prompt = buildCodingPrompt(spec, contextFiles, patchInstructions);

    const result = await this.llmManager.callModel('coding', [
      { role: 'user', content: prompt }
    ]);
    this.recordCost(taskId, 'coding', result);

    if (!result.success) throw new Error(result.error);

    const output = await this.extractJSONWithFallback(result.content, 'coding', taskId);

    const rawDir = path.join(PIPE_DIR, taskId);
    if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
    const rawPath = path.join(rawDir, '_llm-response.json');
    fs.writeFileSync(rawPath, JSON.stringify({
      model: result.model || 'unknown',
      usage: result.usage || {},
      rawContent: result.content,
      parsedAt: new Date().toISOString()
    }, null, 2));

    const hasFiles = Array.isArray(output.files) && output.files.length > 0;
    const hasPatch = output.artifacts?.codePatch && typeof output.artifacts.codePatch === 'string';
    const hasMock = output.status === 'success' && output.nextAction === 'request_review';
    if (!hasFiles && !hasPatch && !hasMock) {
      throw new Error('Coding output invalid: missing files array or codePatch');
    }

    if (Array.isArray(output.files)) {
      const placeholderPattern = /\/\/\s*(示例|示例内容|todo|TODO|example)/;
      for (const file of output.files) {
        if (placeholderPattern.test(file.content || '')) {
          this.emitLog(taskId, 'warn', `[占位检测] ${file.path} 包含占位内容，建议人工审查`);
        }
      }
    }

    const writeResult = this.pipeManager.writeOutput(taskId, output);
    if (!writeResult.success) {
      const debugPath = path.join(PIPE_DIR, taskId, 'coding-fail-debug.json');
      fs.writeFileSync(debugPath, JSON.stringify({ rawContent: result.content, parsedOutput: output }, null, 2));
      throw new Error(writeResult.error);
    }

    this.applyCodingOutput(taskId, output);

    return output;
  }

  applyCodingOutput(taskId, output) {
    const input = this.pipeManager.peekInputBeacon(taskId);
    const projectRoot = input?._meta?.projectRoot || process.cwd();

    // 新格式：files 数组直接写文件
    if (Array.isArray(output.files)) {
      for (const file of output.files) {
        if (!file.path) continue;
        const filePath = path.isAbsolute(file.path) ? file.path : path.join(projectRoot, file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content || '');
      }
      return;
    }

    const patch = output.artifacts?.codePatch;
    if (typeof patch === 'string' && patch.includes('--- ')) {
      const patchPath = path.join(PIPE_DIR, taskId, 'code.patch');
      fs.writeFileSync(patchPath, patch);
      try {
        execSync(['git', 'apply', '--unsafe-paths', '--ignore-whitespace', patchPath], { cwd: projectRoot, timeout: 10000 });
      } catch (e) {
        console.warn(`[applyCodingOutput] git apply failed for ${taskId}: ${e.message}`);
        this.emitLog(taskId, 'warn', `git apply 失败: ${e.message}`);
      }
    }
  }

  /**
   * Review 阶段（DeepSeek-chat + DeepSeek-R1）
   */
  async executeReview(taskId) {
    const specPath = path.join(PIPE_DIR, taskId, 'spec.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const input = this.pipeManager.peekInputBeacon(taskId);
    const projectRoot = input?._meta?.projectRoot || process.cwd();
    const diff = this.getCodeDiff(taskId, projectRoot);

    // Step 1: Pre-filter（DeepSeek-chat）
    const prefilterPrompt = buildPrefilterPrompt(diff);
    const prefilterResult = await this.llmManager.callModel('prefilter', [
      { role: 'user', content: prefilterPrompt }
    ]);
    this.recordCost(taskId, 'prefilter', prefilterResult);

    if (!prefilterResult.success) throw new Error(prefilterResult.error);
    const prefilterReport = await this.extractJSONWithFallback(prefilterResult.content, 'prefilter', taskId);

    const hasCritical = prefilterReport.issues?.some(i => i.severity === 'CRITICAL');
    if (hasCritical) {
      return {
        status: 'fail',
        nextAction: 'request_fix',
        summary: 'Pre-filter 发现严重问题',
        artifacts: { prefilterReport: this.saveReport(taskId, 'prefilter', prefilterReport) }
      };
    }

    // Step 2: Deep Review（DeepSeek-R1）
    const reviewPrompt = buildReviewPrompt(spec, diff, prefilterReport);
    const reviewResult = await this.llmManager.callModel('review', [
      { role: 'user', content: reviewPrompt }
    ]);
    this.recordCost(taskId, 'review', reviewResult);

    if (!reviewResult.success) throw new Error(reviewResult.error);
    console.log('[Review raw content]', reviewResult.content?.substring?.(0, 400));
    this.emitLog(taskId, 'info', `Review 原始内容: ${reviewResult.content?.substring?.(0, 400)}`);
    const reviewReport = await this.extractJSONWithFallback(reviewResult.content, 'review', taskId);
    const reviewPath = this.saveReport(taskId, 'review', reviewReport);

    return {
      status: reviewReport.pass ? 'success' : 'fail',
      nextAction: reviewReport.pass ? 'request_test' : 'request_fix',
      summary: reviewReport.summary || 'Review 完成',
      artifacts: { reviewReport: reviewPath }
    };
  }

  /**
   * Testing 阶段（Kimi）
   */
  async executeTesting(taskId) {
    const specPath = path.join(PIPE_DIR, taskId, 'spec.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const codeFiles = this.loadCodeFiles(taskId);

    const prompt = buildTestingPrompt(spec, codeFiles);
    const result = await this.llmManager.callModel('testing', [
      { role: 'user', content: prompt }
    ]);
    this.recordCost(taskId, 'testing', result);

    if (!result.success) throw new Error(result.error);
    const testReport = await this.extractJSONWithFallback(result.content, 'testing', taskId);
    const testPath = this.saveReport(taskId, 'test', testReport);

    const passRate = testReport.total > 0 ? testReport.passed / testReport.total : 0;

    return {
      status: passRate >= 0.8 ? 'success' : 'fail',
      nextAction: passRate >= 0.8 ? 'request_delivery' : 'request_fix',
      summary: `测试通过率: ${(passRate * 100).toFixed(0)}%`,
      artifacts: { testReport: testPath }
    };
  }

  /**
   * Delivery Gate 阶段（Claude）
   */
  async executeDelivery(taskId) {
    const reviewPath = path.join(PIPE_DIR, taskId, 'review-report.json');
    const testPath = path.join(PIPE_DIR, taskId, 'test-report.json');

    let reviewReport = { pass: true, issues: [], summary: '无 review 报告' };
    let testReport = { total: 0, passed: 0, failed: 0, cases: [] };

    if (fs.existsSync(reviewPath)) {
      reviewReport = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    }
    if (fs.existsSync(testPath)) {
      testReport = JSON.parse(fs.readFileSync(testPath, 'utf8'));
    }

    const prompt = buildDeliveryPrompt(reviewReport, testReport);
    const result = await this.llmManager.callModel('delivery', [
      { role: 'user', content: prompt }
    ]);
    this.recordCost(taskId, 'delivery', result);

    if (!result.success) throw new Error(result.error);
    const decision = await this.extractJSONWithFallback(result.content, 'delivery', taskId);

    if (decision.decision === 'deliver') {
      return {
        status: 'success',
        nextAction: 'complete',
        summary: decision.reason
      };
    } else {
      // 生成 patch 指令，落盘供下一轮 Kimi 读取
      const patchPath = path.join(PIPE_DIR, taskId, 'patch-instructions.json');
      fs.writeFileSync(patchPath, JSON.stringify(decision.patch_instructions || [], null, 2));

      return {
        status: 'fail',
        nextAction: 'request_coding',
        summary: decision.reason
      };
    }
  }

  /**
   * 辅助方法：从 LLM 输出中提取 JSON
   */
  extractJSON(text) {
    if (typeof text !== 'string') {
      throw new Error(`Expected string, got ${typeof text}`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      const blockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (blockMatch) {
        try { return JSON.parse(blockMatch[1]); } catch (e2) {}
      }
      const objMatch = text.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch (e2) {}
      }
      console.error('[extractJSON] Parse failed, raw:', text.substring(0, 400));
      this.emitLog(taskId, 'error', `extractJSON 解析失败, 原始返回:\n${text.substring(0, 400)}`);
      throw new Error('Failed to extract JSON from LLM output');
    }
  }

  async extractJSONWithFallback(text, stage, taskId) {
    try {
      return this.extractJSON(text);
    } catch (e) {
      console.warn(`[extractJSON] 解析失败，尝试自愈重试 (stage=${stage})`);
      this.emitLog(taskId, 'warn', `extractJSON 自愈重试 (stage=${stage})`);
      this.eventBus.emit(EVENTS.SUBSTEP, { taskId, phase: stage, label: 'extractJSON', status: 'retry', detail: `重试: ${e.message}` });
      const schemaHint = this.getSchemaHint(stage);
      const correctionResult = await this.llmManager.callModel(stage, [
        {
          role: 'user',
          content: `你的上一条回复不是合法 JSON。请只输出如下格式的纯 JSON 对象，不要任何说明文字、markdown 代码块或前言：\n\n${schemaHint}\n\n需要重新格式化的内容：\n\n${text}`
        }
      ]);
      this.recordCost(taskId, stage, correctionResult);
      if (!correctionResult.success) throw new Error(`自愈调用失败: ${correctionResult.error}`);
      return this.extractJSON(correctionResult.content);
    }
  }

  getSchemaHint(stage) {
    const hints = {
      planning: `{"task_id":"TASK-xxx","files_to_touch":["src/app.js"],"constraints":[],"acceptance_criteria":[],"coding_hints":""}`,
      coding: `{"version":"1.0","status":"success","summary":"一句话总结","files":[{"path":"src/app.js","content":"..."}],"artifacts":{},"nextAction":"request_review"}`,
      prefilter: `{"passed":true,"issues":[{"severity":"HIGH","description":"...","line":1}]}`,
      review: `{"approved":true,"issues":[],"summary":"..."}`,
      testing: `{"passed":true,"coverage":80,"issues":[]}`,
      delivery: `{"status":"delivered","summary":"...","nextAction":"complete"}`
    };
    return hints[stage] || `{}`;
  }

  /**
   * 辅助方法：保存报告
   */
  saveReport(taskId, type, report) {
    const reportPath = path.join(PIPE_DIR, taskId, `${type}-report.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return reportPath;
  }

  /**
   * 辅助方法：获取项目结构摘要
   */
  getProjectStructure(projectRoot) {
    try {
      const files = [];
      const walk = (dir, prefix) => {
        if (files.length >= 20) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.name === 'node_modules') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(`${prefix}${entry.name}/`);
            walk(fullPath, `${prefix}  `);
          } else {
            files.push(`${prefix}${entry.name}`);
          }
          if (files.length >= 20) break;
        }
      };
      if (fs.existsSync(projectRoot)) {
        walk(projectRoot, '');
      }
      return files.join('\n') || 'src/\n  app.ts\npackage.json';
    } catch (e) {
      return 'src/\n  app.ts\npackage.json';
    }
  }

  /**
   * 辅助方法：加载上下文文件片段
   */
  loadContextFiles(filePaths) {
    if (!Array.isArray(filePaths)) return [];
    return filePaths.map(filePath => {
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '// 新文件';
      return { path: filePath, content };
    });
  }

  /**
   * 辅助方法：获取代码 diff
   */
  getCodeDiff(taskId, projectRoot) {
    try {
      const input = this.pipeManager.peekInputBeacon(taskId);
      const baseCommit = input?._meta?.baseCommit || null;

      let diff = '';

      if (baseCommit) {
        try {
          diff = execSync(['git', 'diff', baseCommit, '--'], {
            cwd: projectRoot || process.cwd(),
            encoding: 'utf8',
            timeout: 10000
          });
        } catch (e) {
        }
      }

      if (!diff || diff.trim().length === 0) {
        diff = '项目未初始化 Git 或无基础快照，无法生成标准 Diff';
      }

      const patchPath = path.join(PIPE_DIR, taskId, 'code.patch');
      fs.writeFileSync(patchPath, diff);
      return diff;
    } catch (error) {
      return '项目未初始化 Git 或无基础快照，无法生成标准 Diff';
    }
  }

  /**
   * 辅助方法：加载代码文件
   */
  loadCodeFiles(taskId) {
    const specPath = path.join(PIPE_DIR, taskId, 'spec.json');
    if (!fs.existsSync(specPath)) return [];
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    return this.loadContextFiles(spec.files_to_touch);
  }

  // ================== 以下方法保留向后兼容 ==================

  async dispatchToActor(taskId, actorType) {
    console.log(`[Orchestrator] 调度 ${taskId} -> ${actorType}`);
    const breaker = this.breakerManager.getBreaker(`actor-${actorType}`, {
      failureThreshold: 3,
      timeout: 60000
    });

    return await breaker.execute(async () => {
      return await this.waitForOutput(taskId, 300000);
    }, { taskId, actorType });
  }

  async spawnWorker(taskId, workerType, task) {
    console.log(`[Orchestrator] spawning ${workerType} for ${taskId}`);

    const workDir = path.join(PIPE_DIR, taskId, 'workers', workerType);
    fs.mkdirSync(workDir, { recursive: true });

    const taskContent = typeof task === 'string' ? task : JSON.stringify(task);

    const prompt = `
${taskContent}

===
【强制约束】
1. 输出必须是 JSON，总字符 < 500
2. 超大内容写入文件，JSON 中只引用路径
3. 违反则任务失败
===`;

    const breaker = this.breakerManager.getBreaker(`worker-${workerType}`, {
      failureThreshold: 5,
      timeout: 120000
    });

    return await breaker.execute(async () => {
      for (let modelIndex = 0; modelIndex < MODELS.length; modelIndex++) {
        const model = MODELS[modelIndex];
        for (let retry = 0; retry < 3; retry++) {
          try {
            console.log(`[Orchestrator] 尝试模型: ${model.id}, 重试: ${retry + 1}/3`);

            const result = await sessions_spawn({
              task: prompt,
              model: model.id,
              timeoutSeconds: model.timeout,
              killOnTimeout: true,
              maxTokens: 150,
              workDir: workDir
            });

            const validated = this.validateAndTruncateWorkerOutput(result, workDir, taskId);

            if (validated.valid) {
              console.log(`[Orchestrator] ${model.id} 输出有效`);
              return { success: true, data: validated.data, model: model.id };
            }

            console.log(`[Orchestrator] ${model.id} 输出无效: ${validated.error}, 重试...`);
          } catch (error) {
            console.error(`[Orchestrator] ${model.id} 失败 (重试 ${retry + 1}):`, error.message);
            if (retry === 2) break;
            await sleep(1000 * (retry + 1));
          }
        }
      }
      throw new Error('All models and retries failed');
    }, { taskId, workerType });
  }

  validateAndTruncateWorkerOutput(output, workDir, taskId) {
    try {
      let data;
      if (typeof output === 'string') {
        const truncatedOutput = output.length > 1000 ? output.substring(0, 1000) : output;
        try {
          data = JSON.parse(truncatedOutput);
        } catch (parseError) {
          const jsonMatch = truncatedOutput.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            data = JSON.parse(jsonMatch[0]);
          } else {
            return { valid: false, error: 'Invalid JSON format', details: parseError.message };
          }
        }
      } else {
        data = output;
      }

      const requiredFields = ['status', 'summary', 'nextAction'];
      for (const field of requiredFields) {
        if (!data[field]) {
          return { valid: false, error: `Missing required field: ${field}` };
        }
      }

      if (data.summary && data.summary.length > 100) {
        data.summary = data.summary.substring(0, 97) + '...';
      }

      if (data.error && data.error.length > 200) {
        data.error = data.error.substring(0, 197) + '...';
      }

      let compact = JSON.stringify(data);
      if (compact.length > 500) {
        data = {
          version: data.version || '1.0',
          status: data.status,
          summary: (data.summary || 'Output truncated').substring(0, 50),
          nextAction: data.nextAction,
          artifacts: data.artifacts || {}
        };
        compact = JSON.stringify(data);
        if (compact.length > 500) {
          return { valid: false, error: `Output still too large after truncation: ${compact.length}` };
        }
      }

      const validStatuses = ['success', 'fail', 'error'];
      if (!validStatuses.includes(data.status)) {
        return { valid: false, error: `Invalid status: ${data.status}` };
      }

      const validActions = ['request_review', 'request_test', 'request_fix', 'complete', 'spawn_crawler', 'request_coding', 'request_delivery'];
      if (!validActions.includes(data.nextAction)) {
        return { valid: false, error: `Invalid nextAction: ${data.nextAction}` };
      }

      return { valid: true, data };
    } catch (e) {
      return { valid: false, error: 'Validation exception', details: e.message };
    }
  }

  async waitForOutput(taskId, timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = this.pipeManager.readOutput(taskId, false);
      if (result.success) {
        return result;
      }
      await sleep(1000);
    }
    return { success: false, error: 'Timeout waiting for output' };
  }

  async handleNextAction(taskId, output) {
    const { nextAction, artifacts } = output.data || output;

    switch (nextAction) {
      case 'request_review':
        console.log(`[Orchestrator] ${taskId} -> Reviewer`);
        return await this.dispatchToActor(taskId, 'reviewer');
      case 'request_test':
        console.log(`[Orchestrator] ${taskId} -> Tester`);
        return await this.dispatchToActor(taskId, 'tester');
      case 'spawn_crawler':
        console.log(`[Orchestrator] ${taskId} -> Spawn Crawler`);
        return await this.spawnWorker(taskId, 'crawler', {
          type: 'crawl',
          target: artifacts?.crawlTarget,
          taskId: taskId
        });
      case 'request_fix':
        console.log(`[Orchestrator] ${taskId} -> Fixer`);
        return await this.dispatchToActor(taskId, 'fixer');
      case 'complete':
        console.log(`[Orchestrator] ${taskId} 完成`);
        return { success: true, status: 'completed' };
      default:
        return { success: false, error: `Unknown nextAction: ${nextAction}` };
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { Orchestrator };

// CLI
if (require.main === module) {
  const orchestrator = new Orchestrator();

  const resumed = orchestrator.resumePendingTasks();
  if (resumed.length > 0) {
    console.log(`[Orchestrator] 发现 ${resumed.length} 个未完成任务，恢复中...`);
    const resumePromises = resumed
      .filter(r => r.action !== 'wait')
      .map(r => orchestrator.runWorkflow(r.taskId));

    Promise.all(resumePromises).then(results => {
      console.log('[Orchestrator] 恢复任务完成:', results.map(r => r.success));
    });
  }

  const taskId = `TASK-${Date.now()}`;
  orchestrator.createTask(taskId, 'feature', '实现用户登录API', {
    projectRoot: '/home/jadekun/project/my-app',
    contextFiles: ['src/auth/types.ts']
  });

  orchestrator.runWorkflow(taskId).then(result => {
    console.log('Result:', result);
    process.exit(result.success ? 0 : 1);
  });
}
