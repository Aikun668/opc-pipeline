# Planner 指令 | Round B-01 | 2026-04-21

## 任务 ID
TASK-B-001

## 任务类型
infra（基础设施）

## 目标
创建三个角色协作的启动脚本，让 Builder 和 Reviewer 启动时自动读取指令文件，结束时自动写入结构化报告，减少用户手动搬运上下文的负担。

## 背景
当前三角色（Planner/Builder/Reviewer）通过 `var/dev-loop/active/` 下三个 Markdown 文件交接，但文件格式不固定，且没有脚本辅助读写。用户需要手动复制粘贴内容在三个终端之间切换。

## 验收标准
- [ ] `scripts/builder-init.js` 存在且可执行：启动时打印当前指令摘要，提示 Builder 工作重点
- [ ] `scripts/reviewer-init.js` 存在且可执行：启动时打印 Builder 报告摘要，提示 Reviewer 审查重点
- [ ] `scripts/planner-archive.js` 存在且可执行：将 active/ 下三个文件归档到 `var/dev-loop/archive/round-NNN/`，并重置模板
- [ ] 三个脚本都有 `--help` 输出
- [ ] `var/dev-loop/active/` 下提供三个角色文件的空白模板（不要覆盖现有内容，只提供 template 版本）
- [ ] `tests/test-dev-loop-scripts.js` 覆盖基本 happy path

## 约束条件
- 只新增文件，不修改 `src/` 下任何现有文件
- 脚本使用 Node.js，不引入新的 npm 依赖（只用 Node.js 内置模块）
- 脚本路径硬编码相对于 `opc-pipeline/` 根目录

## 关键文件路径
```
var/dev-loop/active/01-planner-instruction.md  ← Builder 读
var/dev-loop/active/02-builder-report.md       ← Builder 写
var/dev-loop/active/03-reviewer-summary.md     ← Reviewer 读+写
var/dev-loop/archive/                          ← 归档目录
```

## 脚本行为详细说明

### builder-init.js
1. 读取 `01-planner-instruction.md`
2. 解析并打印：任务 ID、任务类型、目标、验收标准列表
3. 输出提示语：「Builder 准备就绪，请开始工作。完成后填写 02-builder-report.md」
4. 支持 `--json` 参数：以 JSON 格式输出解析结果（供未来自动化使用）

### reviewer-init.js
1. 读取 `02-builder-report.md`
2. 解析并打印：任务 ID、执行结果（成功/失败）、修改的文件列表、需要审查的重点
3. 输出提示语：「Reviewer 准备就绪，请审查以上内容。完成后填写 03-reviewer-summary.md」
4. 支持 `--json` 参数

### planner-archive.js
1. 读取三个 active 文件的内容
2. 生成归档目录 `var/dev-loop/archive/round-NNN/`（NNN 自增，从已有目录中取最大值+1）
3. 复制三个文件到归档目录
4. 用空白模板覆盖 active/ 下的文件（模板见下方）
5. 打印归档路径

**空白模板内容**（覆盖 active 文件用）：
```
01-planner-instruction.md → 见本文件底部 TEMPLATE-01
02-builder-report.md      → 见本文件底部 TEMPLATE-02
03-reviewer-summary.md    → 见本文件底部 TEMPLATE-03
```

---

## TEMPLATE-01（01-planner-instruction.md 模板）

```markdown
# Planner 指令 | Round XXX | 日期

## 任务 ID
TASK-XXX-NNN

## 任务类型
[feature / bugfix / refactor / test / infra]

## 目标
（一句话）

## 验收标准
- [ ] 条件 1
- [ ] 条件 2

## 约束条件
-

## 关键文件路径
-

## 给 Builder 的注意事项
-
```

---

## TEMPLATE-02（02-builder-report.md 模板）

```markdown
# Builder 报告 | Round XXX | 日期

## 任务 ID
TASK-XXX-NNN

## 执行结果
[成功 / 失败 / 部分完成]

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|

## 验收标准完成情况
- [ ] 条件 1 → [完成/未完成/跳过] 说明
- [ ] 条件 2 → [完成/未完成/跳过] 说明

## 测试结果
（运行了什么测试，结果如何）

## 已知问题 / 注意事项
-

## 请求 Reviewer 关注点
-
```

---

## TEMPLATE-03（03-reviewer-summary.md 模板）

```markdown
# Reviewer 总结 | Round XXX | 日期

## 任务 ID
TASK-XXX-NNN

## 审查结论
[通过 / 通过（有建议）/ 拒绝]

## 问题清单
| 严重级别 | 位置 | 描述 | 是否阻塞 |
|----------|------|------|----------|

## 给 Planner 的建议
-

## 下一轮方向建议
-
```

---

## 完成后

Builder 填写 `02-builder-report.md`，格式用上方 TEMPLATE-02，然后通知用户切换到 Reviewer。
