const fs = require('fs');
const path = require('path');
const { ClaudeClient } = require('../llm-clients/claude-client');
const { KimiClient } = require('../llm-clients/kimi-client');
const { DeepSeekClient } = require('../llm-clients/deepseek-client');
const { GLMClient } = require('../llm-clients/glm-client');
const { SiliconFlowClient } = require('../llm-clients/siliconflow-client');
const { CircuitBreakerManager } = require('./circuit-breaker');
const { CostTracker } = require('./cost-tracker');

class LLMManager {
  constructor(configPath, options = {}) {
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.clients = {};
    this.breakerManager = new CircuitBreakerManager();
    this.stats = { totalCalls: 0, totalTokens: { input: 0, output: 0, reasoning: 0 }, byStage: {} };

    this.costTracker = options.costTracker || null;
  }

  /**
   * 获取或创建客户端
   */
  getClient(stage) {
    if (this.clients[stage]) return this.clients[stage];

    const modelConfig = this.config.models[stage];
    if (!modelConfig) throw new Error(`Unknown stage: ${stage}`);

    const apiKey = this.resolveApiKey(modelConfig.provider);
    const ClientClass = this.getClientClass(modelConfig.provider);

    const envBaseURLMap = {
      claude: process.env.CLAUDE_BASE_URL,
      glm: process.env.GLM_BASE_URL,
      deepseek: process.env.DEEPSEEK_BASE_URL,
      kimi: process.env.KIMI_BASE_URL,
      siliconflow: process.env.SILICONFLOW_BASE_URL
    };
    const baseURL = modelConfig.baseURL || envBaseURLMap[modelConfig.provider] || undefined;

    this.clients[stage] = new ClientClass({
      apiKey,
      model: modelConfig.model,
      timeout: (modelConfig.timeout || 60) * 1000,
      baseURL
    });

    return this.clients[stage];
  }

  /**
   * 统一调用接口
   */
  async callModel(stage, messages, options = {}) {
    // Mock 模式：不调用真实 API，直接返回模拟数据
    if (process.env.OPC_SPAWN_MODE === 'mock') {
      const mockContent = this.generateMockResponse(stage);
      this.stats.totalCalls++;
      return {
        success: true,
        content: JSON.stringify(mockContent),
        usage: { input: 10, output: 10 }
      };
    }

    const client = this.getClient(stage);
    const modelConfig = this.config.models[stage];

    // 合并配置
    const callOptions = {
      maxTokens: options.maxTokens || modelConfig.maxTokens,
      temperature: options.temperature ?? modelConfig.temperature,
      stopSequences: options.stopSequences || [],
      jsonMode: modelConfig.jsonMode || false
    };

    // 熔断器保护
    const breaker = this.breakerManager.getBreaker(`llm-${stage}`, {
      failureThreshold: 3,
      timeout: 60000
    });

    const result = await breaker.execute(async () => {
      return await client.chat(messages, callOptions);
    });

    // 统计
    if (result.success && result.usage) {
      this.stats.totalCalls++;
      this.stats.totalTokens.input += result.usage.input || 0;
      this.stats.totalTokens.output += result.usage.output || 0;
      if (result.usage.reasoning) {
        this.stats.totalTokens.reasoning += result.usage.reasoning;
      }

      // 按阶段记录
      if (!this.stats.byStage[stage]) {
        this.stats.byStage[stage] = { calls: 0, input: 0, output: 0, reasoning: 0 };
      }
      this.stats.byStage[stage].calls++;
      this.stats.byStage[stage].input += result.usage.input || 0;
      this.stats.byStage[stage].output += result.usage.output || 0;
      this.stats.byStage[stage].reasoning += result.usage.reasoning || 0;

      const maxReasoning = modelConfig.maxReasoningTokens;
      if (maxReasoning && result.usage.reasoning && result.usage.reasoning > maxReasoning) {
        console.warn(`[WARN] DeepSeek-R1 推理 Token 极高 (${result.usage.reasoning} > ${maxReasoning})，请注意 API 账单！`);
      }

      if (this.costTracker && options.taskId) {
        const costUsage = {
          input_tokens: result.usage.input || 0,
          output_tokens: result.usage.output || 0,
          reasoning_tokens: result.usage.reasoning || 0
        };
        try {
          const cost = this.costTracker.recordCall(options.taskId, stage, modelConfig.model, costUsage);
          console.log(`[CostTracker] ${stage}: model=${modelConfig.model}, cost=¥${cost}`);
        } catch (e) {
          console.error(`[CostTracker] 记录失败: ${e.message}`);
        }
      }
    }

    return result;
  }

  resolveApiKey(provider) {
    const keyConfig = this.config.apiKeys[provider];
    if (!keyConfig) throw new Error(`Missing API key config for provider: ${provider}`);
    if (keyConfig.startsWith('env:')) {
      const envVar = keyConfig.substring(4);
      const key = process.env[envVar];
      if (!key) throw new Error(`Missing environment variable: ${envVar}`);
      return key;
    }
    return keyConfig;
  }

  getClientClass(provider) {
    const map = {
      claude: ClaudeClient,
      kimi: KimiClient,
      deepseek: DeepSeekClient,
      glm: GLMClient,
      siliconflow: SiliconFlowClient
    };
    const ClientClass = map[provider];
    if (!ClientClass) throw new Error(`Unknown provider: ${provider}`);
    return ClientClass;
  }

  getStats() {
    return { ...this.stats };
  }

  writeCostReport(taskId, archiveDir) {
    if (!this.costTracker) return null;
    return this.costTracker.writeReport(taskId, archiveDir);
  }

  generateMockResponse(stage) {
    const mocks = {
      planning: {
        version: '1.0',
        status: 'success',
        summary: 'Mock plan',
        nextAction: 'request_coding',
        task_id: 'MOCK',
        files_to_touch: ['src/app.ts'],
        constraints: [],
        acceptance_criteria: [],
        coding_hints: ''
      },
      coding: {
        version: '1.0',
        status: 'success',
        summary: 'Mock code',
        nextAction: 'request_review',
        artifacts: {}
      },
      prefilter: {
        version: '1.0',
        status: 'success',
        summary: 'Prefilter passed',
        pass: true,
        issues: []
      },
      review: {
        version: '1.0',
        status: 'success',
        summary: 'Review passed',
        nextAction: 'request_test',
        pass: true,
        issues: []
      },
      testing: {
        version: '1.0',
        status: 'success',
        summary: 'Tests passed',
        nextAction: 'request_delivery',
        total: 5,
        passed: 5,
        failed: 0,
        cases: []
      },
      delivery: {
        version: '1.0',
        status: 'success',
        summary: 'Delivered',
        nextAction: 'complete',
        decision: 'deliver',
        reason: 'Mock delivery',
        patch_instructions: []
      }
    };
    return mocks[stage] || { version: '1.0', status: 'success', summary: 'Mock', nextAction: 'complete' };
  }
}

module.exports = { LLMManager };
