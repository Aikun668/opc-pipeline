const axios = require('axios');
const { BaseLLMClient } = require('./base-client');

class DeepSeekClient extends BaseLLMClient {
  constructor(config) {
    super(config);
    this.baseURL = config.baseURL || 'https://api.deepseek.com/v1';
  }

  async chat(messages, options = {}) {
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
      return {
        success: true,
        content: choice.message.content,
        usage: {
          input: response.data.usage.prompt_tokens,
          output: response.data.usage.completion_tokens,
          reasoning: response.data.usage.completion_tokens_details?.reasoning_tokens || 0
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  async healthCheck() {
    const result = await this.chat([{ role: 'user', content: 'ping' }], { maxTokens: 10 });
    return result.success;
  }
}

module.exports = { DeepSeekClient };
