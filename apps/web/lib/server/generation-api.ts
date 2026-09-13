import { createLessonGenerator, GenerationError, readConfig, readLimitedText, type ModelEnvironment } from './generate-lesson.ts';

const generate = createLessonGenerator();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
// No app authentication yet: intentionally local-only, including production builds.
export function assertLocalRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new GenerationError(403, 'LOCAL_ONLY', '生成接口暂只支持本机访问，上线前需增加身份验证和持久化限流。');
  if (mutation && request.headers.get('origin') !== url.origin) throw new GenerationError(403, 'ORIGIN', '拒绝跨来源生成请求。');
  if (mutation && request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new GenerationError(415, 'CONTENT_TYPE', '请使用 JSON 请求。');
}
export function configurationResponse(request: Request, env: ModelEnvironment) {
  try {
    assertLocalRequest(request);
    const config = readConfig(env);
    return json({ configured: true, model: config.model });
  } catch (error) {
    if (error instanceof GenerationError) return json({ configured: false, code: error.code, message: error.message }, error.status === 403 ? 403 : 200);
    return json({ configured: false, message: '无法读取配置。' }, 500);
  }
}
export async function generationResponse(request: Request, env: ModelEnvironment, generator = generate) {
  try {
    assertLocalRequest(request, true);
    let raw: unknown;
    const text = await readLimitedText(request.body, 1024);
    try { raw = JSON.parse(text); } catch { throw new GenerationError(400, 'INVALID_JSON', '请求不是有效 JSON。'); }
    return json(await generator(raw, env));
  } catch (error) {
    const safe = error instanceof GenerationError ? error : new GenerationError(500, 'INTERNAL', '生成服务暂不可用，已保留原课件。');
    // Never reflect provider bodies, prompts, stack traces or credentials.
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
