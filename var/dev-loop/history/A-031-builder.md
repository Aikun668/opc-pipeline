# Builder Report | Round A-31 | 2026-05-11

## 任务 ID
TASK-A-031

## 执行结果
成功

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| config/models.json | 修改 | coding timeout 600→900s（Fix 1，A-21 已完成） |
| llm-clients/deepseek-client.js | 修改 | ECONNABORTED 时返回清晰超时信息 |
| src/live-server.js | 修改 | 新增 `/api/rounds/:id/tasks` 端点，返回任务列表+状态 |
| src/public/scoring.html | 重写 | 完整重构：暗色主题、真实数据管线、智能预览、评分可视化 |

## 验收标准完成情况

### Fix 1 — Coding 超时（A-21 遗留）
- [x] `config/models.json` coding timeout 600→900s

### Fix 2 — ECONNABORTED 错误信息
- [x] `deepseek-client.js` L74-82 改造
  - maxRetries 达到时检测 `error.code === 'ECONNABORTED'` 或 message 含 timeout
  - 返回：`请求超时(${timeoutSec}s)，已重试${maxRetries}次，请检查网络或增大 timeout 配置`
  - 非超时错误保持原有降级逻辑

### Fix 3 — Live Server API 扩展
- [x] 新增 `serveRoundTaskList(roundDir, res)` 方法
  - 读取 `var/benchmark/{roundId}/tasks/` 目录
  - 返回：`[{ taskId, status, hasOutput }]`
  - status 从 `task-result.json` 的 success 字段推导
- [x] 路由注册：`/api/rounds/:id/tasks`（parts.length === 2）

### Fix 4 — Scoring.html 完全重写

**Part A — 数据管线修复**
- [x] 评分数据直接读取 `review-scores.json`
  - 通过 `/api/rounds/{id}/tasks/{tid}/file?p=review-scores.json` 获取
  - 解析后提取 `review.grade`、`review.scores`、`review.issues`
  - Review 评分卡片优先展示（中间列）
- [x] 自动评分作为参考（左列）
  - 从 `/api/rounds/{id}/scores` 获取 `autoScores`
  - 展示 grade 标签 + 总分数 + 五维分数条
- [x] 人工评分可持久化（右列）
  - 通过 `/api/rounds/{id}/scores/{tid}` POST 保存
  - 加载时从 scores API 的 humanScores 恢复

**Part B — 预览体验**
- [x] 三栏布局：任务列表 | 文件树 | 预览+评分
- [x] 文件树常驻左侧，点击文件右侧预览
- [x] 面包屑导航 + 返回按钮
  - 显示 `taskId / filePath` 路径
  - 返回按钮恢复文件树选择状态
- [x] 文件类型智能判断
  - `.html` → sandbox iframe 渲染（通过 `/preview/` URL）
  - `.png/.jpg/.svg/.gif` → `<img>` 标签预览
  - `.js/.py/.ts/.json/.md/.css/.sh/.yml/.txt/.tsx/.jsx/.vue` → 语法高亮
  - 其他 → 二进制提示
- [x] 文件图标按类型着色（js/py/html/css/md/json/img）

**Part C — 主题统一**
- [x] 暗色主题，完全对齐 dashboard.html 的 CSS 变量
  - `--bg: #0d1117`, `--card: #161b22`, `--border: #30363d`
  - `--accent: #58a6ff`, `--success: #3fb950`, `--warning: #d29922`, `--error: #f85149`
- [x] 字体、圆角、阴影与 dashboard 一致

**Part D — 评分交互**
- [x] 自动评分：grade 圆形色标（A/B/C）+ 五维分数条
- [x] Review 评分：grade 色标 + 四维分数条 + issue 列表（最多显示 5 条，剩余提示数量）
  - issue 卡片带 level 色标（A=红, B=黄, C=蓝）
  - 显示 category、desc、suggestion
- [x] 人工评分：五星制，点击保存后持久化

## 不修改的文件

- `scripts/` ✅
- `config/`（除 A-21 已完成的 timeout 修改）✅
- 零新依赖 ✅

## 验证结果

| 检查项 | 结果 |
|--------|------|
| deepseek-client.js 语法 | 通过（node --check） |
| live-server.js 语法 | 通过（node --check） |
| scoring.html 结构 | 通过（HTML 完整，无未闭合标签） |
| `/api/rounds/:id/tasks` 路由 | 已注册 |
| `serveRoundTaskList` 方法 | 已实现 |
| ECONNABORTED 错误信息 | 已改造 |

## 已知问题 / 注意事项

- scoring.html 不再调用已废弃的 `/api/rounds/:id/scores` 作为唯一数据源，而是组合多个 API
- review-scores.json 不存在时，Review 评分卡显示 "-"，不影响其他功能
- 文件预览的 iframe sandbox 禁止了 top-navigation，防止 HTML 产物跳转父页面
- 图片预览直接使用 `/preview/` URL，支持 png/jpg/svg/gif

## 请求 Reviewer 关注点

1. **超时错误信息**：在 coding 阶段超时后，日志是否显示清晰的 "请求超时(900s)，已重试3次..." 而非裸 "aborted"
2. **任务列表加载**：切换轮次后，任务列表是否正确从 `/api/rounds/:id/tasks` 加载
3. **Review 评分数据**：选择任务后，Review 评分卡是否显示真实的 grade 和 issue 列表
4. **文件预览**：点击 .html 是否渲染 iframe，点击 .png 是否显示图片，点击 .js 是否显示语法高亮代码
5. **主题一致性**：评分页面与监控页面的暗色风格是否统一
