import { z } from 'zod';
import { assertLocalRequest } from './generation-api.ts';
import { GenerationError, readLimitedText, type ModelEnvironment } from './generate-lesson.ts';

type SpeechEnvironment = ModelEnvironment & { DASHSCOPE_TTS_VOICE?: string };
const input = z.object({ text: z.string().trim().min(1).max(580) }).strict();
const model = 'qwen3-tts-flash';
export function createSpeechService(fetcher: typeof fetch = fetch, now = Date.now, timeoutMs = 45000) {
  const cache = new Map<string, { url: string; expires: number }>();
  const pending = new Map<string, Promise<string>>();
  let calls: number[] = [];
  return async (request: Request, env: SpeechEnvironment) => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
      assertLocalRequest(request, true);
      const parsed = input.safeParse(JSON.parse(await readLimitedText(request.body, 4096)));
      if (!parsed.success) throw new GenerationError(400, 'INVALID_INPUT', '每段讲稿须为 1–580 字，请拆分后播放。');
      const apiKey = env.DASHSCOPE_API_KEY?.trim();
      if (!apiKey) throw new GenerationError(503, 'NOT_CONFIGURED', '请配置服务端 DASHSCOPE_API_KEY 并重启，才能合成语音。');
      const voice = env.DASHSCOPE_TTS_VOICE?.trim() || 'Cherry';
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(voice)) throw new GenerationError(503, 'BAD_CONFIG', 'TTS 音色配置无效。');
      const key = JSON.stringify([voice, parsed.data.text]);
      const hit = cache.get(key);
      if (hit && hit.expires > now()) return Response.json({ url: hit.url, model, voice, cached: true }, { headers });
      let job = pending.get(key);
      const reused = !!job;
      if (!job) {
        calls = calls.filter(t => now() - t < 3600000);
        if (pending.size >= 2 || calls.length >= 60) throw new GenerationError(429, 'LIMIT', '语音正在合成或已达每小时 60 段限制，请稍后重试。');
        calls.push(now());
        job = (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetcher('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
              method: 'POST', redirect: 'manual', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({ model, input: { text: parsed.data.text, voice, language_type: 'Chinese' } }),
            });
            if (!response.ok) {
              await response.body?.cancel();
              throw new GenerationError(502, 'TTS_PROVIDER', `语音合成失败（HTTP ${response.status}），请检查百炼 TTS 权限和额度，不会自动重试。`);
            }
            const result = JSON.parse(await readLimitedText(response.body, 16384));
            const url = new URL(result.output?.audio?.url);
            // Only return official Beijing audio assets; never reflect arbitrary provider URLs.
            if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com' || url.port || url.username || url.password) throw new Error('Invalid audio URL');
            url.protocol = 'https:';
            const expires = Math.min(now() + 600000, Number(result.output.audio.expires_at) * 1000 - 60000);
            if (Number.isFinite(expires) && expires > now()) cache.set(key, { url: url.href, expires });
            if (cache.size > 64) cache.delete(cache.keys().next().value!);
            return url.href;
          } catch (error) {
            if (controller.signal.aborted) throw new GenerationError(504, 'TIMEOUT', '语音合成超时，请手动重试。');
            throw error;
          } finally { clearTimeout(timer); }
        })();
        pending.set(key, job);
        void job.finally(() => pending.delete(key)).catch(() => {});
      }
      return Response.json({ url: await job, model, voice, cached: reused }, { headers });
    } catch (error) {
      const safe = error instanceof GenerationError ? error : new GenerationError(error instanceof SyntaxError ? 400 : 502, 'TTS_ERROR', '无法生成语音，请重试；文字讲解仍可阅读。');
      return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers });
    }
  };
}
