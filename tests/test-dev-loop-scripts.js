#!/usr/bin/env node
/**
 * test-dev-loop-scripts.js - Dev-Loop 脚本验证测试
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const ACTIVE_DIR = path.join(ROOT, 'var', 'dev-loop', 'active');
const ARCHIVE_DIR = path.join(ROOT, 'var', 'dev-loop', 'archive');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failCount++;
  }
}

function runScript(scriptName, args = []) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const argList = Array.isArray(args) ? args : args ? [args] : [];
  try {
    return execFileSync(process.execPath, [scriptPath, ...argList], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: ROOT
    });
  } catch (e) {
    return e.stdout || e.message;
  }
}

// ========== builder-init.js ==========

test('builder-init.js 文件存在', () => {
  assert(fs.existsSync(path.join(SCRIPTS_DIR, 'builder-init.js')), 'builder-init.js 不存在');
});

test('builder-init.js --help 输出包含用法说明', () => {
  const output = runScript('builder-init.js', '--help');
  assert(output.includes('用法'), '--help 缺少用法说明');
  assert(output.includes('builder-init.js'), '--help 缺少脚本名称');
});

test('builder-init.js 默认输出包含指令摘要', () => {
  const output = runScript('builder-init.js');
  assert(output.includes('任务 ID'), '缺少任务 ID 字段');
  assert(output.includes('任务类型'), '缺少任务类型字段');
  assert(output.includes('目标'), '缺少目标字段');
  assert(output.includes('验收标准'), '缺少验收标准字段');
});

test('builder-init.js 默认输出包含准备就绪提示', () => {
  const output = runScript('builder-init.js');
  assert(output.includes('Builder 准备就绪'), '缺少准备就绪提示');
  assert(output.includes('02-builder-report.md'), '缺少报告文件提示');
});

test('builder-init.js --json 输出合法 JSON', () => {
  const output = runScript('builder-init.js', '--json');
  const parsed = JSON.parse(output);
  assert(typeof parsed.taskId === 'string', 'taskId 不是字符串');
  assert(typeof parsed.goal === 'string', 'goal 不是字符串');
  assert(Array.isArray(parsed.acceptanceCriteria), 'acceptanceCriteria 不是数组');
});

// ========== reviewer-init.js ==========

test('reviewer-init.js 文件存在', () => {
  assert(fs.existsSync(path.join(SCRIPTS_DIR, 'reviewer-init.js')), 'reviewer-init.js 不存在');
});

test('reviewer-init.js --help 输出包含用法说明', () => {
  const output = runScript('reviewer-init.js', '--help');
  assert(output.includes('用法'), '--help 缺少用法说明');
  assert(output.includes('reviewer-init.js'), '--help 缺少脚本名称');
});

test('reviewer-init.js 默认输出包含报告摘要', () => {
  const output = runScript('reviewer-init.js');
  assert(output.includes('任务 ID'), '缺少任务 ID 字段');
  assert(output.includes('执行结果'), '缺少执行结果字段');
});

test('reviewer-init.js 默认输出包含准备就绪提示', () => {
  const output = runScript('reviewer-init.js');
  assert(output.includes('Reviewer 准备就绪'), '缺少准备就绪提示');
  assert(output.includes('03-reviewer-summary.md'), '缺少报告文件提示');
});

test('reviewer-init.js --json 输出合法 JSON', () => {
  const output = runScript('reviewer-init.js', '--json');
  const parsed = JSON.parse(output);
  assert(typeof parsed.taskId === 'string', 'taskId 不是字符串');
  assert(typeof parsed.result === 'string', 'result 不是字符串');
  assert(Array.isArray(parsed.modifiedFiles), 'modifiedFiles 不是数组');
});

// ========== planner-archive.js ==========

test('planner-archive.js 文件存在', () => {
  assert(fs.existsSync(path.join(SCRIPTS_DIR, 'planner-archive.js')), 'planner-archive.js 不存在');
});

test('planner-archive.js --help 输出包含用法说明', () => {
  const output = runScript('planner-archive.js', '--help');
  assert(output.includes('用法'), '--help 缺少用法说明');
  assert(output.includes('planner-archive.js'), '--help 缺少脚本名称');
});

test('planner-archive.js --dry 不修改文件', () => {
  const before01 = fs.readFileSync(path.join(ACTIVE_DIR, '01-planner-instruction.md'), 'utf8');
  const output = runScript('planner-archive.js', '--dry');
  const after01 = fs.readFileSync(path.join(ACTIVE_DIR, '01-planner-instruction.md'), 'utf8');
  assert(before01 === after01, '--dry 模式修改了文件');
  assert(output.includes('[DRY]'), '--dry 输出缺少 [DRY] 标记');
  assert(output.includes('[DRY RUN]'), '--dry 输出缺少 [DRY RUN] 总结');
});

test('planner-archive.js 实际执行归档', () => {
  const output = runScript('planner-archive.js');
  assert(output.includes('已归档'), '输出缺少"已归档"标记');
  assert(output.includes('已重置模板'), '输出缺少"已重置模板"标记');
  assert(output.includes('归档完成'), '输出缺少"归档完成"标记');

  const entries = fs.readdirSync(ARCHIVE_DIR).filter(d => d.startsWith('round-'));
  assert(entries.length > 0, 'archive 目录下没有 round- 目录');

  const latestRound = entries.sort().pop();
  const roundDir = path.join(ARCHIVE_DIR, latestRound);
  assert(fs.existsSync(path.join(roundDir, '01-planner-instruction.md')), '归档缺少 01 文件');
  assert(fs.existsSync(path.join(roundDir, '02-builder-report.md')), '归档缺少 02 文件');
  assert(fs.existsSync(path.join(roundDir, '03-reviewer-summary.md')), '归档缺少 03 文件');
});

test('planner-archive.js 归档后 active 文件已重置为模板', () => {
  const content01 = fs.readFileSync(path.join(ACTIVE_DIR, '01-planner-instruction.md'), 'utf8');
  const content02 = fs.readFileSync(path.join(ACTIVE_DIR, '02-builder-report.md'), 'utf8');
  const content03 = fs.readFileSync(path.join(ACTIVE_DIR, '03-reviewer-summary.md'), 'utf8');

  assert(content01.includes('TASK-XXX-NNN'), '01 模板未正确重置');
  assert(content02.includes('修改文件清单'), '02 模板未正确重置');
  assert(content03.includes('审查结论'), '03 模板未正确重置');
});

test('planner-archive.js round 编号自增', () => {
  runScript('planner-archive.js');
  const entries = fs.readdirSync(ARCHIVE_DIR).filter(d => d.startsWith('round-'));
  const nums = entries.map(d => parseInt(d.replace('round-', ''), 10)).sort((a, b) => a - b);

  assert(nums.length >= 2, '至少应有 2 个 round 目录');
  const lastTwo = nums.slice(-2);
  assert(lastTwo[1] === lastTwo[0] + 1, `round 编号不自增: ${lastTwo[0]} → ${lastTwo[1]}`);
});

// ========== 总结 ==========

console.log('\n================================');
console.log(`结果: ${passCount} 通过, ${failCount} 失败`);
console.log('================================');

process.exit(failCount > 0 ? 1 : 0);
