#!/usr/bin/env python3
"""
Task #001 - 基础数据清洗脚本
功能：读取CSV，去重、标准化手机号、填充缺失值
"""

import csv
import sys
import re
import argparse
from pathlib import Path


def normalize_phone(phone: str) -> str:
    """将手机号统一格式化为 +86-XXX-XXXX-XXXX"""
    if not phone or str(phone).strip() == '':
        return 'N/A'

    # 提取所有数字
    digits = re.sub(r'\D', '', str(phone))

    # 处理带国家码的情况 (+86 或 86 开头)
    if digits.startswith('86') and len(digits) >= 12:
        digits = digits[2:]

    # 必须是11位中国手机号
    if len(digits) != 11:
        return 'N/A'

    # 格式化为 +86-138-0000-0000
    return f"+86-{digits[:3]}-{digits[3:7]}-{digits[7:11]}"


def clean_csv(input_path: str, output_path: str) -> dict:
    """
    清洗CSV文件
    返回统计信息
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"输入文件不存在: {input_path}")

    seen_rows = set()
    cleaned_rows = []
    stats = {
        'total_input': 0,
        'duplicates_removed': 0,
        'missing_filled': 0,
        'phones_normalized': 0,
        'total_output': 0
    }

    with open(input_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames

        for row in reader:
            stats['total_input'] += 1

            # 处理缺失字段：用 N/A 填充
            for field in fieldnames:
                if not row.get(field) or str(row.get(field)).strip() == '':
                    row[field] = 'N/A'
                    stats['missing_filled'] += 1

            # 标准化手机号
            if 'phone' in row:
                original_phone = row['phone']
                normalized = normalize_phone(original_phone)
                if normalized != original_phone:
                    stats['phones_normalized'] += 1
                row['phone'] = normalized

            # 去重：基于所有字段的元组
            row_tuple = tuple(row.values())
            if row_tuple in seen_rows:
                stats['duplicates_removed'] += 1
                continue

            seen_rows.add(row_tuple)
            cleaned_rows.append(row)

    # 写入输出文件
    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(cleaned_rows)

    stats['total_output'] = len(cleaned_rows)
    return stats


def main():
    parser = argparse.ArgumentParser(description='CSV 数据清洗工具')
    parser.add_argument('input', help='输入CSV文件路径')
    parser.add_argument('-o', '--output', default='cleaned_output.csv', help='输出CSV文件路径')
    args = parser.parse_args()

    try:
        stats = clean_csv(args.input, args.output)
        print(f"\n清洗完成！")
        print(f"  输入行数: {stats['total_input']}")
        print(f"  输出行数: {stats['total_output']}")
        print(f"  去重数量: {stats['duplicates_removed']}")
        print(f"  填充缺失: {stats['missing_filled']} 处")
        print(f"  手机号标准化: {stats['phones_normalized']} 个")
        print(f"  输出文件: {args.output}")
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
