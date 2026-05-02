# Builder Report — A-13

**时间**: 2026-05-02 15:30
**任务**: 单任务运行脚本 `scripts/run-task.js`
**状态**: ✅ 已完成

## 变更摘要

创建 `scripts/run-task.js`，支持通过 `--id` 参数从 tasks JSON 文件中读取单个任务并运行，同时启动 Dashboard 服务器，任务完成后保持在线。

## 修改文件

### 1. scripts/run-task.js（新增，188 行）

单任务运行脚本，完整功能：
1. **CLI 参数解析**: `--id <任务ID>` (必需), `--file <tasks.json>` (可选，默认 tasks-business.json)
2. **任务查找**: 从 JSON 数组中按 id 匹配任务
3. **实时归档**: 复用 BenchmarkArchiver 创建轮次 (round-XXX)
4. **事件日志**: 复用 EventLogger 写入 events.jsonl
5. **任务执行**: 复用 Orchestrator 跑完整 6 阶段工作流
6. **异常处理**: 区分 BUDGET_EXCEEDED (熔断) 和普通错误
7. **保持在线**: 任务完成后打印访问地址，保持进程运行
8. **WSL 兼容**: 打印 Windows 可访问的 IP 地址

## 验证结果

```bash
$ node scripts/run-task.js --id BENCH-BIZ-001
🚀 单任务运行: BENCH-BIZ-001
   描述: 【数据清洗脚本】读取CSV文件，去除完全重复的行；手机号统一格式...
   模式: mock

[Archiver] 创建轮次: round-008
[Orchestrator] 任务创建: BENCH-BIZ-001, 初始阶段: planning
...
✅ 完成: completed, 耗时: 62ms, 成本: ¥0.0002

============================================================
服务器运行中
  实时监控: http://localhost:3456
  Windows 访问: http://192.168.198.59:3456
  质量评分: http://localhost:3456/scoring
  按 Ctrl+C 退出
============================================================
```

- ✅ mock 模式下任务正常完成 (6/6 阶段)
- ✅ 轮次正确创建 (round-008)
- ✅ Dashboard 正常启动并监听 3456 端口
- ✅ 成本/时长统计正确
- ✅ 服务器保持运行，不自动退出

## 设计决策

- **不修改已有文件**: 仅新增脚本，复用现有模块 (orchestrator, live-server, benchmark-archiver, event-logger, event-bus)
- **无新依赖**: 仅使用 Node.js 内置模块
- **与 benchmark-runner 共享归档逻辑**: 轮次编号自动递增，events.jsonl 格式一致

## 已知限制

- 与 benchmark-runner 相同：mock 模式下成本为模拟值
- 单次只运行一个任务，不支持批量

---

Builder 完成。等待 Planner 下一批指令。
