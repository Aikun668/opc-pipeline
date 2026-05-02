# Planner 指令 | Round A-13 | 2026-05-02

## 任务 ID
TASK-A-013

## 任务类型
feature

## 目标

新建 `scripts/run-task.js` — 单任务运行脚本，支持按任务 ID 从 tasks JSON 文件中读取描述，启动 Dashboard，跑完后保持服务器在线。

## 背景

当前 `benchmark-runner.js` 是批量压测工具，固定读整个 tasks 数组串行全跑。现在需要一个轻量入口跑单个任务，用于：
- 快速验证修复效果（比如 A-12 的 Dashboard 修复）
- 开发调试阶段只跑一个任务不看全局压测
- 后续 Phase D 任务队列的单任务调度

## 设计原则

- **不修改 benchmark-runner.js** 的批量逻辑
- **复用现有模块**（LiveServer、BenchmarkArchiver、EventLogger、Orchestrator），不重复造轮子
- **不需要** percentile、markdown 报告、类型分组、基线对比（那是批量压测的事）
- 跑完保持服务器在线，支持 Windows 浏览器通过 WSL IP 访问
- 沿用 round 归档体系，round 编号与 benchmark 共享（archiver.getNextRoundId）

## 验收标准

- [ ] `node scripts/run-task.js --id BENCH-BIZ-001` 只运行 BIZ-001 一个任务
- [ ] Dashboard 实时显示该任务的 5 阶段推进
- [ ] 任务完成后服务器保持在线，终端打印 WSL IP
- [ ] var/benchmark/ 下创建了新的 round-NNN/ 目录，有 events.jsonl + task-result.json
- [ ] 不修改 benchmark-runner.js、orchestrator.js、live-server.js 等已有文件

## CLI 设计

```bash
# 默认从 tasks-business.json 查找任务
node scripts/run-task.js --id BENCH-BIZ-001

# 可指定其他 tasks JSON 文件
node scripts/run-task.js --id BENCH-001 --file tests/benchmark/tasks.json

# 环境变量控制模式
OPC_SPAWN_MODE=mock node scripts/run-task.js --id BENCH-BIZ-001
OPC_SPAWN_MODE=api  node scripts/run-task.js --id BENCH-BIZ-001
```

## 具体实现

新建 `scripts/run-task.js`，目录结构：

```
scripts/
└── run-task.js          # 新增，~70 行
```

### 代码结构

```
1. shebang + 模块引入
2. 解析 --id 和 --file 参数
3. 加载 tasks JSON → 按 ID 查找任务 → 找不到则报错退出
4. 启动 LiveServer
5. BenchmarkArchiver.createRound() 创建轮次
6. EventLogger(roundDir) 初始化
7. 创建临时 workDir → 初始化 Orchestrator → createTask + runWorkflow
8. archiver.archiveTask() 归档
9. archiver.finalizeRound() 写入 results.json + rounds.json
10. eventBus.emit(ROUND_END) 通知历史刷新
11. 打印服务器 URL（含 WSL IP）
12. await new Promise(() => {}) 保持在线
13. process.on('unhandledRejection') + on('uncaughtException') 兜底
```

### 关键代码参考

**参数解析：**
```js
const taskId = args.find(a => a.startsWith('--id='))
  ? args.find(a => a.startsWith('--id=')).split('=')[1]
  : args[args.indexOf('--id') + 1];

const tasksFilePath = /* 默认 tests/benchmark/tasks-business.json，--file 覆盖 */;
```

**task 查找：**
```js
const tasks = JSON.parse(fs.readFileSync(tasksFilePath, 'utf8'));
const task = tasks.find(t => t.id === taskId);
if (!task) { console.error(`任务 ${taskId} 未找到`); process.exit(1); }
```

**成本提取（参考 benchmark-runner.js L94-95）：**
```js
const costRecord = orchestrator.costTracker.getTaskCost(task.id);
```

**archiver 复用：**
参考 benchmark-runner.js L62-64、L137、L143-150 的调用方式。

**keep-alive 与 WSL IP：**
直接复用 A-12 在 benchmark-runner.js 中已实现的那套模式。

### 不修改的文件

- `src/` 下所有文件
- `tests/benchmark/benchmark-runner.js`
- `tests/benchmark/tasks-business.json`
- `config/` 下所有文件

## 验证方式

```bash
# mock 模式跑 BIZ-001
OPC_SPAWN_MODE=mock node scripts/run-task.js --id BENCH-BIZ-001

# 浏览器确认
# - Dashboard 出现 BIZ-001 任务卡，5 阶段推进
# - 完成后服务器不退出
# - var/benchmark/ 下有新 round 目录
```

## 完成后

Builder 填写 `var/dev-loop/active/02-builder-report.md`，附：
1. `scripts/run-task.js` 完整文件内容
2. mock 模式运行终端输出
3. 浏览器 Dashboard 截图描述
4. 归档目录验证
