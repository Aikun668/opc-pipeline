# Planner 指令 | Round A-16 | 2026-05-02

## 任务 ID
TASK-A-016

## 任务类型
bugfix

## 目标

修复两个 Dashboard 信息缺失问题：历史回放 LOG 事件不显示消息内容 + LLM 返回占位内容时无法追溯原始响应。

## 验收标准

- [ ] Dashboard 历史回放中，LOG 类型事件显示具体日志消息（而非仅显示 "log"）
- [ ] 当 LLM 编码阶段返回占位/模板内容（如 `// 示例内容`）时，原始 LLM 响应被保存到文件，可供审查

## 具体修改

### Fix 1 — `src/public/dashboard.html`（1 处修改）

`loadRoundEvents` 函数（约 L393）中，事件描述 `desc` 的生成逻辑增加 LOG 类型特殊处理：

```
当前：desc = ev.type
改为：if (ev.type === 'log') desc = ev.message || 'log'
```

同时在 `loadRoundEvents` 的渲染 HTML 中（约 L399），对 LOG 事件显示消息内容。

### Fix 2 — `src/orchestrator.js`（2 处修改）

#### 2a — 编码阶段保存原始 LLM 响应

`executeCoding` 方法中，在 `extractJSON` 解析之后（约 L358），增加：

```js
// 保存原始 LLM 响应供审查
const rawDir = path.join(this.pipeDir, taskId);
if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
const rawPath = path.join(rawDir, '_llm-response.json');
fs.writeFileSync(rawPath, JSON.stringify({
  model: result.model || 'unknown',
  usage: result.usage || {},
  rawContent: result.content,
  parsedAt: new Date().toISOString()
}, null, 2));
```

文件写入 `var/pipe/TASK-XXX/_llm-response.json`，包含完整原始 content（未截断）。

#### 2b — 检测占位内容并告警

编码阶段解析出文件列表后，遍历每个文件的内容，检测是否匹配占位模式（如 `// 示例内容`、`// TODO` 等）。若匹配则 emit 一条 LOG 事件告警：

```js
const placeholderPattern = /\/\/\s*(示例|示例内容|todo|TODO|example)/;
for (const file of files) {
  if (placeholderPattern.test(file.content || '')) {
    this.emitLog(taskId, 'warn', `[占位检测] ${file.path} 包含占位内容，建议人工审查`);
  }
}
```

## 不修改的文件

- `config/`、`tests/`、`scripts/`（不含 `src/` 下的 .js 文件 — 但本次两个 fix 都需要修改 `src/` 下的文件，注意与之前的约束不同）

## 验证方式

1. 运行 `node scripts/run-task.js --id BENCH-BIZ-001 --file tests/benchmark/tasks-business.json`
2. 打开 Dashboard，展开历史轮次查看 LOG 事件是否显示消息内容
3. 检查 `var/pipe/TASK-BENCH-BIZ-001/_llm-response.json` 是否存在且包含完整原始内容

## 完成后

Builder 填写 `02-builder-report.md`，附验证截图描述。
