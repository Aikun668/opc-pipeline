# Planner 指令 | Round A-33 | 2026-05-12

## 任务 ID
TASK-A-033

## 任务类型
bugfix + UI redesign（预览致命 bug 修复 + scoring 浅色主题重构）

## 背景

A-31 scoring 重写遗留了两个严重问题和一个主题问题，用户明确要求评分系统"绝对不能要暗色"。

## 问题清单

### 问题 1：预览功能全程不可用（致命）

**根因**：`src/live-server.js:677`，`listFiles()` 路径拼接用反斜杠：
```js
// 错误：Windows 风格分隔符
const relPath = prefix ? `${prefix}\${entry.name}` : entry.name;
```
Linux/WSL 上 `\` 是合法文件名字符，不是路径分隔符。影响链：
1. `listFiles` 返回文件路径如 `src\index.html`（一个畸形的扁平文件名）
2. scoring `buildTree()` 用 `/` split → 文件树无法建层级，显示为扁平异常路径
3. `selectFile()` 调 API 传 `src\index.html` → `path.resolve` 找不到文件 → 404
4. `/preview/` 同上 → iframe 加载失败

**修复**：`\` → `/`（1 字符）

### 问题 2：主题必须从暗色改为浅色

用户原话："评分页面的后面的那个背景色绝对不能要暗色，直接和监测面板颜色一样的不就行了吗"

但实际上 dashboard 也是暗色。用户真实意图：**评分页面不能是暗色**，要浅色专业风格。

参考 Supabase DESIGN.md：白色画布（`#ffffff`），近黑文字（`#171717`），翡翠绿点缀，极简 chrome。Vercel 同理。

**配色方案**（对齐 Supabase/Vercel 白画布风格）：

```css
:root {
  --bg: #ffffff;
  --card: #ffffff;
  --surface2: #fafafa;
  --border: #ebebeb;
  --border-hairline: rgba(0,0,0,0.06);
  --text: #171717;
  --text-muted: #666666;
  --accent: #0072f5;          /* Vercel 蓝，链接/选中 */
  --success: #3ecf8e;          /* Supabase 翡翠绿，C 级 */
  --warning: #d29922;
  --error: #f85149;
  --radius: 8px;
  --radius-sm: 6px;
  --shadow: 0px 0px 0px 1px rgba(0,0,0,0.08);  /* Vercel shadow-as-border */
}
```

### 问题 3：评分栏可滚动 + 高度可调

当前 `.score-area` 固定 `height: 320px`，三栏评分卡 + issue 列表挤在 320px 内，需要频繁滚动。用户要求评分栏应该可以滑动。

**修复**：
- 评分栏改为可拖拽调整高度（resize handle），默认 40vh
- 也可简化为：`min-height: 320px; max-height: 60vh; flex-shrink: 0;` 让内容自然撑开

### 问题 4：细节打磨

| # | 问题 | 修复 |
|---|------|------|
| 4a | 文件树切换任务时不清空旧数据 | selectTask 开头已设 `taskFiles = []`，但 renderFileTree 在 fetch 完成后才调 — 加 loading 状态 |
| 4b | 预览 iframe 高度不足 | `height: 100%` 依赖父容器，改为 `min-height: 100%` 或 `flex: 1` |
| 4c | 返回按钮点击后文件树高亮未清除 | `backToFileTree()` 已处理 ✅ |
| 4d | select 下拉框暗色主题残留 | 跟随主题变量走，浅色后自然修复 |

## 文件涉及

| 文件 | 改动 |
|------|------|
| `src/live-server.js` | L677: `\` → `/`（1 字符） |
| `src/public/scoring.html` | CSS 变量全量替换（暗→浅）+ 评分栏高度可调 + 细节修复 |

## 不修改
- `src/public/dashboard.html`（保持暗色不动）
- `scripts/` / `config/`
- 零新依赖

## 设计参考
- Supabase DESIGN.md：白色画布品牌，翡翠绿点缀，Circular/Inter 字体，shadow 替代 border
- Vercel DESIGN.md：Geist 字体体系，shadow-as-border 技法

## 验证
1. 浏览器打开 `/scoring` → 白色背景，不是暗色
2. 选 round → 选任务 → 文件树正确显示层级结构
3. 点击 .html 文件 → iframe 正确渲染
4. 点击 .js/.py 文件 → 代码高亮显示
5. 评分栏可滚动查看 issue 列表

---

产出文件：`var/dev-loop/active/01-planner-instruction.md`
