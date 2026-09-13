import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmProblem, confirmationIssues, problemInputSchema } from '../apps/web/lib/problem-schema.ts';
import { createProblemParser, problemResponse } from '../apps/web/lib/server/parse-problem.ts';
import { GenerationError } from '../apps/web/lib/server/generate-lesson.ts';

const text = '给定只包含括号的字符串 s，判断括号类型及闭合顺序是否合法，返回布尔值。';
const draft = { title: '有效的括号', statement: text, inputDescription: '括号字符串 s', outputDescription: '布尔值', constraints: ['长度 1 到 10000'], examples: [{ input: '"()"', output: 'true' }], missingInformation: [] as string[] };
const env = { DEEPSEEK_API_KEY: 'fake-test-only' };
const response = (value: unknown = draft, finish = 'stop') => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });
const request = (value: string, origin = 'http://localhost:3001') => new Request('http://localhost:3001/api/problems/parse', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: value });
const code = (name: string) => (error: unknown) => error instanceof GenerationError && error.code === name;

test('新题输入支持非固定题，拒绝空输入、过长内容及额外参数', () => {
  assert.equal(problemInputSchema.parse({ text }).text, text);
  for (const value of [{ text: '   ' }, { text: 'a'.repeat(6001) }, { text, model: 'other' }]) assert.equal(problemInputSchema.safeParse(value).success, false);
});
test('真实格式模拟：解析任意题目 JSON，传入文本视为不可信数据', async () => {
  const parser = createProblemParser(async (_url, options) => {
    const body = JSON.parse(options?.body as string);
    assert.equal(JSON.parse(body.messages.find((m: {role: string}) => m.role === 'user').content).problemText, text);
    assert.equal(body.messages[0].content.includes('不可信'), true);
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.messages[0].content.includes(env.DEEPSEEK_API_KEY), false);
    return response();
  });
  const result = await parser({ text }, env);
  assert.deepEqual(result.draft, draft);
  assert.equal(result.source, 'deepseek');
  assert.equal(result.usage?.total_tokens, 300);
});
test('模型宣称无缺失时，空输入/输出仍阻止确认', () => {
  assert.equal(confirmationIssues(draft).length, 0);
  assert.ok(confirmationIssues({ ...draft, inputDescription: '', outputDescription: '' }).length >= 2);
  assert.throws(() => confirmProblem({ ...draft, title: '' }, text, 'deepseek', true));
  assert.throws(() => confirmProblem(draft, text, 'deepseek', false));
});
test('待澄清问题和不完整样例必须处理，确认保留来源和原文', () => {
  assert.throws(() => confirmProblem({ ...draft, missingInformation: ['空字符串是否合法？'] }, text, 'deepseek', true));
  assert.throws(() => confirmProblem({ ...draft, examples: [{ input: '()', output: '' }] }, text, 'deepseek', true));
  const manual = confirmProblem(draft, text, 'manual', true);
  assert.equal(manual.source, 'manual');
  assert.equal(manual.originalText, text);
  assert.equal(manual.status, 'confirmed');
  assert.equal('solution' in manual, false);
});
test('格式校验拒绝模型附加代码、未知属性、超量样例及截断', async () => {
  for (const bad of [{ ...draft, code: 'alert(1)' }, { ...draft, examples: Array(9).fill({ input: '', output: '' }) }, { ...draft, constraints: ['x'.repeat(301)] }]) {
    await assert.rejects(createProblemParser(async () => response(bad))({ text }, env), code('INVALID_OUTPUT'));
  }
  await assert.rejects(createProblemParser(async () => response(draft, 'length'))({ text }, env), code('INCOMPLETE'));
});
test('缺少密钥或无效文本不触发模型调用；网络错误不泄密', async () => {
  let calls = 0;
  const parser = createProblemParser(async () => { calls++; throw new Error(env.DEEPSEEK_API_KEY); });
  await assert.rejects(parser({ text: '' }, env), code('INVALID_INPUT'));
  await assert.rejects(parser({ text }, {}), code('NOT_CONFIGURED'));
  assert.equal(calls, 0);
  await assert.rejects(parser({ text }, env), error => error instanceof GenerationError && error.code === 'NETWORK' && !error.message.includes(env.DEEPSEEK_API_KEY));
});
test('解析 API 成功、跨域拦截、非 JSON 和体积上限', async () => {
  const parser = createProblemParser(async () => response());
  assert.equal((await problemResponse(request(JSON.stringify({ text })), env, parser)).status, 200);
  assert.equal((await problemResponse(request('{}', 'https://other.example'), env, parser)).status, 403);
  assert.equal((await problemResponse(request('{'), env, parser)).status, 400);
  assert.equal((await problemResponse(request('a'.repeat(40001)), env, parser)).status, 413);
});
test('解析超时、并发、失败调用预算，不自动重试', async () => {
  const parser = createProblemParser(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true })), Date.now, 10);
  const first = parser({ text }, env);
  await assert.rejects(parser({ text }, env), code('BUSY'));
  await assert.rejects(first, code('TIMEOUT'));
  let count = 0;
  const failures = createProblemParser(async () => { count++; return new Response('', { status: 401 }); }, () => 1);
  for (let i = 0; i < 12; i++) await assert.rejects(failures({ text }, env), code('MODEL_HTTP'));
  await assert.rejects(failures({ text }, env), code('BUDGET_LIMIT'));
  assert.equal(count, 12);
});
