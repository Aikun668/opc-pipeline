#!/usr/bin/env node
/**
 * planner-archive.js - Planner 归档脚本
 * 将 active/ 下三个文件归档到 archive/round-NNN/，并重置为空白模板
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ACTIVE_DIR = path.join(ROOT, 'var', 'dev-loop', 'active');
const ARCHIVE_DIR = path.join(ROOT, 'var', 'dev-loop', 'archive');

const ACTIVE_FILES = [
  '01-planner-instruction.md',
  '02-builder-report.md',
  '03-reviewer-summary.md'
];

const TEMPLATES = {
  '01-planner-instruction.md': `# Planner 指令 | Round XXX | 日期

## 任务 ID
TASK-XXX-NNN

## 任务类型
[feature / bugfix / refactor / test / infra]

## 目标
（一句话）

## 验收标准
- [ ] 条件 1
- [ ] 条件 2

## 约束条件
-

## 关键文件路径
-

## 给 Builder 的注意事项
-
`,
  '02-builder-report.md': `# Builder 报告 | Round XXX | 日期

## 任务 ID
TASK-XXX-NNN

## 执行结果
[成功 / 失败 / 部分完成]

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|

## 验收标准完成情况
- [ ] 条件 1 → [完成/未完成/跳过] 说明
- [ ] 条件 2 → [完成/未完成/跳过] 说明

## 测试结果
（运行了什么测试，结果如何）

## 已知问题 / 注意事项
-

## 请求 Reviewer 关注点
-
`,
  '03-reviewer-summary.md': `# Reviewer 总结 | Round XXX | 日期

## 任务 ID
TASK-XXX-NNN

## 审查结论
[通过 / 通过（有建议）/ 拒绝]

## 问题清单
| 严重级别 | 位置 | 描述 | 是否阻塞 |
|----------|------|------|----------|

## 给 Planner 的建议
-

## 下一轮方向建议
-
`
};

function showHelp() {
  console.log(`
planner-archive.js - Dev-Loop 归档助手

用法:
  node scripts/planner-archive.js          归档当前 active/ 文件并重置
  node scripts/planner-archive.js --dry    仅预览，不实际操作
  node scripts/planner-archive.js --help   显示帮助信息

说明:
  1. 将 var/dev-loop/active/ 下三个文件复制到
     var/dev-loop/archive/round-NNN/（NNN 自增）
  2. 用空白模板覆盖 active/ 下的文件
  3. 打印归档路径
`);
}

function getNextRound() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    return 1;
  }
  const entries = fs.readdirSync(ARCHIVE_DIR)
    .filter(d => d.startsWith('round-'))
    .map(d => parseInt(d.replace('round-', ''), 10))
    .filter(n => !isNaN(n));

  return entries.length === 0 ? 1 : Math.max(...entries) + 1;
}

function run(dryRun) {
  if (!fs.existsSync(ACTIVE_DIR)) {
    console.error(`错误: active 目录不存在 ${ACTIVE_DIR}`);
    process.exit(1);
  }

  const roundNum = getNextRound();
  const roundDir = path.join(ARCHIVE_DIR, `round-${String(roundNum).padStart(3, '0')}`);

  console.log(`归档目标: ${roundDir}`);
  console.log();

  for (const file of ACTIVE_FILES) {
    const src = path.join(ACTIVE_DIR, file);
    if (!fs.existsSync(src)) {
      console.log(`  ⚠️  跳过（不存在）: ${file}`);
      continue;
    }

    const size = fs.statSync(src).size;
    const dest = path.join(roundDir, file);

    if (dryRun) {
      console.log(`  [DRY] 复制: ${file} (${size} bytes) → ${dest}`);
    } else {
      fs.mkdirSync(roundDir, { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`  ✅ 已归档: ${file} (${size} bytes)`);
    }
  }

  console.log();

  for (const file of ACTIVE_FILES) {
    const dest = path.join(ACTIVE_DIR, file);
    if (dryRun) {
      console.log(`  [DRY] 重置模板: ${file}`);
    } else {
      fs.writeFileSync(dest, TEMPLATES[file], 'utf8');
      console.log(`  📝 已重置模板: ${file}`);
    }
  }

  console.log();
  if (dryRun) {
    console.log(`[DRY RUN] 以上操作未实际执行。去掉 --dry 参数以执行归档。`);
  } else {
    console.log(`归档完成: ${roundDir}`);
  }
}

const args = process.argv.slice(2);

if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

const dryRun = args.includes('--dry');
run(dryRun);
