import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons } from '../apps/web/lib/lessons.ts';
import { compileTeachingPlan } from '../apps/web/lib/teaching-plan.ts';
import { createLessonGenerator, readConfig, GenerationError } from '../apps/web/lib/server/generate-lesson.ts';
import { configurationResponse, generationResponse } from '../apps/web/lib/server/generation-api.ts';

const env = { DEEPSEEK_API_KEY: 'test-secret-not-real' };
const input = { lessonId: 'two-sum', style: 'beginner' };
const plan = (i = 0) => ({ objective: '理解算法状态变化和不变量', steps: lessons[i].frames.map(f => ({ id: f.id, title: f.title, narration: f.narration })) });
const reply = (content = JSON.stringify(plan()), finish = 'stop') => Response.json({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });
const request = (body: string, origin = 'http://localhost:3001') => new Request('http://localhost:3001/api/lessons/generate', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body });
const hasCode = (code: string) => (error: unknown) => error instanceof GenerationError && error.code === code;

test('严格教学 JSON：拒绝未知字段、超长文本、遗漏和重排步骤', () => {
  assert.equal(compileTeachingPlan(plan(), lessons[0]).lesson.frames.length, 6);
  assert.throws(() => compileTeachingPlan({ ...plan(), code: 'alert(1)' }, lessons[0]));
  const extra = plan(); Object.assign(extra.steps[0], { current: 99 });
  assert.throws(() => compileTeachingPlan(extra, lessons[0]));
  const long = plan(); long.steps[0].narration = '字'.repeat(701);
  assert.throws(() => compileTeachingPlan(long, lessons[0]));
  const missing = plan(); missing.steps.pop();
  assert.throws(() => compileTeachingPlan(missing, lessons[0]));
  const wrong = plan(); wrong.steps.reverse();
  assert.throws(() => compileTeachingPlan(wrong, lessons[0]));
});

test('两题编译只替换讲解，动画、代码、答案和检查点不变', () => {
  for (let i = 0; i < 2; i++) {
    const modified = plan(i); modified.steps[0].narration = '这是模型生成的新讲解，供初学者逐步理解算法。';
    const { lesson } = compileTeachingPlan(modified, lessons[i]);
    assert.equal(lesson.frames[0].narration, modified.steps[0].narration);
    assert.equal(lesson.code, lessons[i].code);
    assert.equal(lesson.output, lessons[i].output);
    assert.deepEqual(lesson.checkpoint, lessons[i].checkpoint);
    lesson.frames.forEach((frame, j) => {
      const { title, narration, ...state } = frame;
      const { title: oldTitle, narration: oldNarration, ...oldState } = lessons[i].frames[j];
      assert.deepEqual(state, oldState);
    });
  }
});

test('正常生成：正确协议、Token 用量、缓存、过期，不泄露密钥', async () => {
  let count = 0, time = 0;
  const generate = createLessonGenerator(async (url, options) => {
    count++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${env.DEEPSEEK_API_KEY}`);
    const body = JSON.parse(options?.body as string);
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.enable_thinking, undefined);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(options?.redirect, 'manual');
    return reply();
  }, () => time);
  const first = await generate(input, env);
  assert.equal(first.usage?.total_tokens, 300);
  assert.equal(first.cached, false);
  assert.equal(first.stages.length, 5);
  assert.equal(JSON.stringify(first).includes(env.DEEPSEEK_API_KEY), false);
  assert.equal((await generate(input, env)).cached, true);
  assert.equal(count, 1);
  time = 600001;
  assert.equal((await generate(input, env)).cached, false);
  assert.equal(count, 2);
});

test('缺少密钥/不合法输入不会发起网络请求', async () => {
  const generate = createLessonGenerator(async () => { throw new Error('must not call'); });
  await assert.rejects(generate(input, {}), hasCode('NOT_CONFIGURED'));
  await assert.rejects(generate({ ...input, prompt: 'override' }, env), hasCode('INVALID_INPUT'));
  await assert.rejects(generate({ ...input, lessonId: 'unknown' }, env), hasCode('INVALID_INPUT'));
  assert.throws(() => readConfig({ ...env, DEEPSEEK_BASE_URL: 'https://attacker.example/compatible-mode/v1' }), hasCode('BAD_CONFIG'));
  assert.throws(() => readConfig({ ...env, DEEPSEEK_BASE_URL: 'http://dashscope.aliyuncs.com/compatible-mode/v1' }), hasCode('BAD_CONFIG'));
});

test('畸形、错位与截断输出拒绝装配，不自动重试', async () => {
  for (const response of [() => reply('not json'), () => reply(JSON.stringify({ ...plan(), steps: [] })), () => reply(JSON.stringify(plan(1))), () => reply(JSON.stringify(plan()), 'length')]) {
    let calls = 0;
    const generate = createLessonGenerator(async () => { calls++; return response(); });
    await assert.rejects(generate(input, env), error => error instanceof GenerationError && ['INVALID_OUTPUT', 'INCOMPLETE'].includes(error.code));
    assert.equal(calls, 1);
  }
});

test('HTTP 错误不会反射上游响应中的秘密', async () => {
  for (const [status, code] of [[401, 'MODEL_AUTH'], [403, 'MODEL_AUTH'], [429, 'MODEL_LIMIT'], [500, 'MODEL_HTTP']] as const) {
    const generate = createLessonGenerator(async () => new Response(env.DEEPSEEK_API_KEY, { status }));
    const response = await generationResponse(request(JSON.stringify(input)), env, generate);
    const text = await response.text();
    assert.equal(text.includes(env.DEEPSEEK_API_KEY), false);
    assert.equal(text.includes(code), true);
  }
});

test('超时与并发保护，结束后可重新生成', async () => {
  const generate = createLessonGenerator(async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), Date.now, 20);
  const pending = generate(input, env);
  await assert.rejects(generate(input, env), hasCode('BUSY'));
  await assert.rejects(pending, hasCode('TIMEOUT'));
  await assert.rejects(generate(input, env), hasCode('TIMEOUT'));
});

test('失败调用也计入预算，达到上限阻止继续请求', async () => {
  let count = 0;
  const generate = createLessonGenerator(async () => { count++; return new Response('', { status: 500 }); }, () => 1);
  for (let i = 0; i < 12; i++) await assert.rejects(generate(input, env), hasCode('MODEL_HTTP'));
  await assert.rejects(generate(input, env), hasCode('BUDGET_LIMIT'));
  assert.equal(count, 12);
});

test('API 拒绝跨域、非本地、无效 JSON 和过大请求', async () => {
  assert.equal((await generationResponse(request('{}', 'https://attacker.example'), env)).status, 403);
  assert.equal(configurationResponse(new Request('https://example.com/api/lessons/generate'), env).status, 403);
  assert.equal((await generationResponse(request('{'), env)).status, 400);
  assert.equal((await generationResponse(request('x'.repeat(1025)), env)).status, 413);
  assert.equal((await generationResponse(request(JSON.stringify(input)), {})).status, 503);
  const ready = await configurationResponse(new Request('http://localhost:3001/api/lessons/generate'), env).text();
  assert.equal(ready.includes(env.DEEPSEEK_API_KEY), false);
  assert.equal(ready.includes('"configured":true'), true);
});

test('上游超大响应拒绝读取', async () => {
  const generate = createLessonGenerator(async () => new Response('x'.repeat(65537)));
  await assert.rejects(generate(input, env), hasCode('TOO_LARGE'));
});

test('完整 API 成功响应可以重新编译，两题均可复用播放器', async () => {
  for (let i = 0; i < lessons.length; i++) {
    const generate = createLessonGenerator(async () => reply(JSON.stringify(plan(i))));
    const response = await generationResponse(request(JSON.stringify({ lessonId: lessons[i].id, style: 'interview' })), env, generate);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.lesson.id, lessons[i].id);
    assert.equal(data.source, 'deepseek');
    assert.equal(data.objective, plan(i).objective);
    assert.equal(data.lesson.frames[5].current, lessons[i].frames[5].current);
  }
});
