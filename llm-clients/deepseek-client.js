const axios = require('axios');
const { BaseLLMClient } = require('./base-client');

class DeepSeekClient extends BaseLLMClient {
  constructor(config) {
    super(config);
    this.baseURL = config.baseURL || 'https://api.deepseek.com/v1';
  }

  async chat(messages, options = {}) {
    const maxRetries = 2;
    const retryDelays = [10000, 30000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const payload = {
          model: this.model,
          messages: messages,
          max_tokens: options.maxTokens || 1024,
          temperature: options.temperature ?? 0.7,
          stop: options.stopSequences || undefined
        };

        if (options.jsonMode) {
          payload.response_format = { type: 'json_object' };
        }

        // reasoner 模型通常不支持 temperature
        if (this.model.includes('reasoner')) {
          delete payload.temperature;
        }

        const response = await axios.post(
          `${this.baseURL}/chat/completions`,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: this.timeout
          }
        );

        const choice = response.data.choices[0];
        const msg = choice.message;
        let content = msg.content || '';
        const reasoning = msg.reasoning_content || '';
        if (!content && reasoning) {
          content = reasoning;
        }
        return {
          success: true,
          content,
          reasoning,
          usage: {
            input: response.data.usage.prompt_tokens,
            output: response.data.usage.completion_tokens,
            reasoning: response.data.usage.completion_tokens_details?.reasoning_tokens || 0
          }
        };
      } catch (error) {
        const statusCode = error.response?.status;
        const is4xx = statusCode && statusCode >= 400 && statusCode < 500;
        const isNetworkError = !statusCode && error.code !== 'ECONNABORTED';

        if (is4xx) {
          return {
            success: false,
            error: error.response?.data?.error?.message || error.message
          };
        }

        if (attempt === maxRetries) {
          const timeoutMs = this.timeout || 0;
          const timeoutSec = timeoutMs > 0 ? Math.round(timeoutMs / 1000) : 0;
          const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED' || error.message?.toLowerCase().includes('timeout') || error.message?.toLowerCase().includes('canceled');
          const errorMsg = isTimeout
            ? `请求超时(${timeoutSec}s)，已重试${maxRetries}次，请检查网络或增大 timeout 配置`
            : (error.response?.data?.error?.message || error.message);
          return {
            success: false,
            error: errorMsg
          };
        }

        const delay = retryDelays[attempt] || 5000;
        console.log(`[DeepSeekClient] 请求失败 (attempt ${attempt + 1}/${maxRetries + 1}), ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async healthCheck() {
    const result = await this.chat([{ role: 'user', content: 'ping' }], { maxTokens: 10 });
    return result.success;
  }
}

module.exports = { DeepSeekClient };
