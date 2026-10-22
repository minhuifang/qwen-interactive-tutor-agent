// DeepSeek chat-completions adapter with function calling. Kept separate from
// the loop so the loop stays testable without any network access.

import { toolDefinitions } from './tools.mjs';

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export class ModelError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'ModelError';
    this.retryable = retryable;
  }
}

const toolCallSchema = value => {
  if (!value || typeof value !== 'object') return null;
  const fn = value.function;
  if (!fn || typeof fn.name !== 'string') return null;
  return { id: typeof value.id === 'string' ? value.id : undefined, name: fn.name, arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) };
};

export function createChatModel({ apiKey, model, url, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = 4096 }) {
  return async function callModel(messages, { signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        method: 'POST',
        redirect: 'manual', // a 3xx would forward the Authorization header elsewhere
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          tools: toolDefinitions,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 300 && response.status < 400) throw new ModelError('已拒绝模型接口重定向，密钥不会转发。');
        throw new ModelError(
          response.status === 401 ? '模型鉴权失败，请检查 API Key。'
            : response.status === 429 ? '模型额度或频率受限，请稍后重试。'
              : `模型服务暂不可用（HTTP ${response.status}）。`,
          { retryable: response.status === 429 || response.status >= 500 },
        );
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new ModelError('模型响应超出大小上限。');
      let payload;
      try { payload = JSON.parse(text); } catch { throw new ModelError('模型返回的不是合法 JSON。'); }

      const choice = payload?.choices?.[0];
      if (!choice) throw new ModelError('模型未返回可用结果。');
      if (choice.finish_reason === 'length') throw new ModelError('模型输出被截断，请缩短代码或说明。');
      const message = choice.message || {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map(toolCallSchema).filter(Boolean) : [];
      const usage = payload.usage && typeof payload.usage === 'object'
        ? {
            prompt_tokens: Number(payload.usage.prompt_tokens) || 0,
            completion_tokens: Number(payload.usage.completion_tokens) || 0,
            total_tokens: Number(payload.usage.total_tokens) || 0,
          }
        : undefined;
      return { content: typeof message.content === 'string' ? message.content : '', toolCalls, usage };
    } catch (error) {
      if (error instanceof ModelError) throw error;
      if (controller.signal.aborted) throw new ModelError(signal?.aborted ? '已取消。' : '模型响应超时，未自动重试。');
      throw new ModelError('无法连接模型服务。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * Streaming chat adapter: yields text deltas as the model produces them, so a
 * student can interrupt a reply that is still being written. Server-sent events
 * over the same allow-listed endpoint; the key never follows a redirect.
 */
export function createChatStream({ apiKey, model, url, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = 4096 }) {
  return async function* callStream(messages, { signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens, stream: true }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 300 && response.status < 400) throw new ModelError('已拒绝模型接口重定向，密钥不会转发。');
        throw new ModelError(
          response.status === 401 ? '模型鉴权失败，请检查 API Key。'
            : response.status === 429 ? '模型额度或频率受限，请稍后重试。'
              : `模型服务暂不可用（HTTP ${response.status}）。`,
          { retryable: response.status === 429 || response.status >= 500 },
        );
      }
      if (!response.body) throw new ModelError('模型未返回流式内容。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new ModelError('模型流式响应超出大小上限。');
          pending += decoder.decode(value, { stream: true });
          let end = pending.indexOf('\n');
          while (end >= 0) {
            const line = pending.slice(0, end).replace(/\r$/, '');
            pending = pending.slice(end + 1);
            const piece = readDelta(line);
            if (piece) yield piece;
            end = pending.indexOf('\n');
          }
          if (pending.length > 65536) throw new ModelError('模型流式响应单行过长。');
        }
        const tail = readDelta(pending.replace(/\r$/, ''));
        if (tail) yield tail;
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof ModelError) throw error;
      if (controller.signal.aborted) throw new ModelError(signal?.aborted ? '已取消。' : '模型响应超时，未自动重试。');
      throw new ModelError('无法连接模型服务。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

/** One SSE frame → the text delta it carries. Unknown frames are ignored. */
function readDelta(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const body = trimmed.slice(5).trim();
  if (!body || body === '[DONE]') return null;
  let payload;
  try { payload = JSON.parse(body); } catch { return null; }
  const delta = payload?.choices?.[0]?.delta?.content;
  return typeof delta === 'string' && delta ? delta : null;
}
