# Builder 报告 | Round A-02 | 2026-04-22

## 任务 ID
TASK-A-002

## 执行结果
成功

## 修改文件清单
| 文件 | 操作 | 说明 |
|------|------|------|
| tests/benchmark/benchmark-runner.js | 修改 | 修复 require 缓存清理 + OPC_SPAWN_MODE 环境变量支持 |

## 验收标准完成情况
- [x] `benchmark-runner.js` 的 require 缓存清理覆盖所有被 Orchestrator 依赖的本地模块 → 完成（`Object.keys(require.cache).filter(k => k.includes('/src/')).forEach(...)`）
- [x] 两个 task 连续执行后，第二个 task 的初始状态不受第一个 task 的任何残留影响 → 完成（验证：清除前 6 个缓存条目，清除后 0 个）
- [x] 支持通过环境变量 `OPC_SPAWN_MODE` 配置执行模式，默认值为 `mock` → 完成（文件顶部读取，优先于 .env）
- [x] 跑 `node tests/benchmark/benchmark-runner.js` 仍然通过 → 完成（2/2 成功，70ms）

## 实际运行结果

```
🚀 Phase A Benchmark Runner
============================
[Benchmark] 开始任务: BENCH-001 - 实现一个两数求和的 JavaScript 函数...
  ✅ 完成: completed, 耗时: 64ms, 成本: ¥0.0031
[Benchmark] 开始任务: BENCH-002 - 实现一个判断字符串是否为回文的函数...
  ✅ 完成: completed, 耗时: 6ms, 成本: ¥0.0031
============================
Benchmark 完成
任务数: 2
成功: 2
失败: 0
总耗时: 70ms
总成本: ¥0.0062
```

## 修改详情

### 1. require 缓存清理（L33-36）

**修改前**（硬编码 4 个模块）：
```javascript
delete require.cache[require.resolve('../../src/orchestrator')];
delete require.cache[require.resolve('../../src/llm-manager')];
delete require.cache[require.resolve('../../src/cost-tracker')];
delete require.cache[require.resolve('../../src/spawn-adapter')];
```

**修改后**（自动覆盖所有 src/ 目录下的模块）：
```javascript
const srcPath = path.join(ROOT, 'src');
Object.keys(require.cache)
  .filter(key => key.includes(srcPath))
  .forEach(key => delete require.cache[key]);
```

验证结果：
- require 后：6 个缓存条目
- 清除后：0 个缓存条目

### 2. OPC_SPAWN_MODE 环境变量支持（L8-10）

**修改前**（在循环内设置，可能被 .env 覆盖）：
```javascript
process.env.OPC_SPAWN_MODE = 'mock';
```

**修改后**（文件顶部，在 dotenv 加载前设置）：
```javascript
const spawnMode = process.env.OPC_SPAWN_MODE || 'mock';
process.env.OPC_SPAWN_MODE = spawnMode;
```

这样即使 `.env` 文件设置了 `OPC_SPAWN_MODE=api`，benchmark 默认仍使用 mock 模式。用户可以通过 `OPC_SPAWN_MODE=api node benchmark-runner.js` 切换到 api 模式。

## 已知问题 / 注意事项
- 缓存清理使用字符串匹配 `includes(srcPath)`，如果项目路径中包含 "src" 的其他目录可能被误清理，但在当前项目结构下安全
- dotenv 的 `injected env` 日志仍然显示，但不影响实际运行

## 请求 Reviewer 关注点
- require 缓存清理方式是否足够健壮（是否需要更精确的路径匹配）
- OPC_SPAWN_MODE 在文件顶部设置是否足够早（dotenv 在 orchestrator.js 顶部加载）
