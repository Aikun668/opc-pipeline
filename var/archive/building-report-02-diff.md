# Build Report - 第三轮

日期: 2026-04-14
状态: 全部完成
验证: 14 通过 / 0 失败

## 变更文件

orchestrator.js:createTask 新增 git rev-parse HEAD 获取 baseCommit 写入信标 _meta_extra.baseCommit
orchestrator.js:getCodeDiff 重写，优先 git diff ${baseCommit} --，无 baseCommit 返回降级提示
pipe/pipe-manager.js:writeInputBeacon 的 _meta 合并 inputData._meta_extra 字段后删除该临时 key
config/models.json:models.review 新增 maxReasoningTokens: 2000
llm-manager.js:callModel 新增 reasoning token 超阈值 console.warn 告警
test-fixes.js:新增测试13 peekInputBeacon 非法JSON返回 null；测试14 getCodeDiff 非Git目录返回降级提示

## 关键逻辑

baseCommit 获取时机:createTask 时一次性快照，存入信标 _meta.baseCommit
baseCommit 为 null 的场景:非 Git 目录 / git 不可用 / git rev-parse 失败
getCodeDiff 降级链:baseCommit 存在 → git diff <hash> → 成功则返回 / 失败则降级提示；baseCommit 不存在 → 直接降级提示
reasoning 告警逻辑:result.usage.reasoning > models[stage].maxReasoningTokens 时打 WARN，不阻断流程
peekInputBeacon 异常处理:候选信标 JSON 解析失败时 continue 跳过，全部失败返回 null

## Review 关注点

1:getCodeDiff 中 git diff ${baseCommit} -- 的 baseCommit 未做 shell 转义（来源是 git rev-parse 自身输出，应为合法 hex hash，但可考虑校验）
2:writeInputBeacon 用 spread 合并 _meta_extra，如果 inputData 有同名 key 会覆盖 _meta 内置字段（taskId/createdAt/projectRoot），当前无此风险但值得留意
3:reasoning 告警仅在非 mock 模式触发（mock 模式 usage 固定为 {input:10,output:10} 无 reasoning 字段）
