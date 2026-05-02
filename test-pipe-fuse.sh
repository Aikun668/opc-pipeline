#!/bin/bash
#
# OPC 管道 + 熔断机制测试脚本
#

set -euo pipefail

PIPE_DIR="/home/jadekun/.openclaw/workspace/opc-pipeline"
TEST_TASK_ID="TEST-$(date +%s)"

echo "================================"
echo "OPC Pipeline 管道系统测试"
echo "================================"
echo ""

# 测试1: 创建管道目录
echo "[测试1] 创建管道目录..."
node "${PIPE_DIR}/pipe/pipe-manager.js" create "${TEST_TASK_ID}"
PIPE_PATH="/tmp/opc-pipe/${TEST_TASK_ID}"
if [[ -d "$PIPE_PATH" ]]; then
    echo "✓ 管道目录创建成功: $PIPE_PATH"
else
    echo "✗ 管道目录创建失败"
    exit 1
fi
echo ""

# 测试2: 写入输入文件
echo "[测试2] 写入输入文件..."
cat > "${PIPE_PATH}/input.json" <<'EOF'
{
  "taskId": "TEST-001",
  "type": "feature",
  "description": "实现用户登录API",
  "constraints": ["使用 bcrypt", "JWT 过期 24h"]
}
EOF
if [[ -f "${PIPE_PATH}/input.json" ]]; then
    echo "✓ 输入文件写入成功"
else
    echo "✗ 输入文件写入失败"
    exit 1
fi
echo ""

# 测试3: 通过验证的输出
echo "[测试3] 测试通过验证的输出..."
cat > "${PIPE_PATH}/output-valid.json" <<'EOF'
{
  "version": "1.0",
  "status": "success",
  "stage": "coding",
  "summary": "登录API实现完成，包含bcrypt加密和JWT签发",
  "artifacts": {
    "patch": "/tmp/opc-pipe/TEST-001/code.patch"
  },
  "metrics": {
    "linesChanged": 50
  },
  "nextAction": "request_review",
  "error": null
}
EOF

# 使用熔断验证器检查
echo "  - 使用 Node.js 验证器检查..."
if node "${PIPE_DIR}/gates/fuse-validator.js" "${PIPE_PATH}/output-valid.json"; then
    echo "✓ Node.js 验证通过"
else
    echo "✗ Node.js 验证失败"
    exit 1
fi

echo "  - 使用 Bash 验证器检查..."
if bash "${PIPE_DIR}/gates/validate-output.sh" "${PIPE_PATH}/output-valid.json"; then
    echo "✓ Bash 验证通过"
else
    echo "✗ Bash 验证失败"
    exit 1
fi
echo ""

# 测试4: 测试熔断触发 - 输出太长
echo "[测试4] 测试熔断触发（输出过长）..."
LONG_SUMMARY=$(python3 -c "print('A' * 450)")
cat > "${PIPE_PATH}/output-too-long.json" <<EOF
{
  "version": "1.0",
  "status": "success",
  "summary": "${LONG_SUMMARY}",
  "nextAction": "complete"
}
EOF

echo "  - 期望: 验证失败（熔断触发）"
if node "${PIPE_DIR}/gates/fuse-validator.js" "${PIPE_PATH}/output-too-long.json" 2>/dev/null; then
    echo "✗ 验证器没有触发熔断（预期应该失败）"
    exit 1
else
    echo "✓ 熔断正确触发"
fi
echo ""

# 测试5: 测试熔断触发 - 缺少必填字段
echo "[测试5] 测试熔断触发（缺少必填字段）..."
cat > "${PIPE_PATH}/output-missing.json" <<'EOF'
{
  "version": "1.0",
  "status": "success"
}
EOF

echo "  - 期望: 验证失败（缺少字段）"
if node "${PIPE_DIR}/gates/fuse-validator.js" "${PIPE_PATH}/output-missing.json" 2>/dev/null; then
    echo "✗ 验证器没有触发熔断（预期应该失败）"
    exit 1
else
    echo "✓ 熔断正确触发"
fi
echo ""

# 测试6: 测试大文件通过 artifacts 引用
echo "[测试6] 测试大文件 artifacts 引用..."
# 创建大文件（模拟代码 patch）
python3 -c "
code = 'function login() { console.log(\"login\"); }\\n' * 100
with open('${PIPE_PATH}/code.patch', 'w') as f:
    f.write(code)
"
ARTIFACT_SIZE=$(stat -c%s "${PIPE_PATH}/code.patch" 2>/dev/null || stat -f%z "${PIPE_PATH}/code.patch")
echo "  - 创建大文件: ${ARTIFACT_SIZE} 字节"

# 验证 output.json 仍然符合约束
cat > "${PIPE_PATH}/output-with-artifact.json" <<'EOF'
{
  "version": "1.0",
  "status": "success",
  "stage": "coding",
  "summary": "代码变更已写入patch文件",
  "artifacts": {
    "patch": "/tmp/opc-pipe/TEST-001/code.patch",
    "testReport": "/tmp/opc-pipe/TEST-001/test-report.json"
  },
  "nextAction": "request_review",
  "error": null
}
EOF

if node "${PIPE_DIR}/gates/fuse-validator.js" "${PIPE_PATH}/output-with-artifact.json"; then
    echo "✓ 带 artifacts 的输出验证通过"
    echo "  - 输出大小: $(wc -c < ${PIPE_PATH}/output-with-artifact.json) 字节"
    echo "  - 引用文件: ${ARTIFACT_SIZE} 字节"
    echo "  - 证明：大内容通过 artifacts 引用，不违反 500 字符限制"
else
    echo "✗ 验证失败"
    exit 1
fi
echo ""

# 测试7: 测试文件锁
echo "[测试7] 测试文件锁机制..."
node -e "
const { PipeManager } = require('${PIPE_DIR}/pipe/pipe-manager.js');
const pm = new PipeManager();
pm.acquireLock('${TEST_TASK_ID}');
console.log('  - 锁已获取');
setTimeout(() => {
  pm.releaseLock('${TEST_TASK_ID}');
  console.log('  - 锁已释放');
}, 100);
"
sleep 0.2
echo "✓ 文件锁机制正常"
echo ""

# 测试8: 清理测试数据
echo "[测试8] 清理测试数据..."
node "${PIPE_DIR}/pipe/pipe-manager.js" cleanup 0
echo "✓ 过期数据清理完成"
echo ""

echo "================================"
echo "所有测试通过"
echo "================================"
