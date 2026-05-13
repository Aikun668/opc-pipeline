# Planner 指令 | Round A-34 | 2026-05-13

## 任务 ID
TASK-A-034

## 任务类型
process（dev-loop SOP 修正：Builder 报告覆盖而非追加）

## 问题

`02-builder-report.md` 当前是追加模式，里面堆了 5 个 round 的报告（A-30, A-31, A-31b, A-32, A-33），文件已经 346 行。正确行为应该是**每轮覆盖写入**，旧轮次移到 history 目录归档。

同理检查 Planner 和 Reviewer 文件是否也有追加问题。

## 修复

### 1. 确立规则

三个 active 文件的行为规范：

| 文件 | 行为 | 说明 |
|------|------|------|
| `01-planner-instruction.md` | **覆盖** | 每轮只保留当前 Plan |
| `02-builder-report.md` | **覆盖** | 每轮只保留当前 Build 报告 |
| `03-reviewer-summary.md` | **覆盖** | 每轮只保留当前 Review |

旧内容在覆盖前追加到 `var/dev-loop/history/{roundId}-{角色}.md`（如 `A-030-planner.md`）。

### 2. 即修复

- `02-builder-report.md`：删除 A-30~A-32 的旧内容，只保留最新一轮（A-33）
- 旧内容归档到 `var/dev-loop/history/` 目录

## 文件涉及

| 文件 | 操作 |
|------|------|
| `var/dev-loop/active/02-builder-report.md` | 清理旧内容，只保留最新 |
| `var/dev-loop/history/` | 新建目录，归档旧轮次报告 |

## 不修改
- 源代码文件
- `scripts/` / `config/`

---

产出文件：`var/dev-loop/active/01-planner-instruction.md`
