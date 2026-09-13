// Server-only module: import from route handlers, never from client components.
import { z } from 'zod';
import { lessons } from '../lessons.ts';
import { compileTeachingPlan, generationInput, type GenerationResult } from '../teaching-plan.ts';

export type ModelEnvironment = {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_BASE_URL?: string;
  DASHSCOPE_MODEL?: string;
};
export class GenerationError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}

export function readConfig(env: ModelEnvironment) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new GenerationError(503, 'NOT_CONFIGURED', '尚未配置 DeepSeek 密钥。请在 apps/web/.env.local 填写 DEEPSEEK_API_KEY 后重启服务。文本生成不会回退到百炼。');
  const model = env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash';
  if (!/^deepseek-[a-z0-9.-]{1,80}$/.test(model)) throw new GenerationError(503, 'BAD_CONFIG', '请配置有效的 DeepSeek 模型 ID。');
  let base: URL;
  try { base = new URL(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'); }
  catch { throw new GenerationError(503, 'BAD_CONFIG', 'DeepSeek Base URL 格式不正确。'); }
  if (base.hostname !== 'api.deepseek.com' || base.protocol !== 'https:' || base.port || base.username || base.password || base.search || base.hash || !['', '/v1'].includes(base.pathname.replace(/\/$/, ''))) {
    throw new GenerationError(503, 'BAD_CONFIG', '只允许 DeepSeek 官方 HTTPS 地址（根路径或 /v1），避免将密钥发往其他服务。');
  }
  return { apiKey, model, url: base.href.replace(/\/$/, '') + '/chat/completions' };
}

export async function readLimitedText(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new GenerationError(413, 'TOO_LARGE', '数据超出大小限制。');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().max(24000) }),
  })).min(1),
  usage: z.unknown().optional(),
});

/** Small explicit workflow; transport and time are injectable for no-quota tests. */
export function createLessonGenerator(fetcher: typeof fetch = fetch, now = Date.now, timeoutMs = 45000) {
  const cache = new Map<string, { expires: number; value: GenerationResult }>();
  let busy = false;
  let calls: number[] = [];
  return async (raw: unknown, env: ModelEnvironment): Promise<GenerationResult> => {
    const parsed = generationInput.safeParse(raw);
    if (!parsed.success) throw new GenerationError(400, 'INVALID_INPUT', '仅支持两道已配置题目，以及 beginner / interview 两种讲解风格。');
    const config = readConfig(env);
    const { lessonId, style } = parsed.data;
    const canonical = lessons.find(l => l.id === lessonId)!;
    // Credentials never appear in cache keys or returned traces. Cache is local to this instance.
    const key = JSON.stringify([config.url, config.model, lessonId, style, 'teaching-v1']);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return { ...hit.value, cached: true };
    if (busy) throw new GenerationError(429, 'BUSY', '已有课件正在生成，请等待完成后再试。');
    calls = calls.filter(t => now() - t < 3600000);
    if (calls.length >= 12) throw new GenerationError(429, 'BUDGET_LIMIT', '本进程一小时已发起 12 次调用，暂停生成以保护额度。');
    busy = true;
    calls.push(now());
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetcher(config.url, {
        // Workers supports follow/manual, not error. Never forward credentials on redirects.
        method: 'POST', signal: abort.signal, redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model, response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, stream: false, max_tokens: 4096,
          messages: [
            { role: 'system', content: '你是 JavaScript 算法老师。仅输出 JSON 对象，不输出 Markdown 围栏。依据给定的可信算法状态重新设计教学提纲与讲解，不改变输入、答案、步骤 ID 或顺序，不生成 HTML、可执行代码或链接。结构严格为 {"objective":"学习目标","steps":[{"id":"原步骤ID","title":"标题","narration":"中文讲解"}]}。必须 6 步，标题不超过60字，每步讲解10到700字，目标不超过300字。文本解释必须与每步提供的变量、Map、公式一致。' },
            { role: 'user', content: JSON.stringify({
              style: style === 'beginner' ? '面向初学者，先解释变量，再用具体数字讲清原因。' : '面试复习风格，强调不变量、复杂度和常见追问。',
              title: canonical.title, problem: canonical.problem, input: canonical.inputLabel,
              output: canonical.output, code: canonical.code, complexity: canonical.complexity,
              frames: canonical.frames,
            }) },
          ],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 300 && response.status < 400) throw new GenerationError(502, 'MODEL_REDIRECT', '已拒绝DeepSeek 接口重定向，请核对配置地址。密钥不会转发到重定向目标。');
        if (response.status === 401 || response.status === 403) throw new GenerationError(502, 'MODEL_AUTH', 'DeepSeek 拒绝访问，请检查密钥、模型权限和 API 地址。');
        if (response.status === 429) throw new GenerationError(429, 'MODEL_LIMIT', 'DeepSeek 限流或额度不足，请检查控制台，不会自动重试。');
        throw new GenerationError(502, 'MODEL_HTTP', `DeepSeek 请求失败（HTTP ${response.status}），请检查模型和地址配置。`);
      }
      const completion = completionSchema.parse(JSON.parse(await readLimitedText(response.body, 65536)));
      if (completion.choices[0].finish_reason !== 'stop') throw new GenerationError(502, 'INCOMPLETE', '模型输出未完整结束，已保留原课件。');
      const { plan, lesson } = compileTeachingPlan(JSON.parse(completion.choices[0].message.content), canonical);
      const usage = usageSchema.safeParse(completion.usage);
      const result: GenerationResult = {
        source: 'deepseek', model: config.model, cached: false, lesson,
        objective: plan.objective, usage: usage.success ? usage.data : null,
        stages: ['校验题目与风格', '加载可信算法状态', 'DeepSeek 生成教学 JSON', 'Zod 校验字段与步骤映射', '装配课件并交付播放器'],
      };
      cache.set(key, { value: result, expires: now() + 600000 });
      if (cache.size > 16) cache.delete(cache.keys().next().value!);
      return result;
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      if (abort.signal.aborted) throw new GenerationError(504, 'TIMEOUT', '生成超过 45 秒，已停止等待并保留原课件，不会自动重试。');
      if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === '步骤 ID 或顺序与算法状态不一致')) {
        throw new GenerationError(502, 'INVALID_OUTPUT', '模型输出未通过课件校验，已保留原课件。可手动再试一次。');
      }
      throw new GenerationError(502, 'NETWORK', '无法连接 DeepSeek，请检查网络。原课件仍可使用。');
    } finally { clearTimeout(timer); busy = false; }
  };
}
