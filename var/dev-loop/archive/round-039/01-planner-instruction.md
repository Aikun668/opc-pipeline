# Planner 指令 | Round A-14 | 2026-05-02

## 任务 ID
TASK-A-014

## 任务类型
feature

## 目标

让浏览器 Dashboard 实时显示与终端完全一致的运行日志，包括阶段切换、LLM 原始返回、JSON 解析失败详情、错误堆栈等全部信息。

## 背景

当前 Dashboard 只显示阶段名称和耗时（Planning ✅ 20s），但 orchestrator 内部所有的 `console.log/error/warn` 信息（模型调用、JSON 解析失败原文、Review 结论等）都不在 Dashboard 上可见。用户需要监测到每一个错误所在，必须让 Dashboard 展示与终端等量的信息。

## 验收标准

- [ ] 运行单任务时，Dashboard 实时显示 orchestrator 的所有关键日志
- [ ] JSON 解析失败时，Dashboard 上能看到 **LLM 返回的原始内容截断**（与终端一致）
- [ ] Review 阶段显示 LLM 返回的完整 JSON 结论
- [ ] 错误/异常时显示 error message + 堆栈
- [ ] 日志区域为深色底、等宽字体，info/warn/error 三色区分
- [ ] 历史回放中也能看到这些日志（events.jsonl 记录 LOG 事件）
- [ ] 不修改终端的 console 输出

## 具体修改

### Fix 1 — `src/event-bus.js` 新增事件类型

加一行：

```js
LOG: 'log'
```

### Fix 2 — `src/orchestrator.js` 新增日志发射方法 + 埋点

在 Orchestrator 类中加辅助方法：

```js
emitLog(taskId, level, message) {
  this.eventBus.emit(EVENTS.LOG, { taskId, level, message, ts: Date.now() });
}
```

在以下关键 console.X 旁边追加 `this.emitLog(...)`：

| 行号 | label | level | message 内容 |
|------|-------|-------|-------------|
| L154 | 任务创建 | info | `任务创建: ${taskId}, 初始阶段: ${stateMachine.currentPhase}` |
| L210 | 阶段执行 | info | `执行阶段: ${phase}` |
| L248 | 阶段重试 | warn | `重试 ${phase}, 次数: ${retryCount}` |
| L262 | 阶段失败 | error | `阶段失败: ${phase}, ${error.message}` + error.stack |
| L427 | Review 原始内容 | info | `Review: ${reviewResult.content?.substring?.(0, 400)}` |
| L530 | extractJSON 失败 | error | `extractJSON 解析失败, 原始返回:\n${text.substring(0, 400)}` |
| L539 | 自愈重试 | warn | `extractJSON 自愈重试 (stage=${stage})` |
| L384 | git apply 失败 | warn | `git apply 失败: ${e.message}` |
| L118-119 | 成本记录 | info | `[CostTracker] ${stage}: ${model}, ¥${cost}` |

> **说明**：所有现有 console.X **保留不动**，只追加 `this.emitLog()`，终端输出不受影响。emitLog 必须传递 `taskId`，否则 Dashboard 不知道日志属于哪个任务。

### Fix 3 — `src/public/dashboard.html` 日志面板 UI

每个 task card 底部新增一个日志区域：

**CSS 新增：**
```css
.log-panel {
  background: #1a1a1a;
  color: #d4d4d4;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 12px;
  border-radius: 6px;
  margin-top: 12px;
  max-height: 300px;
  overflow-y: auto;
}
.log-entry { white-space: pre-wrap; word-break: break-all; }
.log-entry .ts { color: #6a9955; margin-right: 8px; }
.log-entry.info { color: #d4d4d4; }
.log-entry.warn { color: #dcdcaa; }
.log-entry.error { color: #f48771; }
.log-entry .msg { color: inherit; }
```

**JS 新增：**
- 在 `handleEvent` 中处理 `data.type === 'log'`：
  - 找到对应 task 的 logs 数组
  - push 新条目 `{ level, message, ts }`
  - 调用 renderTask 刷新
- 在 `renderTask` 中：在 footer 下方追加日志面板 HTML

**日志面板默认展开**，日志区域自动滚动到底部。

### Fix 4 — EventLogger 自动记录

不需额外改动。EventLogger 的 `subscribeAll()` 会遍历 `Object.values(EVENTS)`，LOG 事件加入后自动被写入 events.jsonl，历史回放时即可查看。

## 不需要改的文件

- `src/live-server.js`（broadcast 自动处理新事件类型）
- `src/event-logger.js`（subscribeAll 自动覆盖新事件）
- `tests/benchmark/` 下所有文件
- `scripts/run-task.js`
- `config/` 下所有文件

## 验证方式

```bash
# 跑一个单任务验证
OPC_SPAWN_MODE=mock node scripts/run-task.js --id BENCH-BIZ-001

# 浏览器确认：
# - 任务卡下方有深色日志区域
# - 日志内容与终端输出一致
# - info/warn/error 颜色区分明显
# - JSON 解析失败时能看到原始 LLM 返回内容
```

## 完成后

Builder 填写 `var/dev-loop/active/02-builder-report.md`，附：
1. 修改的 3 个文件及改动摘要
2. Dashboard 截图或终端验证输出
3. events.jsonl 中 LOG 事件的格式确认
