#!/usr/bin/env node
/**
 * OPC 熔断验证器 - Node.js 版本
 * 用于 Agent 内部调用
 */

const fs = require('fs');

const CONSTRAINTS = {
  MAX_OUTPUT_CHARS: 500,
  MAX_SUMMARY_CHARS: 100,
  MAX_ERROR_CHARS: 200,
  VALID_STATUSES: ['success', 'fail', 'error'],
  REQUIRED_FIELDS: ['version', 'status', 'summary', 'nextAction']
};

class FuseValidator {
  constructor(options = {}) {
    this.strict = options.strict !== false; // 默认严格模式
    this.maxOutputChars = options.maxOutputChars || CONSTRAINTS.MAX_OUTPUT_CHARS;
    this.maxSummaryChars = options.maxSummaryChars || CONSTRAINTS.MAX_SUMMARY_CHARS;
  }

  /**
   * 验证输出对象
   * @param {Object} output - 输出数据
   * @returns {Object} { valid: boolean, reason?: string, details?: Object }
   */
  validate(output) {
    // 检查1: 必须是对象
    if (typeof output !== 'object' || output === null) {
      return {
        valid: false,
        reason: 'Output must be an object',
        code: 'NOT_OBJECT'
      };
    }

    // 检查2: 必须字段
    const missing = CONSTRAINTS.REQUIRED_FIELDS.filter(f => !(f in output));
    if (missing.length > 0) {
      return {
        valid: false,
        reason: `Missing required fields: ${missing.join(', ')}`,
        code: 'MISSING_FIELDS',
        details: { missing }
      };
    }

    // 检查3: status 枚举值
    if (!CONSTRAINTS.VALID_STATUSES.includes(output.status)) {
      return {
        valid: false,
        reason: `Invalid status: ${output.status}, must be one of ${CONSTRAINTS.VALID_STATUSES.join(', ')}`,
        code: 'INVALID_STATUS'
      };
    }

    // 检查4: summary 长度
    if (typeof output.summary !== 'string') {
      return {
        valid: false,
        reason: 'summary must be a string',
        code: 'SUMMARY_NOT_STRING'
      };
    }
    if (output.summary.length > this.maxSummaryChars) {
      return {
        valid: false,
        reason: `summary too long: ${output.summary.length} > ${this.maxSummaryChars} chars`,
        code: 'SUMMARY_TOO_LONG',
        details: {
          actual: output.summary.length,
          limit: this.maxSummaryChars,
          preview: output.summary.substring(0, 50) + '...'
        }
      };
    }

    // 检查5: 总字符数（熔断核心）
    const compactOutput = JSON.stringify(output);
    if (compactOutput.length > this.maxOutputChars) {
      return {
        valid: false,
        reason: `Output too long: ${compactOutput.length} > ${this.maxOutputChars} chars`,
        code: 'OUTPUT_TOO_LONG',
        details: {
          actual: compactOutput.length,
          limit: this.maxOutputChars,
          hint: 'Use artifacts to reference large content'
        }
      };
    }

    // 检查6: error 字段
    if (output.error !== undefined && output.error !== null) {
      if (typeof output.error !== 'string') {
        return {
          valid: false,
          reason: 'error must be a string or null',
          code: 'ERROR_NOT_STRING'
        };
      }
      if (output.error.length > CONSTRAINTS.MAX_ERROR_CHARS) {
        return {
          valid: false,
          reason: `error message too long: ${output.error.length} > ${CONSTRAINTS.MAX_ERROR_CHARS} chars`,
          code: 'ERROR_TOO_LONG'
        };
      }
    }

    // 检查7: artifacts 类型
    if (output.artifacts !== undefined) {
      if (typeof output.artifacts !== 'object' || output.artifacts === null) {
        return {
          valid: false,
          reason: 'artifacts must be an object',
          code: 'ARTIFACTS_NOT_OBJECT'
        };
      }
    }

    // 检查8: nextAction 必须是字符串
    if (typeof output.nextAction !== 'string') {
      return {
        valid: false,
        reason: 'nextAction must be a string',
        code: 'NEXTACTION_NOT_STRING'
      };
    }

    // 所有检查通过
    return {
      valid: true,
      details: {
        status: output.status,
        summaryLength: output.summary.length,
        outputLength: compactOutput.length
      }
    };
  }

  /**
   * 从文件验证
   */
  validateFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        reason: `File not found: ${filePath}`,
        code: 'FILE_NOT_FOUND'
      };
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return {
        valid: false,
        reason: `Failed to read file: ${e.message}`,
        code: 'READ_ERROR'
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return {
        valid: false,
        reason: `Invalid JSON: ${e.message}`,
        code: 'INVALID_JSON'
      };
    }

    return this.validate(parsed);
  }

  /**
   * 生成合规的输出模板
   */
  static createTemplate(options = {}) {
    return {
      version: '1.0',
      status: options.status || 'success',
      stage: options.stage || 'coding',
      summary: options.summary || '',
      artifacts: options.artifacts || {},
      metrics: options.metrics || {},
      nextAction: options.nextAction || 'complete',
      error: options.error || null
    };
  }
}

module.exports = { FuseValidator, CONSTRAINTS };

// CLI 用法
if (require.main === module) {
  const filePath = process.argv[2];
  
  if (!filePath) {
    console.error('Usage: node fuse-validator.js <output.json>');
    process.exit(1);
  }

  const validator = new FuseValidator();
  const result = validator.validateFile(filePath);
  
  if (result.valid) {
    console.log('✓ Validation passed');
    console.log(JSON.stringify(result.details, null, 2));
    process.exit(0);
  } else {
    console.error('✗ FUSE_BLOWN:', result.reason);
    if (result.details) {
      console.error('Details:', JSON.stringify(result.details, null, 2));
    }
    process.exit(1);
  }
}
