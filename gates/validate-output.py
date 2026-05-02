#!/usr/bin/env python3
#
# OPC 输出验证脚本 - 熔断机制硬检查
# 返回 0 = 通过，返回 1 = 熔断触发（输出无效）
#

import sys
import json
import os

MAX_OUTPUT_CHARS = 500
MAX_SUMMARY_CHARS = 100
MAX_ERROR_CHARS = 200
VALID_STATUSES = ['success', 'fail', 'error']
REQUIRED_FIELDS = ['version', 'status', 'summary', 'nextAction']

def validate(output_file):
    # 检查文件存在
    if not output_file:
        print("ERROR: No output file specified", file=sys.stderr)
        return 1
    
    if not os.path.isfile(output_file):
        print(f"ERROR: Output file not found: {output_file}", file=sys.stderr)
        return 1
    
    # 读取并解析JSON
    try:
        with open(output_file, 'r') as f:
            content = f.read()
        output = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"FUSE_BLOWN: Invalid JSON format - {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"ERROR: Failed to read file - {e}", file=sys.stderr)
        return 1
    
    # 检查1: 必须是对象
    if not isinstance(output, dict):
        print("FUSE_BLOWN: Output must be an object", file=sys.stderr)
        return 1
    
    # 检查2: 必须字段
    missing = [f for f in REQUIRED_FIELDS if f not in output]
    if missing:
        print(f"FUSE_BLOWN: Missing required fields: {', '.join(missing)}", file=sys.stderr)
        return 1
    
    # 检查3: status 枚举值
    if output['status'] not in VALID_STATUSES:
        print(f"FUSE_BLOWN: Invalid status value: {output['status']}", file=sys.stderr)
        return 1
    
    # 检查4: summary 长度
    if not isinstance(output['summary'], str):
        print("FUSE_BLOWN: summary must be a string", file=sys.stderr)
        return 1
    if len(output['summary']) > MAX_SUMMARY_CHARS:
        print(f"FUSE_BLOWN: summary too long: {len(output['summary'])} > {MAX_SUMMARY_CHARS} chars", file=sys.stderr)
        return 1
    
    # 检查5: 总字符数（熔断核心）
    compact_output = json.dumps(output, separators=(',', ':'))
    if len(compact_output) > MAX_OUTPUT_CHARS:
        print(f"FUSE_BLOWN: Output too long: {len(compact_output)} > {MAX_OUTPUT_CHARS} chars", file=sys.stderr)
        print("Hint: Use artifacts to reference large content", file=sys.stderr)
        return 1
    
    # 检查6: error 字段
    if 'error' in output and output['error'] is not None:
        if not isinstance(output['error'], str):
            print("FUSE_BLOWN: error must be a string or null", file=sys.stderr)
            return 1
        if len(output['error']) > MAX_ERROR_CHARS:
            print(f"FUSE_BLOWN: error message too long: {len(output['error'])} > {MAX_ERROR_CHARS} chars", file=sys.stderr)
            return 1
    
    # 检查7: artifacts 类型
    if 'artifacts' in output and output['artifacts'] is not None:
        if not isinstance(output['artifacts'], dict):
            print("FUSE_BLOWN: artifacts must be an object", file=sys.stderr)
            return 1
    
    # 所有检查通过
    print("OK: Output validation passed")
    print(f"  - Status: {output['status']}")
    print(f"  - Summary: {output['summary'][:50]}...")
    print(f"  - Size: {len(compact_output)} chars")
    return 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 validate-output.py <output.json>", file=sys.stderr)
        sys.exit(1)
    
    sys.exit(validate(sys.argv[1]))
