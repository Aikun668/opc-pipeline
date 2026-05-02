# OPC Pipeline 总路线图

> Planner 维护 | 最后更新：2026-04-21

## 当前状态

Alpha 阶段完成。全流程跑通，96.6s/次，¥0.11/次，安全漏洞清零。

## 执行路线（已确认）

```
Phase B: 三角色协作自动化
    ↓
Phase C: 成本监控 + 预算控制      ← 与 B 并行
    ↓
Phase A: 生产 Beta 压测（24h）
    ↓
Phase D: 任务队列管理层
```

---

## Phase B — 三角色协作自动化

**目标**：每次角色切换，只需说一句"去看指令文件，开始工作"，不再手动搬运上下文。

### 设计原则

- 所有交接信息写文件，不靠口头传递
- 每个角色启动时先读固定路径的指令文件
- 状态锁防止重复处理
- Planner 负责写指令，Builder/Reviewer 各自只读指令、写报告

### 文件协议规范

```
var/dev-loop/
├── active/
│   ├── 01-planner-instruction.md   # Planner 写，Builder 读
│   ├── 02-builder-report.md        # Builder 写，Reviewer 读
│   └── 03-reviewer-summary.md      # Reviewer 写，Planner 读
├── ROADMAP.md                      # 本文件，全局计划
└── archive/                        # 完成的轮次归档
    └── round-NNN/
```

### 指令文件格式标准（Phase B 核心交付）

**01-planner-instruction.md 标准格式：**
```markdown
# Planner 指令 | Round NNN | 日期

## 任务 ID
TASK-XXX-NNN

## 任务类型
[feature / bugfix / refactor / test / infra]

## 目标
一句话描述要做什么

## 验收标准
- [ ] 具体可验证的条件 1
- [ ] 具体可验证的条件 2

## 约束条件
- 不得修改哪些文件
- 依赖哪些已有模块

## 交给 Builder 的上下文
- 关键文件路径
- 已知的坑/注意事项

## 完成后
Builder 填写 02-builder-report.md，格式见模板
```

### Phase B 任务清单

| # | 任务 | 交付物 | 负责 |
|---|------|--------|------|
| B1 | 制定并写入三个角色的指令文件格式规范 | 本文 + 模板文件 | Planner |
| B2 | 创建 Builder 启动脚本：自动读取指令，输出结构化报告 | `scripts/builder-init.js` | Builder |
| B3 | 创建 Reviewer 启动脚本：自动读取 builder 报告，输出结构化总结 | `scripts/reviewer-init.js` | Builder |
| B4 | 创建 Planner 归档脚本：轮次结束后自动存档、重置文件 | `scripts/planner-archive.js` | Builder |
| B5 | Reviewer 验证 B2~B4 | 验收报告 | Reviewer |

---

## Phase C — 成本监控 + 预算控制

**目标**：每次 LLM 调用实时记录 token 用量和费用，达到阈值时报警或熔断。

### Phase C 任务清单

| # | 任务 | 交付物 | 负责 |
|---|------|--------|------|
| C1 | 成本计算模块：token→费用换算（支持各模型单价配置） | `src/cost-tracker.js` | Builder |
| C2 | 集成到 LLMManager：每次调用后写入成本日志 | 修改 `src/llm-manager.js` | Builder |
| C3 | 预算熔断：超过单次/累计预算阈值时触发 circuit breaker | 修改 `src/circuit-breaker.js` | Builder |
| C4 | 成本报告：每个任务结束写入 `var/archive/cost-TASK-XXX.json` | `src/cost-reporter.js` | Builder |
| C5 | Reviewer 验证 C1~C4 | 验收报告 | Reviewer |

---

## Phase A — 生产 Beta 压测

**前置条件**：B、C 完成

**目标**：设计 10 个标准编码任务，连续运行，统计成功率、平均耗时、成本，记录所有失败。

（详细任务清单待 B、C 完成后展开）

---

## Phase D — 任务队列管理层

**前置条件**：A 完成

（详细任务清单待 A 完成后展开）

---

## 角色说明

| 角色 | 工具 | 职责 |
|------|------|------|
| Planner | Claude Code（你现在） | 制定计划，写指令，归档总结，决策走向 |
| Builder | Claude Code（另一个终端） | 按指令实现代码，写报告 |
| Reviewer | Claude Code（第三个终端） | 审查 Builder 的交付物，写验收总结 |

**你（用户）的角色**：只需在角色切换时说一句话，其余由各角色自主读文件工作。
