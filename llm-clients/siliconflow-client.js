const axios = require('axios');

class SiliconFlowClient {
  constructor(options = {}) {
    if (!options.apiKey) throw new Error('SiliconFlowClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.model = options.model || 'Qwen/Qwen3.6-35B-A3B';
    this.timeout = options.timeout || 90000;
    this.baseURL = options.baseURL || 'https://api.siliconflow.cn/v1';
  }

  async chat(messages, options = {}) {
    const payload = {
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options.maxTokens || 800,
      temperature: options.temperature ?? 0.5
    };
    if (options.stopSequences?.length > 0) payload.stop = options.stopSequences;
    if (options.jsonMode) payload.response_format = { type: 'json_object' };

    try {
      const response = await axios.post(`${this.baseURL}/chat/completions`, payload, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        timeout: this.timeout
      });
      const data = response.data;
      if (!data.choices?.length) throw new Error('API returned malformed response');
      return {
        success: true,
        content: data.choices[0].message.content,
        usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0, reasoning: 0 }
      };
    } catch (error) {
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }
}

module.exports = { SiliconFlowClient };
