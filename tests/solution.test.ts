import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmProblem } from '../apps/web/lib/problem-schema.ts';
import { solutionInputSchema, solutionResultSchema } from '../apps/web/lib/solution-schema.ts';
import { createSolutionGenerator, solutionResponse } from '../apps/web/lib/server/generate-solution.ts';
import { GenerationError } from '../apps/web/lib/server/generate-lesson.ts';

const text = '给定一个整数数组，返回数组中全部整数之和，空数组返回零。';
const confirmed = confirmProblem({ title: '数组求和', statement: text, inputDescription: '整数数组', outputDescription: '整数', constraints: ['长度不超过100'], examples: [{ input: '[1,2]', output: '3' }], missingInformation: [] }, text, 'manual', true);
const input = { confirmed };
const env = { DEEPSEEK_API_KEY: 'fake-only-secret' };
const solution = { approach: '累加', steps: ['遍历累加'], assumptions: [], timeComplexity: 'O(n)', spaceComplexity: 'O(1)', language: 'javascript', entrypoint: 'solve', inputContract: 'input 为整数数组', code: 'function solve(input) { return input.reduce((a,b) => a+b, 0); }', cautions: [] };
const response = (value: unknown = solution, finish = 'stop') => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }] });
const code = (expected: string) => (error: unknown) => error instanceof GenerationError && error.code === expected;

test('解法必须绑定完整已确认题意，未确认或待澄清均拒绝', async () => {
  let calls = 0;
  const generate = createSolutionGenerator(async () => { calls++; return response(); });
  for (const value of [{}, { confirmed: { ...confirmed, status: 'draft' } }, { confirmed: { ...confirmed, problem: { ...confirmed.problem, missingInformation: ['范围？'] } } }, { confirmed: { ...confirmed, problem: { ...confirmed.problem, inputDescription: '' } } }]) {
    assert.equal(solutionInputSchema.safeParse(value).success, false);
    await assert.rejects(generate(value, env), code('INVALID_INPUT'));
  }
  assert.equal(calls, 0);
});
test('解法只返回文本，服务端决定未验证状态，不执行模型代码', async () => {
  const generate = createSolutionGenerator(async (_url, options) => {
    assert.equal(options?.redirect, 'manual');
    const body = JSON.parse(options?.body as string);
    assert.deepEqual(JSON.parse(body.messages.find((m: {role: string}) => m.role === 'user').content).problem, confirmed.problem);
    assert.equal(body.max_tokens, 6000);
    return response({ ...solution, code: 'throw new Error("must never execute")' });
  });
  const result = solutionResultSchema.parse(await generate(input, env));
  assert.equal(result.verification.status, 'not_run');
  assert.equal(result.solution.code.includes('must never execute'), true);
  assert.equal(JSON.stringify(result).includes(env.DEEPSEEK_API_KEY), false);
});
test('可选参考代码从原题与对话直接生成，不需要解析或人工确认字段', async () => {
  let calls = 0;
  const generate = createSolutionGenerator(async (_url, options) => {
    calls++;
    const body = JSON.parse(String(options?.body));
    const sent = JSON.parse(body.messages.find((m: {role: string}) => m.role === 'user').content);
    assert.equal(sent.originalText, text);
    assert.equal(sent.discussion, '空数组返回零。');
    return response();
  });
  const result = await generate({ text, context: '空数组返回零。' }, env);
  assert.equal(calls, 1);
  assert.equal(result.verification.status, 'not_run');
});
test('拒绝模型伪造验证结果、未知字段和截断输出', async () => {
  await assert.rejects(createSolutionGenerator(async () => response({ ...solution, verification: 'passed' }))(input, env), code('INVALID_OUTPUT'));
  await assert.rejects(createSolutionGenerator(async () => response(solution, 'length'))(input, env), code('INCOMPLETE'));
});
test('解法超时释放锁，并发拦截；失败计入12次限额，无自动重试', async () => {
  const generate = createSolutionGenerator(async (_url, opts) => new Promise((_resolve, reject) => opts?.signal?.addEventListener('abort', () => reject(new Error('abort')))), Date.now, 10);
  const first = generate(input, env);
  await assert.rejects(generate(input, env), code('BUSY'));
  await assert.rejects(first, code('TIMEOUT'));
  await assert.rejects(generate(input, env), code('TIMEOUT'));
  let count = 0;
  const failed = createSolutionGenerator(async () => { count++; return new Response('secret', { status: 401 }); }, () => 1);
  for (let i = 0; i < 12; i++) await assert.rejects(failed(input, env), code('MODEL_HTTP'));
  await assert.rejects(failed(input, env), code('BUDGET_LIMIT'));
  assert.equal(count, 12);
});
test('解法 API 拦截跨域和超大请求，重定向不泄露密钥', async () => {
  const request = (body: string, origin = 'http://localhost:3001') => new Request('http://localhost:3001/api/solutions/generate', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
  const generate = createSolutionGenerator(async () => response());
  assert.equal((await solutionResponse(request(JSON.stringify(input)), env, generate)).status, 200);
  assert.equal((await solutionResponse(request('{}', 'https://evil.test'), env, generate)).status, 403);
  assert.equal((await solutionResponse(request('x'.repeat(160001)), env, generate)).status, 413);
  assert.equal((await solutionResponse(request('{'), env, generate)).status, 400);
  await assert.rejects(createSolutionGenerator(async () => new Response('', { status: 302 }))(input, env), code('MODEL_REDIRECT'));
});
