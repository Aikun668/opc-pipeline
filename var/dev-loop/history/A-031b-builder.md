# Builder Report | Round A-31b | 2026-05-11

## 任务 ID
TASK-A-031b

## 执行结果
成功

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/live-server.js` | 修改 | 删除 `saveRoundScore` 冗余双写；简化 `serveRoundScores` fallback |

## 问题修复

### 人工评分双写不一致风险

**原问题**：`saveRoundScore` 同时写 `roundDir/scores.json`（主存储）和全局 `BENCHMARK_DIR/human-scores.json`（冗余），存在 L345 成功但 L353 失败的数据不一致风险。

**修复**：
- [x] 删除 `saveRoundScore` L347-353：移除全局 `human-scores.json` 的读写逻辑
- [x] 简化 `serveRoundScores` L318-322：移除从全局文件读 humanScores 的 fallback
  - 自 A-31 引入 `scores.json` 后，全局文件已是冗余
  - GET 永远走 `scores.json` 快速路径

## 验证结果

| 检查项 | 结果 |
|--------|------|
| live-server.js 语法 | 通过（node --check） |
| 删除行数 | ~10 行 |

## 请求 Reviewer 关注点

1. **保存评分**：打分保存后刷新页面，分数是否仍在
2. **数据一致性**：确认没有 `human-scores.json` 相关报错

