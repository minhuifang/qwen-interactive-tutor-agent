import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../apps/web/lib/server/teach.ts';
import { createSolutionGenerator } from '../apps/web/lib/server/generate-solution.ts';
import { teachingResultSchema } from '../apps/web/lib/teaching-schema.ts';
const text = '给定一个整数数组，返回数组中全部整数之和，空数组返回零。';
const draft = { title: '数组求和', statement: text, inputDescription: '整数数组', outputDescription: '整数', constraints: [], examples: [], missingInformation: [] as string[] };
const prepared = { version: '0.1', status: 'ready', source: 'deepseek', originalText: text, problem: draft };
const solution = { approach: '从零开始累加', steps: ['用 [1,2] 演示，累加得到 3'], assumptions: [], timeComplexity: 'O(n)', spaceComplexity: 'O(1)', language: 'javascript', entrypoint: 'solve', inputContract: '整数数组', code: 'function solve(input) { return input.reduce((a,b)=>a+b,0); }', cautions: [] };
const usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 };
const reply = (s: unknown) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(s) } }], usage });
const env = { DEEPSEEK_API_KEY: 'fake-secret' };
const request = () => new Request('http://localhost:3001/api/teach', { method: 'POST', headers: { origin: 'http://localhost:3001', 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
test('清楚题意无需人工确认，无范围与样例也自动讲解，保持未运行', async () => {
  const teacher = createTeacher(async () => ({ draft, source: 'deepseek', model: 'fake', usage }), createSolutionGenerator(async () => reply(solution)));
  const response = await teacher(request(), env);
  assert.equal(response.status, 200);
  const data = teachingResultSchema.parse(await response.json());
  assert.equal(data.status, 'ready');
  if (data.status === 'ready') assert.equal(data.result.verification.status, 'not_run');
});
test('关键歧义返回可回答问题，不调用解法或伪造人工确认', async () => {
  let called = false;
  const teacher = createTeacher(async () => ({ draft: { ...draft, missingInformation: ['返回数值还是下标？'] }, source: 'deepseek', model: 'fake', usage }), async () => { called = true; throw new Error('must not generate'); });
  const response = await teacher(request(), env);
  assert.equal((await response.json()).status, 'clarification');
  assert.equal(called, false);
});
test('assumptions 单字符串无损转数组；缺失字段由模型修复一次，合计用量', async () => {
  const normalized = await createSolutionGenerator(async () => reply({ ...solution, assumptions: '输入均为整数' }))({ prepared }, env);
  assert.deepEqual(normalized.solution.assumptions, ['输入均为整数']);
  let calls = 0;
  const fixed = await createSolutionGenerator(async (_url, options) => {
    calls++;
    if (calls === 1) return reply({ ...solution, assumptions: null });
    assert.match(String(options?.body), /assumptions: invalid_type/);
    return reply(solution);
  })({ prepared }, env);
  assert.equal(calls, 2);
  assert.equal(fixed.usage?.total_tokens, 10);
});
test('重复格式错误仅修复一次，不清空假设绕过验证', async () => {
  let calls = 0;
  await assert.rejects(createSolutionGenerator(async () => { calls++; return reply({ ...solution, assumptions: ['字'.repeat(301)] }); })({ prepared }, env), /不是题目输入错误/);
  assert.equal(calls, 2);
});
