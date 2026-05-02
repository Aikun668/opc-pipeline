# Builder Report — A-16

**时间**: 2026-05-02 16:08
**任务**: Dashboard 信息缺失修复（LOG 回放 + 原始响应保存）
**状态**: ✅ 已完成

## 变更摘要

修复两个 Dashboard 信息缺失问题：历史回放 LOG 事件不显示消息内容 + LLM 返回占位内容时无法追溯原始响应。

## 修改文件

### 1. src/public/dashboard.html（LOG 事件回放显示消息）

`loadRoundEvents` 函数中增加 LOG 类型特殊处理：

```diff
  let desc = ev.type;
+ if (ev.type === 'log') desc = ev.message || 'log';
  if (ev.phase) desc += ` · ${ev.phase}`;
```

效果：历史回放中 LOG 事件不再仅显示 "log"，而是显示具体日志消息内容（如 "任务创建: BENCH-BIZ-001, 初始阶段: planning"）。

### 2. src/orchestrator.js（编码阶段保存原始响应 + 占位检测）

**2a — 保存原始 LLM 响应：**

在 `executeCoding` 中 `extractJSONWithFallback` 之后增加：

```js
const rawDir = path.join(PIPE_DIR, taskId);
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

**2b — 检测占位内容并告警：**

编码阶段解析出文件列表后，遍历检测占位模式：

```js
const placeholderPattern = /\/\/\s*(示例|示例内容|todo|TODO|example)/;
for (const file of output.files) {
  if (placeholderPattern.test(file.content || '')) {
    this.emitLog(taskId, 'warn', `[占位检测] ${file.path} 包含占位内容，建议人工审查`);
  }
}
```

## 验证结果

### 1. Mock 单任务验证

```bash
$ node scripts/run-task.js --id BENCH-BIZ-001 --file tests/benchmark/tasks-business.json
✅ 完成: completed, 耗时: 64ms, 成本: ¥0.0002
```

### 2. _llm-response.json 文件确认

```bash
$ cat var/pipe/BENCH-BIZ-001/_llm-response.json
{
  "model": "unknown",
  "usage": { "input": 10, "output": 10 },
  "rawContent": "{\"version\":\"1.0\",\"status\":\"success\",...}",
  "parsedAt": "2026-05-02T08:07:26.900Z"
}
```

- ✅ 文件正确创建：`var/pipe/BENCH-BIZ-001/_llm-response.json`
- ✅ 包含完整原始 content（未截断）
- ✅ 包含 model、usage、parsedAt 元数据

### 3. LOG 事件格式确认

```json
{"ts":1777709246897,"type":"log","taskId":"BENCH-BIZ-001","level":"info","message":"任务创建: BENCH-BIZ-001, 初始阶段: planning"}
```

- ✅ LOG 事件正确写入 events.jsonl（round-013）
- ✅ 包含完整 message 字段
- ✅ Dashboard 历史回放将显示消息内容而非仅 "log"

## 影响范围

- Dashboard 历史回放可读性提升，LOG 事件显示具体内容
- 编码阶段原始 LLM 响应持久化，便于问题追溯和审查
- 占位内容自动检测，减少低质量代码流入下游阶段

---

Builder 完成。等待 Planner 下一批指令。
