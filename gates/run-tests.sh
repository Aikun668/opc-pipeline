#!/bin/bash
#
# 硬编码质量关卡 - 测试检查
# 不依赖 AI 理解，只看 EXIT_CODE
#

set -euo pipefail

PROJECT_DIR="${1:-.}"
REPORT_FILE="${2:-test-report.json}"

cd "$PROJECT_DIR"

echo "{\"stage\": \"testing\", \"checks\": [], \"passed\": true}" > "$REPORT_FILE"

PASS=0
FAIL=0

# ===== 检查 1: 单元测试 =====
echo "Running unit tests..."
if npm test 2>&1; then
    TEST_EXIT=0
    echo "✓ Unit tests passed"
else
    TEST_EXIT=1
    echo "✗ Unit tests failed"
fi

# 提取测试结果（不依赖 AI）
if [[ -f "coverage/lcov-report/index.html" ]]; then
    COVERAGE=$(grep -oP '>[0-9]+%' coverage/lcov-report/index.html | head -1 | tr -d '>%')
else
    COVERAGE=0
fi

if [[ "$TEST_EXIT" -eq 0 && "$COVERAGE" -ge 80 ]]; then
    CHECK1='{"name": "unit_tests", "passed": true, "coverage": '$COVERAGE'}'
    ((PASS++))
else
    CHECK1='{"name": "unit_tests", "passed": false, "coverage": '$COVERAGE', "error": "Exit code: '$TEST_EXIT' or coverage < 80%"}'
    ((FAIL++))
fi

# ===== 检查 2: TypeScript 类型 =====
echo "Running type check..."
if npx tsc --noEmit 2>&1; then
    CHECK2='{"name": "typescript", "passed": true}'
    ((PASS++))
else
    CHECK2='{"name": "typescript", "passed": false, "error": "Type errors found"}'
    ((FAIL++))
fi

# ===== 检查 3: Lint =====
echo "Running lint..."
if npx eslint src/ --max-warnings=0 2>&1; then
    CHECK3='{"name": "lint", "passed": true}'
    ((PASS++))
else
    CHECK3='{"name": "lint", "passed": false, "error": "Lint errors found"}'
    ((FAIL++))
fi

# ===== 检查 4: 安全检查（基础） =====
echo "Running security scan..."
if grep -r "eval(" src/ 2>/dev/null || \
   grep -r "Function(" src/ 2>/dev/null || \
   grep -r "exec(" src/ 2>/dev/null | grep -v "child_process"; then
    CHECK4='{"name": "security", "passed": false, "error": "Potential dangerous code found"}'
    ((FAIL++))
else
    CHECK4='{"name": "security", "passed": true}'
    ((PASS++))
fi

# ===== 生成报告 =====
TOTAL=$((PASS + FAIL))
if [[ "$FAIL" -eq 0 ]]; then
    OVERALL="true"
    EXIT_CODE=0
else
    OVERALL="false"
    EXIT_CODE=1
fi

cat > "$REPORT_FILE" <<EOF
{
  "stage": "testing",
  "timestamp": $(date +%s),
  "passed": $OVERALL,
  "summary": {
    "total": $TOTAL,
    "passed": $PASS,
    "failed": $FAIL
  },
  "checks": [
    $CHECK1,
    $CHECK2,
    $CHECK3,
    $CHECK4
  ]
}
EOF

echo "================================"
echo "Tests: $PASS/$TOTAL passed"
echo "================================"

cat "$REPORT_FILE"
exit $EXIT_CODE
