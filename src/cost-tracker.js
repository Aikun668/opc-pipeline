const fs = require('fs');
const path = require('path');

class BudgetExceededError extends Error {
  constructor(cost, limit, modelId) {
    super(`Budget exceeded: ¥${cost.toFixed(4)} > ¥${limit.toFixed(2)} (model: ${modelId})`);
    this.name = 'BudgetExceededError';
    this.cost = cost;
    this.limit = limit;
    this.modelId = modelId;
  }
}

class CostTracker {
  constructor(pricingConfigPath) {
    this.pricing = JSON.parse(fs.readFileSync(pricingConfigPath, 'utf8'));
    this.aliases = this.pricing.aliases || {};
    this.records = {};
  }

  resolveModelId(modelId) {
    return this.aliases[modelId] || modelId;
  }

  calculateCallCost(modelId, usage) {
    const resolved = this.resolveModelId(modelId);
    const rates = this.pricing[resolved];
    if (!rates) return 0;

    const inputCost = (usage.input_tokens || 0) * rates.input / 1000;
    const outputCost = (usage.output_tokens || 0) * rates.output / 1000;
    const reasoningCost = (usage.reasoning_tokens || 0) * (rates.reasoning || 0) / 1000;
    return Math.round((inputCost + outputCost + reasoningCost) * 10000) / 10000;
  }

  recordCall(taskId, phase, modelId, usage) {
    if (!this.records[taskId]) {
      this.records[taskId] = { phases: [], totalCost: 0, totalTokens: { input: 0, output: 0, reasoning: 0 } };
    }

    const cost = this.calculateCallCost(modelId, usage);

    this.records[taskId].phases.push({
      phase,
      model: modelId,
      tokens: {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        reasoning: usage.reasoning_tokens || 0
      },
      cost
    });

    this.records[taskId].totalCost = Math.round((this.records[taskId].totalCost + cost) * 10000) / 10000;
    this.records[taskId].totalTokens.input += usage.input_tokens || 0;
    this.records[taskId].totalTokens.output += usage.output_tokens || 0;
    this.records[taskId].totalTokens.reasoning += usage.reasoning_tokens || 0;

    return cost;
  }

  getTaskCost(taskId) {
    return this.records[taskId] || null;
  }

  writeReport(taskId, archiveDir) {
    const record = this.records[taskId];
    if (!record) return null;

    fs.mkdirSync(archiveDir, { recursive: true });

    const report = {
      taskId,
      completedAt: new Date().toISOString(),
      totalCost: record.totalCost,
      totalTokens: record.totalTokens,
      phases: record.phases
    };

    const filePath = path.join(archiveDir, `cost-${taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    return filePath;
  }
}

module.exports = { CostTracker, BudgetExceededError };
