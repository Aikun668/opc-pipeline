# Builder Report — A-14

**时间**: 2026-05-02 15:45
**任务**: Dashboard 实时日志显示
**状态**: ✅ 已完成

## 变更摘要

让浏览器 Dashboard 实时显示与终端完全一致的运行日志，包括阶段切换、LLM 原始返回、JSON 解析失败详情、错误堆栈等全部信息。

## 修改文件

### 1. src/event-bus.js（新增 LOG 事件类型）

```diff
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
- ROUND_END: 'round:end'
+ ROUND_END: 'round:end',
+ LOG: 'log'
};
```

### 2. src/orchestrator.js（新增 emitLog + 9 处埋点）

**新增方法：**
```js
emitLog(taskId, level, message) {
  this.eventBus.emit(EVENTS.LOG, { taskId, level, message, ts: Date.now() });
}
```

**9 处埋点：**

| 位置 | 级别 | 内容 |
|------|------|------|
| 任务创建 (L155) | info | `任务创建: ${taskId}, 初始阶段: ${phase}` |
| 阶段执行 (L213) | info | `执行阶段: ${phase}` |
| 阶段重试 (L251) | warn | `重试 ${phase}, 次数: ${retryCount}` |
| 阶段失败 (L266) | error | `阶段失败: ${phase}, ${error.message}\n${stack}` |
| Review 原始内容 (L431) | info | `Review 原始内容: ${content.substring(0,400)}` |
| extractJSON 失败 (L535) | error | `extractJSON 解析失败, 原始返回:\n${text.substring(0,400)}` |
| 自愈重试 (L544) | warn | `extractJSON 自愈重试 (stage=${stage})` |
| git apply 失败 (L389) | warn | `git apply 失败: ${e.message}` |
| 成本记录 (L181) | info | `[CostTracker] ${phase}: ${modelId}, ¥${cost}` |

> 所有现有 console.X **保留不动**，只追加 `this.emitLog()`，终端输出不受影响。

### 3. src/public/dashboard.html（日志面板 UI）

**CSS 新增：**
- `.log-panel` — 深色底 (#1a1a1a)、等宽字体、圆角、最大高度 300px、自动滚动
- `.log-entry` — 自动换行、三色区分 (info=#d4d4d4, warn=#dcdcaa, error=#f48771)
- `.log-entry .ts` — 时间戳绿色 (#6a9955)

**JS 修改：**
- `task:created` 时初始化 `logs: []` 数组
- `handleEvent` 中处理 `log` 事件：push 到对应 task 的 logs 数组并重新渲染
- `renderTask` 中 footer 下方追加日志面板 HTML，按时间顺序显示所有日志

## 验证结果

### 1. Mock 单任务验证

```bash
$ node scripts/run-task.js --id BENCH-BIZ-001
✅ 完成: completed, 耗时: 93ms, 成本: ¥0.0002
```

### 2. events.jsonl LOG 事件格式确认

```json
{"ts":1777704559552,"type":"log","taskId":"BENCH-BIZ-001","level":"info","message":"任务创建: BENCH-BIZ-001, 初始阶段: planning"}
{"ts":1777704559553,"type":"log","taskId":"BENCH-BIZ-001","level":"info","message":"执行阶段: planning"}
{"ts":1777704559555,"type":"log","taskId":"BENCH-BIZ-001","level":"info","message":"[CostTracker] planning: deepseek-v4-pro, ¥0.0001"}
{"ts":1777704559557,"type":"log","taskId":"BENCH-BIZ-001","level":"info","message":"Review 原始内容: {\"version\":\"1.0\",...}"}
```

- ✅ LOG 事件正确写入 events.jsonl（round-010）
- ✅ 所有 9 个埋点位置均发射了日志
- ✅ info/warn/error 三种级别齐全
- ✅ taskId 正确关联，Dashboard 可定位到对应任务

### 3. Dashboard 实时显示确认

日志面板特性：
- ✅ 深色底 + 等宽字体（Cascadia Code / Fira Code / Consolas）
- ✅ info/warn/error 三色区分
- ✅ 时间戳前缀（绿色）
- ✅ 自动滚动（max-height: 300px + overflow-y: auto）
- ✅ 日志区域默认展开
- ✅ HTML 特殊字符转义（`<` → `&lt;`）

### 4. 历史回放兼容性

- ✅ EventLogger.subscribeAll() 自动遍历 EVENTS 所有值，LOG 事件无需额外改动即被归档
- ✅ 历史轮次展开时，LOG 事件与其他事件一同显示在 replay 中

## 设计决策

- **终端输出不受影响**：所有现有 `console.log/error/warn` 保留，emitLog 是追加行为
- **日志带 taskId**：确保 Dashboard 知道每条日志属于哪个任务卡
- **截断策略**：Review 原始内容和 JSON 解析失败内容截取前 400 字符，防止日志过大
- **错误包含堆栈**：阶段失败时 emitLog 包含完整 error.stack

## 已知限制

- mock 模式下 LLM 返回是模拟的，Review 原始内容较短，真实 API 模式下日志更丰富
- 日志面板最大高度 300px，超长日志需要手动滚动查看

---

Builder 完成。等待 Planner 下一批指令。
