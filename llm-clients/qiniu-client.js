const axios = require('axios');

class QiniuClient {
  constructor(options = {}) {
    if (!options.apiKey) throw new Error('QiniuClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.model = options.model || 'qwen/qwen3.6-plus';
    this.timeout = options.timeout || 90000;
    // 默认使用七牛云的大模型 API 网关（需根据实际官方文档调整）
    this.baseURL = options.baseURL || 'https://apigateway.qiniuapi.com/v1';
  }

  async chat(messages, options = {}) {
    const maxTokens = options.maxTokens || 800;
    const temperature = options.temperature ?? 0.5;

    // 适配大部分大模型平台标准的 OpenAI 格式
    const payload = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      max_tokens: maxTokens,
      temperature: temperature
    };

    if (options.stopSequences && options.stopSequences.length > 0) {
      payload.stop = options.stopSequences;
    }

    if (options.jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    try {
      const response = await axios.post(`${this.baseURL}/chat/completions`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: this.timeout
      });

      const data = response.data;
      if (!data.choices || data.choices.length === 0) {
        throw new Error('API returned malformed response');
      }

      return {
        success: true,
        content: data.choices[0].message.content,
        usage: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
          reasoning: 0
        }
      };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      return {
        success: false,
        error: `Qiniu API Error: ${errorMsg}`,
        rawError: error
      };
    }
  }
}

module.exports = { QiniuClient };
