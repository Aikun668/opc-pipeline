#!/bin/bash
#
# OPC 输出验证脚本 - 熔断机制硬检查
# 返回 0 = 通过，返回 1 = 熔断触发（输出无效）
#

set -euo pipefail

OUTPUT_FILE="${1:-}"
MAX_OUTPUT_CHARS=500
MAX_SUMMARY_CHARS=100

if [[ -z "$OUTPUT_FILE" ]]; then
    echo "ERROR: No output file specified" >&2
    exit 1
fi

if [[ ! -f "$OUTPUT_FILE" ]]; then
    echo "ERROR: Output file not found: $OUTPUT_FILE" >&2
    exit 1
fi

# 检查1: 必须是有效JSON
if ! jq empty "$OUTPUT_FILE" 2>/dev/null; then
    echo "FUSE_BLOWN: Invalid JSON format" >&2
    exit 1
fi

# 检查2: 必须字段存在
for field in version status summary nextAction; do
    if ! jq -e ".${field}" "$OUTPUT_FILE" >/dev/null 2>&1; then
        echo "FUSE_BLOWN: Missing required field: ${field}" >&2
        exit 1
    fi
done

# 检查3: status 必须是枚举值
STATUS=$(jq -r '.status' "$OUTPUT_FILE")
if [[ "$STATUS" != "success" && "$STATUS" != "fail" && "$STATUS" != "error" ]]; then
    echo "FUSE_BLOWN: Invalid status value: ${STATUS}" >&2
    exit 1
fi

# 检查4: summary 长度限制
SUMMARY=$(jq -r '.summary // ""' "$OUTPUT_FILE")
if [[ "${#SUMMARY}" -gt "$MAX_SUMMARY_CHARS" ]]; then
    echo "FUSE_BLOWN: summary too long: ${#SUMMARY} > ${MAX_SUMMARY_CHARS} chars" >&2
    exit 1
fi

# 检查5: 总字符数限制（熔断核心）
# 计算压缩后的JSON字符数（去除空白）
COMPACT_LENGTH=$(jq -c '.' "$OUTPUT_FILE" | wc -c)
if [[ "$COMPACT_LENGTH" -gt "$MAX_OUTPUT_CHARS" ]]; then
    echo "FUSE_BLOWN: Output too long: ${COMPACT_LENGTH} > ${MAX_OUTPUT_CHARS} chars" >&2
    echo "Hint: Use artifacts to reference large content" >&2
    exit 1
fi

# 检查6: error 字段（如果存在）
if jq -e '.error' "$OUTPUT_FILE" >/dev/null 2>&1; then
    ERROR_MSG=$(jq -r '.error')
    if [[ "${#ERROR_MSG}" -gt 200 ]]; then
        echo "FUSE_BLOWN: error message too long: ${#ERROR_MSG} > 200 chars" >&2
        exit 1
    fi
fi

# 检查7: artifacts 必须是对象（如果存在）
if jq -e '.artifacts' "$OUTPUT_FILE" >/dev/null 2>&1; then
    if ! jq -e '(.artifacts | type) == "object"' "$OUTPUT_FILE" >/dev/null 2>&1; then
        echo "FUSE_BLOWN: artifacts must be an object" >&2
        exit 1
    fi
fi

# 所有检查通过
echo "OK: Output validation passed"
echo "  - Status: $STATUS"
echo "  - Summary: ${SUMMARY:0:50}..."
echo "  - Size: ${COMPACT_LENGTH} chars"
exit 0
