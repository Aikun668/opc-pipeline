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
1. 必须是有效 JSON，不要 markdown 代码块
2. 总字符 < 2000
3. 格式：
{
  "task_id": "TASK-xxx",
  "files_to_touch": ["src/auth.ts", "src/types.ts"],
  "constraints": ["使用 JWT", "添加单元测试"],
  "acceptance_criteria": [
    "登录成功返回 token",
    "token 过期返回 401"
  ],
  "coding_hints": "使用 bcrypt 加密密码"
}

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

输出 JSON（< 1500 字符）：
{
  "pass": false,
  "issues": [
    {"severity": "HIGH", "category": "security", "line": 58, "desc": "SQL 注入风险", "suggestion": "使用参数化查询"}
  ],
  "summary": "发现 1 个高危问题"
}

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
