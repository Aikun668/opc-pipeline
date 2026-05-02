#!/usr/bin/env node
/**
 * builder-init.js - Builder 启动脚本
 * 读取 Planner 指令，打印摘要，提示工作重点
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INSTRUCTION_PATH = path.join(ROOT, 'var', 'dev-loop', 'active', '01-planner-instruction.md');

function showHelp() {
  console.log(`
builder-init.js - Builder 启动助手

用法:
  node scripts/builder-init.js          打印当前指令摘要
  node scripts/builder-init.js --json   以 JSON 格式输出解析结果
  node scripts/builder-init.js --help   显示帮助信息

说明:
  读取 var/dev-loop/active/01-planner-instruction.md，
  解析任务 ID、类型、目标、验收标准，提示 Builder 工作重点。
`);
}

function parseInstruction(content) {
  const result = {
    taskId: '',
    taskType: '',
    goal: '',
    acceptanceCriteria: [],
    constraints: [],
    keyPaths: [],
    raw: content
  };

  // 任务 ID
  const taskMatch = content.match(/##\s*任务\s*ID\s*\n+\s*(.+)/);
  if (taskMatch) result.taskId = taskMatch[1].trim();

  // 任务类型
  const typeMatch = content.match(/##\s*任务类型\s*\n+\s*(.+)/);
  if (typeMatch) result.taskType = typeMatch[1].trim();

  // 目标
  const goalMatch = content.match(/##\s*目标\s*\n+\s*(.+)/);
  if (goalMatch) result.goal = goalMatch[1].trim();

  // 验收标准
  const criteriaMatch = content.match(/##\s*验收标准\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (criteriaMatch) {
    result.acceptanceCriteria = criteriaMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[-*]\s+\\?\[/.test(l));
  }

  // 约束条件
  const constraintsMatch = content.match(/##\s*约束条件\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (constraintsMatch) {
    result.constraints = constraintsMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('-') && l.length > 1);
  }

  // 关键文件路径
  const pathsMatch = content.match(/##\s*关键文件路径\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (pathsMatch) {
    result.keyPaths = pathsMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('```'));
  }

  return result;
}

function printSummary(parsed) {
  console.log('═══════════════════════════════════════');
  console.log('  Builder 启动 - 当前指令摘要');
  console.log('═══════════════════════════════════════');
  console.log();
  console.log(`  任务 ID:   ${parsed.taskId}`);
  console.log(`  任务类型: ${parsed.taskType}`);
  console.log(`  目标:     ${parsed.goal}`);
  console.log();

  if (parsed.acceptanceCriteria.length > 0) {
    console.log('  验收标准:');
    parsed.acceptanceCriteria.forEach(c => console.log(`    ${c}`));
    console.log();
  }

  if (parsed.constraints.length > 0) {
    console.log('  约束条件:');
    parsed.constraints.forEach(c => console.log(`    ${c}`));
    console.log();
  }

  if (parsed.keyPaths.length > 0) {
    console.log('  关键文件:');
    parsed.keyPaths.forEach(p => console.log(`    ${p}`));
    console.log();
  }

  console.log('───────────────────────────────────────');
  console.log('  Builder 准备就绪，请开始工作。');
  console.log('  完成后填写 var/dev-loop/active/02-builder-report.md');
  console.log('───────────────────────────────────────');
}

// Main
const args = process.argv.slice(2);

if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

if (!fs.existsSync(INSTRUCTION_PATH)) {
  console.error(`错误: 找不到指令文件 ${INSTRUCTION_PATH}`);
  process.exit(1);
}

const content = fs.readFileSync(INSTRUCTION_PATH, 'utf8');
const parsed = parseInstruction(content);

if (args.includes('--json')) {
  console.log(JSON.stringify(parsed, null, 2));
} else {
  printSummary(parsed);
}
