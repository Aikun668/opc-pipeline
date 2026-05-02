#!/usr/bin/env node
/**
 * reviewer-init.js - Reviewer 启动脚本
 * 读取 Builder 报告，打印摘要，提示审查重点
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'var', 'dev-loop', 'active', '02-builder-report.md');

function showHelp() {
  console.log(`
reviewer-init.js - Reviewer 启动助手

用法:
  node scripts/reviewer-init.js          打印 Builder 报告摘要
  node scripts/reviewer-init.js --json   以 JSON 格式输出解析结果
  node scripts/reviewer-init.js --help   显示帮助信息

说明:
  读取 var/dev-loop/active/02-builder-report.md，
  解析任务 ID、执行结果、修改文件、审查重点，提示 Reviewer 工作方向。
`);
}

function parseReport(content) {
  const result = {
    taskId: '',
    result: '',
    modifiedFiles: [],
    acceptanceStatus: [],
    testResults: '',
    knownIssues: '',
    reviewerFocus: '',
    raw: content
  };

  const taskMatch = content.match(/##\s*任务\s*ID\s*\n+\s*(.+)/) ||
                    content.match(/任务\s*ID[:：]\s*(.+)/);
  if (taskMatch) result.taskId = taskMatch[1].trim();

  const resultMatch = content.match(/##\s*执行结果\s*\n+\s*(.+)/) ||
                      content.match(/结果[:：]\s*(.+)/);
  if (resultMatch) result.result = resultMatch[1].trim();

  const filesMatch = content.match(/##\s*修改文件清单\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (filesMatch) {
    result.modifiedFiles = filesMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('文件'));
  }

  const criteriaMatch = content.match(/##\s*验收标准完成情况\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (criteriaMatch) {
    result.acceptanceStatus = criteriaMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- ['));
  }

  const testMatch = content.match(/##\s*测试结果\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (testMatch) result.testResults = testMatch[1].trim();

  const issuesMatch = content.match(/##\s*已知问题(?:\s*\/\s*注意事项)?\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (issuesMatch) result.knownIssues = issuesMatch[1].trim();

  const focusMatch = content.match(/##\s*请求\s*Reviewer\s*关注点\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  if (focusMatch) result.reviewerFocus = focusMatch[1].trim();

  return result;
}

function printSummary(parsed) {
  console.log('═══════════════════════════════════════');
  console.log('  Reviewer 启动 - Builder 报告摘要');
  console.log('═══════════════════════════════════════');
  console.log();
  console.log(`  任务 ID:   ${parsed.taskId}`);
  console.log(`  执行结果: ${parsed.result}`);
  console.log();

  if (parsed.modifiedFiles.length > 0) {
    console.log('  修改文件清单:');
    parsed.modifiedFiles.forEach(f => console.log(`    ${f}`));
    console.log();
  }

  if (parsed.acceptanceStatus.length > 0) {
    console.log('  验收标准完成情况:');
    parsed.acceptanceStatus.forEach(c => console.log(`    ${c}`));
    console.log();
  }

  if (parsed.testResults) {
    console.log('  测试结果:');
    console.log(`    ${parsed.testResults.split('\n').join('\n    ')}`);
    console.log();
  }

  if (parsed.reviewerFocus) {
    console.log('  ⚠️  请求 Reviewer 关注:');
    console.log(`    ${parsed.reviewerFocus.split('\n').join('\n    ')}`);
    console.log();
  }

  console.log('───────────────────────────────────────');
  console.log('  Reviewer 准备就绪，请审查以上内容。');
  console.log('  完成后填写 var/dev-loop/active/03-reviewer-summary.md');
  console.log('───────────────────────────────────────');
}

const args = process.argv.slice(2);

if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

if (!fs.existsSync(REPORT_PATH)) {
  console.error(`错误: 找不到报告文件 ${REPORT_PATH}`);
  process.exit(1);
}

const content = fs.readFileSync(REPORT_PATH, 'utf8');
const parsed = parseReport(content);

if (args.includes('--json')) {
  console.log(JSON.stringify(parsed, null, 2));
} else {
  printSummary(parsed);
}
