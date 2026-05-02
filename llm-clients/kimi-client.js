const axios = require('axios');
const { BaseLLMClient } = require('./base-client');

class KimiClient extends BaseLLMClient {
  constructor(config) {
    super(config);
    this.baseURL = config.baseURL || 'https://api.moonshot.cn/v1';
  }

  async chat(messages, options = {}) {
    try {
      const body = {
        model: this.model,
        messages: messages,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature ?? 0.7,
        stop: options.stopSequences || undefined
      };

      if (options.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        body,
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
          output: response.data.usage.completion_tokens
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

module.exports = { KimiClient };
