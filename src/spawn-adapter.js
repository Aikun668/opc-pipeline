/**
 * Spawn Adapter - 封装实际的 Worker 调用逻辑
 *
 * 为什么需要这个文件：
 * OpenClaw 的 sessions_spawn 是平台提供的 Tool/CLI，不是 npm 模块。
 * 直接 require('openclaw') 会导致 MODULE_NOT_FOUND 崩溃。
 *
 * 这个适配器提供三种模式：
 * 1. api    - 调用真实 LLM API（生产环境）
 * 2. cli    - 通过子进程调用 openclaw CLI
 * 3. mock   - 返回模拟结果（本地测试）
 *
 * 通过环境变量 OPC_SPAWN_MODE 切换，默认 mock。
 */

const { execSync } = require('child_process');
const path = require('path');
const { LLMManager } = require('./llm-manager');

const SPAWN_MODE = process.env.OPC_SPAWN_MODE || 'mock';
let llmManager = null;

// 懒加载 LLMManager
function getLLMManager() {
  if (!llmManager) {
    const configPath = path.join(__dirname, 'config', 'models.json');
    llmManager = new LLMManager(configPath);
  }
  return llmManager;
}

/**
 * 统一的 spawn 接口
 * @param {Object} options
 * @param {string} options.task - 任务 prompt
 * @param {string} options.model - 模型 ID
 * @param {number} options.timeoutSeconds - 超时秒数
 * @param {boolean} options.killOnTimeout - 超时是否 kill
 * @param {number} options.maxTokens - 最大 token 数
 * @param {string} options.workDir - 工作目录
 * @param {string} options.stage - API 模式要求的阶段 (planning|coding|prefilter|review|testing|delivery)
 * @returns {Promise<string>} LLM 原始输出
 */
async function sessions_spawn(options) {
  switch (SPAWN_MODE) {
    case 'api':
      return await spawnViaAPI(options);
    case 'cli':
      return await spawnViaCli(options);
    case 'mock':
      return await spawnMock(options);
    default:
      throw new Error(`Unknown OPC_SPAWN_MODE: ${SPAWN_MODE}`);
  }
}

/**
 * API 模式：调用真实 LLM API
 */
async function spawnViaAPI(options) {
  const { task, stage } = options;

  // stage 必须是: planning | coding | prefilter | review | testing | delivery
  if (!stage) {
    throw new Error('API mode requires "stage" parameter');
  }

  const manager = getLLMManager();
  const messages = [{ role: 'user', content: task }];
  const result = await manager.callModel(stage, messages);

  if (!result.success) {
    throw new Error(`LLM API call failed: ${result.error}`);
  }

  return result.content;
}

/**
 * CLI 模式：通过子进程调用 openclaw 命令行
 * 当 OpenClaw 提供了真实的 CLI spawn 命令时使用
 */
async function spawnViaCli(options) {
  const { task, model, timeoutSeconds, maxTokens, workDir } = options;

  const timeoutMs = (timeoutSeconds || 300) * 1000;

  try {
    const result = execSync(
      `openclaw sessions spawn --model "${model}" --max-tokens ${maxTokens || 150} --timeout ${timeoutSeconds || 300}`,
      {
        input: task,
        cwd: workDir || process.cwd(),
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 // 1MB
      }
    );

    return result.trim();
  } catch (error) {
    if (error.killed) {
      throw new Error(`Spawn timeout after ${timeoutSeconds}s (model: ${model})`);
    }
    throw new Error(`Spawn CLI failed: ${error.message}`);
  }
}

/**
 * Mock 模式：返回模拟结果，用于本地测试
 * 不调用任何外部服务，保证流程能跑通
 */
async function spawnMock(options) {
  const { task, model, workDir, stage } = options;

  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 500));

  const taskLower = (task || '').toLowerCase();
  const isAnalyze = taskLower.includes('analyze') || taskLower.includes('分析') || taskLower.includes('planning');
  const isValidate = taskLower.includes('validate') || taskLower.includes('验证') || taskLower.includes('delivery');
  const isCrawl = taskLower.includes('crawl') || taskLower.includes('爬');

  let mockResponse;

  if (isAnalyze || stage === 'planning') {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'Task analysis completed',
      nextAction: 'request_coding',
      artifacts: {
        spec: { task_id: 'MOCK', files_to_touch: ['src/mock.ts'], constraints: [], acceptance_criteria: [] }
      }
    };
  } else if (isValidate || stage === 'delivery') {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'QA validation passed',
      nextAction: 'complete',
      artifacts: {}
    };
  } else if (isCrawl) {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'Crawl completed',
      nextAction: 'complete',
      artifacts: {}
    };
  } else if (stage === 'coding') {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'Mock coding completed',
      nextAction: 'request_review',
      artifacts: {}
    };
  } else if (stage === 'prefilter') {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'Prefilter passed',
      pass: true,
      issues: []
    };
  } else if (stage === 'review') {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'Review passed',
      nextAction: 'request_test',
      pass: true,
      issues: []
    };
  } else if (stage === 'testing') {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: 'Tests passed',
      nextAction: 'request_delivery',
      total: 5,
      passed: 5,
      failed: 0,
      cases: []
    };
  } else {
    mockResponse = {
      version: '1.0',
      status: 'success',
      summary: `Mock completed (model: ${model})`,
      nextAction: 'request_review',
      artifacts: {}
    };
  }

  console.log(`[SpawnAdapter:mock] stage=${stage || 'none'}, model=${model || 'none'}, workDir=${workDir || 'none'}`);
  return JSON.stringify(mockResponse);
}

module.exports = { sessions_spawn, getLLMManager };
