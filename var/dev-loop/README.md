# Dev-Loop 协作规范 (SOP)

## 概述

这是 Planner、Builder、Reviewer 共同遵守的最高协作宪法，确保文档闭环流转。

\---

## 目录结构

```
var/dev-loop/
├── active/           # 当前进行中的循环
│   ├── 01-planner-instruction.md   # Planner 下达的计划
│   ├── 02-builder-report.md      # Builder 执行报告
│   └── 03-reviewer-summary.md    # Reviewer 审查结论
├── history/           # 已完成的历史循环归档
│   └── cycle-XXX/    # 每轮迭代的完整记录
└── README.md         # 本规范声明
```

\---

## 闭环流转机制 (SOP)

### 流程图

```
Planner → 01-planner-instruction.md
    ↓
Builder ← 01-planner-instruction.md
    ↓
02-builder-report.md
    ↓
Reviewer ← 02-builder-report.md
    ↓
03-reviewer-summary.md
    ↓
(循环) → Planner → ... (进入下一轮)
```

### 步骤说明

1. **Planner**

   * 读取 `active/03-reviewer-summary.md`（上一轮结论）
   * 打包 active 目录的 3 个文件，移入 `history/cycle-XXX/`
   * 清空 `active/`，写入新计划 `01-planner-instruction.md`
2. **Builder**

   * 只读 `active/01-planner-instruction.md`
   * 执行完成后写入 `active/02-builder-report.md`
3. **Reviewer**

   * 读取代码 + `02-builder-report.md`
   * 审查后写入 `active/03-reviewer-summary.md`
4. **循环**

   * 等待 Reviewer 完成后，Planner 开启下一轮

\---

## 规则

* **禁止**在 var/ 根目录直接创建 .md 文件
* **禁止**在 active/ 目录存放超过 1 个周期的文件
* 每个循环完成后必须归档到 history/cycle-XXX/
* 命名规范：`01-xxx.md`, `02-xxx.md`, `03-xxx.md`

\---

## 当前状态

等待 Planner 写入 `01-planner-instruction.md`

