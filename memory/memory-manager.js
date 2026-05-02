/**
 * OPC Memory Manager - 记忆管理模块
 * 负责角色对话历史的归档、摘要生成和检索
 */

const fs = require('fs');
const path = require('path');

const MEMORY_BASE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline/memory';
const ARCHIVE_DIR = path.join(MEMORY_BASE_DIR, 'archives');
const ROLES_DIR = path.join(MEMORY_BASE_DIR, 'roles');

// 归档触发条件
const ARCHIVE_TRIGGERS = {
  conversationLength: 20,      // 对话超过 20 轮
  featureCompleted: true,       // Feature 完成
  testsPass: true,              // 测试通过
  manualTrigger: false          // 手动触发
};

class MemoryManager {
  constructor() {
    this.ensureDirectories();
    this.roleMemories = new Map(); // role -> { history, lastArchive }
  }

  ensureDirectories() {
    [MEMORY_BASE_DIR, ARCHIVE_DIR, ROLES_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 检查是否需要归档
   */
  shouldArchive(role, context = {}) {
    const memory = this.roleMemories.get(role);
    if (!memory) return false;

    // 条件 1: 对话历史过长
    if (memory.history.length >= ARCHIVE_TRIGGERS.conversationLength) {
      return true;
    }

    // 条件 2: Feature 完成且测试通过
    if (context.featureCompleted && context.testsPass) {
      return true;
    }

    // 条件 3: 手动触发
    if (context.manualTrigger) {
      return true;
    }

    return false;
  }

  /**
   * 添加对话到历史
   */
  addConversation(role, message) {
    if (!this.roleMemories.has(role)) {
      this.roleMemories.set(role, {
        history: [],
        lastArchive: Date.now()
      });
    }

    const memory = this.roleMemories.get(role);
    memory.history.push({
      timestamp: Date.now(),
      role: message.role,
      content: message.content,
      taskId: message.taskId
    });
  }

  /**
   * 归档并重置对话历史
   */
  async archiveAndReset(role, context = {}) {
    const memory = this.roleMemories.get(role);
    if (!memory || memory.history.length === 0) {
      console.log(`[MemoryManager] ${role} 无历史记录，跳过归档`);
      return { archived: false };
    }

    console.log(`[MemoryManager] 开始归档 ${role}, 历史记录: ${memory.history.length} 条`);

    try {
      // 1. 生成摘要
      const summary = this.generateSummary(role, memory.history, context);

      // 2. 写入归档文件
      const archivePath = this.writeArchive(role, summary, memory.history);

      // 3. 更新索引
      this.updateArchiveIndex(role, archivePath, summary);

      // 4. 重置历史（保留最近 3 轮作为"热缓存"）
      const hotCache = memory.history.slice(-3);
      memory.history = hotCache;
      memory.lastArchive = Date.now();

      console.log(`[MemoryManager] ${role} 归档完成: ${archivePath}`);
      console.log(`[MemoryManager] 保留热缓存: ${hotCache.length} 条`);

      return {
        archived: true,
        archivePath,
        summary,
        hotCacheSize: hotCache.length
      };

    } catch (error) {
      console.error(`[MemoryManager] 归档失败: ${role}`, error);
      return { archived: false, error: error.message };
    }
  }

  /**
   * 生成摘要
   */
  generateSummary(role, history, context) {
    const taskIds = [...new Set(history.map(h => h.taskId).filter(Boolean))];
    const userMessages = history.filter(h => h.role === 'user');
    const assistantMessages = history.filter(h => h.role === 'assistant');

    // 提取关键信息
    const keyTopics = this.extractKeyTopics(history);
    const commonErrors = this.extractCommonErrors(history);
    const successPatterns = this.extractSuccessPatterns(history);

    return {
      role,
      timestamp: Date.now(),
      conversationCount: history.length,
      taskIds,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      keyTopics,
      commonErrors,
      successPatterns,
      context: {
        featureCompleted: context.featureCompleted || false,
        testsPass: context.testsPass || false
      },
      summary: this.generateTextSummary(role, history, keyTopics)
    };
  }

  /**
   * 提取关键主题
   */
  extractKeyTopics(history) {
    const topics = new Map();

    history.forEach(msg => {
      if (msg.role === 'user') {
        // 简单的关键词提取（实际可以用 NLP）
        const keywords = msg.content
          .toLowerCase()
          .match(/\b(实现|修复|优化|重构|测试|bug|feature|api|数据库|认证|性能)\b/g) || [];

        keywords.forEach(kw => {
          topics.set(kw, (topics.get(kw) || 0) + 1);
        });
      }
    });

    // 返回前 5 个高频主题
    return Array.from(topics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));
  }

  /**
   * 提取常见错误
   */
  extractCommonErrors(history) {
    const errors = [];

    history.forEach(msg => {
      if (msg.content.includes('error') || msg.content.includes('错误') || msg.content.includes('失败')) {
        // 提取错误信息（简化版）
        const errorMatch = msg.content.match(/(error|错误|失败)[：:]\s*(.{0,100})/i);
        if (errorMatch) {
          errors.push({
            timestamp: msg.timestamp,
            error: errorMatch[2].trim()
          });
        }
      }
    });

    return errors.slice(0, 5); // 最多保留 5 个
  }

  /**
   * 提取成功模式
   */
  extractSuccessPatterns(history) {
    const patterns = [];

    history.forEach(msg => {
      if (msg.content.includes('成功') || msg.content.includes('完成') || msg.content.includes('通过')) {
        patterns.push({
          timestamp: msg.timestamp,
          pattern: msg.content.substring(0, 100)
        });
      }
    });

    return patterns.slice(0, 5);
  }

  /**
   * 生成文本摘要
   */
  generateTextSummary(role, history, keyTopics) {
    const topicStr = keyTopics.map(t => `${t.topic}(${t.count}次)`).join(', ');
    return `${role} 处理了 ${history.length} 条对话，主要涉及: ${topicStr || '无明显主题'}`;
  }

  /**
   * 写入归档文件
   */
  writeArchive(role, summary, history) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${role}-${timestamp}.json`;
    const archivePath = path.join(ARCHIVE_DIR, filename);

    const archiveData = {
      ...summary,
      fullHistory: history.map(h => ({
        timestamp: h.timestamp,
        role: h.role,
        content: h.content.substring(0, 500), // 截断长内容
        taskId: h.taskId
      }))
    };

    fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
    return archivePath;
  }

  /**
   * 更新归档索引
   */
  updateArchiveIndex(role, archivePath, summary) {
    const indexPath = path.join(ARCHIVE_DIR, 'index.json');

    let index = [];
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }

    index.push({
      role,
      archivePath,
      timestamp: summary.timestamp,
      conversationCount: summary.conversationCount,
      keyTopics: summary.keyTopics,
      summary: summary.summary
    });

    // 保持索引文件不超过 1000 条
    if (index.length > 1000) {
      index = index.slice(-1000);
    }

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * 检索相关记忆（语义检索简化版）
   */
  searchMemory(role, query, limit = 5) {
    const indexPath = path.join(ARCHIVE_DIR, 'index.json');

    if (!fs.existsSync(indexPath)) {
      return [];
    }

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    // 简单的关键词匹配（实际可以用向量检索）
    const queryKeywords = query.toLowerCase().match(/\b\w+\b/g) || [];

    const results = index
      .filter(entry => entry.role === role)
      .map(entry => {
        // 计算相关性分数
        let score = 0;
        queryKeywords.forEach(kw => {
          if (entry.summary.toLowerCase().includes(kw)) {
            score += 1;
          }
          entry.keyTopics.forEach(topic => {
            if (topic.topic.includes(kw)) {
              score += 2;
            }
          });
        });

        return { ...entry, score };
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /**
   * 加载归档详情
   */
  loadArchive(archivePath) {
    if (!fs.existsSync(archivePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  }

  /**
   * 获取角色当前历史
   */
  getRoleHistory(role) {
    const memory = this.roleMemories.get(role);
    return memory ? memory.history : [];
  }

  /**
   * 清空角色历史（不归档）
   */
  clearRoleHistory(role) {
    if (this.roleMemories.has(role)) {
      this.roleMemories.get(role).history = [];
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = {
      roles: [],
      totalArchives: 0
    };

    this.roleMemories.forEach((memory, role) => {
      stats.roles.push({
        role,
        historyLength: memory.history.length,
        lastArchive: memory.lastArchive
      });
    });

    const indexPath = path.join(ARCHIVE_DIR, 'index.json');
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      stats.totalArchives = index.length;
    }

    return stats;
  }
}

module.exports = { MemoryManager, ARCHIVE_TRIGGERS };
