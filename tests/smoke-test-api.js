#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { LLMManager } = require('../src/llm-manager');

const STAGES = ['planning', 'coding', 'prefilter', 'review', 'testing', 'delivery'];
const PROVIDER_MAP = {
  planning: 'Claude/Anthropic',
  coding: 'GLM/智谱',
  prefilter: 'DeepSeek-chat',
  review: 'DeepSeek-R1',
  testing: 'Kimi/月之暗面',
  delivery: 'Claude/Anthropic'
};

async function runSmokeTest() {
  console.log('='.repeat(50));
  console.log('LLM API 冒烟测试（含延迟统计）');
  console.log('='.repeat(50));

  const manager = new LLMManager(path.join(__dirname, '..', 'config', 'models.json'));
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const stage of STAGES) {
    const provider = PROVIDER_MAP[stage];
    const start = Date.now();
    try {
      const client = manager.getClient(stage);
      const ok = await client.healthCheck();
      const latency = Date.now() - start;
      if (ok) {
        console.log(`✓ ${stage.padEnd(12)} ${provider.padEnd(18)} ${latency}ms`);
        passed++;
        results.push({ stage, provider, status: 'OK', latency });
      } else {
        console.log(`✗ ${stage.padEnd(12)} ${provider.padEnd(18)} healthCheck返回false (${latency}ms)`);
        failed++;
        results.push({ stage, provider, status: 'FAIL', latency, error: 'healthCheck returned false' });
      }
    } catch (e) {
      const latency = Date.now() - start;
      console.log(`✗ ${stage.padEnd(12)} ${provider.padEnd(18)} ${e.message} (${latency}ms)`);
      failed++;
      results.push({ stage, provider, status: 'ERROR', latency, error: e.message });
    }
  }

  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));

  const reportPath = path.join(__dirname, 'var', 'smoke-test-report.txt');
  fs.mkdirSync(path.join(__dirname, 'var'), { recursive: true });
  const lines = [
    'OPC Pipeline Smoke Test Report',
    `时间: ${new Date().toISOString()}`,
    `结果: ${passed}/${STAGES.length} 通过`,
    '',
    ...results.map(r =>
      r.status === 'OK'
        ? `${r.stage}:${r.provider}:${r.status}:${r.latency}ms`
        : `${r.stage}:${r.provider}:${r.status}:${r.latency}ms:${r.error}`
    )
  ];
  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`\n报告已写入: ${reportPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

runSmokeTest();
