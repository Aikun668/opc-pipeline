const axios = require('axios');
const { BaseLLMClient } = require('./base-client');

class ClaudeClient extends BaseLLMClient {
  constructor(config) {
    super(config);
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';
  }

  async chat(messages, options = {}) {
    try {
      const body = {
        model: this.model,
        messages: messages,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature ?? 1.0,
        stop_sequences: options.stopSequences || []
      };

      if (options.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const response = await axios.post(
        `${this.baseURL}/messages`,
        body,
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      const block = response.data.content?.[0] || {};
      const content = block.text || block.thinking || '';
      return {
        success: true,
        content,
        usage: {
          input: response.data.usage?.input_tokens || 0,
          output: response.data.usage?.output_tokens || 0
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

module.exports = { ClaudeClient };
