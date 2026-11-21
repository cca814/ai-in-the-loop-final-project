import { ConfigurationError, ModelOutputError, ProviderError } from './errors.js';

export function createClient({ provider = process.env.LLM_PROVIDER || 'openai', apiKey, model, fetchImpl = fetch, maxRetries = 2, timeoutMs = 45_000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const providers = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL' },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY', model: 'GROQ_MODEL' },
    gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' }
  };
  if (!Object.hasOwn(providers, provider)) throw new ConfigurationError('LLM_PROVIDER must be openai, groq or gemini');
  const config = providers[provider];
  apiKey ??= process.env[config.key];
  model ??= process.env[config.model];
  if (!apiKey || !model) throw new ConfigurationError(`Set ${config.key} and ${config.model}`);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 4 || !Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new ConfigurationError('Invalid retry or timeout settings');

  async function post(url, options) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        // A timeout/network failure may have reached the provider. Do not
        // automatically duplicate it; retry only explicit transient HTTP errors.
        throw new ProviderError(null, attempt + 1, ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network');
      }
      if (response.ok) {
        try { return await response.json(); }
        catch (error) {
          if (['TimeoutError', 'AbortError'].includes(error.name)) throw new ProviderError(null, attempt + 1, 'timeout');
          throw new ModelOutputError('Provider returned invalid JSON', 'PROVIDER_RESPONSE_INVALID');
        }
      }
      // Release a failed response without reading or logging its body.
      try { await response.body?.cancel(); } catch { /* Already closed. */ }
      if (![500, 502, 503, 504].includes(response.status) || attempt >= maxRetries) throw new ProviderError(response.status, attempt + 1);
      const header = response.headers?.get('retry-after');
      const retryAfter = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : NaN;
      if (Number.isFinite(retryAfter) && retryAfter > 10_000) throw new ProviderError(response.status, attempt + 1);
      const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1000 * 2 ** attempt;
      await sleep(delay);
    }
  }
  if (provider === 'gemini') {
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new ConfigurationError('GEMINI_MODEL must be a model ID');
    return async (messages) => {
      if (!Array.isArray(messages) || messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new Error('Unsupported Gemini message');
      const system = messages.filter(message => message.role === 'system').map(message => ({ text: message.content }));
      const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
      const result = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(system.length ? { systemInstruction: { parts: system } } : {}), contents, generationConfig: { responseMimeType: 'application/json' } })
      });
      const candidate = result.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new ModelOutputError('Gemini did not complete its response', 'PROVIDER_RESPONSE_INCOMPLETE');
      const content = candidate.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
      if (!content) throw new ModelOutputError('LLM returned no content', 'PROVIDER_RESPONSE_EMPTY');
      return content;
    };
  }
  return async (messages) => {
    const result = await post(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, response_format: { type: 'json_object' } })
    });
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new ModelOutputError('LLM returned no content', 'PROVIDER_RESPONSE_EMPTY');
    return content;
  };
}

export function createOpenAIClient(options = {}) {
  return createClient({ ...options, provider: 'openai' });
}
