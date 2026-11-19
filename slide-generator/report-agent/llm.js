export function createClient({ provider = process.env.LLM_PROVIDER || 'openai', apiKey, model, fetchImpl = fetch } = {}) {
  const providers = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL' },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY', model: 'GROQ_MODEL' },
    gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' }
  };
  if (!Object.hasOwn(providers, provider)) throw new Error('LLM_PROVIDER must be openai, groq or gemini');
  const config = providers[provider];
  apiKey ??= process.env[config.key];
  model ??= process.env[config.model];
  if (!apiKey || !model) throw new Error(`Set ${config.key} and ${config.model}`);
  if (provider === 'gemini') {
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('GEMINI_MODEL must be a model ID');
    return async (messages) => {
      if (!Array.isArray(messages) || messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new Error('Unsupported Gemini message');
      const system = messages.filter(message => message.role === 'system').map(message => ({ text: message.content }));
      const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(system.length ? { systemInstruction: { parts: system } } : {}), contents, generationConfig: { responseMimeType: 'application/json' } })
      });
      if (!response.ok) throw new Error(`LLM request failed (HTTP ${response.status})`);
      const result = await response.json();
      const candidate = result.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new Error('Gemini did not complete its response');
      const content = candidate.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
      if (!content) throw new Error('LLM returned no content');
      return content;
    };
  }
  return async (messages) => {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, response_format: { type: 'json_object' } })
    });
    if (!response.ok) throw new Error(`LLM request failed (HTTP ${response.status})`);
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('LLM returned no content');
    return content;
  };
}

export function createOpenAIClient(options = {}) {
  return createClient({ ...options, provider: 'openai' });
}
