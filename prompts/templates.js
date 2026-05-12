/**
 * 各阶段 Prompt 模板
 * 统一要求 LLM 返回 JSON
 */

/**
 * Planning 阶段 Prompt（Claude）
 */
function buildPlanningPrompt(taskDescription, projectStructure) {
  return `你是架构师，负责将需求分解为结构化 spec。

需求：
${taskDescription}

项目结构摘要：
${projectStructure}

  输出要求：
1. 只输出 **纯 JSON**，不要 markdown 代码块、不要 \`\`\` 标记、不要任何前言或解释
2. 总字符 < 2000
3. 严格按以下格式（示例中的值仅为演示，请根据实际需求修改）：

{
  "task_id": "TASK-BENCH-BIZ-001",
  "files_to_touch": [
    "src/cleaner.ts",
    "src/app.ts"
  ],
  "constraints": [
    "输出为 CSV 格式",
    "手机号格式 +86-138-0000-0000"
  ],
  "acceptance_criteria": [
    "重复行被移除",
    "手机号统一格式",
    "缺失字段填 N/A"
  ],
  "coding_hints": "使用 csv-parse 解析，正则格式化手机号"
}

重要：JSON 内不要包含注释或占位符，所有值必须是实际数据。
只输出 JSON，不要任何解释。`;
}

/**
 * Coding 阶段 Prompt（GLM-5.1）
 */
function buildCodingPrompt(spec, contextFiles, patchInstructions = null) {
  let patchHint = '';
  if (patchInstructions && patchInstructions.length > 0) {
    patchHint = `\n上一轮打回的修复指令：\n${JSON.stringify(patchInstructions, null, 2)}\n请优先根据以上指令修复问题后再实现。\n`;
  }

  return `你是 Coder，根据 spec 实现功能。${patchHint}

Spec：
${JSON.stringify(spec, null, 2)}

上下文文件片段：
${contextFiles.map(f => `--- ${f.path} ---\n${f.content.substring(0, 500)}`).join('\n\n')}

输出要求：
1. JSON 中禁止嵌入大段代码（必须 < 500 字符）
2. 在 JSON 中通过 files 数组声明要创建/修改的文件：
{
  "version": "1.0",
  "status": "success",
  "summary": "一句话总结",
  "files": [
    {"path": "utils/health.js", "content": "function systemCheck() { ... }\\nmodule.exports = { systemCheck };"}
  ],
  "artifacts": {},
  "nextAction": "request_review"
}

只输出 JSON，不要 markdown 代码块。`;
}

/**
 * Pre-filter 阶段 Prompt（DeepSeek-chat）
 */
function buildPrefilterPrompt(diff) {
  return `你是代码粗筛器，快速检查明显问题。

代码变更（diff）：
${diff}

检查项：
- 语法错误
- 变量名拼写
- 明显的空指针
- 缺少必要的 import

输出 JSON：
{
  "pass": true,
  "issues": [
    {"severity": "CRITICAL", "line": 42, "desc": "变量未定义"}
  ]
}

只输出 JSON。`;
}

/**
 * Deep Review 阶段 Prompt（DeepSeek-R1）
 */
function buildReviewPrompt(spec, diff, prefilterReport) {
  const isEmptyDiff = !diff || diff.trim().length === 0 || diff.includes('无法生成标准 Diff');

  return `你是安全审查专家，深度分析代码。

Spec：
${JSON.stringify(spec, null, 2)}

代码变更（diff）：
${diff}

Pre-filter 已检查：
${JSON.stringify(prefilterReport, null, 2)}

重点检查：
- 逻辑漏洞（边界条件、并发问题）
- 安全问题（SQL 注入、XSS、认证绕过）
- 性能隐患（N+1 查询、内存泄漏）

## 评审等级定义（必须遵守）

即使没有发现错误，也必须给出 grade 和 quality_evaluation，不可跳过。

### 等级说明
- **A级（非常严重）**：阻断性问题。包括但不限于：安全漏洞、数据丢失风险、核心功能缺失、逻辑错误。A级问题必须修复，否则不予放行。
- **B级（中等严重）**：需要修改。包括但不限于：边界条件未处理、错误处理缺失、性能隐患、代码异味。建议修改后再放行。
- **C级（建议优化）**：可优化项。包括但不限于：命名建议、注释补充、代码风格、可读性改进。记录即可，无需阻塞流程。

### 评审规则（反偷懒机制）
1. 禁止在无错误时直接给满分 grade=A。无错误仅代表无 A 级问题，仍需给出 B/C 级质量评价。
2. 每次评审必须输出至少 2 条建议（C级），强制做实质性审查。
3. grade 字段含义：
   - "A" = 存在至少 1 个 A 级问题
   - "B" = 无 A 级问题，存在 B 级问题
   - "C" = 无 A/B 级问题，仅 C 级建议（正常放行）
4. scores 中的 4 维度评分必须与 grade 和 issues 一致。
${isEmptyDiff ? `
### 特殊情况：无代码变更
当前 diff 为空或几乎没有代码变更，则：
- grade 强制为 "B"
- issues 中增加一条 B 级："代码变更量过少，请确认是否完成需求"
- scores 中的 requirement_fulfillment 降至 30-50 分
` : ''}
  输出 JSON（< 1500 字符）：
  {
    "grade": "B",
    "issues": [
      {"level": "A", "category": "security", "line": 58, "desc": "SQL 注入风险", "suggestion": "使用参数化查询"},
      {"level": "C", "category": "quality", "line": 102, "desc": "函数过长建议拆分", "suggestion": "提取为独立函数"}
    ],
    "summary": "A级1项，B级0项，C级1项",
    "scores": {
      "requirement_fulfillment": 85,
      "code_quality": 70,
      "maintainability": 75,
      "security": 90
    }
  }

  评分说明（scores 字段）：
  - requirement_fulfillment: 需求实现度，评估代码是否完整实现了 Spec 中的所有功能
  - code_quality: 代码质量，评估可读性、结构、错误处理、命名等
  - maintainability: 可维护性，评估模块化程度、耦合度、文档注释
  - security: 安全性，评估是否有漏洞或安全隐患
  - 每项 0-100，越高越好

  只输出 JSON。`;
}

/**
 * Testing 阶段 Prompt（Kimi）
 */
function buildTestingPrompt(spec, codeFiles) {
  return `你是测试工程师，生成单元测试。

Spec acceptance_criteria：
${JSON.stringify(spec.acceptance_criteria, null, 2)}

实现文件：
${codeFiles.map(f => `--- ${f.path} ---\n${f.content.substring(0, 800)}`).join('\n\n')}

任务：
1. 生成测试文件（写入 artifacts）
2. 返回测试报告 JSON：
{
  "total": 5,
  "passed": 4,
  "failed": 1,
  "cases": [
    {"name": "登录成功", "status": "pass"},
    {"name": "密码错误", "status": "fail", "error": "Expected 401, got 200"}
  ]
}

只输出 JSON。`;
}

/**
 * Delivery Gate 阶段 Prompt（Claude）
 */
function buildDeliveryPrompt(reviewReport, testReport) {
  return `你是最终裁判，决定是否放行。

Review 报告：
${JSON.stringify(reviewReport, null, 2)}

Test 报告：
${JSON.stringify(testReport, null, 2)}

判断标准：
- Review 无 CRITICAL 问题
- Test 通过率 >= 80%

输出 JSON：
{
  "decision": "deliver",
  "reason": "所有检查通过",
  "patch_instructions": []
}

或：
{
  "decision": "retry",
  "reason": "存在 SQL 注入风险",
  "patch_instructions": [
    {"file": "src/auth.ts", "line": 58, "action": "使用参数化查询替换字符串拼接"}
  ]
}

只输出 JSON。`;
}

module.exports = {
  buildPlanningPrompt,
  buildCodingPrompt,
  buildPrefilterPrompt,
  buildReviewPrompt,
  buildTestingPrompt,
  buildDeliveryPrompt
};
