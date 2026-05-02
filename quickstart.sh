#!/bin/bash
# OPC Pipeline 快速启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "════════════════════════════════════════════════════════════"
echo "           OPC Pipeline 快速启动                             "
echo "════════════════════════════════════════════════════════════"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo "请先安装 Node.js: https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js 版本: $(node --version)"
echo ""

# 运行测试
echo "📋 运行测试验证..."
if node test-fixes.js; then
    echo "✅ 所有测试通过"
else
    echo "❌ 测试失败，请检查错误"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "           可用命令                                          "
echo "════════════════════════════════════════════════════════════"
echo ""
echo "1. 启动监控面板:"
echo "   node monitor.js"
echo ""
echo "2. 运行示例任务:"
echo "   node orchestrator.js"
echo ""
echo "3. 启动 Coder Actor:"
echo "   node actors/coder-actor.js"
echo ""
echo "4. 查看升级通知:"
echo "   ls -la var/escalations/"
echo ""
echo "5. 查看记忆归档:"
echo "   ls -la memory/archives/"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# 询问是否启动监控
read -p "是否启动监控面板? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "启动监控面板..."
    node monitor.js
fi
