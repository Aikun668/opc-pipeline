/**
 * 统一 LLM API 客户端基类
 * 所有具体客户端继承此类
 */
class BaseLLMClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.timeout = config.timeout || 60000;
  }

  /**
   * 统一调用接口
   * @param {Array} messages - [{role, content}]
   * @param {Object} options - {maxTokens, temperature, stopSequences}
   * @returns {Promise<{success: boolean, content: string, usage: {input: number, output: number}}>}
   */
  async chat(messages, options = {}) {
    throw new Error('Must implement chat() method');
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    throw new Error('Must implement healthCheck() method');
  }
}

module.exports = { BaseLLMClient };
