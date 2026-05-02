# OPC Pipeline Build Review 总结

> Reviewer 输出 | 目标读者: Planner
> 时间: 2026-04-14

---

## 一、Build 整体评价

Builder 本次交付的 LLM API 集成整体结构清晰，6 阶段工作流在 Mock 模式下可完整跑通（12/12 测试通过）。新增 `llm-clients/`、`llm-manager.js`、Prompt 模板、冒烟测试等模块设计合理，统一调用契约和熔断保护已落地。

但存在 **3 处非常严重的问题** 会影响生产运行稳定性，另有若干中等/轻微问题。Reviewer 已顺手修复简单问题，复杂模块新增需求标记为 Pass。

---

## 二、Review 分级详情

### 1. 非常修改（非常严重）— 已顺手修复

#### 1.1 `pipe-manager.js` `hardTruncate` 存在 `ReferenceError`
- **文件**: `opc-pipeline/pipe/pipe-manager.js`
- **问题**: `hardTruncate` 内部引用了一个未传入的 `taskId` 变量（第 181 行），当输出超长触发极端截断时会直接抛 `ReferenceError`。
- **修复**: 将 `taskId` 作为参数传入 `hardTruncate`，并在 `writeOutput` 中透传。

#### 1.2 `orchestrator.js` `executePlanning` 错误消费信标
- **文件**: `opc-pipeline/orchestrator.js`
- **问题**: `executePlanning` 调用了 `this.pipeManager.readInputBeacon(taskId)`，该方法会将 `input.json.ready` 原子移动到 `input.json.processing`。Orchestrator 不是 Actor，Planning 阶段崩溃或重试后，ready 信标已消失，会导致 "No input beacon found" 而永远无法恢复。
- **修复**: 改为直接用 `fs.readFileSync` 读取 `input.json.ready` 内容，不移动信标状态。

#### 1.3 `state-machine.js` 终端状态缺失 `PHASE_CONFIG`
- **文件**: `opc-pipeline/state-machine.js`
- **问题**: `PHASE_CONFIG` 缺少 `completed` 和 `failed` 配置。当状态机到达终端状态时，`getCurrentConfig()` 返回 `undefined`，`isPhaseTimeout()` 和 `decideNextAction()` 访问 `config.timeout` / `config.nextPhase` 会直接崩溃。
- **修复**: 补全 `COMPLETED` 和 `FAILED` 的 `PHASE_CONFIG`（timeout: 0, maxRetries: 0）。

---

### 2. 主张修改（中等严重）— 已顺手修复

#### 2.1 `orchestrator.js` `FAILED` 状态会陷入无限异常循环
- **文件**: `opc-pipeline/orchestrator.js`
- **问题**: `runWorkflow` 的 while 条件只检查了 `!== COMPLETED`，未排除 `FAILED`。当 `decideNextAction` 返回 `fail` 后，下一次循环 `currentPhase === 'failed'` 仍会进入 switch 并走到 `default` 抛出 `Unknown phase`。
- **修复**: while 条件增加 `&& stateMachine.currentPhase !== PHASES.FAILED`。

#### 2.2 `orchestrator.js` `executeCoding` 忽略 `writeOutput` 失败
- **文件**: `opc-pipeline/orchestrator.js`
- **问题**: `this.pipeManager.writeOutput(taskId, output)` 的返回值被直接忽略。若输出被 Fuse 截断/验证失败（`success: false`），工作流不会感知，会继续返回无效 output 给状态机。
- **修复**: 捕获 `writeResult`，失败时抛出错误进入重试逻辑。

#### 2.3 `package.json` `dotenv` 版本号不存在
- **文件**: `opc-pipeline/package.json`
- **问题**: 依赖写了 `"dotenv": "^17.4.2"`，但 npm 上 dotenv 最新稳定版为 16.x，17.x 尚未发布，`npm install` 会报错。
- **修复**: 改为 `"dotenv": "^16.4.5"`。

#### 2.4 `tester-actor.js` 覆盖率提取不兼容 macOS/BSD
- **文件**: `opc-pipeline/actors/tester-actor.js`
- **问题**: 使用 `grep -oP`（GNU PCRE 扩展），在 macOS 和 BSD 系统上不支持，会导致测试 Actor 崩溃。
- **修复**: 改为 Node 内置 `fs.readFileSync` + `String.prototype.match` 提取覆盖率，彻底跨平台。

---

### 3. 轻微建议（基本没问题）— 未修改，仅记录

#### 3.1 `getCodeDiff` 仍是 stub
- **文件**: `opc-pipeline/orchestrator.js`
- **说明**: `getCodeDiff` 目前只读取 `code.patch`，若不存在则返回占位字符串。实际 diff 生成逻辑（由 GLM 写 patch 还是 Orchestrator 调用 git diff）需要后续确认。

#### 3.2 `llm-clients` `healthCheck()` 消耗 token
- **文件**: `llm-clients/*.js`
- **说明**: 所有客户端的 `healthCheck` 都通过发一条 `ping` 消息调用真实 API 来判断连通性，会消耗 token。建议后续改为轻量级检查（如验证 API Key 格式或发 HEAD 请求）。

#### 3.3 `test-fixes.js` test12 断言不够严格
- **文件**: `opc-pipeline/test-fixes.js`
- **说明**: 原 test12 只断言 `result !== null`，未断言最终阶段必须是 `completed`。Reviewer 已顺手加强该断言。

#### 3.4 `spawn-adapter.js` `SPAWN_MODE` 为模块级常量
- **文件**: `opc-pipeline/spawn-adapter.js`
- **说明**: `SPAWN_MODE` 在 `require` 时确定，运行时修改 `process.env.OPC_SPAWN_MODE` 不会生效。当前 test-fixes.js 通过 `delete require.cache` 处理，但建议后续改为运行时读取以支持动态切换。

---

## 三、已修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `pipe/pipe-manager.js` | 修复 `hardTruncate` 的 `taskId` 未定义问题 |
| `state-machine.js` | 补全 `COMPLETED` / `FAILED` 的 `PHASE_CONFIG` |
| `orchestrator.js` | Planning 不再消费信标；while 排除 FAILED；`writeOutput` 失败抛出异常 |
| `package.json` | 修正 `dotenv` 版本号为 `^16.4.5` |
| `actors/tester-actor.js` | 覆盖率提取改为跨平台 Node 实现 |
| `test-fixes.js` | test12 增加 `finalPhase === 'completed'` 严格断言 |

---

## 四、验证结果

```bash
$ node test-fixes.js
================================
结果: 12 通过, 0 失败
================================
```

---

## 五、Pass 给 Builder 的大修改 / 后续 Todo

以下问题涉及较大模块设计或新增功能，本次 Review 未实施，建议进入下一轮 Builder 迭代：

1. **`getCodeDiff` 的 diff 生成方案**
   - **问题**: `getCodeDiff` 目前是 stub，Review 阶段依赖的 `code.patch` 文件来源不明确。
   - **意图**: 需要 Builder 明确 diff 是由 GLM Coding 阶段自行写入 `.patch` 文件，还是 Orchestrator 需要在 Coding 阶段结束后调用 `git diff` 生成。若是后者，需要新增 `git diff` 调用模块和错误处理（如项目非 git 仓库的 fallback）。

2. **DeepSeek-R1 `reasoning_tokens` 追踪**
   - **问题**: 当前 `deepseek-client.js` 的 usage 只统计 `prompt_tokens + completion_tokens`，未单独追踪 `reasoning_tokens`。
   - **意图**: 若业务需要单独监控 R1 的 reasoning 开销，需要 Builder 在客户端中解析并上报 `reasoning_tokens`，并在 `monitor.js` 的 Token 统计面板中增加对应展示列。

3. **Orchestrator 与 Actor 信标语义统一**
   - **问题**: 新架构中 Orchestrator 内置执行 Planning / Review / Testing / Delivery，但仍在使用为 Actor 设计的 `readInputBeacon` 语义（消费式）。虽然 Planning 的紧急问题已修复，但长期来看，内置阶段与 Actor 阶段的信标生命周期需要更清晰的规范（如 Orchestrator 阶段用 `peek` / Actor 阶段用 `claim`）。
   - **意图**: 建议 Builder 在 `pipe-manager.js` 中新增 `peekInputBeacon(taskId)` 非消费式读取方法，逐步将 Orchestrator 内置阶段迁移到新的读取语义上，避免类似信标误消费问题在 Review/Testing 等阶段复现。

---

## 六、Reviewer 结论

**当前代码在修复后已达到可进入下一轮 Planner 的标准。**

- 严重 bug 已清除
- Mock 模式 6 阶段工作流验证通过
- 依赖版本已修正

**建议 Planner 的下一步**：
1. 确认 `getCodeDiff` 的 diff 生成方案，下发给 Builder 实现。
2. 配置 `.env` 真实 API Key，运行 `OPC_SPAWN_MODE=api node smoke-test-api.js` 做真实连通性验证。
3. 确认是否需要追踪 DeepSeek-R1 的 `reasoning_tokens`。

