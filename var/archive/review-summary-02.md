# OPC Pipeline Build #2 Review 总结

> Reviewer 输出 | 目标读者: Planner  
> 时间: 2026-04-14 (第二轮)

---

## 一、Build 整体评价  

Builder 本轮交付的 **3 个核心功能** 已全部实现且通过测试（12/12）。整体架构合理，Mock 模式 6 阶段工作流完整执行到 `completed`。

**亮点**：
1. `peekInputBeacon` – 非消费式信标读取，ready→processing→done 兜底顺序正确  
2. `getCodeDiff` – git diff + HEAD~1 回退 + 非 git 目录降级  
3. `reasoning_tokens` – DeepSeek-R1 解析 + 累加统计 + 监控面板展示

**Review 顺手修复**：`peekInputBeacon` 增加 JSON 解析异常捕获（防止损坏信标文件导致崩溃）。

---

## 二、Review 分级详情  

### 1. 非常修改（非常严重）– **无**  
未发现系统流程完整性错误。

### 2. 主张修改（中等严重）– **Pass 给 Builder**

#### 2.1 `getCodeDiff` 非 git 仓库检测不准确
**问题**：内层 try/catch 可能吞掉错误，导致无法正确返回"项目未初始化 Git"消息，而是输出 placeholder。  
**影响**：下游 Review 阶段可能误判为"无变更"而非"项目未初始化"。  
**建议**：在尝试 git diff 前，先用 `git rev-parse --is-inside-work-tree` 检测是否为 git 仓库。

#### 2.2 `HEAD~1` 只有一个提交时无效
**问题**：单提交仓库中 `git diff HEAD~1` 会抛 "ambiguous argument" 错误。  
**影响**：当前被内层 catch 吞掉，返回 placeholder，但可能隐藏真实状态。  
**建议**：检查提交数（`git rev-list --count HEAD`），≥2 时才尝试 HEAD~1。

#### 2.3 未跟踪文件和暂存变更未被捕获
**问题**：`git diff` 默认不包含未跟踪文件和暂存变更。  
**影响**：新文件或已暂存变更在 Review 阶段不可见。  
**建议**：可考虑 `git diff HEAD`（含暂存）或补充 `git ls-files --others`。

#### 2.4 `code.patch` 写入非原子操作
**问题**：直接 `writeFileSync`，无 tmp+rename 模式。  
**影响**：若写入过程崩溃，下游可能读到损坏/不完整的 patch。  
**建议**：统一使用 pipe-manager 的原子写入模式（tmp→rename）。

### 3. 轻微建议（基本没问题）

#### 3.1 可补充新功能单元测试
`peekInputBeacon`、`getCodeDiff` 边缘情况、`reasoning_tokens` 统计验证。

#### 3.2 错误消息分类细化
git 错误可进一步区分：无 git、无提交、权限错误等。

---

## 三、验证结果  

```bash
$ node test-fixes.js
================================
结果: 12 通过, 0 失败
================================
```
- ✅ Mock 模式 6 阶段完整执行到 `completed`
- ✅ git diff 在非 git 目录下降级正确（输出 "项目未初始化 Git，无法生成 Diff"）
- ✅ 监控面板 Token 统计行显示 `推理 token (R1): 0`

---

## 四、结论与下一步  

**当前代码质量良好，可通过 Review，进入下一轮 Planner。**

**建议 Planner 关注**：
1. 确认 `getCodeDiff` 的长期策略（是否每轮提交后自动生成 patch）
2. 配置真实 API Key 并运行 `OPC_SPAWN_MODE=api node smoke-test-api.js`
3. 评估是否需要为 `reasoning_tokens` 设置单独监控阈值

**本次 Review 修复**：
- `pipe-manager.js` – peekInputBeacon 增加 JSON 解析异常捕获

**Pass 给 Builder 的项目**：
- git diff 多轮迭代优化（2.1-2.4）
- 新功能单元测试补充（3.1）

---

> **附**：遵循"一刀直击要害"原则，本总结已压缩至核心问题与建议。